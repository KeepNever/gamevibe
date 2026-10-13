import { Hono } from 'hono'
import { db } from '../db/index.ts'
import { authMiddleware } from '../middleware/auth.ts'

// 显式声明上下文变量：用 use('*', mw) 挂载时 Hono 不会把 mw 的 Variables 传播给后续 handler，
// 不声明的话 c.get('userId') 推导为 unknown，作为 SQL 参数会报类型错。
const stats = new Hono<{ Variables: { userId: string; username: string } }>()
stats.use('*', authMiddleware)

// 个人游戏数据看板聚合：用户库 / 最近浏览 / 我的评论，一次返回
stats.get('/', (c) => {
  const userId = c.get('userId')

  const libRows = db
    .prepare('SELECT id, user_id, external_id, name, cover_url, status, added_at, user_rating FROM user_library WHERE user_id=?')
    .all(userId) as any[]

  const wishlist = libRows.filter((r) => r.status === 'wishlist').length
  const playing = libRows.filter((r) => r.status === 'playing').length
  const completed = libRows.filter((r) => r.status === 'completed').length

  const recentRows = db
    .prepare('SELECT game_id, viewed_at FROM user_recent WHERE user_id=? ORDER BY viewed_at DESC')
    .all(userId) as any[]

  const reviewRows = db
    .prepare('SELECT id, game_id, rating, content, created_at FROM reviews WHERE user_id=? ORDER BY created_at DESC')
    .all(userId) as any[]

  const summary = {
    wishlist,
    playing,
    completed,
    favorites: wishlist, // favorites 与 wishlist 同表同 status
    reviews: reviewRows.length,
    recent: recentRows.length,
    totalLibrary: libRows.length,
  }

  const library = libRows.map((r) => ({
    id: r.id,
    external_id: r.external_id,
    name: r.name,
    cover_url: r.cover_url ?? null,
    status: r.status,
    added_at: r.added_at,
    user_rating: r.user_rating ?? null,
  }))

  const recent = recentRows.map((r) => ({ game_id: r.game_id, viewed_at: r.viewed_at }))
  const reviews = reviewRows.map((r) => ({
    id: r.id,
    game_id: r.game_id,
    rating: r.rating,
    content: r.content,
    created_at: r.created_at,
  }))

  return c.json({ summary, library, recent, reviews })
})

export default stats
