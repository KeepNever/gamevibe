// 读取探索页「目录区平台筛选器」的初始选中状态（不做任何点击）
import { chromium } from 'playwright'

const base = process.argv[2] || 'http://127.0.0.1:8792'
for (const k of ['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'https_proxy', 'http_proxy', 'all_proxy']) delete process.env[k]

const browser = await chromium.launch({
  args: process.env.VERIFY_NO_PROXY === '1'
    ? ['--no-proxy-server']
    : ['--proxy-server=http://127.0.0.1:7890', '--proxy-bypass-list=localhost;127.0.0.1'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
await page.goto(base + '/explore', { waitUntil: 'domcontentloaded', timeout: 60000 })

await page.waitForFunction(
  () => [...document.querySelectorAll('h2')].some((e) => /平台官方直连/.test(e.textContent || '')),
  { timeout: 60000 },
).catch(() => console.log('等标题超时'))
await page.waitForTimeout(3500)

const res = await page.evaluate(() => {
  const labels = ['PC', 'Xbox', 'PlayStation', 'Nintendo Switch', '移动端', '网页']
  const out = []
  for (const btn of document.querySelectorAll('button')) {
    const t = (btn.textContent || '').trim()
    if (!labels.includes(t)) continue
    const cs = getComputedStyle(btn)
    out.push({ text: t, bg: cs.backgroundColor, color: cs.color, cls: btn.className.slice(0, 90) })
  }
  // 顶部计数与「已加载 N / 共 M」
  const body = (document.body.textContent || '').replace(/\s+/g, ' ')
  const m = body.match(/多平台发现 · 共 \d+ 款/)
  const loaded = body.match(/已加载 \d+ \/ 共 \d+/)
  return { filters: out, count: m ? m[0] : '(未匹配)', loaded: loaded ? loaded[0] : '(未匹配)' }
})

console.log(JSON.stringify(res, null, 1))
await browser.close()
