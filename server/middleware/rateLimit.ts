/**
 * 速率限制中间件（基于内存的滑动窗口）
 *
 * - 每个端点可配置独立限额（默认: 60次/分钟）
 * - 使用 Map 存储，key = IP + 路径前缀
 * - 超限返回 429 + Retry-After
 * - 定期清理过期条目防止内存泄漏
 */

interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()
// 每 5 分钟清理一次过期桶
const CLEANUP_MS = 5 * 60 * 1000
let lastCleanup = Date.now()

function cleanup() {
  const now = Date.now()
  if (now - lastCleanup < CLEANUP_MS) return
  for (const [k, b] of buckets) {
    if (now >= b.resetAt) buckets.delete(k)
  }
  lastCleanup = now
}

export interface RateLimitOptions {
  /** 窗口期内的最大请求数，默认 60 */
  maxRequests?: number
  /** 窗口期毫秒数，默认 60000 (1 分钟) */
  windowMs?: number
}

/**
 * 创建速率限制中间件
 */
export function rateLimit(opts?: RateLimitOptions) {
  // CI / 回归环境整体放大配额（RATE_LIMIT_SCALE=100），
  // 避免回归脚本连跑撞限流产生 429 假失败。默认 1 = 生产行为不变
  const scale = Math.max(1, Number(process.env.RATE_LIMIT_SCALE || 1) || 1)
  const max = Math.ceil((opts?.maxRequests ?? 60) * scale)
  const windowMs = opts?.windowMs ?? 60_000

  return async function rateLimitMiddleware(c: any, next: any) {
    cleanup()

    // 提取客户端标识：优先 X-Forwarded-For → X-Real-Ip → 远程地址
    const ip =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
      c.req.header('x-real-ip') ||
      c.req.header('remote-address') ||
      'unknown'

    const pathPrefix = new URL(c.req.url).pathname.split('/').slice(0, 4).join('/')
    // 同一路径可能同时命中多条规则（/api/auth/login 既属于 /api/auth/* 也属于 /api/*）。
    // 若共用同一个桶，每个请求会被重复计数，实际配额只剩配置值的一半
    // （10/min 的认证限流因此变成 5/min）。把限额并入 key，让每条规则独立计数。
    const key = `${ip}:${pathPrefix}:${max}`

    const now = Date.now()
    let bucket = buckets.get(key)

    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 1, resetAt: now + windowMs }
      buckets.set(key, bucket)
    } else {
      bucket.count++
    }

    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000)
      return c.json(
        { error: '请求过于频繁，请稍后再试' },
        429,
        { 'Retry-After': String(Math.max(1, retryAfter)) }
      )
    }

    // 将剩余额度注入响应头（方便前端展示）
    c.res.headers.set('X-RateLimit-Limit', String(max))
    c.res.headers.set('X-RateLimit-Remaining', String(Math.max(0, max - bucket.count)))

    await next()
  }
}
