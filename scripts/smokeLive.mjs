// 发布后线上冒烟：核心接口 + 社区新功能可达性
for (const k of Object.keys(process.env)) if (/proxy/i.test(k)) delete process.env[k]
const BASE = process.argv[2] || 'https://7fe3227e96e54b979531a0c7f7024f34.app.workbuddy.host'
const ADMIN_EMAIL = process.env.SHOT_ADMIN || '老白不白@seed.local'
const ADMIN_PASS = process.env.ADMIN_PASS || 'seedpass1234'

async function main() {
  const t0 = Date.now()
  const h = await fetch(`${BASE}/api/health`).then((r) => r.json())
  console.log('health:', h.ok, `(${Date.now() - t0}ms)`)

  const t1 = Date.now()
  const rev = await fetch(`${BASE}/api/reviews/vampire-survivors`).then((r) => r.json())
  console.log('评论:', rev.count, '条, 平均', rev.average, `(${Date.now() - t1}ms)`)

  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASS }),
  })
  const cookie = (login.headers.getSetCookie ? login.headers.getSetCookie() : [])
    .map((s) => s.split(';')[0])
    .join('; ')
  console.log('登录:', login.status)

  const rp = await fetch(`${BASE}/api/admin/reports`, { headers: { Cookie: cookie } })
  console.log('举报接口:', rp.status)

  const n = await fetch(`${BASE}/api/social/notifications`, { headers: { Cookie: cookie } }).then((r) => r.json())
  console.log('通知接口:', (n.notifications || []).length, '条, 未读', n.unread)

  const me = await fetch(`${BASE}/api/auth/me`, { headers: { Cookie: cookie } }).then((r) => r.json())
  console.log('me:', me.authenticated, (me.roles || []).map((r) => r.key).join(','))
}

main().catch((e) => {
  console.log('FAIL', e.message)
  process.exitCode = 1
})
