// 抓取「多平台发现」页真机截图，用于判断布局协调性与封面质量
// 注意：本机有失效代理会污染 Chromium，必须显式禁用。
// 用法：node scripts/shotExplore.mjs [baseUrl]

import { chromium } from 'playwright'

delete process.env.HTTPS_PROXY
delete process.env.HTTP_PROXY
delete process.env.ALL_PROXY
delete process.env.https_proxy
delete process.env.http_proxy

const base = process.argv[2] || 'https://gamevibe.app.workbuddy.host'
const out = process.argv[3] || 'D:/GameVibe/gamevibe/.shot-explore.png'

const browser = await chromium.launch({ args: ['--no-proxy-server'] })
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 2400 },
  deviceScaleFactor: 1,
  ignoreHTTPSErrors: true,
})
const page = await ctx.newPage()

const errs = []
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)) })
page.on('requestfailed', (r) => errs.push(`REQFAIL ${r.url().slice(0, 110)} ${r.failure()?.errorText}`))

// 收集所有图片加载结果
const imgStats = { total: 0, ok: 0, fail: 0, failed: [] }
page.on('response', (res) => {
  const ct = res.headers()['content-type'] || ''
  if (!ct.startsWith('image/')) return
  imgStats.total++
  if (res.status() === 200) imgStats.ok++
  else { imgStats.fail++; imgStats.failed.push(`${res.status()} ${res.url().slice(0, 120)}`) }
})

await page.goto(`${base}/explore`, { waitUntil: 'domcontentloaded', timeout: 60000 })
// 等「多平台发现」网格里的卡片出现
await page.waitForSelector('a[href^="/game/"]', { timeout: 45000 }).catch(() => {})
await page.waitForTimeout(9000) // 等懒加载图片

const info = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('a[href^="/game/"]')]
  const imgs = [...document.querySelectorAll('a[href^="/game/"] img')]
  const grid = document.querySelector('a[href^="/game/"]')?.parentElement
  const gc = grid ? getComputedStyle(grid) : null
  // 统计「看起来是占位」的卡片：没有 img 或 img 未成功
  const broken = []
  for (const a of cards) {
    const im = a.querySelector('img')
    const src = im?.getAttribute('src') || ''
    if (!im || !im.complete || im.naturalWidth === 0) {
      broken.push(`${a.getAttribute('href')} | ${src.slice(0, 110)}`)
    } else if (im.naturalWidth < 250) {
      broken.push(`${a.getAttribute('href')} | 低分辨率 ${im.naturalWidth}x${im.naturalHeight} | ${src.slice(0, 90)}`)
    }
  }
  return {
    cardCount: cards.length,
    imgCount: imgs.length,
    gridCols: gc?.gridTemplateColumns,
    gridGap: gc?.gap,
    firstCardAspect: cards[0] ? (() => { const r = cards[0].getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}` })() : null,
    brokenCount: broken.length,
    broken: broken.slice(0, 25),
    docScrollH: document.documentElement.scrollHeight,
  }
})

await page.screenshot({ path: out, fullPage: false })
console.log(JSON.stringify({ base, ...info, imgStats: { ...imgStats, failed: imgStats.failed.slice(0, 15) }, consoleErrors: [...new Set(errs)].slice(0, 15), shot: out }, null, 2))

await browser.close()
