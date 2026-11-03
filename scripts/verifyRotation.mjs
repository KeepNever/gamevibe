// 验证密码轮换：旧密码 401、demo 新密码 200
for (const k of Object.keys(process.env)) if (/proxy/i.test(k)) delete process.env[k]
const BASE = process.argv[2] || 'https://7fe3227e96e54b979531a0c7f7024f34.app.workbuddy.host'

async function login(email, password) {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  return r.status
}

async function main() {
  const old1 = await login('老白不白@seed.local', 'seedpass1234')
  const old2 = await login('糖糖不吃糖@seed.local', 'seedpass1234')
  const demo = await login('demo@seed.local', 'DemoPass12345')
  console.log('旧密码登录管理员:', old1, old1 === 401 ? '✅ 已失效' : '❌ 仍可登录!')
  console.log('旧密码登录普通种子:', old2, old2 === 401 ? '✅ 已失效' : '❌ 仍可登录!')
  console.log('公开演示账号:', demo, demo === 200 ? '✅ 可登录' : '❌ 失败')
  process.exitCode = old1 === 401 && old2 === 401 && demo === 200 ? 0 : 1
}
main()
