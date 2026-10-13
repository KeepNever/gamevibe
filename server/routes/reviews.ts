import { Hono } from 'hono'
import { randomBytes } from 'node:crypto'
import { db } from '../db/index.ts'
import { authMiddleware } from '../middleware/auth.ts'
import { getSteamReviewsByGameId } from '../lib/steamReviews.ts'

const reviews = new Hono()

// 读取单条评论并附带用户信息
function selectReviewRow(id: string) {
  return db
    .prepare(
      `SELECT r.id, r.user_id, r.game_id, r.rating, r.content, r.created_at,
              u.username, u.display_name, u.avatar
       FROM reviews r LEFT JOIN users u ON u.id = r.user_id
       WHERE r.id = ?`,
    )
    .get(id) as any
}

function selectGameReviews(gameId: string, limit: number, offset: number) {
  return db
    .prepare(
      `SELECT r.id, r.user_id, r.game_id, r.rating, r.content, r.created_at,
              u.username, u.display_name, u.avatar
       FROM reviews r LEFT JOIN users u ON u.id = r.user_id
       WHERE r.game_id = ?
       ORDER BY r.created_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(gameId, limit, offset) as any[]
}

function aggregateFor(gameId: string) {
  const row = db
    .prepare('SELECT COUNT(*) AS cnt, AVG(rating) AS avg FROM reviews WHERE game_id = ?')
    .get(gameId) as any
  return {
    count: row.cnt || 0,
    average: row.avg != null ? Number(Number(row.avg).toFixed(2)) : 0,
  }
}

// ── 公开：全站评论聚合（供卡片真实平均分） ──────────────
reviews.get('/aggregate', (c) => {
  const rows = db
    .prepare('SELECT game_id, COUNT(*) AS cnt, AVG(rating) AS avg FROM reviews GROUP BY game_id')
    .all() as any[]
  const map: Record<string, { avg: number; count: number }> = {}
  for (const r of rows) {
    map[r.game_id] = { count: r.cnt, avg: Number(Number(r.avg).toFixed(2)) }
  }
  return c.json(map)
})

// ── 公开：按用户查询其全部评论（看板/社交用） ───────────
reviews.get('/user/:userId', authMiddleware, (c) => {
  const userId = c.req.param('userId')
  const rows = db
    .prepare(
      `SELECT r.id, r.user_id, r.game_id, r.rating, r.content, r.created_at,
              u.username, u.display_name, u.avatar
       FROM reviews r LEFT JOIN users u ON u.id = r.user_id
       WHERE r.user_id = ?
       ORDER BY r.created_at DESC`,
    )
    .all(userId) as any[]
  return c.json({ reviews: rows })
})

// ── 公开：单个游戏的评论列表 + 平均分（分页） ──────────
reviews.get('/:gameId', (c) => {
  const gameId = c.req.param('gameId')
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1)
  const pageSize = Math.min(50, Math.max(1, parseInt(c.req.query('pageSize') || '20', 10) || 20))
  const rows = selectGameReviews(gameId, pageSize, (page - 1) * pageSize)
  const agg = aggregateFor(gameId)
  return c.json({ reviews: rows, average: agg.average, count: agg.count })
})

// ── 鉴权：提交评论（同用户同游戏 upsert） ──────────────
reviews.post('/', authMiddleware, async (c) => {
  const userId = c.get('userId')
  let body: any
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: '请求体格式错误' }, 400)
  }
  const { gameId, rating, content } = body
  if (!gameId) return c.json({ error: '缺少 gameId' }, 400)

  const ratingNum = rating == null ? null : Number(rating)
  if (ratingNum != null && (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5)) {
    return c.json({ error: '评分需在 1-5 之间' }, 400)
  }

  const existing = db
    .prepare('SELECT id FROM reviews WHERE user_id=? AND game_id=?')
    .get(userId, gameId) as any

  if (existing) {
    db.prepare('UPDATE reviews SET rating=?, content=?, created_at=? WHERE id=?').run(
      ratingNum,
      content ?? null,
      Date.now(),
      existing.id,
    )
    return c.json({ ok: true, id: existing.id, upserted: true, review: selectReviewRow(existing.id) })
  }

  const id = randomBytes(12).toString('hex')
  db.prepare(
    'INSERT INTO reviews (id,user_id,game_id,rating,content,created_at) VALUES (?,?,?,?,?,?)',
  ).run(id, userId, gameId, ratingNum, content ?? null, Date.now())
  return c.json({ ok: true, id, upserted: false, review: selectReviewRow(id) }, 201)
})

// ── 鉴权：编辑自己的评论 ──────────────────────────────
reviews.put('/:id', authMiddleware, async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  const row = db.prepare('SELECT user_id FROM reviews WHERE id=?').get(id) as any
  if (!row) return c.json({ error: '评论不存在' }, 404)
  if (row.user_id !== userId) return c.json({ error: '只能修改自己的评论' }, 403)

  let body: any
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: '请求体格式错误' }, 400)
  }
  const { rating, content } = body
  const ratingNum = rating == null ? null : Number(rating)
  if (ratingNum != null && (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5)) {
    return c.json({ error: '评分需在 1-5 之间' }, 400)
  }
  db.prepare('UPDATE reviews SET rating=?, content=? WHERE id=?').run(ratingNum, content ?? null, id)
  return c.json({ ok: true, review: selectReviewRow(id) })
})

// ── 鉴权：删除自己的评论 ──────────────────────────────
reviews.delete('/:id', authMiddleware, (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  const row = db.prepare('SELECT user_id FROM reviews WHERE id=?').get(id) as any
  if (!row) return c.json({ error: '评论不存在' }, 404)
  if (row.user_id !== userId) return c.json({ error: '只能删除自己的评论' }, 403)
  db.prepare('DELETE FROM reviews WHERE id=?').run(id)
  return c.json({ ok: true })
})

// ── Steam 评测数据（公开，供 GameDetail 展示）─────────
// 约定：始终返回 200 + available 标记。
//   available=false 时带 reason（中文），summary 全 0、reviews 为空 —— 前端据此如实提示，
//   不再像以前那样返回一份编造的「模拟数据」。
reviews.get('/steam/:gameId', async (c) => {
  const gameId = c.req.param('gameId')
  try {
    const data = await getSteamReviewsByGameId(gameId)
    return c.json(data)
  } catch (e) {
    return c.json(
      {
        gameId,
        steamAppId: '',
        available: false,
        reason: `Steam 评测获取失败：${(e as Error).message}`,
        summary: { totalPositive: 0, totalReviews: 0, reviewScore: 0, totalNegative: 0 },
        reviews: [],
        source: 'unavailable',
        fetchedAt: Date.now(),
      },
      200,
    )
  }
})

export default reviews
