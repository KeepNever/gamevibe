// 探针：验证到 Turso 的 HTTPS 443 管道是否可达、token 是否有效。
// 两种调用目标都测：libSQL 的 /v2/pipeline 与平台健康页。
// 不打印 token 任何片段。
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

function loadEnv(file) {
  const out = {}
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!m) continue
    let v = m[2]
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    out[m[1]] = v
  }
  return out
}

const env = { ...loadEnv(join(root, '.env')), ...process.env }
const rawUrl = env.TURSO_DATABASE_URL || ''
const token = env.TURSO_AUTH_TOKEN || ''

console.log('── 配置检查 ──')
console.log('URL 原样:', JSON.stringify(rawUrl))
console.log('URL 长度:', rawUrl.length)
console.log('token 长度:', token.length)
console.log('URL 可疑字符:', [...rawUrl].filter((c) => c.charCodeAt(0) > 126 || c.charCodeAt(0) < 33).map((c) => `U+${c.charCodeAt(0).toString(16)}`).join(',') || '无')

// libsql:// → https://，只用于探测
const httpUrl = rawUrl.replace(/^libsql:\/\//, 'https://').replace(/\/+$/, '')
console.log('推导出的 https 地址:', httpUrl)

let host
try {
  const u = new URL(httpUrl)
  host = u.host
  console.log('解析成功，host =', host)
} catch (e) {
  console.log('❌ URL 解析失败:', e.message)
  process.exit(1)
}

async function timed(label, url, init) {
  const t0 = Date.now()
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(12_000) })
    const ms = Date.now() - t0
    const txt = await r.text()
    console.log(`\n[${label}] HTTP ${r.status} · ${ms}ms`)
    console.log('  响应片段:', txt.slice(0, 300).replace(/\s+/g, ' '))
    return { status: r.status, ms, txt }
  } catch (e) {
    const ms = Date.now() - t0
    console.log(`\n[${label}] ❌ ${ms}ms · ${e.name}: ${e.message}`)
    if (e.cause) console.log('  cause:', e.cause.code || e.cause.message || String(e.cause))
    return null
  }
}

// 1. 真实 SQL 往返
const body = JSON.stringify({
  requests: [
    { type: 'execute', stmt: { sql: 'SELECT 1 AS ok, sqlite_version() AS v' } },
    { type: 'close' },
  ],
})
const r1 = await timed('SQL 往返 /v2/pipeline', `${httpUrl}/v2/pipeline`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body,
})

if (r1 && r1.status === 200) {
  try {
    const j = JSON.parse(r1.txt)
    const res = j.results?.[0]?.response?.result
    console.log('  ✅ 库版本:', JSON.stringify(res?.rows))
  } catch {
    console.log('  ⚠️ 200 但响应不是预期 JSON')
  }
} else if (r1 && r1.status === 401) {
  console.log('  ⚠️ 401 = 网络通、token 无效或已吊销')
}

// 2. 对照：同一 host 的根路径（不存在的路径，4xx 也算通）
await timed('对照 /', `${httpUrl}/`, { method: 'GET' })

console.log('\n结论：')
if (r1?.status === 200) console.log('  ✅ 可以上。凭据有效，443 管道可用。')
else if (r1 && r1.status >= 400 && r1.status < 500) console.log('  ⚠️ 网络通但凭据/路径有问题，需排查')
else console.log('  ❌ 连不上。若本机能通、沙箱不通，则是沙箱出网限制。')
