// 逐步滚动截取探索页长页面的多个片段，便于逐屏检查
// 用法: node scripts/shotSlices.mjs <base> <输出前缀> [偏移列表，逗号分隔]
import { chromium } from 'playwright'

const base = process.argv[2] || 'http://127.0.0.1:8792'
const prefix = process.argv[3] || 'D:/GameVibe/gamevibe/.slice'
const offsets = (process.argv[4] || '0,900,1800,2700,3600,4500').split(',').map(Number)

for (const k of ['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'https_proxy', 'http_proxy', 'all_proxy']) delete process.env[k]

const browser = await chromium.launch({
  args: process.env.VERIFY_NO_PROXY === '1'
    ? ['--no-proxy-server']
    : ['--proxy-server=http://127.0.0.1:7890', '--proxy-bypass-list=localhost;127.0.0.1'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
await page.goto(base + '/explore', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(2500)

await page.evaluate(() => {
  const all = [...document.querySelectorAll('*')]
  let best = null, bestH = 0
  for (const el of all) {
    const cs = getComputedStyle(el)
    if (!/(auto|scroll)/.test(cs.overflowY)) continue
    if (el.scrollHeight - el.clientHeight > 200 && el.scrollHeight > bestH) { bestH = el.scrollHeight; best = el }
  }
  best?.setAttribute('data-sc', '1')
})

const total = await page.evaluate(() => {
  const sc = document.querySelector('[data-sc="1"]')
  return sc ? sc.scrollHeight : 0
})

const out = []
for (const off of offsets) {
  await page.evaluate((o) => { document.querySelector('[data-sc="1"]').scrollTop = o }, off)
  await page.waitForTimeout(700)
  // 触发懒加载
  await page.evaluate(async () => {
    const imgs = [...document.images]
    await Promise.all(imgs.map((im) => (im.complete ? null : new Promise((r) => { im.onload = r; im.onerror = r; setTimeout(r, 6000) }))))
  })
  await page.waitForTimeout(900)
  const p = `${prefix}-${off}.png`
  await page.screenshot({ path: p })
  out.push(p)
}
console.log(JSON.stringify({ ok: true, contentHeight: total, shots: out }))
await browser.close()
