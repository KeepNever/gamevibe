// 服务端强制力证据：真密钥下伪造 token 必须被 403 拒绝（siteverify 真实拒绝）
for (const k of Object.keys(process.env)) if (/proxy/i.test(k)) delete process.env[k]
const BASE = process.argv[2] || 'https://7fe3227e96e54b979531a0c7f7024f34.app.workbuddy.host'

async function main() {
  const stamp = Date.now().toString(36)
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: `伪造token${stamp}`,
      email: `fake${stamp}@test.local`,
      password: 'testPass123',
      turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
    }),
  })
  const d = await res.json().catch(() => ({}))
  console.log('伪造 token 注册:', res.status, d.error)
  console.log(res.status === 403 ? '✅ 服务端强制力成立：伪造 token 被真实拒绝' : '❌ 异常：伪造 token 未被拒绝')
  process.exitCode = res.status === 403 ? 0 : 1
}
main().catch((e) => {
  console.log('FAIL', e.message)
  process.exitCode = 1
})
