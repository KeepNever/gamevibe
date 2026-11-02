import { createMiddleware } from 'hono/factory'
import { verifyToken } from '../lib/crypto.ts'
import { hasPermission, getAccountState } from '../lib/rbac.ts'
import { db } from '../db/index.ts'
import { readSessionCookie, getSession, isSessionAlive, touchSession } from '../lib/session.ts'

/**
 * 鉴权中间件
 * ─────────────────────────────────────────────────────────
 * 双通道（过渡期）：
 *   1. httpOnly Cookie（新）—— 前端 JS 读不到，XSS 偷不走
 *   2. X-Auth-Token / Authorization（旧）—— 保留给脚本、旧会话、应急回退
 *
 * 令牌只证明「签发时这个人存在」，不证明「现在还能用」。所以还要过两关：
 *   - 有 sid：查 sessions 表，撤销/过期即失效 → 这才有「踢下线」
 *   - 无 sid（兼容期老令牌）：比对 users.password_changed_at，
 *     改过密码的老令牌一律失效，避免「改了密码旧设备还能用」这种假安全
 */

export interface Identity {
  userId: string
  username: string
  sid?: string
  /** 老令牌（无 sid），不受会话管理控制，但会被改密一刀切 */
  legacy: boolean
}

function readRawToken(c: any): string | undefined {
  const cookieToken = readSessionCookie(c)
  if (cookieToken) return cookieToken
  const custom = c.req.header('X-Auth-Token') || c.req.header('x-auth-token')
  if (custom) return custom
  const auth = c.req.header('Authorization')
  if (!auth) return undefined
  return auth.startsWith('Bearer ') ? auth.slice(7) : auth
}

export type ResolveResult =
  | { ok: true; identity: Identity }
  | { ok: false; status: 401 | 403; body: Record<string, unknown> }

export function resolveIdentity(c: any): ResolveResult {
  const raw = readRawToken(c)
  if (!raw) return { ok: false, status: 401, body: { error: '未授权：缺少令牌' } }

  const payload = verifyToken(raw)
  if (!payload) {
    return { ok: false, status: 401, body: { error: '令牌无效或已过期，请重新登录' } }
  }

  let userId = payload.sub
  let username = payload.username
  let legacy = true

  if (payload.sid) {
    const s = getSession(db, payload.sid)
    if (!isSessionAlive(s)) {
      return {
        ok: false,
        status: 401,
        body: { error: '登录状态已失效，请重新登录', code: 'SESSION_REVOKED' },
      }
    }
    // 以会话记录为准，避免令牌里的冗余字段和真实账号漂移
    userId = String(s.user_id)
    if (s.username) username = String(s.username)
    legacy = false
    touchSession(db, s)
  }

  // 账号状态：不存在 / 已注销 / 已停用
  const state = getAccountState(userId)
  if (state === 'missing') {
    return { ok: false, status: 401, body: { error: '账号不存在，请重新登录', code: 'ACCOUNT_MISSING' } }
  }
  if (state === 'disabled') {
    return { ok: false, status: 403, body: { error: '账号已被停用', code: 'ACCOUNT_DISABLED' } }
  }
  if (state === 'deleted') {
    return {
      ok: false,
      status: 401,
      body: { error: '账号已注销', code: 'ACCOUNT_DELETED' },
    }
  }

  // 老令牌：改密后立即失效（无 sid 无法靠会话表撤销，只能靠时间比对）
  if (legacy) {
    const row = db.prepare('SELECT username, password_changed_at FROM users WHERE id=?').get(userId) as
      | { username: string; password_changed_at: number }
      | undefined
    if (row) {
      username = String(row.username)
      const changedAt = Number(row.password_changed_at || 0)
      const issuedAt = Number(payload.iat || 0)
      if (changedAt > 0 && issuedAt * 1000 < changedAt) {
        return {
          ok: false,
          status: 401,
          body: { error: '密码已修改，请重新登录', code: 'PASSWORD_CHANGED' },
        }
      }
    }
  }

  return { ok: true, identity: { userId, username, sid: payload.sid, legacy } }
}

export const authMiddleware = createMiddleware<{
  Variables: { userId: string; username: string; sessionId: string | undefined; legacyToken: boolean }
}>(async (c, next) => {
  const r = resolveIdentity(c)
  if (!r.ok) return c.json(r.body, r.status)
  c.set('userId', r.identity.userId)
  c.set('username', r.identity.username)
  c.set('sessionId', r.identity.sid)
  c.set('legacyToken', r.identity.legacy)
  await next()
})

/**
 * 可选鉴权：有凭证就识别，没有/失效就当作匿名继续。
 * 用于 /auth/me 这类「刷新页面必调」的接口——匿名访问不该返回 401，
 * 否则每次打开首页都会在控制台留一条红色错误，也会误导前端判断会话失效。
 */
export const optionalAuth = createMiddleware<{
  Variables: { userId: string | undefined; username: string | undefined; sessionId: string | undefined }
}>(async (c, next) => {
  const r = resolveIdentity(c)
  if (r.ok) {
    c.set('userId', r.identity.userId)
    c.set('username', r.identity.username)
    c.set('sessionId', r.identity.sid)
  }
  await next()
})

/**
 * 权限点校验中间件，必须挂在 authMiddleware 之后：
 *   route.delete('/x', authMiddleware, requirePermission('review.delete.any'), handler)
 * 未登录返回 401，已登录但缺权限返回 403（两者语义不同，前端据此区分跳转）
 */
export function requirePermission(perm: string) {
  return createMiddleware<{ Variables: { userId: string; username: string } }>(async (c, next) => {
    const userId = c.get('userId')
    if (!userId) return c.json({ error: '未授权：缺少令牌' }, 401)
    if (!hasPermission(userId, perm)) {
      return c.json({ error: '权限不足，无法执行此操作', code: 'FORBIDDEN', permission: perm }, 403)
    }
    await next()
  })
}
