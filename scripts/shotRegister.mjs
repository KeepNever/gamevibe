// 注册页截图（确认 Turnstile 组件可见）
import { chromium } from 'playwright'

for (const k of Object.keys(process.env)) if (/proxy/i.test(k)) delete process.env[k]
const BASE = process.argv[2] || 'http://127.0.0.1:8792'

const browser = await chromium.launch({ channel: 'chrome', args: ['--no-proxy-server'] })
const page = await browser.newPage({ viewport: { width: 900, height: 1100 }, deviceScaleFactor: 1.5 })
await page.goto(`${BASE}/register`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(7000)
await page.screenshot({ path: 'D:/GameVibe/gamevibe/.probe/captcha-register.png', fullPage: true })
console.log('截图完成')
await browser.close()
