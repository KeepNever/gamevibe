// 主页实时数据「真实/演示」标注 —— 真机验证（Playwright）
//
// 断言：首屏统计卡出现、逐卡「实时/演示」角标、数据来源行、趋势区数字的真实标记。
// 用法：
//   node scripts/verifyRealtimeUI.mjs
//   环境变量：WEB（默认 http://localhost:5173）、SHOT_DIR、STRICT_REAL=1 要求出现「实时」角标

// 本机存在失效代理，会卡死 Chromium；先清干净（Node 的 fetch 默认不读这些变量，只有浏览器会）
delete process.env.HTTPS_PROXY
delete process.env.HTTP_PROXY
delete process.env.ALL_PROXY
delete process.env.NODE_USE_ENV_PROXY

import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const WEB = process.env.WEB || 'http://localhost:5173'
const OUT = process.env.SHOT_DIR || 'D:/GameVibe/gamevibe/docs/web-screenshots'
const STRICT_REAL = process.env.STRICT_REAL === '1'
mkdirSync(OUT, { recursive: true })

const errors = []
const browser = await chromium.launch({ args: ['--no-proxy-server'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } })
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})

await page.goto(WEB, { waitUntil: 'domcontentloaded', timeout: 60000 })
// 首屏统计卡：等「收录游戏」出现
await page.waitForSelector('text=收录游戏', { timeout: 60000 })
await page.waitForTimeout(4000) // 等 /api/live 第一轮返回

const body = await page.locator('body').innerText()

const hasCards = ['收录游戏', '在线玩家', '特价中', '今日上新'].every((k) => body.includes(k))
const hasSourceLine = body.includes('数据来源：')
const realBadgeCount = (body.match(/实时/g) || []).length
const demoBadgeCount = (body.match(/演示/g) || []).length
const hasPartDemo = body.includes('含演示数据')
const hasAllReal = body.includes('实时') && !hasPartDemo
const sourceSnippet = (body.split('数据来源：')[1] || '').split('\n')[0]?.trim() ?? ''

// 趋势区（AI 今日趋势）应存在
const hasTrend = body.includes('AI 今日趋势')

await page.screenshot({ path: `${OUT}/home-realtime.png`, fullPage: false })
// 放大 viewport 拍整页（该站滚动容器在 Layout 内部，fullPage 只截一屏）
const tall = await browser.newPage({ viewport: { width: 1440, height: 3200 } })
await tall.goto(WEB, { waitUntil: 'domcontentloaded', timeout: 60000 })
await tall.waitForSelector('text=收录游戏', { timeout: 60000 })
await tall.waitForTimeout(4000)
await tall.screenshot({ path: `${OUT}/home-realtime-tall.png` })
await tall.close()

await browser.close()

const lines = [
  `站点：${WEB}`,
  `四张统计卡齐全：${hasCards ? '✅' : '❌'}`,
  `「数据来源」行出现：${hasSourceLine ? '✅' : '❌'}${sourceSnippet ? ` — ${sourceSnippet}` : ''}`,
  `「实时」角标数量：${realBadgeCount}`,
  `「演示」角标数量：${demoBadgeCount}`,
  `底部为「含演示数据」：${hasPartDemo ? '是' : '否'}`,
  `底部为「实时」：${hasAllReal ? '是' : '否'}`,
  `AI 今日趋势区存在：${hasTrend ? '✅' : '❌'}`,
  `运行期报错数量：${errors.length}`,
  ...errors.slice(0, 8),
  `截图：${OUT}/home-realtime.png、${OUT}/home-realtime-tall.png`,
]
console.log(lines.join('\n'))

let pass = hasCards && hasSourceLine && hasTrend && errors.length === 0
if (STRICT_REAL) pass = pass && realBadgeCount > 0
process.exitCode = pass ? 0 : 1
