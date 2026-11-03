// 深度探针：注册页 captcha 状态机卡在哪一步
import { chromium } from 'playwright'

for (const k of Object.keys(process.env)) if (/proxy/i.test(k)) delete process.env[k]
const BASE = process.argv[2] || 'http://127.0.0.1:8792'

const browser = await chromium.launch({ channel: 'chrome', args: ['--no-proxy-server'] })
const page = await browser.newPage()

const logs = []
page.on('console', (m) => logs.push(`[console.${m.type()}] ${m.text().slice(0, 160)}`))
page.on('requestfailed', (r) => logs.push(`[reqfail] ${r.url().slice(0, 110)} ← ${r.failure()?.errorText}`))
page.on('response', (r) => {
  if (r.url().includes('challenges.cloudflare') || r.url().includes('captcha-config'))
    logs.push(`[resp ${r.status()}] ${r.url().slice(0, 110)}`)
})

await page.goto(`${BASE}/register`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(9000)

const info = await page.evaluate(() => {
  const box = document.querySelector('.min-h-\\[70px\\]')
  return {
    boxText: box ? box.innerText.slice(0, 120) : '(容器不存在)',
    boxHTMLLen: box ? box.innerHTML.length : 0,
    hasTurnstile: !!window.turnstile,
    scriptTags: [...document.querySelectorAll('script[data-turnstile], script[src*="challenges"]')].map((s) =>
      s.src.slice(0, 90),
    ),
  }
})

console.log('容器文本:', JSON.stringify(info.boxText))
console.log('容器 HTML 长度:', info.boxHTMLLen)
console.log('window.turnstile:', info.hasTurnstile)
console.log('验证脚本标签:', JSON.stringify(info.scriptTags))
console.log('--- 页面事件 ---')
for (const l of logs) console.log(l)
await browser.close()
