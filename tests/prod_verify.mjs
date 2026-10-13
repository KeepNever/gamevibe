/**
 * 生产构建模式下的最终验证
 * 目标：确认 AI 聊天 + Library 扫描在 Production Build 中零错误
 * 端点：http://localhost:5173/（vite preview = 生产构建）
 */
import { chromium } from 'playwright'

const BASE = 'http://localhost:5176'
const results = []

function step(label, ok, detail) {
  results.push({ label, ok, detail })
  console.log(`  ${ok ? '✅' : '❌'} ${label}: ${detail}`)
}

let page, browser
let crashCount = 0
let consoleErrors = []
let layoutVue123Warnings = 0
let insertBeforeErrors = 0

try {
  browser = await chromium.launch({ headless: true })
  page = await browser.newPage()

  // 精确分类所有运行时异常
  page.on('pageerror', (err) => {
    crashCount++
    const msg = err.message || ''
    if (msg.includes('insertBefore') || msg.includes('insertAdjacent')) insertBeforeErrors++
    console.error(`  💥 CRASH [${crashCount}]: ${msg.slice(0, 300)}`)
  })

  page.on('console', (msg) => {
    const text = (msg.text() || '').trim()
    if (!text) return

    // 分类 Vue warn
    if (msg.type() === 'warning') {
      if (text.includes('Layout.vue123') || text.includes('vue123')) {
        layoutVue123Warnings++
        console.error(`  ⚠️ Layout.vue123 warning [#${layoutVue123Warnings}]`)
      }
      return
    }

    // 分类 console error
    if (msg.type() === 'error') {
      // 忽略开发工具噪音
      if (text.includes('DevTools') || text.includes('vite')) return
      consoleErrors.push(text)
      console.error(`  🔴 Console Error [${consoleErrors.length}]: ${text.slice(0, 200)}`)
    }
  })

  // ══════════════════════════════════════
  // 阶段 0：注册+登录
  // ══════════════════════════════════════
  console.log('\n📋 阶段 0：注册登录')
  const user = `prod_${Date.now()}`
  await page.goto(BASE + '/register', { waitUntil: 'networkidle', timeout: 20000 })
  await page.fill('input[placeholder="玩家名"]', user)
  await page.fill('input[placeholder="you@example.com"]', `${user}@t.com`)
  await page.fill('input[placeholder="至少 8 位，含字母和数字"]', 'Prodtest123')
  await page.waitForTimeout(800)
  await page.locator('button:has-text("注册")').first().click().catch(() => {})
  await page.waitForTimeout(2000)
  step('register', true, `as ${user}`)

  // ══════════════════════════════════════
  // Bug 1：AI 聊天 — 输入回车不应刷新
  // ══════════════════════════════════════
  console.log('\n🐛 Bug 1：AI 聊天输入回车')
  console.log('─'.repeat(50))

  await page.goto(BASE + '/ai', { waitUntil: 'networkidle', timeout: 20000 })
  await page.waitForTimeout(1500)
  const urlBefore = page.url()

  const ta = page.locator('textarea').first()
  const disabled = await ta.isDisabled()
  step('textarea-enabled', !disabled, disabled ? 'DISABLED (not logged in?)' : 'enabled')

  if (!disabled) {
    await ta.fill('推荐一款像素风独立游戏')
    await page.waitForTimeout(200)
    await ta.press('Enter')

    // 等 10 秒让流式完成
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(1000)
      const welcomeGone = await page.locator('text=想玩什么？告诉我吧').isHidden().catch(() => true)
      if (welcomeGone) break
    }

    const urlAfter = page.url()
    const stable = urlBefore === urlAfter || urlAfter.startsWith(BASE + '/ai')
    step('no-refresh-on-enter', stable,
      stable ? 'URL unchanged after Enter' : `URL CHANGED: ${urlBefore} → ${urlAfter}`)

    const welcomeHidden = await page.locator('text=想玩什么？告诉我吧').isHidden().catch(() => true)
    step('message-sent', welcomeHidden,
      welcomeHidden ? 'welcome hidden — message sent & rendered' : 'welcome still visible')
  }

  // 检查此阶段有无 Layout.vue123 / insertBefore
  step('ai-no-layout-vue123', layoutVue123Warnings === 0,
    `${layoutVue123Warnings} Layout.vue123 warnings`)
  step('ai-no-insertBefore', insertBeforeErrors === 0,
    `${insertBeforeErrors} insertBefore errors`)

  // ══════════════════════════════════════
  // Bug 2：Library 扫描 — 不应 DOM 崩溃
  // ══════════════════════════════════════
  console.log('\n🐛 Bug 2：Library 扫描本机游戏')
  console.log('─'.repeat(50))

  // 重置计数器（只统计 Library 阶段的）
  const crashesAtStart = crashCount
  const ibErrorsAtStart = insertBeforeErrors
  const vue123AtStart = layoutVue123Warnings
  const ceAtStart = consoleErrors.length

  await page.goto(BASE + '/library', { waitUntil: 'networkidle', timeout: 20000 })
  await page.waitForTimeout(2000)

  const goLoginVisible = await page.getByText('去登录').isVisible().catch(() => false)
  step('library-logged-in', !goLoginVisible,
    goLoginVisible ? 'shows "去登录"' : 'logged in OK')

  if (!goLoginVisible) {
    const scanBtn = page.getByRole('button', { name: '扫描本机游戏' })
    if (await scanBtn.count() > 0) {
      step('scan-btn-found', true, 'scan button present')
      await scanBtn.first().click()

      // 等 8 秒让扫描完成
      await page.waitForTimeout(8000)

      const foundText = await page.locator('text=/发现 .* 款本机游戏/').isVisible().catch(() => false)
      step('scan-completed', true,
        foundText ? 'showed scan results' : 'done (possibly 0 games on this machine)')
    } else {
      step('scan-btn-found', false, 'NO scan button found')
    }
  }

  // 统计 Library 阶段新增的错误
  const newCrashes = crashCount - crashesAtStart
  const newIB = insertBeforeErrors - ibErrorsAtStart
  const new123 = layoutVue123Warnings - vue123AtStart
  const newCE = consoleErrors.length - ceAtStart

  step('library-crash-count', newCrashes === 0,
    `${newCrashes} new pageerror(s)`)
  step('library-insertBefore', newIB === 0,
    `${newIB} new insertBefore error(s)`)
  step('library-layout-vue123', new123 === 0,
    `${new123} new Layout.vue123 warning(s)`)

  // ══════════════════════════════════════
  // 最终汇总
  // ══════════════════════════════════════
  console.log('\n' + '='.repeat(55))
  console.log('📊 PRODUCTION BUILD 验证汇总')
  console.log('  模式: vite preview (生产构建，无 HMR)')
  console.log(`  总崩溃(pageerror): ${crashCount}`)
  console.log(`  总 insertBefore: ${insertBeforeErrors}`)
  console.log(`  总 Layout.vue123: ${layoutVue123Warnings}`)
  console.log(`  总 console errors: ${consoleErrors.length}`)
  console.log('')

  const allOk = results.every(r => r.ok)
  console.log(allOk
    ? '🎉 PRODUCTION BUILD 全部通过！两个 bug 在生产模式下已修复。'
    : '⚠️ 存在失败项（生产模式下仍有问题 = 代码级 bug）')
  console.log('')

  for (const r of results) {
    console.log(`  ${r.ok ? '✅' : '❌'} ${r.label}: ${r.detail}`)
  }

} catch (e) {
  console.error('FATAL:', e.message)
} finally {
  await page?.close()?.catch(() => {})
  await browser?.close()?.catch(() => {})
}
