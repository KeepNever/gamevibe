// 浏览器级验证：注册页 Turnstile 组件是否真实渲染出 iframe 并产出 token
import { chromium } from 'playwright'

for (const k of Object.keys(process.env)) if (/proxy/i.test(k)) delete process.env[k]
const BASE = process.argv[2] || 'http://127.0.0.1:8792'

const browser = await chromium.launch({ channel: 'chrome', args: ['--no-proxy-server'] })
const page = await browser.newPage({ viewport: { width: 900, height: 1000 } })

const state = { token: null }
// 抓 widget 的 token 回调结果：Turnstile 成功后 input[value] 会出现
await page.goto(`${BASE}/register`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6000)

// 组件容器内是否有 Turnstile iframe
const iframeCount = await page.locator('div[class*="min-h-\\[70px\\]"] iframe, form iframe').count()
const box = await page.locator('form iframe').first().boundingBox().catch(() => null)
console.log('Turnstile iframe 数量:', iframeCount, '| 尺寸:', box ? `${Math.round(box.width)}x${Math.round(box.height)}` : '无')

// 隐藏 input（Turnstile 成功后自动填 token）
const token = await page.evaluate(() => {
  const el = document.querySelector('input[name="cf-turnstile-response"]')
  return el ? el.value : null
})
console.log('token 已产出:', token ? `是（${token.length} 字符）` : '尚未（visible 模式需勾选/自动通过）')

// 提交注册验证端到端（测试 sitekey 自动通过）
await page.fill('input[placeholder*="用户名"], input[type="text"]', `浏览器直测${Date.now().toString(36)}`)
const email = `pw${Date.now().toString(36)}@test.local`
await page.fill('input[type="email"]', email)
await page.fill('input[type="password"]', 'browserPass123')
await page.waitForTimeout(1500)
await page.click('button[type="submit"]')
await page.waitForTimeout(4000)
console.log('提交后 URL:', page.url())
state.token = token
await browser.close()
