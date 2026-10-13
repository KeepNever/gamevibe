// C2 前端渲染验证：用真实浏览器加载首页 / AI 助手页，抓运行期报错并截图
// 用法：node --experimental-strip-types --env-file=.env --no-warnings scripts/verifyC2UI.ts
//
// 前置：后端 8792、前端 5173 均在运行
// 断言：首页出现「匹配 N%」、AI 页出现口味画像面板与四维、chat 出现「已按…筛选」标签、无运行期报错
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { db } from '../server/db/index.ts'

const API = process.env.C2_API || 'http://localhost:8792'
const WEB = process.env.C2_WEB || 'http://localhost:5173'
const OUT = process.env.C2_SHOT_DIR || 'D:/GameVibe/gamevibe/docs/c2-screenshots'

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true })

  // 1) 造临时账号 + 两条互动，保证 /api/recommendations 走画像引擎（前端才有匹配度可展示）
  const uname = 'c2' + Date.now().toString().slice(-6)
  const reg: any = await fetch(`${API}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: uname, email: `${uname}@c2.local`, password: 'c2Pass12345' }),
  }).then((r) => r.json() as any)
  if (!reg?.token) throw new Error('注册失败：' + JSON.stringify(reg).slice(0, 120))

  const now = Date.now()
  const ins = db.prepare(
    'INSERT INTO user_library (id,user_id,source,external_id,name,status,added_at) VALUES (?,?,?,?,?,?,?)',
  )
  ins.run('c2-lib-1', reg.user.id, 'manual', 'baldurs-gate-3', '博德之门3', 'completed', now)
  ins.run('c2-lib-2', reg.user.id, 'manual', 'disco-elysium', '极乐迪斯科', 'playing', now)

  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript((t) => {
    localStorage.setItem('gv_token', t)
  }, reg.token as string)
  const page = await ctx.newPage()

  const errors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push('[console] ' + m.text())
  })
  page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message))

  // 2) 首页：为你推荐 + 匹配度 + 命中维度
  await page.goto(`${WEB}/`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  const homeText = await page.locator('body').innerText()
  const hasMatch = /匹配\s*\d+\s*%/.test(homeText)
  const hasForYou = homeText.includes('为你推荐')
  await page.screenshot({ path: `${OUT}/home.png` })
  // 滚到「为你推荐」区，单独确认匹配度与维度标签的排版（滚动容器在 Layout 内部，用滚轮更可靠）
  await page.mouse.move(620, 500)
  await page.mouse.wheel(0, 760)
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${OUT}/home-foryou.png` })

  // 3) AI 助手页：右侧口味画像面板
  await page.goto(`${WEB}/ai`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
  const aiText = await page.locator('body').innerText()
  const hasPanel = aiText.includes('你的口味画像')
  const hasDims = aiText.includes('剧情') && aiText.includes('难度') && aiText.includes('探索')
  await page.screenshot({ path: `${OUT}/ai-profile.png` })

  // 4) 发一条带硬约束的提问，验证「已按…筛选」标签渲染
  await page.fill('textarea', '预算50元以内有什么好玩的')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(8000)
  const chatText = await page.locator('body').innerText()
  const hasFilter = chatText.includes('已按')
  await page.screenshot({ path: `${OUT}/ai-chat.png` })

  await browser.close()

  // 5) 清理临时账号
  db.prepare('DELETE FROM chat_messages WHERE user_id=?').run(reg.user.id)
  db.prepare('DELETE FROM user_library WHERE user_id=?').run(reg.user.id)
  db.prepare('DELETE FROM users WHERE id=?').run(reg.user.id)

  const lines = [
    `首页进入「为你推荐」：${hasForYou ? '✅' : '❌'}`,
    `首页出现「匹配 N%」：${hasMatch ? '✅' : '❌'}`,
    `AI 页出现口味画像面板：${hasPanel ? '✅' : '❌'}`,
    `面板展示四维名称：${hasDims ? '✅' : '❌'}`,
    `chat 出现「已按…筛选」标签：${hasFilter ? '✅' : '❌'}`,
    `运行期报错数量：${errors.length}`,
    ...errors.slice(0, 15),
    `截图目录：${OUT}`,
  ]
  console.log(lines.join('\n'))
  if (!hasForYou || !hasMatch || !hasPanel || !hasDims || !hasFilter || errors.length) process.exit(1)
}

main().catch((e) => {
  console.error('验证异常：', e)
  process.exit(1)
})
