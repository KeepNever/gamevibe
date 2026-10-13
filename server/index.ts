import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { cors } from 'hono/cors'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, extname, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { env } from './env.ts'
import { db } from './db/index.ts'
import auth from './routes/auth.ts'
import library from './routes/library.ts'
import collections from './routes/collections.ts'
import chat from './routes/chat.ts'
import aiPublic from './routes/aiPublic.ts'
import aiPersonal from './routes/aiPersonal.ts'
import games from './routes/games.ts'
import reviews from './routes/reviews.ts'
import igdb from './routes/igdb.ts'
import news from './routes/news.ts'
import stats from './routes/stats.ts'
import recommendations from './routes/recommendations.ts'
import social from './routes/social.ts'
import live from './routes/live.ts'
import diag from './routes/diag.ts'
import { rateLimit } from './middleware/rateLimit.ts'
import { securityHeaders } from './middleware/securityHeaders.ts'

// ════════════════════════════════════════════════
//  进程级保护：单条坏请求/未捕获异常不再拖垮整个服务
// ════════════════════════════════════════════════
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err?.message || err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', (reason as Error)?.message || reason)
})

const app = new Hono()

// ════════════════════════════════════════════════
//  全局安全中间件（最先执行）
// ════════════════════════════════════════════════

// 安全响应头（所有路由生效）
app.use('*', securityHeaders())

// 跨域配置（联调时前端通过 Vite proxy 访问，此处仍保留 CORS 以便独立调用）
app.use(
  '/api/*',
  cors({
    origin: (origin) => {
      // 允许列表中的 origin 或无 origin 的同源请求（如 server-sent events / curl）
      const allowed = env.CORS_ORIGIN.split(',').map((s) => s.trim())
      if (!origin || allowed.includes(origin)) return origin
      // 开发环境宽松放行
      if (process.env.NODE_ENV !== 'production') return origin
      return ''
    },
    allowHeaders: ['Authorization', 'X-Auth-Token', 'Content-Type', 'X-Request-ID'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
    maxAge: 86400, // 预检缓存 24 小时
  }),
)

// ════════════════════════════════════════════════
//  速率限制（按端点分级）
// ════════════════════════════════════════════════

// 认证端点最严格：10 次/分钟（防暴力破解）
app.use('/api/auth/*', rateLimit({ maxRequests: 10, windowMs: 60_000 }))
// AI 对话端点最贵（真实调用 LLM、流式长文本）：20 次/分钟
app.use('/api/ai/chat', rateLimit({ maxRequests: 20, windowMs: 60_000 }))
// AI 其余端点（精选 / 点评 / 口碑 / 画像，均带缓存）：60 次/分钟
// 说明：详情页一次会打 review + reviewDigest 两个 AI 请求，
// 若整树沿用 20 次/分钟会误伤正常浏览（10 个详情页即触顶，且限流键按路径前缀分组）
app.use('/api/ai/*', rateLimit({ maxRequests: 60, windowMs: 60_000 }))
// 写入操作：30 次/分钟
app.use(
  '/api/library/*',
  rateLimit({ maxRequests: 30, windowMs: 60_000 }),
)
app.use(
  '/api/collections/*',
  rateLimit({ maxRequests: 30, windowMs: 60_000 }),
)
// 其他 API：默认 60 次/分钟
app.use('/api/*', rateLimit({ maxRequests: 60, windowMs: 60_000 }))

// ════════════════════════════════════════════════
//  路由注册
// ════════════════════════════════════════════════

app.get('/api/health', (c) =>
  c.json({
    ok: true,
    time: Date.now(),
    version: '1.1.0',
    security: { rateLimit: true, securityHeaders: true },
  })
)

app.route('/api/auth', auth)
app.route('/api/library', library)
app.route('/api/collections', collections)
app.route('/api/ai', chat)
app.route('/api/ai', aiPublic)
app.route('/api/ai', aiPersonal)
app.route('/api/live', live)
app.route('/api/diag', diag)
app.route('/api/games', games)
app.route('/api/reviews', reviews)
app.route('/api/igdb', igdb)
app.route('/api/news', news)
app.route('/api/stats', stats)
app.route('/api/recommendations', recommendations)
app.route('/api/social', social)

// ════════════════════════════════════════════════
//  静态资源托管（同源部署前端，SPA fallback）
//  仅当项目根目录存在 dist/ 时启用，使 `npm run server`
//  同时提供 API 与前端，成为可一键部署的全栈单服务。
// ════════════════════════════════════════════════

const DIST_DIR = fileURLToPath(new URL('../dist', import.meta.url))
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
}

if (existsSync(DIST_DIR)) {
  app.get('*', (c) => {
    const urlPath = decodeURIComponent(c.req.path)
    if (urlPath.startsWith('/api/')) return c.notFound()

    // 防目录穿越：解析后必须仍在 DIST_DIR 内
    const resolved = normalize(join(DIST_DIR, urlPath))
    if (!resolved.startsWith(DIST_DIR)) return c.body('Forbidden', 403)

    let filePath = resolved
    // 未命中文件或命中目录 → SPA 回退到 index.html
    if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
      filePath = join(DIST_DIR, 'index.html')
    }
    const ext = extname(filePath).toLowerCase()
    const body = readFileSync(filePath)
    return new Response(body, {
      headers: { 'Content-Type': MIME[ext] || 'application/octet-stream' },
    })
  })
  console.log('  📦 静态托管已启用：dist/ 将通过本服务同源提供')
}

// ════════════════════════════════════════════════
//  全局错误处理兜底
// ════════════════════════════════════════════════

app.onError((err, c) => {
  console.error(`[API Error] ${c.req.method} ${c.req.url}:`, err.message)
  // 生产环境不暴露内部堆栈
  const isDev = process.env.NODE_ENV !== 'production'
  return c.json(
    {
      error: isDev ? err.message : '\u670d\u52a1\u5668\u5185\u90e8\u9519\u8bef',
      ...(isDev && { stack: err.stack?.split('\n').slice(0, 5) }),
    },
    500,
  )
})

// 404 兜底
app.notFound((c) => c.json({ error: '\u8d44\u6e90\u4e0d\u5b58\u5728' }, 404))

// 首次启动自动灌入演示数据（users 为空时才执行；seed 内部 INSERT OR IGNORE 幂等）
try {
  const u = db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }
  if (u.c === 0) {
    const seedPath = fileURLToPath(new URL('../scripts/seedSocial.mjs', import.meta.url))
    console.log('  🌱 首次启动，自动灌入演示数据…')
    execFileSync(process.execPath, [seedPath], { stdio: 'ignore', env: process.env })
  }
} catch (e) {
  console.warn('[seed] 自动灌库跳过：', e instanceof Error ? e.message : e)
}

serve({ fetch: app.fetch, port: env.PORT, hostname: '0.0.0.0' }, (info) => {
  console.log(`\uD83C\uDFAE GameVibe \u540e\u7aef\u5df2\u542f\u52a8: http://localhost:${info.port}`)
  console.log(`   \u5b89\u5168: Rate Limit \u2705 | Security Headers \u2705 | CORS \u2705`)
})
