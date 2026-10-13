// Step E 前端渲染验证：首页「AI 今日趋势」卡
// 用法：node scripts/verifyTrendUI.mjs
// 前置：后端 8792、前端 5173 均在运行
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const WEB = process.env.WEB || 'http://localhost:5173'
const OUT = process.env.SHOT_DIR || 'D:/GameVibe/gamevibe/docs/e-screenshots'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push('[console] ' + m.text()) })
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message))

await page.goto(`${WEB}/`, { waitUntil: 'networkidle' })
await page.waitForTimeout(4500)

const body = await page.locator('body').innerText()
const hasTitle = body.includes('AI 今日趋势')
const hasLive = body.includes('实时') && body.includes('快照')
const hasRank = body.includes('热度榜')
const hasMetrics = ['全网在线', '直播观众', '今日上新', '今日特价'].every((t) => body.includes(t))

// 卡片内的定性解读文本（第一段）：非空且不含阿拉伯数字
const section = page.locator('section', { hasText: 'AI 今日趋势' }).first()
const text = await section.locator('p').first().innerText().catch(() => '')
const textOk = text.length >= 10 && !/[0-9]/.test(text)

// 元素级截图（滚动容器在 Layout 内部，直接对元素截图最稳）
await section.screenshot({ path: `${OUT}/home-trend.png` }).catch(async () => {
  await page.screenshot({ path: `${OUT}/home-trend.png` })
})

await browser.close()

const lines = [
  `首页出现「AI 今日趋势」：${hasTitle ? '✅' : '❌'}`,
  `显示「实时 · 快照」标记：${hasLive ? '✅' : '❌'}`,
  `出现「热度榜」：${hasRank ? '✅' : '❌'}`,
  `四项全局指标齐全：${hasMetrics ? '✅' : '❌'}`,
  `定性解读文本非空且不含数字：${textOk ? '✅' : '❌'}（${text.length} 字）`,
  `运行期报错数量：${errors.length}`,
  ...errors.slice(0, 10),
  `截图目录：${OUT}`,
]
console.log(lines.join('\n'))
if (!hasTitle || !hasLive || !hasRank || !hasMetrics || !textOk || errors.length) process.exit(1)
