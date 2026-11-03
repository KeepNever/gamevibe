// 登录 / 权限 实机验证（Playwright）
// 用法：node scripts/verifyAuthUI.mjs [base]
// 断言：登录页要素、未登录拦截带回跳、管理员可进后台、普通用户被挡回首页

import { chromium } from 'playwright'
import { mkdirSync, readFileSync } from 'node:fs'

for (const k of ['HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'https_proxy', 'http_proxy', 'all_proxy']) {
  delete process.env[k]
}

const base = process.argv[2] || 'http://127.0.0.1:8792'
// 相对脚本定位，CI（Linux）与本机（Windows）都能跑
const outDir = new URL('./../.probe/auth', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
mkdirSync(outDir, { recursive: true })

// 演示密码以种子脚本为准，别硬编码
const seedSrc = readFileSync(new URL('./seedSocial.mjs', import.meta.url), 'utf8')
const PASS = /const PASS = '([^']+)'/.exec(seedSrc)?.[1] || ''
if (!PASS) {
  console.error('[fatal] 未能从 seedSocial.mjs 读到演示密码')
  process.exit(1)
}

const results = []
const ok = (name, cond, extra = '') => {
  results.push({ name, pass: !!cond, extra })
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? ' — ' + extra : ''}`)
}

// 鉴权已改为 httpOnly Cookie，页面 JS 读不到令牌，也就不能再往 localStorage 里塞。
// 用 Playwright 的 context.request 登录，Cookie 会自动落在同一个 context 上。
async function loginAs(context, email) {
  const r = await context.request.post(`${base}/api/auth/login`, {
    data: { email, password: PASS },
  })
  return r.ok()
}

// Playwright 自带的 Chromium 未安装（ms-playwright 目录下没有 chromium），
// 直接复用系统 Chrome，避免为了跑一次验证去下载上百 MB
const browser = await chromium.launch({
  // CI 里没有 Chrome 浏览器：设 PLAYWRIGHT_CHANNEL=bundled 时用 Playwright 内置 chromium
  channel: process.env.PLAYWRIGHT_CHANNEL && process.env.PLAYWRIGHT_CHANNEL !== 'bundled'
    ? process.env.PLAYWRIGHT_CHANNEL
    : undefined,
  args: ['--no-proxy-server'],
})
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 950 },
  deviceScaleFactor: 1.5,
  locale: 'zh-CN',
})
const page = await ctx.newPage()
const errs = []
page.on('pageerror', (e) => errs.push(e.message))

// ── 1. 登录页要素 ────────────────────────────────────
await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(600)
ok('登录页含「记住我」', await page.locator('text=记住我').count() > 0)
ok('登录页含「忘记密码」入口', await page.locator('text=忘记密码').count() > 0)
ok('密码可见切换按钮存在', await page.locator('button[title="显示密码"]').count() > 0)

// 密码可见：点开后 input type 变 text
await page.fill('input[type="email"]', 'someone@test.local')
await page.fill('input[type="password"]', 'abc12345')
await page.click('button[title="显示密码"]')
await page.waitForTimeout(200)
const typeAfter = await page.locator('input[autocomplete="current-password"]').getAttribute('type')
ok('点击眼睛后明文显示', typeAfter === 'text', `type=${typeAfter}`)
await page.screenshot({ path: `${outDir}/01-login.jpg`, type: 'jpeg', quality: 88 })

// 即时校验：填非法邮箱后失焦
await page.fill('input[type="email"]', 'bad-email')
await page.locator('input[type="email"]').blur()
await page.waitForTimeout(300)
ok('非法邮箱即时提示', await page.locator('text=邮箱格式不正确').count() > 0)
await page.screenshot({ path: `${outDir}/02-login-validation.jpg`, type: 'jpeg', quality: 88 })

// ── 2. 未登录访问受保护页 ─────────────────────────────
await page.goto(`${base}/favorites`, { waitUntil: 'domcontentloaded' })
// 等 SPA 挂载 + 路由守卫跑完再看最终 URL：固定 sleep 在慢网/首次拉 chunk 时会误判「未拦截」
await page.waitForFunction(() => location.pathname === '/login', null, { timeout: 20000 })
  .catch(() => console.log('[warn] 路由守卫未在 20s 内把未登录用户跳到 /login'))
const urlBlocked = page.url()
ok('未登录访问 /favorites 被拦截', urlBlocked.includes('/login'), urlBlocked)
ok('拦截时带上回跳参数', urlBlocked.includes('redirect=%2Ffavorites') || urlBlocked.includes('redirect=/favorites'))

// ── 3. 管理员进后台 ──────────────────────────────────
const adminOk = await loginAs(ctx, '老白不白@seed.local')
ok('管理员账号可登录（Cookie 会话）', adminOk)
await page.goto(`${base}/admin`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1800)
ok('管理员能打开 /admin', page.url().includes('/admin'), page.url())
ok('后台标题渲染', await page.locator('text=用户与权限').count() > 0)
const rowCount = await page.locator('select').count()
ok('用户列表渲染出角色下拉', rowCount > 0, `${rowCount} 行`)
await page.screenshot({ path: `${outDir}/03-admin.jpg`, type: 'jpeg', quality: 88 })

// 角色矩阵展开
await page.click('text=查看角色矩阵').catch(() => {})
await page.waitForTimeout(800)
ok('角色矩阵可展开', await page.locator('text=评论管理').count() > 0)
await page.screenshot({ path: `${outDir}/04-admin-matrix.jpg`, type: 'jpeg', quality: 88 })

// ── 4. 普通用户被挡 ──────────────────────────────────
await ctx.clearCookies()
const userOk = await loginAs(ctx, '阿坤Kun@seed.local')
ok('普通用户可登录（Cookie 会话）', userOk)
await page.goto(`${base}/admin`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)
const urlUser = page.url()
ok('普通用户进 /admin 被挡回首页', !urlUser.includes('/admin'), urlUser)

// ── 5. 忘记密码页 ────────────────────────────────────
await page.goto(`${base}/forgot-password`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => /找回密码/.test(document.body.innerText), null, { timeout: 20000 })
  .catch(() => console.log('[warn] 忘记密码页未渲染出内容'))
ok('忘记密码页可访问', await page.locator('text=找回密码').count() > 0)
await page.screenshot({ path: `${outDir}/05-forgot.jpg`, type: 'jpeg', quality: 88 })

ok('页面无 JS 运行时错误', errs.length === 0, errs.slice(0, 3).join(' | '))

await browser.close()

const passed = results.filter((r) => r.pass).length
console.log(`\n═══ ${passed}/${results.length} 通过 ═══`)
console.log(`截图：${outDir}`)
process.exit(passed === results.length ? 0 : 1)
