// 点开「加载更多」直到全部展开，然后滚动到页面尾部截图，检查移动端/网页游戏封面的渲染
import { chromium } from 'playwright'

const base = process.argv[2] || 'http://127.0.0.1:8792'
const out = process.argv[3] || 'D:/GameVibe/gamevibe/.shot-tail.png'
const key = process.argv[4] || ''

for (const k of ['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'https_proxy', 'http_proxy', 'all_proxy']) delete process.env[k]

const browser = await chromium.launch({
  args: process.env.VERIFY_NO_PROXY === '1'
    ? ['--no-proxy-server']
    : ['--proxy-server=http://127.0.0.1:7890', '--proxy-bypass-list=localhost;127.0.0.1'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
await page.goto(base + '/explore', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(2200)

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

// 反复点「加载更多」直到消失
let clicks = 0
for (let i = 0; i < 12; i++) {
  const ok = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '加载更多')
    if (btn) { btn.click(); return true }
    return false
  })
  if (!ok) break
  clicks++
  await page.waitForTimeout(1300)
}
console.log('点击加载更多', clicks, '次')

// 等图
await page.evaluate(async () => {
  const sc = document.querySelector('[data-sc="1"]')
  for (let pass = 0; pass < 8; pass++) {
    const imgs = [...document.images].filter((im) => !im.complete)
    if (!imgs.length) break
    sc.scrollTop += 900
    await new Promise((r) => setTimeout(r, 400))
    await Promise.all(imgs.map((im) => new Promise((r) => { im.onload = r; im.onerror = r; setTimeout(r, 3000) })))
  }
})
await page.waitForTimeout(1200)

const total = await page.evaluate(() => document.querySelector('[data-sc="1"]').scrollHeight)
const cards = await page.evaluate(() => document.querySelectorAll('a[href^="/game/"]').length)

// 滚到目标
if (key) {
  await page.evaluate((k) => {
    const sc = document.querySelector('[data-sc="1"]')
    let t = null
    for (const el of document.querySelectorAll('a[href^="/game/"]')) {
      if ((el.textContent || '').includes(k)) { t = el; break }
    }
    if (t) sc.scrollTop = t.getBoundingClientRect().top + sc.scrollTop - 120
  }, key)
} else {
  await page.evaluate(() => { const sc = document.querySelector('[data-sc="1"]'); sc.scrollTop = sc.scrollHeight })
}
await page.waitForTimeout(1500)
await page.evaluate(async () => {
  await Promise.all([...document.images].map((im) => (im.complete ? null : new Promise((r) => { im.onload = r; im.onerror = r; setTimeout(r, 6000) }))))
})
await page.waitForTimeout(600)
await page.screenshot({ path: out })
console.log(JSON.stringify({ ok: true, out, cards, contentHeight: total }))
await browser.close()
