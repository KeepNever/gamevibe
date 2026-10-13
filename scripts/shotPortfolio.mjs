// 作品集截图：抓「首页 / 多平台直连 / 成就榜 / AI 联网检索」四张
// 用法：node scripts/shotPortfolio.mjs [base] [outDir] [keys]
//   keys: home,explore,ach,ai（默认全跑）
//
// 代理规则（踩过坑，别改）：
//   · 连线上 → 必须清代理 + --no-proxy-server（本机失效代理会让 Chromium ERR_TIMED_OUT，
//     而 Node fetch 默认不读它 → 接口正常只有浏览器挂，极易误判「站点挂了」）
//   · 连本地 → 反过来必须走 7890 代理（本机直连图 CDN 不通），但 localhost 要 bypass

import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const useProxy = process.env.SHOT_PROXY === '1'
if (!useProxy) {
  for (const k of ['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'https_proxy', 'http_proxy', 'all_proxy']) {
    delete process.env[k]
  }
}

const base = process.argv[2] || 'https://7fe3227e96e54b979531a0c7f7024f34.app.workbuddy.host'
const outDir = process.argv[3] || 'D:/GameVibe/gamevibe/docs/portfolio'
const only = (process.argv[4] || 'home,explore,ach,ai').split(',').map((s) => s.trim())
mkdirSync(outDir, { recursive: true })

const SHOT = { type: 'jpeg', quality: 88 }
const results = []

console.log(`[env] base=${base} | 代理=${useProxy ? '7890（本地模式）' : '关闭（线上模式）'} | 镜头=${only.join(',')}`)

const browser = await chromium.launch({
  args: useProxy
    ? ['--proxy-server=http://127.0.0.1:7890', '--proxy-bypass-list=localhost;127.0.0.1']
    : ['--no-proxy-server'],
})
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 950 },
  deviceScaleFactor: 1.5,
  ignoreHTTPSErrors: true,
  locale: 'zh-CN',
})
const page = await ctx.newPage()

const consoleErrors = []
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 140)) })

/** 等图片加载完（懒加载图靠滚动触发，先滚再等） */
async function settle(ms = 1500) {
  await page.evaluate(async () => {
    const imgs = [...document.images]
    await Promise.all(imgs.map((im) => (im.complete ? null : new Promise((r) => {
      im.onload = r
      im.onerror = r
      setTimeout(r, 8000)
    }))))
  }).catch(() => {})
  await page.waitForTimeout(ms)
}

/** 该站的滚动容器在 Layout 内部（非 window），必须找到真正的滚动元素 */
async function scrollInto(selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return 'no-el'
    let sc = null
    let bestH = 0
    for (const e of document.querySelectorAll('*')) {
      const cs = getComputedStyle(e)
      if (!/(auto|scroll)/.test(cs.overflowY)) continue
      if (e.scrollHeight - e.clientHeight > 200 && e.scrollHeight > bestH) {
        bestH = e.scrollHeight
        sc = e
      }
    }
    const top = el.getBoundingClientRect().top + (sc ? sc.scrollTop : window.scrollY) - 24
    if (sc) sc.scrollTop = top
    else window.scrollTo(0, top)
    return sc ? `container:${bestH}` : 'window'
  }, selector)
}

/** 元素截图（过高时截取前 maxH px） */
async function shotSection(name, locator, maxH = 1500) {
  const box = await locator.boundingBox()
  if (!box) throw new Error(`无 boundingBox: ${name}`)
  const h = Math.min(Math.round(box.height), maxH)
  const path = `${outDir}/${name}`
  await page.screenshot({
    path,
    ...SHOT,
    clip: { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: h },
  })
  results.push({ name, path, w: Math.round(box.width), h })
}

/**
 * 登录：不点表单，直接把 token 写进 localStorage。
 * 原因：登录页表单在无头浏览器里偶发不提交，而 authStore 启动时有个 fetchMe()，
 * 只要 `gv_token` 在，刷新后会自动恢复登录态 —— 这条路比模拟点击稳得多。
 */
async function login() {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: '糖糖不吃糖@seed.local', password: 'seedpass1234' }),
  })
  if (!res.ok) throw new Error(`登录接口 ${res.status}`)
  const { token } = await res.json()

  await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.evaluate((t) => localStorage.setItem('gv_token', t), token)
  await page.goto(base + '/ai', { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.waitForSelector('textarea:not([disabled])', { timeout: 40000 })
  console.log('[login] ok（token 注入）| url:', page.url())
}

// ── 1. 首页首屏 ──────────────────────────────────────────────
if (only.includes('home')) {
  try {
    await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 90000 })
    await page.waitForFunction(() => document.body.innerText.includes('GameVibe'), { timeout: 60000 })
    await settle(6000)
    const path = `${outDir}/01-home.jpg`
    await page.screenshot({ path, ...SHOT })
    results.push({ name: '01-home.jpg', path, w: 1440, h: 950 })
    console.log('[home] ok')
  } catch (e) { console.log('[home] 失败:', e.message) }
}

// ── 2. 探索页「平台官方直连」 ─────────────────────────────────
if (only.includes('explore')) {
  try {
    await page.goto(base + '/explore', { waitUntil: 'domcontentloaded', timeout: 90000 })
    await page.waitForFunction(
      () => [...document.querySelectorAll('h2')].some((e) => /平台官方直连/.test(e.textContent || '')),
      { timeout: 90000 },
    )
    await page.waitForFunction(() => {
      const h = [...document.querySelectorAll('h2')].find((e) => /平台官方直连/.test(e.textContent || ''))
      const sec = h && h.closest('section')
      if (!sec) return false
      const btns = [...sec.querySelectorAll('button')].filter((b) => /^(Steam|PlayStation|Nintendo Switch|Xbox)/.test((b.textContent || '').trim()))
      return btns.length >= 4
    }, { timeout: 90000 }).catch(() => console.log('[explore] 等 tab 超时，按当前状态继续'))
    await scrollInto('h2')
    await settle(5000)
    const sec = page.locator('section', { has: page.locator('h2', { hasText: '平台官方直连' }) }).first()
    await sec.scrollIntoViewIfNeeded().catch(() => {})
    await page.waitForTimeout(1200)
    await shotSection('02-explore-platforms.jpg', sec, 1400)
    console.log('[explore] ok')
  } catch (e) { console.log('[explore] 失败:', e.message) }
}

// ── 3. 详情页「全球成就」 ─────────────────────────────────────
if (only.includes('ach')) {
  try {
    await page.goto(base + '/game/dc_elden-ring', { waitUntil: 'domcontentloaded', timeout: 90000 })
    await page.waitForFunction(
      () => [...document.querySelectorAll('h2')].some((e) => /全球成就/.test(e.textContent || '')),
      { timeout: 90000 },
    )
    // 等成就数据回来（加载中会显示「正在读取 Steam 成就数据…」）
    await page.waitForFunction(
      () => !/正在读取 Steam 成就数据/.test(document.body.innerText),
      { timeout: 90000 },
    ).catch(() => console.log('[achievements] 等数据超时，按当前状态继续'))
    await settle(4000)
    const sec = page.locator('section', { has: page.locator('h2', { hasText: '全球成就' }) }).first()
    await sec.scrollIntoViewIfNeeded().catch(() => {})
    await page.waitForTimeout(1500)
    await shotSection('03-achievements.jpg', sec, 1400)
    console.log('[achievements] ok')
  } catch (e) { console.log('[achievements] 失败:', e.message) }
}

// ── 4. AI 联网检索 ──────────────────────────────────────────
if (only.includes('ai')) {
  try {
    await login()
    await page.goto(base + '/ai', { waitUntil: 'domcontentloaded', timeout: 90000 })
    const box = page.locator('textarea').first()
    await box.waitFor({ timeout: 60000 })
    await box.fill(process.env.SHOT_AI_QUERY || '最近有什么新的游戏资讯？')
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => /联网来源/.test(document.body.innerText), { timeout: 150000 })
      .catch(() => console.log('[ai] 未等到联网来源，按当前状态截图'))
    await page.waitForTimeout(4000)
    // 加高视口，让「模型简报 + 来源卡片」同屏；并把整条回答的顶部精确对齐到滚动容器顶部
    await page.setViewportSize({ width: 1440, height: 1560 })
    await page.waitForTimeout(800)
    const aligned = await page.evaluate(() => {
      const leaves = [...document.querySelectorAll('body *')]
        .filter((e) => e.children.length === 0 && /联网来源/.test(e.textContent || ''))
      let node = leaves[0]
      if (!node) return 'no-anchor'
      // 往上爬到整条回答的容器（高度足够大那层）
      while (node.parentElement && node.getBoundingClientRect().height < 600) {
        node = node.parentElement
      }
      let sc = node.parentElement
      while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement
      if (!sc) return 'no-scroller'
      const delta = node.getBoundingClientRect().top - sc.getBoundingClientRect().top
      sc.scrollTop += delta - 8
      return `aligned delta=${Math.round(delta)} h=${Math.round(node.getBoundingClientRect().height)}`
    })
    console.log('[ai] 对齐:', aligned)
    await page.waitForTimeout(1500)
    const path = `${outDir}/04-ai-websearch.jpg`
    await page.screenshot({ path, ...SHOT })
    results.push({ name: '04-ai-websearch.jpg', path, w: 1440, h: 1560 })
    console.log('[ai] ok')
  } catch (e) { console.log('[ai] 失败:', e.message) }
}

await browser.close()
console.log('\n=== 产物 ===')
console.log(JSON.stringify(results, null, 2))
console.log('=== 控制台错误 ===')
console.log(JSON.stringify([...new Set(consoleErrors)].slice(0, 8), null, 2))
