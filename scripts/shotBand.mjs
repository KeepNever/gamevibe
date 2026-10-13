// 轻量截图：探索页首屏 + 平台直连区块（供交付审阅，体积小）
import { chromium } from 'playwright'

const base = process.argv[2] || 'http://127.0.0.1:8792'
const outTop = process.argv[3] || 'D:/GameVibe/gamevibe/.shot-top.png'
const outBand = process.argv[4] || 'D:/GameVibe/gamevibe/.shot-band.png'

for (const k of ['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'https_proxy', 'http_proxy', 'all_proxy']) delete process.env[k]

const browser = await chromium.launch({
  args: process.env.VERIFY_NO_PROXY === '1'
    ? ['--no-proxy-server']
    : ['--proxy-server=http://127.0.0.1:7890', '--proxy-bypass-list=localhost;127.0.0.1'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
await page.goto(base + '/explore', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)

// 找内部滚动容器
const scrollerSel = await page.evaluate(() => {
  const all = [...document.querySelectorAll('*')]
  let best = null, bestH = 0
  for (const el of all) {
    const cs = getComputedStyle(el)
    if (!/(auto|scroll)/.test(cs.overflowY)) continue
    if (el.scrollHeight - el.clientHeight > 200 && el.scrollHeight > bestH) { bestH = el.scrollHeight; best = el }
  }
  if (!best) return null
  best.setAttribute('data-shot-scroller', '1')
  return '[data-shot-scroller="1"]'
})

// 等图片加载完
await page.evaluate(async () => {
  const imgs = [...document.images]
  await Promise.all(imgs.map((im) => (im.complete ? null : new Promise((r) => { im.onload = r; im.onerror = r; setTimeout(r, 6000) }))))
})
await page.waitForTimeout(600)
await page.screenshot({ path: outTop })

if (scrollerSel) {
  await page.evaluate((sel) => {
    const sc = document.querySelector(sel)
    const band = [...document.querySelectorAll('*')].find((e) => /平台官方直连/.test(e.textContent || '') && e.children.length < 40)
    if (band && sc) sc.scrollTop = band.getBoundingClientRect().top + sc.scrollTop - 90
  }, scrollerSel)
  await page.waitForTimeout(1400)
  await page.evaluate(async () => {
    const imgs = [...document.images]
    await Promise.all(imgs.map((im) => (im.complete ? null : new Promise((r) => { im.onload = r; im.onerror = r; setTimeout(r, 6000) }))))
  })
  await page.waitForTimeout(600)
  await page.screenshot({ path: outBand })
}

console.log(JSON.stringify({ ok: true, outTop, outBand, scrollerSel }))
await browser.close()
