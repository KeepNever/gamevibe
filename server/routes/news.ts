import { Hono } from 'hono'
import {
  getRecentReleases,
  getUpcoming,
  getSteamNews,
  getAggregatedNews,
} from '../lib/gameNews.ts'

const news = new Hono()

/**
 * GET /api/news
 *
 * 综合聚合：一次性返回所有来源的新游戏信息（推荐前端使用）
 */
news.get('/', async (c) => {
  const data = await getAggregatedNews()
  return c.json({
    ok: true,
    ...data,
    fetchedAt: Date.now(),
    cacheTTL: '10min',
  })
})

/**
 * GET /api/news/releases?page=1&pageSize=20
 *
 * 最新发售的游戏（RAWG.io）
 */
news.get('/releases', async (c) => {
  const page = Number(c.req.query('page') || '1')
  const pageSize = Math.min(Number(c.req.query('pageSize') || '20'), 50)
  const data = await getRecentReleases(page, pageSize)
  return c.json({ ok: true, ...data })
})

/**
 * GET /api/news/upcoming?page=1&pageSize=20
 *
 * 即将发售的游戏（RAWG.io）
 */
news.get('/upcoming', async (c) => {
  const page = Number(c.req.query('page') || '1')
  const pageSize = Math.min(Number(c.req.query('pageSize') || '20'), 50)
  const data = await getUpcoming(page, pageSize)
  return c.json({ ok: true, ...data })
})

/**
 * GET /api/news/steam
 *
 * Steam 商店特价 + 即将发售
 */
news.get('/steam', async (c) => {
  const items = await getSteamNews()
  return c.json({ ok: true, items, count: items.length })
})

export default news
