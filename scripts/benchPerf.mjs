// Turso 模式下测推荐接口延迟（登录 → 两次请求取第二次，消除冷启动差异）
for (const k of Object.keys(process.env)) if (/proxy/i.test(k)) delete process.env[k]
const BASE = process.argv[2] || 'http://127.0.0.1:8792'
const EMAIL = process.env.SHOT_ADMIN || '老白不白@seed.local'
const PASS = process.env.ADMIN_PASS || 'seedpass1234'

async function main() {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASS }),
  })
  const cookie = (r.headers.getSetCookie ? r.headers.getSetCookie() : []).map((s) => s.split(';')[0]).join('; ')
  console.log('登录:', r.status)

  for (const path of ['/api/ai/recommend?limit=4', '/api/reviews/vampire-survivors', '/api/social/notifications']) {
    // 预热一次（buddId/画像缓存）
    await fetch(`${BASE}${path}`, { headers: { Cookie: cookie } }).catch(() => {})
    const t0 = Date.now()
    const res = await fetch(`${BASE}${path}`, { headers: { Cookie: cookie } })
    const ms = Date.now() - t0
    console.log(`${path}: ${res.status} ${ms}ms`)
  }
}
main().catch((e) => {
  console.log('FAIL', e.message)
  process.exitCode = 1
})
