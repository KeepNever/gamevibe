// Step D 前端渲染验证：详情页「玩家怎么说」（共识 / 分歧 + 真实引用）
// 用法：node scripts/verifyDigestUI.mjs
// 前置：后端 8792、前端 5173 均在运行
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const WEB = process.env.WEB || 'http://localhost:5173'
const OUT = process.env.SHOT_DIR || 'D:/GameVibe/gamevibe/docs/d-screenshots'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push('[console] ' + m.text()) })
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message))

await page.goto(`${WEB}/game/elden-ring`, { waitUntil: 'networkidle' })
await page.waitForTimeout(3500)

const body = await page.locator('body').innerText()
const hasTitle = body.includes('玩家怎么说')
const hasCount = /条评论\s*·\s*平均/.test(body)
const hasConsensus = body.includes('共识')
const hasQuote = /[“"][^”"]{6,}[”"]/.test(body)
const hasNote = body.includes('引用均为站内真实玩家评论原文')

// 滚到口碑区块再截图（滚动容器在 Layout 内部，用滚轮）
await page.mouse.move(620, 500)
await page.mouse.wheel(0, 900)
await page.waitForTimeout(600)
await page.screenshot({ path: `${OUT}/game-detail-digest.png` })

// 再验一款：分歧区（CS2 有低分评论）
await page.goto(`${WEB}/game/cs2`, { waitUntil: 'networkidle' })
await page.waitForTimeout(3500)
const cs2 = await page.locator('body').innerText()
const cs2HasDigest = cs2.includes('玩家怎么说')
await page.mouse.move(620, 500)
await page.mouse.wheel(0, 900)
await page.waitForTimeout(600)
await page.screenshot({ path: `${OUT}/game-detail-digest-cs2.png` })

await browser.close()

const lines = [
  `详情页出现「玩家怎么说」：${hasTitle ? '✅' : '❌'}`,
  `显示评论数 + 平均分：${hasCount ? '✅' : '❌'}`,
  `出现「共识」分区：${hasConsensus ? '✅' : '❌'}`,
  `出现带引号的真实引用：${hasQuote ? '✅' : '❌'}`,
  `出现数据来源说明：${hasNote ? '✅' : '❌'}`,
  `CS2 页口碑区块正常：${cs2HasDigest ? '✅' : '❌'}`,
  `运行期报错数量：${errors.length}`,
  ...errors.slice(0, 10),
  `截图目录：${OUT}`,
]
console.log(lines.join('\n'))
if (!hasTitle || !hasCount || !hasConsensus || !hasQuote || !hasNote || !cs2HasDigest || errors.length) process.exit(1)
