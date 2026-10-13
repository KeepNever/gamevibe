// 生产站点浏览器冒烟：确认线上页面能正常启动、渲染实时/AI 模块、无运行期报错
import { chromium } from 'playwright'

const BASE = process.argv[2] || 'https://gamevibe.app.workbuddy.host'
const out = []
let pass = 0, fail = 0
const ok = (n, c, d) => { c ? (pass++, out.push(`  PASS ${n}${d ? ' — ' + d : ''}`)) : (fail++, out.push(`  FAIL ${n}${d ? ' — ' + d : ''}`)) }

// 1) /api/live 是否随时间变化
const a = await (await fetch(`${BASE}/api/live`)).json()
await new Promise((r) => setTimeout(r, 3200))
const b = await (await fetch(`${BASE}/api/live`)).json()
ok('live 动态', a.global.onlinePlayers !== b.global.onlinePlayers,
  `t1=${a.global.onlinePlayers} t2=${b.global.onlinePlayers} source=${a.source}`)

// 2) 浏览器渲染
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()) })
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 })
await page.waitForTimeout(2500)
const body = await page.evaluate(() => document.body.innerText)
ok('页面非空白', body.length > 200, `bodyText len=${body.length}`)
ok('实时指示可见', body.includes('实时'), '')
ok('AI 精选模块可见', body.includes('AI') && (body.includes('精选') || body.includes('问问')), '')
ok('AI 今日趋势卡可见', body.includes('AI 今日趋势') && body.includes('热度榜'), '')

ok('无运行期报错', errors.length === 0, errors.slice(0, 3).join(' | '))

await page.screenshot({ path: 'docs/deploy-screenshots/prod-home.png', fullPage: false })
const trendSection = page.locator('section', { hasText: 'AI 今日趋势' }).first()
await trendSection.screenshot({ path: 'docs/deploy-screenshots/prod-trend.png' }).catch(() => {})
await browser.close()

out.push('')
out.push(`──── 生产冒烟：通过 ${pass} / 失败 ${fail} ────`)
console.log(out.join('\n'))
process.exit(fail === 0 ? 0 : 1)
