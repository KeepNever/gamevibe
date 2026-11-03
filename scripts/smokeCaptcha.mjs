// 验证码开关冒烟：配置接口 + 无 token 注册被拦 + 带 token 放行（siteverify 真请求）
for (const k of Object.keys(process.env)) if (/proxy/i.test(k)) delete process.env[k]
const BASE = process.argv[2] || 'http://127.0.0.1:8792'

async function main() {
  const cfg = await fetch(`${BASE}/api/auth/captcha-config`).then((r) => r.json())
  console.log('captcha-config:', JSON.stringify(cfg))

  const stamp = Date.now().toString(36)
  const no = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: `验证码测试${stamp}`, email: `cap${stamp}@test.local`, password: 'testPass123' }),
  })
  const d = await no.json().catch(() => ({}))
  console.log('无 token 注册:', no.status, d.error || '(意外放行)')

  if (cfg.enabled) {
    const withTok = await fetch(`${BASE}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: `验证码通过${stamp}`,
        email: `capok${stamp}@test.local`,
        password: 'testPass123',
        turnstileToken: 'test-token-any-value',
      }),
    })
    console.log('带 token 注册:', withTok.status, '(测试 secret 接受任意 token，siteverify 为真实网络请求)')
  }
}
main().catch((e) => {
  console.log('FAIL', e.message)
  process.exitCode = 1
})
