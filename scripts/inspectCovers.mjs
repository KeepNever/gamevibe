// 直接查页面里每张卡片封面的 object-fit / 原始尺寸 / 渲染尺寸，用数据判断排版是否正确
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
await page.waitForTimeout(2500)
// 触发全部懒加载
await page.evaluate(async () => {
  const sc = document.querySelector('main') || document.scrollingElement
  for (let i = 0; i < 10; i++) {
    ;(document.querySelector('[data-x]') || window).scrollBy?.(0, 0)
    const el = [...document.querySelectorAll('*')].find((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight - e.clientHeight > 200)
    if (el) el.scrollTop += 1200
    await new Promise((r) => setTimeout(r, 350))
  }
  await Promise.all([...document.images].map((im) => (im.complete ? null : new Promise((r) => { im.onload = r; im.onerror = r; setTimeout(r, 5000) }))))
})
await page.waitForTimeout(800)

const rows = await page.evaluate(() => {
  const out = []
  for (const a of document.querySelectorAll('a[href^="/game/"]')) {
    const img = a.querySelector('img')
    if (!img) continue
    const box = img.closest('div')
    const cs = getComputedStyle(img)
    out.push({
      name: (a.querySelector('h3')?.textContent || '').trim().slice(0, 24),
      src: img.currentSrc.replace('https://', '').slice(0, 58),
      nat: img.naturalWidth + 'x' + img.naturalHeight,
      fit: cs.objectFit,
      boxW: Math.round(box.getBoundingClientRect().width),
      boxH: Math.round(box.getBoundingClientRect().height),
      loaded: img.complete && img.naturalWidth > 0,
    })
  }
  return out
})
console.log('卡片数', rows.length)
console.log('未加载', rows.filter((r) => !r.loaded).length)
const groups = {}
for (const r of rows) {
  const ratio = r.nat.split('x').map(Number)
  const rr = (ratio[0] / ratio[1]).toFixed(2)
  const k = `${rr} | ${r.fit} | ${r.nat}`
  groups[k] = groups[k] || []
  groups[k].push(r.name)
}
for (const [k, v] of Object.entries(groups).sort((a, b) => b[1].length - a[1].length)) {
  console.log(String(v.length).padStart(3), k, '例:', v.slice(0, 3).join(' / '))
}
process.exitCode = 0
await browser.close()
