// 最终验证：AI 不再幻觉 + Library 零 insertBefore
const { chromium } = require('playwright')
const BASE = 'http://localhost:5179'

const errors = []
const results = []

function log(label, ok, detail) {
  const icon = ok ? '✅' : '❌'
  console.log(`  ${icon} ${label}: ${detail}`)
  results.push({ label, ok, detail })
  if (!ok) errors.push(label)
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

;(async () => {
  console.log('🧪 GameVibe 最终验证\n')

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()

  // 挂载错误监听
  page.on('pageerror', e => errors.push(`PAGE_ERROR: ${e.message.substring(0, 100)}`))
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const t = msg.text().substring(0, 120)
      // 过滤掉 Chrome 自身的 Intervention 警告
      if (!t.includes('[Intervention]')) {
        errors.push(`CON_ERR: ${t}`)
      }
    }
  })

  // ── 阶段 1: 注册登录 ──
  console.log('── 阶段 1: 注册登录 ──')
  await page.goto(BASE + '/register', { waitUntil: 'networkidle', timeout: 20000 })
  await sleep(800)

  const ts = Date.now()
  const nameInput = page.locator('input[placeholder*="玩家名"], input[placeholder*="用户"]').first()
  const emailInput = page.locator('input[type="email"], input[placeholder*="@"]').first()
  const pwdInput = page.locator('input[type="password"]')
  
  await nameInput.fill(`verify_${ts}`)
  await emailInput.fill(`verify_${ts}@t.com`)
  await pwdInput.fill('Verify1234')
  await page.locator('button[type="submit"]').click()
  await sleep(2500)
  const onLogin = page.url()
  log('注册+跳转', !onLogin.includes('/register'), `当前页: ${onLogin}`)

  // ── 阶段 2: AI 聊天 — 发送"你好"，验证不再返回游戏推荐 ──
  console.log('\n── 阶段 2: AI 对话验证(核心) ──')
  await page.goto(BASE + '/ai', { waitUntil: 'networkidle', timeout: 20000 })
  await sleep(1200)

  const ta = page.locator('textarea').first()
  const disabled = await ta.isDisabled()
  log('输入框可用', !disabled, disabled ? '被禁用(未登录?)' : '✓ 可输入')

  if (!disabled) {
    await ta.fill('你好')
    await ta.press('Enter')
    console.log('  ⏳ 等待 AI 回复（最多 15s）...')

    let replyReceived = false
    let hasGreeting = false
    let hasGameRec = false
    let fullText = ''

    for (let i = 0; i < 15; i++) {
      await sleep(1000)
      // 检查是否出现回复气泡（欢迎语消失说明有回复）
      const welcomeHidden = await page.locator('text=想玩什么？告诉我吧').isHidden().catch(() => true)
      if (welcomeHidden) {
        replyReceived = true
        // 提取 AI 回复文本
        try {
          fullText = await page.evaluate(() => {
            // 找到最后一个助手消息气泡
            const bubbles = document.querySelectorAll('.rounded-2xl.px-4.py-3')
            if (bubbles.length > 1) return bubbles[bubbles.length - 1]?.textContent || ''
            return ''
          })
        } catch {}
        break
      }
    }

    hasGreeting = /你好.*我是|我是.*顾问|随时为你|告诉.*类型|说得更具体|游戏顾问/.test(fullText)
    hasGameRec = /(军需物资|硝云之门|空间骑士|霓奥库布|这是为你精选|以下是我为你筛选)/.test(fullText)

    log('AI 回复到达', replyReceived, replyReceived ? `耗时 ~${Date.now() - ts}ms` : '超时无回复')
    log('AI 返回问候/引导', hasGreeting,
      hasGreeting ? `✓ 内容: "${fullText.substring(0, 80)}..."` : `内容: "${fullText.substring(0, 80)}..."`)
    log('AI 无幻觉(不硬推游戏)', !hasGameRec,
      hasGameRec ? '⚠️ 仍包含固定推荐' : '✓ 不再硬推游戏')
    log('页面未刷新', page.url().includes('/ai'), `URL: ${page.url()}`)
  }

  // ── 阶段 3: Library 扫描 ──
  console.log('\n── 阶段 3: Library 扫描验证 ──')
  await page.goto(BASE + '/library', { waitUntil: 'networkidle', timeout: 20000 })
  await sleep(1500)

  // 先确认登录态
  const goLoginVisible = await page.getByText('去登录').isVisible().catch(() => false)
  log('Library 登录态', !goLoginVisible, goLoginVisible ? '显示"去登录"' : '已登录')

  if (!goLoginVisible) {
    const scanBtn = page.locator('button:has-text("扫描本机游戏")')
    const scanCount = await scanBtn.count()

    if (scanCount > 0) {
      await scanBtn.first().click()
      console.log('  ⏳ 等待扫描结果（最多 8s）...')
      await sleep(8000)

      const foundText = await page.locator('text=/发现 .* 款/').isVisible().catch(() => false)
      const gameItems = await page.locator('[data-game-id]').count()
      const libCardCount = await page.locator('.lib-item, .scanned-game, [class*=game-card]').count()

      log('扫描按钮可点击', true, '✓')
      log('扫描完成', foundText || gameItems > 0 || libCardCount > 0,
        foundText ? '显示发现数' : gameItems ? `${gameItems} 个游戏项` : libCardCount ? `${libCardCount} 个卡片` : '可能为空(无Steam)')
    } else {
      log('扫描按钮存在', false, '未找到"扫描本机游戏"按钮')
    }
  } else {
    log('Library 测试', false, '跳过：未登录状态')
  }

  // ── 结果汇总 ──
  await browser.close()

  console.log('\n═══ 结果汇总 ═══')
  const passed = results.filter(r => r.ok).length
  const failed = results.filter(r => !r.ok).length
  console.log(`通过: ${passed}/${results.length}  失败: ${failed}`)

  if (errors.length > 0) {
    console.log('\n⚠️ 收集到的错误:')
    errors.forEach((e, i) => console.log(`  ${i + 1}. ${e}`))
    
    // 特别检查崩溃签名
    const crashSignatures = errors.filter(e =>
      /insertBefore|removeChild|Failed to resolve component|Layout\.vue123/.test(e)
    )
    if (crashSignatures.length > 0) {
      console.log('\n❌❌❌ 崩溃签名仍存在!')
      crashSignatures.forEach(e => console.log(`  💀 ${e}`))
    } else {
      console.log('\n✅ 零崩溃签名（insertBefore/removeChild/Layout.vue123）')
    }
  } else {
    console.log('\n🎉 零错误! 完美通过!')
  }

  process.exit(failed > 0 ? 1 : 0)
})().catch(e => {
  console.error('FATAL:', e.message)
  process.exit(2)
})
