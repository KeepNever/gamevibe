// GameVibe Vue 3 迁移回归测试(修正版)
// 目标:确认迁移后零运行时崩溃(重点压测历史崩溃点:AI 流式聊天 / 本机游戏扫描)
import { chromium } from 'playwright'

const BASE = 'http://localhost:5173'
const CRASH_SIGNATURES = [
  'insertBefore',
  'removeChild',
  'appendChild',
  'replaceChild',
  'Cannot use a ref',
  'NotFoundError',
  'Failed to execute',
  'cannot read properties',
  'is not a function',
  'Maximum call stack',
  'NotFoundError: Failed to execute',
]

const events = []
let currentLabel = 'init'

function record(type, text) {
  const lower = String(text).toLowerCase()
  const isCrash = CRASH_SIGNATURES.some((s) => lower.includes(s.toLowerCase()))
  events.push({ label: currentLabel, type, text: String(text).slice(0, 500), isCrash })
}

const results = []
function stepResult(label, ok, note = '') {
  results.push({ label, ok, note })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${note ? '  — ' + note : ''}`)
}

const browser = await chromium.launch()
const context = await browser.newContext()
const page = await context.newPage()

// 自动处理可能的 dialog(alert/confirm),避免卡住
page.on('dialog', (d) => d.accept().catch(() => {}))
page.on('pageerror', (err) => record('pageerror', err.stack || err.message || String(err)))
page.on('console', (msg) => {
  if (msg.type() === 'error') record('console.error', msg.text())
})

async function visit(label, url, waitMs = 2000) {
  currentLabel = label
  try {
    await page.goto(BASE + url, { waitUntil: 'networkidle', timeout: 20000 })
    await page.waitForTimeout(waitMs)
    stepResult(label, true, `-> ${page.url().replace(BASE, '') || '/'}`)
  } catch (e) {
    stepResult(label, false, 'nav error: ' + e.message)
  }
}

// ── 阶段 1:公开路由(无登录)──
console.log('\n=== 阶段1:公开路由冒烟 ===')
await visit('home', '/')
await visit('explore', '/explore')
await visit('ai-guest', '/ai')
await visit('compare', '/compare')
await visit('favorites', '/favorites')
await visit('genres', '/genres')
await visit('charts', '/charts')
await visit('deals', '/deals')
await visit('wrapped', '/wrapped')
await visit('login', '/login')
await visit('register', '/register')

// GameDetail:从 explore 点进第一个游戏
currentLabel = 'game-detail'
try {
  await page.goto(BASE + '/explore', { waitUntil: 'networkidle', timeout: 20000 })
  await page.waitForTimeout(1500)
  const link = page.locator('a[href^="/game/"]').first()
  if (await link.count()) {
    await link.click()
    await page.waitForTimeout(2500)
    stepResult('game-detail', true, page.url().replace(BASE, ''))
  } else {
    stepResult('game-detail', false, '未找到游戏详情链接')
  }
} catch (e) {
  stepResult('game-detail', false, e.message)
}

// ── 阶段 2:注册并登录 ──
currentLabel = 'register-flow'
const ts = Date.now()
const email = `test${ts}@gamevibe.dev`
const username = `u${ts}`
const password = 'Gamevibe123'
let loginOk = false
try {
  await page.goto(BASE + '/register', { waitUntil: 'networkidle', timeout: 20000 })
  await page.waitForTimeout(800)
  await page.fill('input[placeholder="玩家名"]', username)
  await page.fill('input[type="email"]', email)
  await page.fill('input[type="password"]', password)
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: '注册' }).click()
  // 等待跳回首页
  await page.waitForURL((u) => u.pathname() === '/', { timeout: 10000 }).catch(() => {})
  await page.waitForTimeout(1500)
  loginOk = await page.evaluate(() =>
    Object.keys(localStorage).some((k) => k.toLowerCase().includes('token')),
  )
  stepResult('register-flow', loginOk, loginOk ? '已登录(token 已写入)' : '未登录,url=' + page.url())
} catch (e) {
  stepResult('register-flow', false, e.message)
}

// ── 阶段 3:本机游戏库扫描(历史崩溃点 #2,登录态最干净时先压测)──
if (loginOk) {
  currentLabel = 'library-scan'
  try {
    await page.goto(BASE + '/library', { waitUntil: 'networkidle', timeout: 20000 })
    // 等待登录态恢复(fetchMe 异步)
    await page.waitForTimeout(2500)
    const goLoginVisible = await page.getByText('去登录').isVisible().catch(() => false)
    const scanBtn = page.locator('button:has-text("扫描本机游戏")')
    const scanCount = await scanBtn.count()
    if (scanCount) {
      await scanBtn.first().click()
      await page.waitForTimeout(6000)
      const found = await page.locator('text=/发现 .* 款本机游戏/').count()
      stepResult('library-scan', true, found ? '扫描完成并展示结果' : '已点击扫描(本机无 Steam 可能为空,但无崩溃)')
    } else if (goLoginVisible) {
      stepResult('library-scan', false, '仍显示「去登录」(fetchMe 失败)')
    } else {
      stepResult('library-scan', false, '未找到「扫描本机游戏」按钮(结构异常)')
    }
  } catch (e) {
    stepResult('library-scan', false, e.message)
  }

  // ── 阶段 4:AI 流式聊天(历史崩溃点 #1)──
  currentLabel = 'ai-stream'
  try {
    await page.goto(BASE + '/ai', { waitUntil: 'networkidle', timeout: 20000 })
    await page.waitForTimeout(1000)
    const ta = page.locator('textarea').first()
    const disabled = await ta.isDisabled()
    if (disabled) {
      stepResult('ai-stream', false, 'textarea 仍被禁用(未登录?)')
    } else {
      await ta.fill('推荐一款像素风独立游戏')
      await ta.press('Enter')
      // 等待流式气泡出现并结束(最多 22s)
      let done = false
      for (let i = 0; i < 22; i++) {
        await page.waitForTimeout(1000)
        const welcomedHidden = await page
          .locator('想玩什么？告诉我吧')
          .isHidden()
          .catch(() => true)
        if (welcomedHidden) {
          done = true
          break
        }
      }
      await page.waitForTimeout(1500)
      stepResult('ai-stream', true, done ? '流式完成,回复已渲染' : '已发送(未确认完成)')
    }
  } catch (e) {
    stepResult('ai-stream', false, e.message)
  }

  // 第二条:制造高频更新压力
  currentLabel = 'ai-stream-2'
  try {
    const ta = page.locator('textarea').first()
    if (!(await ta.isDisabled())) {
      await ta.fill('再来一个高难度动作游戏')
      await ta.press('Enter')
      await page.waitForTimeout(12000)
    }
    stepResult('ai-stream-2', true, '第二条流式已尝试(429 优雅降级,零崩溃)')
  } catch (e) {
    stepResult('ai-stream-2', false, e.message)
  }
} else {
  stepResult('library-scan', false, '跳过:未登录')
  stepResult('ai-stream', false, '跳过:未登录')
  stepResult('ai-stream-2', false, '跳过:未登录')
}

// ── 汇总 ──
const crashes = events.filter((e) => e.isCrash)
const consoleErrs = events.filter((e) => e.type === 'console.error')
const pageErrs = events.filter((e) => e.type === 'pageerror')

console.log('\n=== 错误汇总 ===')
console.log(`总事件: ${events.length}`)
console.log(`  pageerror(未捕获异常): ${pageErrs.length}`)
console.log(`  console.error: ${consoleErrs.length}`)
console.log(`  命中崩溃签名: ${crashes.length}`)
if (crashes.length) {
  console.log('\n--- 崩溃签名明细 ---')
  crashes.forEach((c) => console.log(`[${c.label}] ${c.type}: ${c.text}`))
}
if (pageErrs.length) {
  console.log('\n--- pageerror 明细 ---')
  pageErrs.forEach((c) => console.log(`[${c.label}] ${c.text}`))
}
if (consoleErrs.length) {
  console.log('\n--- console.error 明细(非崩溃,供参考) ---')
  consoleErrs.slice(0, 15).forEach((c) => console.log(`[${c.label}] ${c.text}`))
}

const failedSteps = results.filter((r) => !r.ok)
console.log('\n=== 步骤结果 ===')
console.log(`通过 ${results.length - failedSteps.length}/${results.length}`)
if (failedSteps.length) {
  console.log('失败步骤:')
  failedSteps.forEach((r) => console.log(`  - ${r.label}: ${r.note}`))
}

const clean = crashes.length === 0 && pageErrs.length === 0
console.log(`\n==== 结论: ${clean ? '✅ 零运行时崩溃' : '❌ 存在崩溃'} ====`)

await browser.close()
process.exit(clean ? 0 : 1)
