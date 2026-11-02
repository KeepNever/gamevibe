import { Hono } from 'hono'
import { db } from '../db/index.ts'
import { authMiddleware, requirePermission } from '../middleware/auth.ts'
import { assignRole, revokeRole, getMaxLevel, listRoles, getUserRoles } from '../lib/rbac.ts'
import { writeAudit, listAudit, AUDIT_LABELS } from '../lib/audit.ts'
import { revokeAllSessions } from '../lib/session.ts'

const admin = new Hono<{ Variables: { userId: string; username: string } }>()

// /api/admin/* 全部需要登录（这是独立子应用，不影响其它公开路由）
admin.use('*', authMiddleware)

/** 分页参数收敛，防止 pageSize 过大拖库 */
function paging(c: any): { page: number; size: number; offset: number } {
  const page = Math.max(1, Number(c.req.query('page') || 1))
  const size = Math.min(100, Math.max(1, Number(c.req.query('pageSize') || 20)))
  return { page, size, offset: (page - 1) * size }
}

// ══ 用户列表 ══════════════════════════════════════════
admin.get('/users', requirePermission('user.read'), (c) => {
  const q = String(c.req.query('q') || '').trim()
  const { page, size, offset } = paging(c)
  const like = `%${q}%`

  const where = q ? 'WHERE username LIKE ? OR email LIKE ? OR display_name LIKE ?' : ''
  const args = q ? [like, like, like] : []

  const total = (
    db.prepare(`SELECT COUNT(*) AS c FROM users ${where}`).get(...args) as unknown as { c: number }
  ).c

  const rows = db
    .prepare(
      `SELECT id, username, email, display_name, avatar, status, created_at
         FROM users ${where}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?`,
    )
    .all(...args, size, offset) as unknown as any[]

  const users = rows.map((r) => ({
    ...r,
    roles: getUserRoles(r.id).map((x) => x.key),
  }))

  return c.json({ users, total, page, pageSize: size })
})

// ══ 角色与权限点清单（后台展示用）══════════════════════
admin.get('/roles', requirePermission('admin.access'), (c) => {
  const perms = db
    .prepare('SELECT key, name, group_name, description FROM permissions ORDER BY group_name, key')
    .all()
  return c.json({ roles: listRoles(), permissions: perms })
})

// ══ 调整角色 ══════════════════════════════════════════
admin.patch('/users/:id/role', requirePermission('user.manage'), async (c) => {
  const me = c.get('userId')
  const targetId = c.req.param('id')
  const body = await c.req.json().catch(() => null)
  const roleKey = String(body?.role || '')

  if (!['admin', 'moderator', 'user'].includes(roleKey)) {
    return c.json({ error: '角色不合法' }, 400)
  }
  if (targetId === me) {
    return c.json({ error: '不能修改自己的角色' }, 400)
  }

  const target = db.prepare('SELECT id, username FROM users WHERE id=?').get(targetId) as any
  if (!target) return c.json({ error: '用户不存在' }, 404)

  // 不能操作与自己同级或更高权限的人（防止管理员互相降级）
  const myLevel = getMaxLevel(me)
  const targetLevel = getMaxLevel(targetId)
  if (targetLevel >= myLevel) {
    return c.json({ error: '不能修改同级或更高权限的用户' }, 403)
  }
  const roleId = (
    db.prepare('SELECT id, level FROM roles WHERE key=?').get(roleKey) as unknown as {
      id: string
      level: number
    }
  )?.level
  if (roleId === undefined) return c.json({ error: '角色不存在' }, 400)
  if (roleId >= myLevel) return c.json({ error: '不能授予与自己同级或更高的角色' }, 403)

  // 单人单角色：先清空再赋新角色（保持模型简单可解释）
  const before = getUserRoles(targetId).map((r) => r.key)
  for (const r of getUserRoles(targetId)) revokeRole(targetId, r.key)
  assignRole(targetId, roleKey, me)

  writeAudit(db, c, {
    actorId: me,
    actorName: c.get('username'),
    action: 'admin.user.role',
    targetType: 'user',
    targetId,
    detail: { user: target.username, changes: [{ field: '角色', from: before.join(','), to: roleKey }] },
  })

  return c.json({ ok: true, user: { id: targetId, roles: [roleKey] } })
})

// ══ 启用 / 停用账号 ═══════════════════════════════════
admin.patch('/users/:id/status', requirePermission('user.manage'), async (c) => {
  const me = c.get('userId')
  const targetId = c.req.param('id')
  const body = await c.req.json().catch(() => null)
  const status = String(body?.status || '')

  if (!['active', 'disabled'].includes(status)) return c.json({ error: '状态不合法' }, 400)
  if (targetId === me) return c.json({ error: '不能停用自己的账号' }, 400)

  const target = db.prepare('SELECT id, username, status FROM users WHERE id=?').get(targetId) as any
  if (!target) return c.json({ error: '用户不存在' }, 404)

  if (getMaxLevel(targetId) >= getMaxLevel(me)) {
    return c.json({ error: '不能操作同级或更高权限的用户' }, 403)
  }

  db.prepare('UPDATE users SET status=?, updated_at=? WHERE id=?').run(status, Date.now(), targetId)

  writeAudit(db, c, {
    actorId: me,
    actorName: c.get('username'),
    action: 'admin.user.status',
    targetType: 'user',
    targetId,
    detail: { user: target.username, changes: [{ field: '状态', from: target.status, to: status }] },
  })

  // 停用后必须立刻踢掉该用户的全部会话，否则他手里的 Cookie 还能用到自然过期
  if (status === 'disabled') {
    revokeAllSessions(db, String(targetId))
  }

  return c.json({ ok: true, user: { id: targetId, status } })
})

// ══ 审计日志（谁在何时对谁做了什么）═══════════════════
admin.get('/audit', requirePermission('admin.access'), (c) => {
  const page = Number(c.req.query('page') || 1)
  const pageSize = Number(c.req.query('pageSize') || 20)
  const q = String(c.req.query('q') || '').trim()
  const action = String(c.req.query('action') || '').trim()
  const r = listAudit(db, { page, pageSize, q, action })
  return c.json({ ...r, labels: AUDIT_LABELS })
})

// ══ 概览统计 ══════════════════════════════════════════
admin.get('/overview', requirePermission('admin.access'), (c) => {
  const users = (db.prepare('SELECT COUNT(*) AS c FROM users').get() as unknown as { c: number }).c
  const disabled = (
    db.prepare("SELECT COUNT(*) AS c FROM users WHERE status='disabled'").get() as unknown as {
      c: number
    }
  ).c
  const admins = (
    db.prepare(
      "SELECT COUNT(*) AS c FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE r.key='admin'",
    ).get() as unknown as { c: number }
  ).c
  const reviews = (db.prepare('SELECT COUNT(*) AS c FROM reviews').get() as unknown as { c: number }).c
  return c.json({ users, disabled, admins, reviews })
})

export default admin
