import { createMiddleware } from 'hono/factory'
import { verifyToken } from '../lib/crypto.ts'
import { hasPermission, getAccountState } from '../lib/rbac.ts'

// 在 Hono 上下文中注入 userId / username
export const authMiddleware = createMiddleware<{
  Variables: { userId: string; username: string }
}>(async (c, next) => {
  // 边缘网关（如腾讯云 EdgeOne/STGW）会覆写 Authorization 头，
  // 因此优先使用自定义的 X-Auth-Token 头传递用户 JWT。
  const custom = c.req.header('X-Auth-Token') || c.req.header('x-auth-token')
  const auth = c.req.header('Authorization')
  const raw = custom || auth
  if (!raw) {
    return c.json({ error: '未授权：缺少令牌' }, 401)
  }
  const token = custom ? raw : raw.startsWith('Bearer ') ? raw.slice(7) : raw
  const payload = verifyToken(token)
  if (!payload) {
    return c.json({ error: '令牌无效或已过期，请重新登录' }, 401)
  }
  // 令牌只证明「签发时这个人存在」，不证明「现在还能用」。
  // 实测过：不加这一步，管理员停用某人后，对方手里的旧 token 仍能正常读列表、
  // 发评论、关注他人（只有 /auth/me 自己查了状态），最长可撑到 token 过期（记住我 30 天）。
  const state = getAccountState(payload.sub)
  if (state === 'missing') {
    return c.json({ error: '账号不存在，请重新登录', code: 'ACCOUNT_MISSING' }, 401)
  }
  if (state === 'disabled') {
    return c.json({ error: '账号已被停用', code: 'ACCOUNT_DISABLED' }, 403)
  }
  c.set('userId', payload.sub)
  c.set('username', payload.username)
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
