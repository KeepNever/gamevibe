// AI 助手「联网检索」前端真机验证（Playwright）
// 用法：node scripts/verifyWebUI.mjs
// 前置：后端 8792、前端 5173 均在运行
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

// ⚠️ 本机存在失效代理（HTTPS_PROXY=127.0.0.1:53869），Chromium 走它必然 ERR_TIMED_OUT
delete process.env.HTTPS_PROXY
delete process.env.HTTP_PROXY
delete process.env.ALL_PROXY

const WEB = process.env.WEB || 'http://localhost:5173'
const API = process.env.API_BASE || 'http://localhost:8792'
const OUT = process.env.SHOT_DIR || 'D:/GameVibe/gamevibe/docs/web-screenshots'
// 线上沙箱到 Steam 时通时不通：非严格模式下只要求「开关 + 状态标记」出现，
// 不强制要求来源区块（严格模式用于本地，必然有数据）
const STRICT = process.env.STRICT_SOURCES !== '0'
mkdirSync(OUT, { recursive: true })

// 用演示账号拿 token
const loginRes = await fetch(`${API}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: '糖糖不吃糖@seed.local', password: 'seedpass1234' }),
})
const { token } = await loginRes.json()
if (!token) throw new Error('登录失败，无法拿到 token')

const browser = await chromium.launch({ headless: true, args: ['--no-proxy-server'] })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await ctx.addInitScript((t) => {
  localStorage.setItem('gv_token', t)
}, token)
const page = await ctx.newPage()
const errors = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('[console] ' + m.text())
})
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message))

await page.goto(`${WEB}/ai`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('textarea', { timeout: 20000 })
await page.waitForTimeout(1500)

// ── 1. 联网开关可见 ──
const initial = await page.locator('body').innerText()
const hasToggleLabel = initial.includes('联网检索')
const hasModeAuto = initial.includes('自动')
const hasModeOff = initial.includes('关闭')

// ── 2. 发一条资讯类问题，等待联网来源出现 ──
await page.fill('textarea', '艾尔登法环最近有什么新闻')
await page.waitForTimeout(200)
await page.keyboard.press('Enter')

let sourcesShown = false
try {
  await page.waitForSelector('text=联网来源', { timeout: STRICT ? 60000 : 30000 })
  sourcesShown = true
} catch {
  sourcesShown = false
}
await page.waitForTimeout(600)

const after = await page.locator('body').innerText()
const hasWebChip = /已联网|联网不可用/.test(after)
const srcLinks = await page.locator('a[href*="steam"]').count()
const hrefs = await page.locator('a[href*="steam"]').evaluateAll((els) => els.map((e) => e.getAttribute('href')).slice(0, 3))
const hasSourceMeta = /联网来源\s*·\s*\d+\s*条/.test(after)
// 全网搜索来源分组（kind=web）应出现，且带「全网 + Steam」标注
const hasWebGroup = after.includes('全网资讯')
const hasWebTag = after.includes('全网 + Steam')

// 全页截图（该站滚动容器在 Layout 内部，截整页要放大 viewport 或直接元素截图）
await page.screenshot({ path: `${OUT}/ai-websearch.png`, fullPage: false })
const bubble = page.locator('div', { hasText: '联网来源' }).last()
await bubble.screenshot({ path: `${OUT}/ai-sources.png` }).catch(() => {})

// ── 3. 口味类 + 强制联网：来源应更多，且按类别分组（相关游戏 / 特价 / 最新发售…）──
await page
  .locator('button', { hasText: /^联网$/ })
  .first()
  .click()
  .catch(() => {})
await page.waitForTimeout(200)
await page.fill('textarea', '我喜欢像素风和独立游戏')
await page.waitForTimeout(200)
await page.keyboard.press('Enter')
await page.waitForSelector('text=相关游戏', { timeout: STRICT ? 90000 : 30000 }).catch(() => {})
await page.waitForTimeout(1500)

const after2 = await page.locator('body').innerText()
const hasRelatedGroup = after2.includes('相关游戏')
const hasDealGroup = after2.includes('特价')
const hasReleaseGroup = after2.includes('最新发售')
const counts = [...after2.matchAll(/联网来源\s*·\s*(\d+)\s*条/g)].map((m) => Number(m[1]))
const maxCount = counts.length ? Math.max(...counts) : 0
await page.screenshot({ path: `${OUT}/ai-websearch-groups.png`, fullPage: false })
// 放大视口再拍一张：让消息区容纳更多内容，把「相关游戏 / 特价 / 最新发售」分组拍全
await page.setViewportSize({ width: 1440, height: 2400 })
await page.waitForTimeout(500)
await page.screenshot({ path: `${OUT}/ai-websearch-groups-tall.png`, fullPage: false })

await browser.close()

const lines = [
  `联网开关标签「联网检索」可见：${hasToggleLabel ? '✅' : '❌'}`,
  `模式按钮「自动」可见：${hasModeAuto ? '✅' : '❌'}`,
  `模式按钮「关闭」可见：${hasModeOff ? '✅' : '❌'}`,
  `联网来源区块出现：${sourcesShown ? '✅' : '❌'}`,
  `来源计数文案出现：${hasSourceMeta ? '✅' : '❌'}`,
  `联网状态标记出现：${hasWebChip ? '✅' : '❌'}`,
  `来源链接数量：${srcLinks}`,
  `链接示例：${hrefs.join(' | ')}`,
  `口味类来源计数：${counts.join(',')}（最大 ${maxCount}）`,
  `分组标题「相关游戏」：${hasRelatedGroup ? '✅' : '❌'}`,
  `分组标题「全网资讯」：${hasWebGroup ? '✅' : '❌'}`,
  `「全网 + Steam」标注：${hasWebTag ? '✅' : '❌'}`,
  `分组标题「特价」：${hasDealGroup ? '✅' : '❌'}`,
  `分组标题「最新发售」：${hasReleaseGroup ? '✅' : '❌'}`,
  `运行期报错数量：${errors.length}`,
  ...errors.slice(0, 10),
  `截图目录：${OUT}`,
]
console.log(lines.join('\n'))

const passCore = hasToggleLabel && hasModeAuto && hasModeOff && hasWebChip && errors.length === 0
// 线上沙箱可能够不着第三方 provider（无全网来源），用 EXPECT_WEB=0 放宽
const EXPECT_WEB = process.env.EXPECT_WEB !== '0'
const passGroup = hasRelatedGroup && hasDealGroup && hasReleaseGroup && maxCount >= 15 && (EXPECT_WEB ? hasWebGroup : true)
const pass = STRICT ? passCore && sourcesShown && srcLinks > 0 && passGroup : passCore
process.exit(pass ? 0 : 1)
