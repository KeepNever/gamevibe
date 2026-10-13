import { Hono } from 'hono'
import { getAISpotlight, getAIReview } from '../lib/ai.ts'
import { getReviewDigest } from '../lib/reviewDigest.ts'
import { getAITrend } from '../lib/trend.ts'

// 公开 AI 接口（无需登录）：主页 AI 精选、详情页 AI 点评、详情页口碑归纳、主页今日趋势
const ai = new Hono()

ai.get('/spotlight', async (c) => {
  const data = await getAISpotlight()
  return c.json(data)
})

ai.get('/review', async (c) => {
  const id = c.req.query('id') || ''
  if (!id) return c.json({ error: '缺少 id' }, 400)
  const data = await getAIReview(id)
  if (!data) return c.json({ error: '未找到该游戏' }, 404)
  return c.json(data)
})

// 口碑归纳：共识 / 分歧（引用均为库内真实评论原文）
ai.get('/reviewDigest', async (c) => {
  const id = c.req.query('gameId') || c.req.query('id') || ''
  if (!id) return c.json({ error: '缺少 gameId' }, 400)
  const data = await getReviewDigest(id)
  if (!data) return c.json({ error: '未找到该游戏' }, 404)
  return c.json(data)
})

// 今日趋势：定性解读（不含数字）+ 实时快照（数字由本地注入）
ai.get('/trend', async (c) => {
  const data = await getAITrend()
  return c.json(data)
})

export default ai
