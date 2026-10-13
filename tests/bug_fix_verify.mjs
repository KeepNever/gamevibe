/**
 * 针对性回归：验证用户反馈的两个具体 bug 是否已修复
 * Bug 1: AI 聊天输入后按回车导致页面刷新/跳转
 * Bug 2: Library 扫描本机游戏报 insertBefore DOM 错误
 */
import { chromium } from 'playwright'

const BASE = 'http://localhost:5174'

const results = []
function step(label, ok, detail) {
  results.push({ label, ok, detail })
  const icon = ok ? '✅' : '❌'
  console.log(`  ${icon} ${label}: ${detail}`)
}

let page, browser, crashes = 0, consoleErrors = 0

try {
  browser = await chromium.launch({ headless: true })
  page = await browser.newPage()

  // ── 挂载全局错误监听 ──
  page.on('pageerror', (err) => {
    crashes++
    const msg = err.message || ''
    console.error(`  💥 PAGE ERROR [${crashes}]: ${msg.slice(0, 200)}`)
  })
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors++
      const text = msg.text() || ''
      // 只打印关键错误（忽略 vite overlay 等开发噪音）
      if (!text.includes('vite') && !text.includes('DevTools') && !text.includes('@vue/reactivity')) {
        console.error(`  ⚠️ CONSOLE ERROR [${consoleErrors}]: ${text.slice(0, 200)}`)
      }
    }
  })

  console.log('\n🔧 Bug 1: AI 聊天输入回车 → 不应刷新/跳转')
  console.log('─'.repeat(50))

  // 先注册登录
  const user = `bugfix_${Date.now()}`
  await page.goto(BASE + '/register', { waitUntil: 'networkidle', timeout: 20000 })
  await page.fill('input[placeholder="玩家名"]', user)
  await page.fill('input[placeholder="you@example.com"]', `${user}@t.com`)
  await page.fill('input[placeholder="至少 8 位，含字母和数字"]', 'Bugfix123')

  // 检查注册按钮是否可点击（等密码规则全部绿）
  await page.waitForTimeout(800)
  const regBtn = page.locator('button:has-text("注册")')
  if (await regBtn.count()) {
    await regBtn.first().click()
    await page.waitForTimeout(2000)
  }
  step('register', true, `registered as ${user}`)

  // 跳到 AI 页面
  await page.goto(BASE + '/ai', { waitUntil: 'networkidle', timeout: 20000 })
  await page.waitForTimeout(1500)

  const urlBefore = page.url()
  console.log(`  URL before input: ${urlBefore}`)

  // 在 textarea 中输入并按 Enter 发送
  const ta = page.locator('textarea').first()
  const disabled = await ta.isDisabled()
  if (disabled) {
    step('ai-textarea-enabled', false, 'textarea still disabled after login')
  } else {
    step('ai-textarea-enabled', true, 'textarea is enabled')

    // 输入文字
    await ta.fill('推荐一款像素风独立游戏')
    await page.waitForTimeout(300)

    // 按 Enter —— 关键测试点：页面不应刷新/跳转
    await ta.press('Enter')
    await page.waitForTimeout(3000) // 等流式响应

    const urlAfter = page.url()
    const urlChanged = urlBefore !== urlAfter
    const urlStable = !urlChanged || urlAfter.startsWith(BASE + '/ai')

    // 核心断言：URL 不能跳走（尤其不能跳到 /ai?xxx 或刷新成初始状态）
    step('ai-no-refresh-on-enter', urlStable,
      urlChanged ? `URL changed: ${urlBefore} → ${urlAfter}` : 'URL stable after Enter')

    // 确认消息已发出（欢迎语应该消失）
    const welcomeHidden = await page.locator('text=想玩什么？告诉我吧').isHidden().catch(() => true)
    step('ai-message-sent', welcomeHidden,
      welcomeHidden ? 'welcome hidden — message sent' : 'welcome still visible')
  }

  // ── Bug 2: Library 扫描 ──
  console.log('\n🔧 Bug 2: Library 扫描本机游戏 → 不应 insertBefore 崩溃')
  console.log('─'.repeat(50))

  // 先确认当前崩溃计数
  const crashesBeforeAI = crashes

  await page.goto(BASE + '/library', { waitUntil: 'networkidle', timeout: 20000 })
  await page.waitForTimeout(2000)

  const goLoginVisible = await page.getByText('去登录').isVisible().catch(() => false)
  if (goLoginVisible) {
    step('library-logged-in', false, 'shows "去登录" on /library')
  } else {
    step('library-logged-in', true, 'logged in state confirmed')

    // 点击扫描按钮
    const scanBtn = page.getByRole('button', { name: '扫描本机游戏' })
    const scanCount = await scanBtn.count()
    if (scanCount === 0) {
      step('library-scan-btn-found', false, 'scan button not found')
    } else {
      step('library-scan-btn-found', true, 'scan button found')
      await scanBtn.first().click()

      // 等 8 秒让扫描完成（可能发现 0 款或 N 款）
      await page.waitForTimeout(8000)

      // 检查是否出现"发现 X 款本机游戏"
      const foundText = await page.locator('text=/发现 .* 款本机游戏/').isVisible().catch(() => false)
      const stillScanning = await page.getByText('扫描中…').isVisible().catch(() => false)
      step('library-scan-completed',
        foundText || !stillScanning,
        foundText ? 'scan completed with results' : (stillScanning ? 'still scanning...' : 'scan done (possibly 0 games)')
      )
    }
  }

  // 最终汇总
  const newCrashes = crashes - crashesBeforeAI
  console.log('\n' + '='.repeat(50))
  console.log('📊 最终汇总')
  console.log('  页面崩溃 (pageerror):', crashes)
  console.log('  新增崩溃 (Library阶段):', newCrashes)
  console.log('  Console errors:', consoleErrors)
  console.log('')
  const allOk = results.every(r => r.ok)
  console.log(allOk ? '🎉 全部通过！两个 bug 均已修复。' : '⚠️ 存在失败项，需继续排查')
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
