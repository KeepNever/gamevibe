// 真密钥上线冒烟：配置模式 + 无 token 拦截 + 真浏览器过验证码注册
import { chromium } from 'playwright'

for (const k of Object.keys(process.env)) if (/proxy/i.test(k)) delete process.env[k]
const BASE = process.argv[2] || 'https://7fe3227e96e54b979531a0c7f7024f34.app.workbuddy.host'

async function main() {
  const cfg = await fetch(`${BASE}/api/auth/captcha-config`).then((r) => r.json())
  console.log('captcha-config:', JSON.stringify(cfg))

  const stamp = Date.now().toString(36)
  const no = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: `真钥测试${stamp}`, email: `real${stamp}@test.local`, password: 'testPass123' }),
  })
  console.log('无 token 注册:', no.status, (await no.json().catch(() => ({}))).error)

  // 真浏览器：Managed 模式可能要求点勾选框（这正是真防护），先等自动通过，不行就模拟点击
  const browser = await chromium.launch({ channel: 'chrome', args: ['--no-proxy-server'] })
  const page = await browser.newPage({ viewport: { width: 900, height: 1100 } })
  await page.goto(`${BASE}/register`, { waitUntil: 'domcontentloaded' })
  let token = null
  for (let i = 0; i < 25 && !token; i++) {
    await page.waitForTimeout(1000)
    token = await page.evaluate(() => {
      const el = document.querySelector('input[name="cf-turnstile-response"]')
      return el && el.value ? el.value : null
    })
    if (!token && i === 8) {
      // Turnstile 的勾选框在其跨域 iframe 里，用 frameLocator 点
      await page
        .frameLocator('iframe[src*="challenges.cloudflare.com"]')
        .locator('input[type="checkbox"], label')
        .first()
        .click({ timeout: 5000 })
        .catch(() => {})
    }
  }
  console.log('组件 token:', token ? `已产出（${token.length} 字符）` : '25s 内未产出')

  await page.fill('input[type="text"]', `真钥直测${stamp}`)
  await page.fill('input[type="email"]', `realok${stamp}@test.local`)
  await page.fill('input[type="password"]', 'realKeyPass123')
  await page.waitForTimeout(1000)
  await page.click('button[type="submit"]')
  await page.waitForTimeout(5000)
  const url = page.url()
  const ok = !url.includes('/register')
  console.log('真实注册:', ok ? '成功（已跳转）' : `失败（仍在 ${url}）`)
  await page.screenshot({ path: 'D:/GameVibe/gamevibe/.probe/realkey-register.png', fullPage: true })
  await browser.close()
  process.exitCode = cfg.mode === 'production' && no.status === 400 && ok ? 0 : 1
}
main().catch((e) => {
  console.log('FAIL', e.message)
  process.exitCode = 1
})
