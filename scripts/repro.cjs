const { chromium } = require('playwright')

const BASE = 'http://localhost:5173'

async function repro() {
  const errors = []
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })

  // 捕获所有 console 错误
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text()
      // 只关注这两类错误
      if (
        text.includes('insertBefore') ||
        text.includes('Cannot use a ref') ||
        text.includes('container') ||
        text.includes('NotFoundError') ||
        text.includes('React DOM')
      ) {
        errors.push(`[CONSOLE ERROR] ${text}`)
      }
    }
  })
  // 捕获页面异常
  page.on('pageerror', (err) => {
    const msg = err.message
    if (
      msg.includes('insertBefore') ||
      msg.includes('Cannot use a ref') ||
      msg.includes('container')
    ) {
      errors.push(`[PAGE ERROR] ${msg.slice(0, 300)}`)
    }
  })

  let step = 0
  function log(msg) { step++; console.log(`${step}. ${msg}`) }

  try {
    log('打开首页')
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1000)

    log('跳转到登录页')
    await page.goto(BASE + '/login', { waitUntil: 'networkidle' })
    await page.waitForTimeout(800)

    log('填写注册表单并提交')
    await page.fill('input[type="email"]', 'repro@example.com')
    await page.fill('input[type="password"]', 'ReproPass1')
    // username field might exist
    const userInputs = await page.locator('input[placeholder*="用户名"], input[name="username"], input[id*="user"]').count()
    if (userInputs > 0) {
      await page.fill('input[placeholder*="用户名"], input[name="username"], input[id*="user"]', 'reprotest')
    }
    await page.click('button[type="submit"]')
    await page.waitForTimeout(2000)

    log('登录（用已有账号）')
    await page.goto(BASE + '/login', { waitUntil: 'networkidle' })
    await page.waitForTimeout(500)
    await page.fill('input[type="email"]', 't@example.com')
    await page.fill('input[type="password"]', 'secret123')
    await page.click('button[type="submit"]')
    await page.waitForTimeout(3000)

    log('点击侧边栏导航：探索')
    try {
      await page.click('a[href="/explore"]')
      await page.waitForTimeout(1500)
    } catch(e) { log('  (探索链接未找到，跳过)') }

    log('点击侧边栏导航：AI助手')
    try {
      await page.click('a[href="/ai"]')
      await page.waitForTimeout(1500)
    } catch(e) { log('  (AI链接未找到，跳过)') }

    log('在 AI 助手发消息')
    try {
      const textarea = page.locator('textarea')
      if (await textarea.count() > 0) {
        await textarea.fill('推荐一款像素风游戏')
        await page.keyboard.press('Enter')
        await page.waitForTimeout(4000)
        // 再发一条
        await textarea.fill('有什么高难度动作游戏吗')
        await page.keyboard.press('Enter')
        await page.waitForTimeout(3000)
      } else {
        log('  (未找到 textarea)')
      }
    } catch(e) { log(`  (AI 发消息失败: ${e.message.slice(0,80)})`) }

    log('点击年报页（Wrapped — 有 SafeSwitch 切换动画）')
    try {
      await page.click('a[href="/wrapped"]')
      await page.waitForTimeout(1500)
    } catch(e) { log('  (年报链接未找到)') }

    log('点击排行榜（Charts — 有 tab 切换）')
    try {
      await page.click('a[href="/charts"]')
      await page.waitForTimeout(1500)
    } catch(e) { log('  (排行榜链接未找到)') }

    log('回到首页')
    try {
      await page.click('a[href="/"]')
      await page.waitForTimeout(1500)
    } catch(e) {}

    log('快速连续切换页面（压力测试）')
    for (const path of ['/ai', '/favorites', '/explore', '/library', '/ai', '/']) {
      try {
        await page.goto(BASE + path, { waitUntil: 'networkidle' })
        await page.waitForTimeout(600)
      } catch(e) {}
    }

    await page.waitForTimeout(2000)

  } finally {
    await browser.close()
  }

  console.log('\n========== 结果 ==========')
  if (errors.length === 0) {
    console.log('✅ 零报错！所有操作均无 insertBefore / Cannot use a ref 错误')
  } else {
    console.log(`❌ 发现 ${errors.length} 个错误:`)
    errors.forEach((e, i) => console.log(`\n${i+1}. ${e}`))
  }

  return errors.length
}

repro().then((n) => process.exit(n > 0 ? 1 : 0)).catch((e) => { console.error(e); process.exit(2) })
