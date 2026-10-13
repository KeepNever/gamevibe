import { Hono } from 'hono'
// 精选库：本地 16 款完整数据（用于首页推荐 / 对比 / 年报深度体验）
import { games } from '../../src/data/games.ts'
import { searchGames, getPopularGames, getRawgGameDetail } from '../lib/rawg.ts'
import { getPlatformFeeds, PLATFORM_META } from '../lib/platformCatalog.ts'
import { getAchievementsByGameId } from '../lib/steamAchievements.ts'

const gamesRoute = new Hono()

// 精选库（保留原行为，供 Home / Compare / Wrapped 使用）
gamesRoute.get('/', (c) => c.json({ games, count: games.length }))

// 各平台官方榜单直连（Steam / PlayStation / Nintendo Switch / Xbox）
// 每个平台打各自的官方免密钥接口，互不牵连；某个平台挂了会在 feeds[].ok=false 里如实说明。
gamesRoute.get('/platforms', async (c) => {
  const feeds = await getPlatformFeeds()
  return c.json({
    feeds,
    meta: PLATFORM_META,
    updatedAt: new Date().toISOString(),
    note: '数据来自各平台官方接口（免密钥），服务端缓存 10 分钟；不可达的平台会标注具体原因。',
  })
})

// 全球成就数据（免密钥，来自 Steam 社区成就页）
// 约定与 /api/reviews/steam/:gameId 一致：始终 200，用 ok 标记是否真取到；
// ok=false 时带中文 reason（无 Steam 版 / 网络不通 / 该游戏没成就），前端如实展示。
gamesRoute.get('/achievements/:gameId', async (c) => {
  const gameId = c.req.param('gameId')
  try {
    return c.json(await getAchievementsByGameId(gameId))
  } catch (e) {
    return c.json(
      {
        ok: false,
        gameId,
        appid: '',
        reason: `成就数据获取失败：${(e as Error).message}`,
        total: 0,
        rated: 0,
        avgPercent: 0,
        ceilingPercent: 0,
        rareRatio: 0,
        difficulty: { key: 'unknown', label: '无法评估', note: '取数失败' },
        buckets: { '0-10': 0, '10-25': 0, '25-50': 0, '50-75': 0, '75-100': 0, unknown: 0 },
        rarest: [],
        items: [],
        truncated: false,
        fetchedAt: Date.now(),
        source: 'steamcommunity',
        note: '',
      },
      200,
    )
  }
})

// 多平台发现：真实 RAWG 数据，网络受限时降级本地多平台目录
// 查询参数：q(搜索) / platforms(逗号分隔展示名) / page / pageSize
gamesRoute.get('/discover', async (c) => {
  const q = c.req.query('q') || ''
  const platforms = (c.req.query('platforms') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const page = Math.max(1, Number(c.req.query('page') || '1'))
  const pageSize = Math.min(Math.max(1, Number(c.req.query('pageSize') || '24')), 40)
  try {
    const data = q
      ? await searchGames(q, page, pageSize, platforms)
      : await getPopularGames(page, pageSize, platforms)
    return c.json(data)
  } catch (e) {
    console.warn('[games] discover 失败:', (e as Error).message)
    return c.json({ games: [], count: 0, next: null })
  }
})

// 搜索联想（返回前 8 条轻量结果）
gamesRoute.get('/search', async (c) => {
  const q = c.req.query('q') || ''
  if (!q) return c.json({ games: [] })
  try {
    const { games: list } = await searchGames(q, 1, 8)
    return c.json({ games: list })
  } catch {
    return c.json({ games: [] })
  }
})

// 单游戏详情（供 GameDetail 兼容 RAWG 游戏）
gamesRoute.get('/rawg/:id', async (c) => {
  const id = c.req.param('id')
  try {
    const g = await getRawgGameDetail(id)
    if (!g) return c.json({ error: 'not found' }, 404)
    return c.json(g)
  } catch {
    return c.json({ error: 'not found' }, 404)
  }
})

export default gamesRoute
