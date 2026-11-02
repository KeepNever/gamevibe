import type { DatabaseSync } from 'node:sqlite'

/**
 * RBAC 种子数据（幂等）。
 * 显式接收 db 实例，避免与 db/index.ts 形成循环导入。
 *
 * 设计要点：
 * - 角色用固定 id，重复执行不会重复插入
 * - 权限点按「资源.动作.范围」命名，前端可按 group_name 分组渲染
 * - 若系统里一个管理员都没有，把最早注册的用户提升为 admin（否则后台永远进不去）
 */
export function seedRbac(db: DatabaseSync): void {
  const now = Date.now()

  const roles: { id: string; key: string; name: string; desc: string; level: number }[] = [
    { id: 'role_admin', key: 'admin', name: '管理员', desc: '拥有全部权限，可管理用户与内容', level: 100 },
    { id: 'role_moderator', key: 'moderator', name: '版主', desc: '可审核与删除评论、查看用户', level: 50 },
    { id: 'role_user', key: 'user', name: '普通用户', desc: '默认为注册用户分配', level: 10 },
  ]
  const insRole = db.prepare(
    `INSERT OR IGNORE INTO roles (id, key, name, description, level, is_system, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?)`,
  )
  for (const r of roles) insRole.run(r.id, r.key, r.name, r.desc, r.level, now)

  const perms: { key: string; name: string; group: string; desc: string }[] = [
    { key: 'review.read.any', name: '查看所有评论', group: '评论管理', desc: '不受归属限制查看任意评论' },
    { key: 'review.delete.any', name: '删除任意评论', group: '评论管理', desc: '可删除他人发布的评论' },
    { key: 'review.moderate', name: '审核评论', group: '评论管理', desc: '隐藏或恢复评论' },
    { key: 'user.read', name: '查看用户列表', group: '用户管理', desc: '访问用户列表与详情' },
    { key: 'user.manage', name: '管理用户', group: '用户管理', desc: '调整角色、禁用账号' },
    { key: 'content.manage', name: '管理游戏内容', group: '内容管理', desc: '维护游戏资料与元数据' },
    { key: 'admin.access', name: '访问管理后台', group: '系统', desc: '进入 /admin 后台入口' },
  ]
  const insPerm = db.prepare(
    'INSERT OR IGNORE INTO permissions (id, key, name, group_name, description) VALUES (?, ?, ?, ?, ?)',
  )
  for (const p of perms) insPerm.run(`perm_${p.key.replace(/\./g, '_')}`, p.key, p.name, p.group, p.desc)

  // 角色 → 权限
  const grants: Record<string, string[]> = {
    admin: perms.map((p) => p.key),
    moderator: ['review.read.any', 'review.delete.any', 'review.moderate', 'user.read'],
    user: [],
  }
  const link = db.prepare(
    'INSERT OR IGNORE INTO role_permissions (role_id, permission_id) SELECT ?, id FROM permissions WHERE key = ?',
  )
  for (const [roleKey, keys] of Object.entries(grants)) {
    const role = db.prepare('SELECT id FROM roles WHERE key = ?').get(roleKey) as unknown as
      | { id: string }
      | undefined
    if (!role) continue
    for (const k of keys) link.run(role.id, k)
  }

  // 所有历史用户（含 seed 账号）补上默认角色
  const orphan = db
    .prepare('SELECT id FROM users WHERE id NOT IN (SELECT user_id FROM user_roles)')
    .all() as unknown as { id: string }[]
  const insUserRole = db.prepare(
    'INSERT OR IGNORE INTO user_roles (user_id, role_id, granted_at, granted_by) VALUES (?, ?, ?, ?)',
  )
  for (const u of orphan) insUserRole.run(u.id, 'role_user', now, 'system')

  // 一个管理员都没有 → 提升最早注册的用户
  const adminCount = db
    .prepare(
      `SELECT COUNT(*) AS c FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE r.key = 'admin'`,
    )
    .get() as unknown as { c: number }
  if (adminCount.c === 0) {
    const first = db
      .prepare('SELECT id, username FROM users ORDER BY created_at ASC LIMIT 1')
      .get() as unknown as { id: string; username: string } | undefined
    if (first) {
      insUserRole.run(first.id, 'role_admin', now, 'system')
      console.log(`[RBAC] 未发现管理员，已将最早注册的用户「${first.username}」提升为 admin`)
    }
  }
}
