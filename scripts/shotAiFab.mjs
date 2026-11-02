/**
 * AI 顾问抽屉布局实测 + 截图
 * 用法：node scripts/shotAiFab.mjs [baseUrl]
 *
 * 复现的是真实出错场景：窗口 1440 宽、抽屉只有 448 —— 旧代码用 xl: 视口断点，
 * 会把两栏硬塞进抽屉。这里直接量 DOM 宽度，不靠看图猜。
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

for (const k of Object.keys(process.env)) if (/proxy/i.test(k)) delete process.env[k]

const BASE = process.argv[2] || 'http://127.0.0.1:8792'
const OUT = 'docs/screens'
mkdirSync(OUT, { recursive: true })

const ACCOUNT = process.env.SHOT_USER || '糖糖不吃糖@seed.local'
const PASS = process.env.SHOT_PASS || 'seedpass1234'

const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--no-proxy-server', '--disable-dev-shm-usage'],
})
const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 })
const page = await ctx.newPage()

const problems = []
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`[console] ${m.text().slice(0, 160)}`)
})
page.on('pageerror', (e) => problems.push(`[pageerror] ${String(e).slice(0, 160)}`))

const login = await ctx.request.post(`${BASE}/api/auth/login`, {
  data: { email: ACCOUNT, password: PASS },
})
if (!login.ok()) {
  console.log(`❌ 登录失败 ${login.status()}`)
  await browser.close()
  process.exit(1)
}

const checks = []
const ok = (name, pass, detail = '') => {
  checks.push([name, pass, detail])
  console.log(`${pass ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
}

await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)

// 打开抽屉
await page.click('button[title="问问 AI 助手"]')
await page.waitForTimeout(700)

const geom = await page.evaluate(() => {
  const drawer = [...document.querySelectorAll('div')].find(
    (d) => d.className && String(d.className).includes('max-w-md') && String(d.className).includes('fixed'),
  )
  if (!drawer) return { error: 'drawer not found' }
  const r = drawer.getBoundingClientRect()

  // 聊天输入框所在列与口味面板
  const input = drawer.querySelector('textarea')
  const chatCol = input ? input.closest('div.flex.flex-col') : null
  const taste = [...drawer.querySelectorAll('*')].find((el) =>
    String(el.textContent || '').includes('你的口味画像') && el.className && String(el.className).includes('shrink-0'),
  )

  // 抽屉内所有元素是否横向溢出
  const overflow = [...drawer.querySelectorAll('*')].filter((el) => {
    const b = el.getBoundingClientRect()
    return b.width > 0 && (b.right > r.right + 1 || b.left < r.left - 1)
  }).length

  // 标题是否被压成竖排（行高比数量异常）
  const h2 = drawer.querySelector('h2')
  return {
    drawerW: Math.round(r.width),
    chatW: chatCol ? Math.round(chatCol.getBoundingClientRect().width) : null,
    tasteVisible: taste ? taste.getBoundingClientRect().width > 0 : false,
    tasteW: taste ? Math.round(taste.getBoundingClientRect().width) : 0,
    overflow,
    h2Lines: h2 ? Math.round(h2.getBoundingClientRect().height / parseFloat(getComputedStyle(h2).lineHeight)) : null,
    h2W: h2 ? Math.round(h2.getBoundingClientRect().width) : null,
  }
})

console.log('\n抽屉几何：', JSON.stringify(geom))
ok('抽屉打开且宽度约 448', geom.drawerW >= 400 && geom.drawerW <= 480, `${geom.drawerW}px`)
ok('聊天列占满抽屉宽度', geom.chatW > geom.drawerW * 0.85, `${geom.chatW} / ${geom.drawerW}`)
ok('抽屉内不并排显示口味面板', geom.tasteVisible === false)
ok('抽屉内无横向溢出元素', geom.overflow === 0, `${geom.overflow} 个`)
ok('标题不再被压成竖排', geom.h2Lines !== null && geom.h2Lines <= 2, `${geom.h2Lines} 行 / 宽 ${geom.h2W}px`)

await page.screenshot({ path: `${OUT}/aifab-01-chat.png` })

// 切到口味画像
const tasteBtn = await page.$('button:has-text("口味画像")')
if (tasteBtn) {
  await tasteBtn.click()
  await page.waitForTimeout(600)
  const g2 = await page.evaluate(() => {
    const drawer = [...document.querySelectorAll('div')].find(
      (d) => d.className && String(d.className).includes('max-w-md') && String(d.className).includes('fixed'),
    )
    const r = drawer.getBoundingClientRect()
    const taste = [...drawer.querySelectorAll('*')].find(
      (el) => String(el.textContent || '').includes('你的口味画像') && el.className && String(el.className).includes('shrink-0'),
    )
    return { tasteW: taste ? Math.round(taste.getBoundingClientRect().width) : 0, drawerW: Math.round(r.width) }
  })
  console.log('切到口味画像：', JSON.stringify(g2))
  ok('切换后口味面板占满宽度', g2.tasteW > g2.drawerW * 0.85, `${g2.tasteW} / ${g2.drawerW}`)
  await page.screenshot({ path: `${OUT}/aifab-02-taste.png` })
} else {
  ok('口味画像切换按钮存在', false)
}

ok('控制台无报错', problems.length === 0, problems.slice(0, 2).join(' | '))

// 整页 /assistant 仍应是并排布局（宽屏才有空间）
await page.goto(`${BASE}/ai`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)
const full = await page.evaluate(() => {
  const input = document.querySelector('textarea')
  const chatCol = input ? input.closest('div.flex.flex-col') : null
  const taste = [...document.querySelectorAll('*')].find(
    (el) => String(el.textContent || '').includes('你的口味画像') && el.className && String(el.className).includes('shrink-0'),
  )
  const c = chatCol?.getBoundingClientRect()
  const t = taste?.getBoundingClientRect()
  return {
    chatW: c ? Math.round(c.width) : null,
    tasteW: t ? Math.round(t.width) : 0,
    sideBySide: !!(c && t && Math.abs(c.top - t.top) < 40 && t.left >= c.right - 4),
  }
})
console.log('整页布局：', JSON.stringify(full))
ok('整页宽屏仍是左聊右口味并排', full.sideBySide && full.tasteW > 200, `chat ${full.chatW} / taste ${full.tasteW}`)
await page.screenshot({ path: `${OUT}/aifab-03-page.png` })

await browser.close()
const failed = checks.filter((c) => !c[1]).length
console.log(`\n${checks.length - failed}/${checks.length} 条通过`)
process.exitCode = failed ? 1 : 0
