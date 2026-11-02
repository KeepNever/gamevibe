import { createMiddleware } from 'hono/factory'
import { verifyToken } from '../lib/crypto.ts'
import { hasPermission } from '../lib/rbac.ts'

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
