// 探索页真机验收：① 平台直连区块是否正常 ② 封面质量与卡片视觉一致性
//
// ⚠️ 代理有两个坑，别搞混：
//   · 本机存在**失效代理** HTTPS_PROXY=127.0.0.1:53869，Chromium 会读它 → 必须删掉环境变量；
//   · 但本机直连外部图床（Steam / 任天堂 / 微软 CDN）是不通的，需要**可用代理** 127.0.0.1:7890。
//   → 所以本地验收要「清掉环境里的代理变量 + 用 --proxy-server 显式指定可用代理」；
//     验线上站点则相反（不需要代理），传 VERIFY_NO_PROXY=1。
//
// 用法：
//   本地  node scripts/verifyExploreUI.mjs http://127.0.0.1:8792
//   线上  VERIFY_NO_PROXY=1 node scripts/verifyExploreUI.mjs https://xxx.app.workbuddy.host
import { chromium } from 'playwright'

delete process.env.HTTPS_PROXY
delete process.env.HTTP_PROXY
delete process.env.ALL_PROXY
delete process.env.https_proxy
delete process.env.http_proxy

const base = process.argv[2] || 'http://127.0.0.1:8792'
const out = process.argv[3] || 'D:/GameVibe/gamevibe/.shot-explore.png'

const launchArgs = process.env.VERIFY_NO_PROXY
  ? ['--no-proxy-server']
  : ['--proxy-server=http://127.0.0.1:7890', '--proxy-bypass-list=localhost;127.0.0.1']

const browser = await chromium.launch({ args: launchArgs })
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 2600 },
  deviceScaleFactor: 1,
  ignoreHTTPSErrors: true,
})
const page = await ctx.newPage()

const errs = []
page.on('console', (m) => {
  if (m.type() === 'error') errs.push(m.text().slice(0, 160))
})
page.on('requestfailed', (r) => errs.push(`REQFAIL ${r.url().slice(0, 110)} ${r.failure()?.errorText}`))

const imgStats = { total: 0, ok: 0, fail: 0, failed: [] }
page.on('response', (res) => {
  const ct = res.headers()['content-type'] || ''
  if (!ct.startsWith('image/')) return
  imgStats.total++
  if (res.status() === 200) imgStats.ok++
  else {
    imgStats.fail++
    imgStats.failed.push(`${res.status()} ${res.url().slice(0, 120)}`)
  }
})

await page.goto(`${base}/explore`, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForSelector('a[href^="/game/"]', { timeout: 45000 }).catch(() => {})
await page.waitForTimeout(6000)

// 页面很长且图片是 lazy 的：滚一遍把下面的图都触发出来，再回顶部截图。
// ⚠️ 本项目的滚动容器是 Layout 内部的一个 overflow 元素，**不是 window**——
//    对 window 调 scrollTo 完全没反应，最底部的懒加载图会永远不进视口，
//    从而被误判成「封面坏掉」。所以必须找到真正的滚动容器再滚。
await page.evaluate(async () => {
  const findScroller = () => {
    let best = null
    for (const el of document.querySelectorAll('*')) {
      const s = getComputedStyle(el)
      if (!/(auto|scroll)/.test(s.overflowY)) continue
      if (el.scrollHeight - el.clientHeight < 80) continue
      if (!best || el.scrollHeight - el.clientHeight > best.scrollHeight - best.clientHeight) best = el
    }
    return best
  }
  const sc = findScroller()
  const step = 700
  const total = sc ? sc.scrollHeight : document.body.scrollHeight
  for (let y = 0; y < total; y += step) {
    if (sc) sc.scrollTop = y
    window.scrollTo(0, y)
    await new Promise((r) => setTimeout(r, 240))
  }
  if (sc) sc.scrollTop = 0
  window.scrollTo(0, 0)
})
// 等到页面上不再有「正在加载中」的封面为止（最多 25s），避免把慢图误判成坏图
await page
  .waitForFunction(
    () => {
      const imgs = [...document.querySelectorAll('a[href^="/game/"] img, a[target="_blank"] img')]
      const pending = imgs.filter((im) => !im.complete)
      const skel = document.querySelectorAll('.animate-pulse').length
      return pending.length === 0 && skel === 0
    },
    { timeout: 25000 },
  )
  .catch(() => {})
await page.waitForTimeout(1500)

const info = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('a[href^="/game/"]')]
  const broken = []
  const aspects = []
  for (const a of cards) {
    const im = a.querySelector('img')
    const src = im?.getAttribute('src') || ''
    if (!im || !im.complete || im.naturalWidth === 0) {
      broken.push(`${a.getAttribute('href')} | ${src.slice(0, 110)}`)
      continue
    }
    const r = a.querySelector('div[class*="aspect-"]')?.getBoundingClientRect()
    if (r) aspects.push(+(r.width / r.height).toFixed(2))
    if (/steamstatic|nintendo|playstation|microsoft|mzstatic/.test(src) === false && src.startsWith('http')) {
      // 非主流官方图床，提示一下（不一定是问题）
    }
  }

  // 平台直连区块
  const band = [...document.querySelectorAll('section')].find((s) => s.textContent?.includes('平台官方直连'))
  const tabs = band ? [...band.querySelectorAll('button')].map((b) => b.textContent.trim().replace(/\s+/g, ' ')) : []
  const bandImgs = band ? band.querySelectorAll('img').length : 0
  const bandText = band ? band.textContent.replace(/\s+/g, ' ').slice(0, 320) : ''

  // 页面上的外链平台卡
  const extCards = [...document.querySelectorAll('a[target="_blank"]')]
  const extHosts = [...new Set(extCards.map((a) => { try { return new URL(a.href).host } catch { return '?' } }))]

  // 真正的滚动容器（Layout 内部那个），用于估算整页高度
  let scrollerH = 0
  for (const el of document.querySelectorAll('*')) {
    const s = getComputedStyle(el)
    if (!/(auto|scroll)/.test(s.overflowY)) continue
    scrollerH = Math.max(scrollerH, el.scrollHeight)
  }

  return {
    totalCards: cards.length,
    brokenCount: broken.length,
    broken: broken.slice(0, 20),
    aspectMin: aspects.length ? Math.min(...aspects) : null,
    aspectMax: aspects.length ? Math.max(...aspects) : null,
    bandFound: Boolean(band),
    bandText,
    bandTabs: tabs.slice(0, 12),
    bandImgCount: bandImgs,
    extCardCount: extCards.length,
    extHosts,
    docScrollH: document.documentElement.scrollHeight,
    scrollerH,
  }
})

// 整页截图：本项目滚动容器在 Layout 内部，fullPage 不可靠 →
// 直接把 viewport 高度设成「内容高度」，一次渲染拿全
const fullH = Math.min(Math.max(info.scrollerH, info.docScrollH), 9000)
await page.setViewportSize({ width: 1440, height: fullH })
await page.waitForTimeout(1500)
await page.screenshot({ path: out, fullPage: false })

console.log(
  JSON.stringify(
    { base, ...info, imgStats: { ...imgStats, failed: imgStats.failed.slice(0, 15) }, consoleErrors: [...new Set(errs)].slice(0, 12), shot: out, shotHeight: fullH },
    null,
    2,
  ),
)

await browser.close()
