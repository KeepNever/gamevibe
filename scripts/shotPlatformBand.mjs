// 检查「平台官方直连」区块的 tab 行为：等数据加载完 → 点指定平台 → 截图
// 用法: node scripts/shotPlatformBand.mjs <base> <tab关键字> <输出png>
//   tab关键字留空则只截默认态
import { chromium } from 'playwright'

const base = process.argv[2] || 'http://127.0.0.1:8792'
const want = process.argv[3] || ''
const out = process.argv[4] || 'D:/GameVibe/gamevibe/.band.png'

for (const k of ['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'https_proxy', 'http_proxy', 'all_proxy']) delete process.env[k]

const browser = await chromium.launch({
  args: process.env.VERIFY_NO_PROXY === '1'
    ? ['--no-proxy-server']
    : ['--proxy-server=http://127.0.0.1:7890', '--proxy-bypass-list=localhost;127.0.0.1'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
await page.goto(base + '/explore', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(2500)

// 等首屏渲染出「平台官方直连」标题（线上首次加载 bundle 较大，2.5s 可能还不够）
await page.waitForFunction(
  () => [...document.querySelectorAll('h2')].some((e) => /平台官方直连/.test(e.textContent || '')),
  { timeout: 60000 },
).catch(() => console.log('等「平台官方直连」标题超时'))

// 给「平台官方直连」的 section 打标记：找 h2 → closest('section')
await page.evaluate(() => {
  const h = [...document.querySelectorAll('h2')].find((e) => /平台官方直连/.test(e.textContent || ''))
  const sec = h ? h.closest('section') : null
  if (sec) sec.setAttribute('data-band', '1')
  // 内部滚动容器
  let best = null, bestH = 0
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el)
    if (!/(auto|scroll)/.test(cs.overflowY)) continue
    if (el.scrollHeight - el.clientHeight > 200 && el.scrollHeight > bestH) { bestH = el.scrollHeight; best = el }
  }
  if (best) best.setAttribute('data-sc', '1')
})
const hasBand = await page.$('[data-band="1"]')
if (!hasBand) { console.log('未找到平台直连 section'); await browser.close(); process.exit(1) }

// 等平台数据加载完：section 内 tab 按钮数 >= 4（四个平台）
await page.waitForFunction(() => {
  const sec = document.querySelector('[data-band="1"]')
  if (!sec) return false
  const btns = [...sec.querySelectorAll('button')].filter((b) => /^(Steam|PlayStation|Nintendo Switch|Xbox)/.test((b.textContent || '').trim()))
  return btns.length >= 4
}, { timeout: 90000 }).catch(() => console.log('等 tab 超时，按当前状态继续'))

await page.evaluate(async () => {
  const imgs = [...document.images]
  await Promise.all(imgs.map((im) => (im.complete ? null : new Promise((r) => { im.onload = r; im.onerror = r; setTimeout(r, 8000) }))))
})
await page.waitForTimeout(1200)

const tabs = await page.evaluate(() => {
  const sec = document.querySelector('[data-band="1"]')
  return [...sec.querySelectorAll('button')]
    .map((b) => (b.textContent || '').trim().replace(/\s+/g, ' '))
    .filter((t) => /^(Steam|PlayStation|Nintendo Switch|Xbox)/.test(t))
})

// 汇总条 + tab 状态
const summary = await page.evaluate(() => {
  const sec = document.querySelector('[data-band="1"]')
  return (sec.textContent || '').replace(/\s+/g, ' ').slice(0, 200)
})
console.log('tabs:', JSON.stringify(tabs))
console.log('summary:', summary)

// 点击目标 tab（限定在 section 内，按 label 前缀精确匹配）
if (want) {
  const r = await page.evaluate((w) => {
    const sec = document.querySelector('[data-band="1"]')
    const btns = [...sec.querySelectorAll('button')].filter((b) => /^(Steam|PlayStation|Nintendo Switch|Xbox)/.test((b.textContent || '').trim()))
    const hit = btns.find((b) => (b.textContent || '').trim().startsWith(w))
    if (!hit) return 'not-found'
    hit.click()
    return 'clicked:' + (hit.textContent || '').trim().replace(/\s+/g, ' ')
  }, want)
  console.log('点击:', r)
  await page.waitForTimeout(1800)
}

// 滚动到 section 顶部
await page.evaluate(() => {
  const sec = document.querySelector('[data-band="1"]')
  const sc = document.querySelector('[data-sc="1"]')
  if (sec && sc) sc.scrollTop = sec.getBoundingClientRect().top + sc.scrollTop - 40
})
await page.waitForTimeout(1000)

const after = await page.evaluate(() => {
  const sec = document.querySelector('[data-band="1"]')
  const txt = (sec.textContent || '').replace(/\s+/g, ' ')
  const imgs = sec.querySelectorAll('img').length
  return { imgs, txt: txt.slice(0, 500) }
})
console.log('切换后 图片数:', after.imgs)
console.log('切换后 文案:', after.txt)

await page.screenshot({ path: out })
console.log(JSON.stringify({ ok: true, out }))
await browser.close()
