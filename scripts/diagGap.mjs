// 诊断：高视口一次展开整页，标出各 AI 模块位置 + 首屏分界线
import { chromium } from 'playwright'

const BASE = process.argv[2] || 'https://gamevibe.app.workbuddy.host'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 5600 } })
await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 })
await page.waitForTimeout(4000)

const tops = await page.evaluate(() => {
  const res = {}
  const mark = (kw, color, label) => {
    const h = Array.from(document.querySelectorAll('h1,h2,h3')).find((el) => (el.innerText || '').includes(kw))
    if (!h) return null
    const sec = h.closest('section') || h.parentElement
    sec.style.outline = `4px solid ${color}`
    sec.style.outlineOffset = '6px'
    sec.style.borderRadius = '14px'
    if (getComputedStyle(sec).position === 'static') sec.style.position = 'relative'
    const tag = document.createElement('div')
    tag.textContent = label
    tag.style.cssText = `position:absolute;top:-14px;left:14px;z-index:9999;background:${color};color:#fff;font:700 15px sans-serif;padding:4px 12px;border-radius:8px;box-shadow:0 3px 10px rgba(0,0,0,.35)`
    sec.prepend(tag)
    return Math.round(sec.getBoundingClientRect().top)
  }
  res.hotRecommend = mark('精选推荐', '#f59e0b', '① 推荐位（匿名=精选推荐，需登录才变"为你推荐"+匹配度）')
  res.aiSpotlight = mark('AI 精选', '#8b5cf6', '② AI 精选')
  res.aiTrend = mark('AI 今日趋势', '#10b981', '③ AI 今日趋势 + 实时热度榜')
  // 首屏分界线
  const line = document.createElement('div')
  line.style.cssText = 'position:fixed;top:900px;left:0;right:0;height:0;border-top:3px dashed #ef4444;z-index:99999'
  const tip = document.createElement('div')
  tip.textContent = '↑ 你打开页面时能看到的第一屏（900px）到此为止'
  tip.style.cssText = 'position:fixed;top:906px;left:16px;background:#ef4444;color:#fff;font:700 14px sans-serif;padding:4px 10px;border-radius:6px;z-index:99999'
  document.body.append(line, tip)
  return res
})

console.log(JSON.stringify(tops, null, 2))
await page.screenshot({ path: 'docs/diag/anon-annotated.png' })
await browser.close()
process.exit(0)
