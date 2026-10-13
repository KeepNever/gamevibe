// 截取探索页中「指定卡片」附近的区域，用于目视检查某一类封面的实际渲染效果
// 用法: node scripts/shotRegion.mjs <base> <卡片名关键字> <输出png> [模式]
//   模式: band(平台直连卡带) | grid(主网格，默认)
import { chromium } from 'playwright'

const base = process.argv[2] || 'http://127.0.0.1:8792'
const key = process.argv[3] || ''
const out = process.argv[4] || 'D:/GameVibe/gamevibe/.shot-region.png'
const mode = process.argv[5] || 'grid'

for (const k of ['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'https_proxy', 'http_proxy', 'all_proxy']) delete process.env[k]

const browser = await chromium.launch({
  args: process.env.VERIFY_NO_PROXY === '1'
    ? ['--no-proxy-server']
    : ['--proxy-server=http://127.0.0.1:7890', '--proxy-bypass-list=localhost;127.0.0.1'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 })
await page.goto(base + '/explore', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(2500)

// 等图片基本加载完
const settle = async () => {
  await page.evaluate(async () => {
    const imgs = [...document.images]
    await Promise.all(imgs.map((im) => (im.complete ? null : new Promise((r) => { im.onload = r; im.onerror = r; setTimeout(r, 8000) }))))
  })
  await page.waitForTimeout(800)
}
await settle()

// 找到内部滚动容器
const scroller = await page.evaluate(() => {
  const all = [...document.querySelectorAll('*')]
  let best = null, bestH = 0
  for (const el of all) {
    const cs = getComputedStyle(el)
    if (!/(auto|scroll)/.test(cs.overflowY)) continue
    if (el.scrollHeight - el.clientHeight > 200 && el.scrollHeight > bestH) { bestH = el.scrollHeight; best = el }
  }
  if (!best) return null
  best.setAttribute('data-sc', '1')
  return '[data-sc="1"]'
})

if (mode === 'band') {
  // 切到 PS / Nintendo 标签看看方图效果（由 key 决定切哪个）
  const tab = key || 'PlayStation'
  await page.evaluate((t) => {
    const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes(t))
    if (btn) btn.scrollIntoView({ block: 'center' })
    btn?.click()
  }, tab)
  await page.waitForTimeout(2500)
  await settle()
}

// 滚到目标卡片
await page.evaluate(({ k, mode }) => {
  const sc = document.querySelector('[data-sc="1"]')
  if (mode === 'band') {
    const band = [...document.querySelectorAll('*')].find((e) => /平台官方直连/.test(e.textContent || '') && e.children.length < 40)
    if (band && sc) sc.scrollTop = band.getBoundingClientRect().top + sc.scrollTop - 60
    return
  }
  // 主网格：跳过「平台官方直连」卡带，到其后的大网格里找含关键字的最内层卡片
  const band = [...document.querySelectorAll('*')].find((e) => /平台官方直连/.test(e.textContent || '') && e.children.length < 40)
  const bandBottom = band ? band.getBoundingClientRect().bottom + sc.scrollTop : 0
  let target = null
  for (const el of document.querySelectorAll('*')) {
    const r = el.getBoundingClientRect()
    if (r.top + sc.scrollTop < bandBottom) continue
    if (!k || !(el.textContent || '').includes(k)) continue
    if (!el.querySelector('img')) continue
    if (r.height < 220 || r.height > 620) continue
    target = el
    break
  }
  if (target && sc) sc.scrollTop = target.getBoundingClientRect().top + sc.scrollTop - 140
  else if (!target) console.log('未找到卡片：' + k)
}, { k: key, mode })

await page.waitForTimeout(1600)
await settle()
await page.screenshot({ path: out })
console.log(JSON.stringify({ ok: true, out, mode, key }))
await browser.close()
