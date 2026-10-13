// 验证：匿名/登录态首页首屏（900px）内是否能看到 AI 模块
import { chromium } from 'playwright'

const BASE = process.argv[2] || 'http://localhost:5173'
const isLocal = BASE.includes('localhost')
const OUT_DIR = isLocal ? 'docs/diag' : 'docs/deploy-screenshots'
const ANON_SHOT = `${OUT_DIR}/${isLocal ? 'anon-firstscreen-v2' : 'prod-firstscreen'}.png`
const LOGIN_SHOT = `${OUT_DIR}/${isLocal ? 'login-firstscreen-v2' : 'prod-firstscreen-login'}.png`

const scan = async (page) =>
  page.evaluate(() => {
    const heads = Array.from(document.querySelectorAll('h2'))
      .map((el) => ({ t: (el.innerText || '').trim().slice(0, 24), top: Math.round(el.getBoundingClientRect().top) }))
      .filter((x) => x.t)
    const vh = window.innerHeight
    const text = document.body.innerText || ''
    const aiHead = heads.find((h) => h.t.includes('AI 精选'))
    return {
      vh,
      firstScreenSections: heads.filter((h) => h.top < vh).map((h) => `${h.top}px ${h.t}`),
      aiSpotlightTop: aiHead ? aiHead.top : null,
      aiSpotlightVisible: aiHead ? aiHead.top < vh : false,
      hasAiSpotlightText: text.includes('AI 精选'),
      recTitleAI: text.includes('🤖 AI 推荐'),
      recTitleForYou: text.includes('🎯 为你推荐'),
      noLoginWall: !text.includes('登录后解锁个性化推荐'),
      sampleReasonInFirstScreen: false,
      allHeads: heads.map((h) => `${h.top}px ${h.t}`),
    }
  })

// 本机环境存在 HTTPS_PROXY（失效代理），Chromium 会走它导致超时 → 清掉并强制直连
delete process.env.HTTPS_PROXY
delete process.env.HTTP_PROXY
delete process.env.ALL_PROXY
const browser = await chromium.launch({ headless: true, args: ['--no-proxy-server'] })
const out = []

// A 匿名态
const p1 = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await p1.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 })
await p1.waitForSelector('h1', { timeout: 20000 }).catch(() => {})
await p1.waitForTimeout(9000)
const a = await scan(p1)
out.push('【匿名态】' + JSON.stringify(a, null, 2))
await p1.screenshot({ path: ANON_SHOT })
await p1.close()

// B 登录态
const r = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: '糖糖不吃糖@seed.local', password: 'seedpass1234' }),
})
const token = r.ok ? (await r.json()).token : null
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
if (token) await ctx.addInitScript((t) => localStorage.setItem('gv_token', t), token)
const p2 = await ctx.newPage()
await p2.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 })
await p2.waitForSelector('h1', { timeout: 20000 }).catch(() => {})
await p2.waitForTimeout(10000)
const b = await scan(p2)
out.push('【登录态】' + JSON.stringify(b, null, 2))
await p2.screenshot({ path: LOGIN_SHOT })
await ctx.close()

await browser.close()
console.log(out.join('\n'))
process.exit(0)
