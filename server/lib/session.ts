import type { DatabaseSync } from 'node:sqlite'
import { randomBytes } from 'node:crypto'
import type { Context } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'

/**
 * 会话层
 * ─────────────────────────────────────────────────────────
 * 目标是把「令牌存活」从纯无状态 JWT 变成「JWT + 服务端会话记录」：
 *   - JWT 只负责证明「这个 sid 是我签的」，不再单独作为登录凭据
 *   - 每个请求校验 session 是否存在 / 未撤销 / 未过期 → 才有「踢下线」
 *   - 令牌搬进 httpOnly Cookie，JS 读不到，XSS 拿不走
 * 兼容期：无 sid 的老令牌仍放行（见 middleware/auth.ts），
 * 靠 users.password_changed_at 兜住「改密后旧令牌失效」这条底线。
 */

export const SESSION_COOKIE = 'gv_session'

/** 同一会话 60 秒内只回写一次 last_seen_at，避免每个请求都写盘 */
const TOUCH_INTERVAL_MS = 60_000

export interface SessionRow {
  id: string
  user_id: string
  ip: string | null
  ua: string | null
  created_at: number
  last_seen_at: number
  expires_at: number
  revoked_at: number | null
  /** JOIN 出来的当前用户名：改过名之后令牌里的旧 username 不该继续被信任 */
  username?: string
}

export function createSession(
  db: DatabaseSync,
  userId: string,
  ttlSeconds: number,
  ip?: string,
  ua?: string,
): string {
  const id = randomBytes(18).toString('hex')
  const now = Date.now()
  db.prepare(
    `INSERT INTO sessions (id, user_id, ip, ua, created_at, last_seen_at, expires_at, revoked_at)
     VALUES (?,?,?,?,?,?,?,NULL)`,
  ).run(id, userId, ip ?? null, (ua ?? '').slice(0, 300) || null, now, now, now + ttlSeconds * 1000)
  return id
}

export function getSession(db: DatabaseSync, sid: string): SessionRow | null {
  const row = db
    .prepare(
      `SELECT s.*, u.username AS username
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.id = ?`,
    )
    .get(sid) as unknown as SessionRow | undefined
  return row ?? null
}

/** 会话是否仍然有效（存在、未撤销、未过期） */
export function isSessionAlive(s: SessionRow | null): s is SessionRow {
  if (!s) return false
  if (s.revoked_at) return false
  return Number(s.expires_at) > Date.now()
}

/** 更新最后活跃时间（节流写入） */
export function touchSession(db: DatabaseSync, s: SessionRow): void {
  const now = Date.now()
  if (now - Number(s.last_seen_at) < TOUCH_INTERVAL_MS) return
  db.prepare('UPDATE sessions SET last_seen_at=? WHERE id=?').run(now, s.id)
}

export function revokeSession(db: DatabaseSync, sid: string): void {
  db.prepare('UPDATE sessions SET revoked_at=? WHERE id=? AND revoked_at IS NULL').run(Date.now(), sid)
}

/**
 * 撤销该用户的全部会话。
 * exceptSid 用于「改密码后保留当前端，踢掉其它端」；
 * 不传则全踢（退出所有设备 / 注销账号）。
 */
export function revokeAllSessions(db: DatabaseSync, userId: string, exceptSid?: string): number {
  const now = Date.now()
  if (exceptSid) {
    const r = db
      .prepare('UPDATE sessions SET revoked_at=? WHERE user_id=? AND id<>? AND revoked_at IS NULL')
      .run(now, userId, exceptSid)
    return Number(r.changes ?? 0)
  }
  const r = db
    .prepare('UPDATE sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL')
    .run(now, userId)
  return Number(r.changes ?? 0)
}

/** 清理过期/已撤销超过 30 天的会话，避免表无限膨胀（启动时跑一次即可） */
export function pruneSessions(db: DatabaseSync): void {
  const cutoff = Date.now() - 30 * 24 * 3600 * 1000
  db.prepare('DELETE FROM sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)').run(
    Date.now(),
    cutoff,
  )
}

export interface SessionView {
  id: string
  ip: string | null
  device: string
  os: string
  current: boolean
  created_at: number
  last_seen_at: number
}

/** UA 粗解析：只求「设备列表里人能看懂」，不追求完整 */
export function parseUa(ua: string | null): { device: string; os: string } {
  const u = ua || ''
  let device = '未知设备'
  if (/Edg\//.test(u)) device = 'Edge'
  else if (/OPR\/|Opera/.test(u)) device = 'Opera'
  else if (/Chrome\//.test(u) && !/Chromium/.test(u)) device = 'Chrome'
  else if (/Firefox\//.test(u)) device = 'Firefox'
  else if (/Safari\//.test(u)) device = 'Safari'
  else if (/node|curl|python|okhttp/i.test(u)) device = '脚本/客户端'

  let os = '未知系统'
  if (/iPhone|iPad|iPod/.test(u)) os = 'iOS'
  else if (/Android/.test(u)) os = 'Android'
  else if (/Windows NT 10/.test(u)) os = 'Windows 10/11'
  else if (/Windows/.test(u)) os = 'Windows'
  else if (/Mac OS X/.test(u)) os = 'macOS'
  else if (/Linux/.test(u)) os = 'Linux'
  return { device, os }
}

export function listSessions(db: DatabaseSync, userId: string, currentSid?: string): SessionView[] {
  const rows = db
    .prepare(
      `SELECT * FROM sessions
        WHERE user_id=? AND revoked_at IS NULL AND expires_at > ?
        ORDER BY last_seen_at DESC LIMIT 50`,
    )
    .all(userId, Date.now()) as unknown as SessionRow[]

  return rows.map((r) => {
    const { device, os } = parseUa(r.ua)
    return {
      id: r.id,
      ip: r.ip,
      device,
      os,
      current: r.id === currentSid,
      created_at: Number(r.created_at),
      last_seen_at: Number(r.last_seen_at),
    }
  })
}

// ══ Cookie 读写 ══════════════════════════════════════════

/**
 * 是否走 HTTPS。
 * 线上在反向代理后面，协议看 x-forwarded-proto；本地 8792 是明文 HTTP，
 * 此时绝不能加 Secure，否则浏览器会直接丢弃 Cookie、登录态全丢。
 */
function isHttps(c: Context): boolean {
  const proto = c.req.header('x-forwarded-proto')?.split(',')[0]?.trim()
  if (proto) return proto === 'https'
  if (process.env.NODE_ENV === 'production') return true
  return new URL(c.req.url).protocol === 'https:'
}

/** 写入会话 Cookie：值就是 JWT（内含 sid），不是裸 sid —— 裸 id 可被伪造冒充 */
export function setSessionCookie(c: Context, token: string, ttlSeconds: number): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    path: '/',
    sameSite: 'Lax',
    secure: isHttps(c),
    maxAge: ttlSeconds,
  })
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
}

export function readSessionCookie(c: Context): string | undefined {
  return getCookie(c, SESSION_COOKIE)
}
