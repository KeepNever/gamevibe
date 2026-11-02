import type { DatabaseSync } from 'node:sqlite'
import type { Context } from 'hono'

/**
 * 审计日志
 * ─────────────────────────────────────────────────────────
 * 原则：**敏感操作必须留痕**，且留痕不能因为业务失败而丢。
 * 失败的尝试（改密旧密码错误、换绑验证码错误、登录失败）同样要记，
 * 否则事后复盘只能看到「成功的那一次」，看不出有人在撞。
 *
 * 记录内容刻意不含密码、令牌、验证码原文——审计表不该成为第二个泄露面。
 */

export type AuditAction =
  | 'auth.register'
  | 'auth.login'
  | 'auth.login.fail'
  | 'auth.logout'
  | 'auth.password.reset'
  | 'account.profile.update'
  | 'account.username.update'
  | 'account.password.change'
  | 'account.password.change.fail'
  | 'account.email.request'
  | 'account.email.confirm'
  | 'account.email.confirm.fail'
  | 'account.phone.update'
  | 'account.session.revoke'
  | 'account.logout_all'
  | 'account.delete'
  | 'admin.user.role'
  | 'admin.user.status'

export interface AuditInput {
  actorId?: string | null
  actorName?: string | null
  action: AuditAction
  targetType?: 'user' | 'session' | 'account'
  targetId?: string | null
  /** 变更明细：{ changes: [{ field, from, to }] } 或一句说明 */
  detail?: Record<string, unknown> | string | null
  result?: 'ok' | 'fail'
}

/**
 * 取客户端 IP。
 * 线上在反代后面，真实 IP 只在 x-forwarded-for 里；本地直连时这两个头都没有，
 * 再从 node-server 暴露的 socket 里取，避免审计记录里全是「未知」。
 */
export function clientIp(c: Context): string | undefined {
  const forwarded =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip')
  if (forwarded) return forwarded
  const incoming = (c.env as any)?.incoming
  const remote: string | undefined =
    incoming?.socket?.remoteAddress || incoming?.connection?.remoteAddress
  if (!remote) return undefined
  // IPv4 映射地址转成普通 IPv4，别在界面上显示 ::ffff:127.0.0.1
  return remote.replace(/^::ffff:/, '')
}

export function clientUa(c: Context): string | undefined {
  return c.req.header('user-agent')?.slice(0, 300)
}

/** 写一条审计。任何异常都吞掉——审计失败不该让用户操作失败 */
export function writeAudit(db: DatabaseSync, c: Context | null, input: AuditInput): void {
  try {
    db.prepare(
      `INSERT INTO audit_logs
         (actor_id, actor_name, action, target_type, target_id, detail, ip, ua, result, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      input.actorId ?? null,
      input.actorName ?? null,
      input.action,
      input.targetType ?? 'account',
      input.targetId ?? null,
      input.detail == null ? null : typeof input.detail === 'string' ? input.detail : JSON.stringify(input.detail),
      c ? clientIp(c) ?? null : null,
      c ? clientUa(c) ?? null : null,
      input.result ?? 'ok',
      Date.now(),
    )
  } catch (e) {
    console.warn('[audit] 写入失败：', e instanceof Error ? e.message : e)
  }
}

export interface AuditListQuery {
  page?: number
  pageSize?: number
  actorId?: string
  action?: string
  q?: string
}

export function listAudit(db: DatabaseSync, q: AuditListQuery = {}) {
  const page = Math.max(1, Number(q.page || 1))
  const size = Math.min(100, Math.max(1, Number(q.pageSize || 20)))
  const offset = (page - 1) * size

  const where: string[] = []
  const args: (string | number | null)[] = []
  if (q.actorId) {
    where.push('actor_id = ?')
    args.push(q.actorId)
  }
  if (q.action) {
    where.push('action LIKE ?')
    args.push(`${q.action}%`)
  }
  if (q.q) {
    where.push('(actor_name LIKE ? OR action LIKE ? OR target_id LIKE ? OR detail LIKE ?)')
    const like = `%${q.q}%`
    args.push(like, like, like, like)
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const total = (
    db.prepare(`SELECT COUNT(*) AS c FROM audit_logs ${clause}`).get(...args) as unknown as { c: number }
  ).c

  const rows = db
    .prepare(`SELECT * FROM audit_logs ${clause} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...args, size, offset) as unknown as any[]

  return {
    items: rows.map((r) => ({
      id: Number(r.id),
      actorId: r.actor_id,
      actorName: r.actor_name,
      action: r.action,
      targetType: r.target_type,
      targetId: r.target_id,
      detail: r.detail,
      ip: r.ip,
      result: r.result,
      created_at: Number(r.created_at),
    })),
    total,
    page,
    pageSize: size,
  }
}

/** 动作 → 中文标签，前端与后台共用同一份口径 */
export const AUDIT_LABELS: Record<string, string> = {
  'auth.register': '注册账号',
  'auth.login': '登录',
  'auth.login.fail': '登录失败',
  'auth.logout': '退出登录',
  'auth.password.reset': '重置密码（邮件链接）',
  'account.profile.update': '修改个人资料',
  'account.username.update': '修改用户名',
  'account.password.change': '修改密码',
  'account.password.change.fail': '改密失败（旧密码错误）',
  'account.email.request': '申请换绑邮箱',
  'account.email.confirm': '完成换绑邮箱',
  'account.email.confirm.fail': '换绑邮箱验证失败',
  'account.phone.update': '更新手机号',
  'account.session.revoke': '踢下线某设备',
  'account.logout_all': '退出所有设备',
  'account.delete': '注销账号',
  'admin.user.role': '调整用户角色',
  'admin.user.status': '启用/停用账号',
}
