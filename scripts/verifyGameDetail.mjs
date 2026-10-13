// 详情页真机验收：全球成就榜 + Steam 评测区的真实性标注
//
// 代理说明同 verifyExploreUI.mjs：本机有失效代理 53869 会污染 Chromium（先删环境变量），
// 但本机直连外部图床不通，所以本地要显式 --proxy-server=127.0.0.1:7890；验线上传 VERIFY_NO_PROXY=1。
//
// 用法：node scripts/verifyGameDetail.mjs http://127.0.0.1:8792 dc_elden-ring [输出png]
import { chromium } from 'playwright'

delete process.env.HTTPS_PROXY
delete process.env.HTTP_PROXY
delete process.env.ALL_PROXY
delete process.env.https_proxy
delete process.env.http_proxy

const base = process.argv[2] || 'http://127.0.0.1:8792'
const gameId = process.argv[3] || 'dc_elden-ring'
const out = process.argv[4] || ''

const launchArgs = process.env.VERIFY_NO_PROXY
  ? ['--no-proxy-server']
  : ['--proxy-server=http://127.0.0.1:7890', '--proxy-bypass-list=localhost;127.0.0.1']

const browser = await chromium.launch({ args: launchArgs })
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 1600 },
  deviceScaleFactor: 1,
  ignoreHTTPSErrors: true,
})
const page = await ctx.newPage()

const consoleErrors = []
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160))
})

// 路由是 history 模式（不是 hash），正确路径形如 /game/dc_elden-ring
await page.goto(`${base}/game/${gameId}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
// 线上首屏慢：必须等关键元素，不能靠固定 sleep
await page.waitForFunction(
  () => !!Array.from(document.querySelectorAll('h2')).find((h) => h.textContent?.includes('全球成就')),
  { timeout: 45000 },
).catch(() => {})
await page.waitForTimeout(4000)

const scroller = await page.evaluate(() => {
  let best = null
  for (const el of document.querySelectorAll('*')) {
    const s = getComputedStyle(el)
    if (!/auto|scroll/.test(s.overflowY)) continue
    if (el.scrollHeight - el.clientHeight < 200) continue
    if (!best || el.scrollHeight > best.scrollHeight) best = el
  }
  window.__sc = best
  return best ? { h: best.scrollHeight, c: best.clientHeight } : null
})

// 滚到底触发懒加载（成就图标是 lazy 的）
if (scroller) {
  await page.evaluate(async () => {
    const sc = window.__sc
    for (let y = 0; y < sc.scrollHeight; y += 600) {
      sc.scrollTop = y
      await new Promise((r) => setTimeout(r, 90))
    }
    sc.scrollTop = 0
  })
  await page.waitForTimeout(1500)
}

const report = await page.evaluate(() => {
  const h2 = Array.from(document.querySelectorAll('h2'))
  const achH = h2.find((h) => h.textContent?.includes('全球成就'))
  const achSec = achH ? achH.closest('section') : null
  const revH = h2.find((h) => h.textContent?.includes('社区评价'))
  const revSec = revH ? revH.closest('section') : null

  const txt = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim()

  // 成就区块里的图标加载情况
  const achImgs = achSec ? Array.from(achSec.querySelectorAll('img')) : []
  const imgOk = achImgs.filter((i) => i.complete && i.naturalWidth > 0).length

  return {
    achFound: !!achSec,
    achHeader: txt(achSec?.querySelector('div')),
    achCount: achImgs.length,
    achIconsOk: imgOk,
    achHasHonestNotice: /暂未获取到成就数据/.test(txt(achSec)),
    achDifficultyChip: txt(achSec?.querySelector('span.text-xs.font-semibold') || null),
    achNumbers: achSec
      ? Array.from(achSec.querySelectorAll('.text-lg.font-display')).map((n) => txt(n))
      : [],
    achNoteShown: /派生值/.test(txt(achSec)),
    achRareNames: achSec
      ? Array.from(achSec.querySelectorAll('li span.text-\\[13px\\]')).slice(0, 6).map((n) => txt(n))
      : [],

    revFound: !!revSec,
    revHasSteamLive: /Steam 实时/.test(txt(revSec)),
    revHasMockBadge: /模拟数据/.test(txt(revSec)),
    revHasHonestNotice: /暂未获取到 Steam 评测/.test(txt(revSec)),
    revText: txt(revSec).slice(0, 240),
  }
})

console.log(JSON.stringify(report, null, 1))
console.log('控制台错误:', JSON.stringify(consoleErrors.slice(0, 5)))

if (out) {
  await page.screenshot({ path: out, fullPage: false })
  console.log('截图:', out)
}

await browser.close()
