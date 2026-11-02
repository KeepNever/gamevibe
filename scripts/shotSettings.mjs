/**
 * 账户设置页实机截图 + 快检
 * 用法：node scripts/shotSettings.mjs [baseUrl]
 * 默认连本地 8792（要用 dist 构建产物，先跑 npm run dist:local）
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

for (const k of Object.keys(process.env)) {
  if (/proxy/i.test(k)) delete process.env[k]
}

const BASE = process.argv[2] || 'http://127.0.0.1:8792'
const OUT = 'docs/screens'
mkdirSync(OUT, { recursive: true })

const ACCOUNT = process.env.SHOT_USER || '糖糖不吃糖@seed.local'
const PASS = process.env.SHOT_PASS || 'seedpass1234'

const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--no-proxy-server', '--disable-dev-shm-usage'],
})
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
const page = await ctx.newPage()

const problems = []
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`[console] ${m.text().slice(0, 160)}`)
})
page.on('pageerror', (e) => problems.push(`[pageerror] ${String(e).slice(0, 160)}`))

// 用 context.request 登录，Cookie 自动落在同一个 context 里（httpOnly 也照常保存）
const login = await ctx.request.post(`${BASE}/api/auth/login`, {
  data: { email: ACCOUNT, password: PASS },
})
if (!login.ok()) {
  console.log(`❌ 登录失败 ${login.status()}：${(await login.text()).slice(0, 160)}`)
  await browser.close()
  process.exit(1)
}
const sets = login.headers()['set-cookie'] || ''
console.log(`✅ 登录成功，Cookie 含 gv_session：${/gv_session=/.test(sets)}，HttpOnly：${/HttpOnly/i.test(sets)}`)

await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(
  () => !!document.querySelector('h1') && document.body.innerText.includes('账户设置'),
  { timeout: 20000 },
)
await page.waitForTimeout(700)

const shots = []
async function shoot(name, tab) {
  await page.goto(`${BASE}/settings?tab=${tab}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(tab === 'devices' ? 1200 : 800)
  const file = `${OUT}/settings-${name}.png`
  await page.screenshot({ path: file })
  shots.push(file)
  console.log(`  📸 ${file}`)
}

await shoot('01-profile', 'profile')
await shoot('02-security', 'security')
await shoot('03-devices', 'devices')
await shoot('04-privacy', 'privacy')

// ── 快检：关键元素是否真的渲染出来 ──
await page.goto(`${BASE}/settings?tab=profile`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(700)
const checks = []
const text = await page.evaluate(() => document.body.innerText)
checks.push(['显示用户名区块', text.includes('用户名')])
checks.push(['显示昵称输入', text.includes('昵称')])
checks.push(['显示注册时间', /注册于/.test(text)])

await page.goto(`${BASE}/settings?tab=security`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(700)
const t2 = await page.evaluate(() => document.body.innerText)
checks.push(['密码区存在', t2.includes('修改密码')])
checks.push(['邮箱区显示当前绑定', t2.includes('当前绑定')])
checks.push(['手机号标注未验证/未绑定', /未验证|尚未绑定/.test(t2)])

await page.goto(`${BASE}/settings?tab=devices`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)
const t3 = await page.evaluate(() => document.body.innerText)
checks.push(['设备列表有当前设备', t3.includes('当前设备')])
checks.push(['有全部退出按钮', t3.includes('全部退出')])

await page.goto(`${BASE}/settings?tab=privacy`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1000)
const t4 = await page.evaluate(() => document.body.innerText)
checks.push(['有导出按钮', t4.includes('导出')])
checks.push(['有注销入口', t4.includes('注销')])

// 侧边栏入口
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)
const homeText = await page.evaluate(() => document.body.innerText)
checks.push(['侧边栏入口文案存在', /账户设置与更多/.test(homeText)])

// 未登录访问设置页应跳登录（用全新 context 模拟访客）
const guestCtx = await browser.newContext()
const guest = await guestCtx.newPage()
await guest.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' })
await guest.waitForTimeout(1200)
checks.push(['未登录访问 /settings 跳转登录页', guest.url().includes('/login')])
await guestCtx.close()

// 管理员后台的审计日志页
const adminCtx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
const admin = await adminCtx.newPage()
const adminLogin = await adminCtx.request.post(`${BASE}/api/auth/login`, {
  data: { email: process.env.ADMIN_USER || '老白不白@seed.local', password: PASS },
})
if (adminLogin.ok()) {
  await admin.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' })
  await admin.waitForTimeout(1200)
  const adminText = await admin.evaluate(() => document.body.innerText)
  const hasAuditTab = /审计日志/.test(adminText)
  checks.push(['后台有审计日志标签', hasAuditTab])
  if (hasAuditTab) {
    await admin.getByRole('button', { name: '审计日志' }).click()
    await admin.waitForTimeout(1200)
    await admin.screenshot({ path: `${OUT}/admin-05-audit.png` })
    shots.push(`${OUT}/admin-05-audit.png`)
    console.log(`  📸 ${OUT}/admin-05-audit.png`)
    const auditText = await admin.evaluate(() => document.body.innerText)
    checks.push(['审计页显示了操作记录', /登录|注册|修改|调整/.test(auditText)])
  }
} else {
  checks.push(['管理员登录（审计页检查前置）', false])
}
await adminCtx.close()

let bad = 0
for (const [name, ok] of checks) {
  if (!ok) bad++
  console.log(`  ${ok ? '✅' : '❌'} ${name}`)
}

if (problems.length) {
  console.log('\n⚠️ 控制台异常：')
  for (const p of [...new Set(problems)].slice(0, 8)) console.log('   ' + p)
}

await browser.close()
console.log(`\n截图 ${shots.length} 张，断言 ${checks.length - bad}/${checks.length} 通过`)
process.exitCode = bad || problems.length ? 1 : 0
