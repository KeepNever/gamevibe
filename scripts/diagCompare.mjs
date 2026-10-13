// 对比诊断：匿名态 vs 登录态首页，证明 AI 痕迹的可见性差异
import { chromium } from 'playwright'

const BASE = process.argv[2] || 'https://gamevibe.app.workbuddy.host'

async function loginToken() {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: '糖糖不吃糖@seed.local', password: 'seedpass1234' }),
  })
  if (!r.ok) throw new Error('login ' + r.status + ' ' + (await r.text().catch(() => '')))
  return (await r.json()).token
}

const scan = (text) => ({
  为你推荐: text.includes('为你推荐'),
  登录后解锁提示: text.includes('登录后解锁'),
  匹配度: /匹配\s*\d+%/.test(text),
  命中维度chips: /剧情向|高难度|开放世界/.test(text),
  AI精选: text.includes('AI 精选'),
  AI今日趋势: text.includes('AI 今日趋势'),
})

const browser = await chromium.launch({ headless: true })
const out = []

// ── A: 匿名态 ──
const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const pA = await ctxA.newPage()
await pA.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 })
await pA.waitForTimeout(3000)
await pA.screenshot({ path: 'docs/diag/anon-firstscreen.png' })
const aText = await pA.evaluate(() => document.body.innerText)
out.push('【匿名态 首屏(900px)】' + JSON.stringify(scan(aText)))
await ctxA.close()

// ── B: 登录态 ──
const token = await loginToken()
const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await ctxB.addInitScript((t) => localStorage.setItem('gv_token', t), token)
const pB = await ctxB.newPage()
await pB.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 })
await pB.waitForTimeout(4000)
const bText = await pB.evaluate(() => document.body.innerText)
out.push('【登录态 全页文本】' + JSON.stringify(scan(bText)))

const sec = pB.locator('section', { hasText: '为你推荐' }).first()
try {
  await sec.scrollIntoViewIfNeeded()
  await pB.waitForTimeout(900)
  await sec.screenshot({ path: 'docs/diag/login-foryou.png' })
  out.push('【登录态 推荐区截图】ok')
} catch (e) {
  out.push('【登录态 推荐区截图】fail ' + e.message)
}
await ctxB.close()
await browser.close()

console.log(out.join('\n'))
process.exit(0)
