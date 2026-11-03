import { Hono } from 'hono'
import { randomBytes } from 'node:crypto'
import { db } from '../db/index.ts'
import { authMiddleware } from '../middleware/auth.ts'
import { hasPermission } from '../lib/rbac.ts'
import { writeAudit } from '../lib/audit.ts'
import { getSteamReviewsByGameId } from '../lib/steamReviews.ts'

const reviews = new Hono()

// 读取单条评论并附带用户信息
async function selectReviewRow(id: string) {
  return await db
    .prepare(
      `SELECT r.id, r.user_id, r.game_id, r.rating, r.content, r.created_at,
              u.username, u.display_name, u.avatar
       FROM reviews r LEFT JOIN users u ON u.id = r.user_id
       WHERE r.id = ?`,
    )
    .get(id) as any
}

async function selectGameReviews(gameId: string, limit: number, offset: number) {
  return await db
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

async function aggregateFor(gameId: string) {
  const row = await db
    .prepare('SELECT COUNT(*) AS cnt, AVG(rating) AS avg FROM reviews WHERE game_id = ?')
    .get(gameId) as any
  return {
    count: row.cnt || 0,
    average: row.avg != null ? Number(Number(row.avg).toFixed(2)) : 0,
  }
}

// ── 公开：全站评论聚合（供卡片真实平均分） ──────────────
reviews.get('/aggregate', async (c) => {
  const rows = await db
    .prepare('SELECT game_id, COUNT(*) AS cnt, AVG(rating) AS avg FROM reviews GROUP BY game_id')
    .all() as any[]
  const map: Record<string, { avg: number; count: number }> = {}
  for (const r of rows) {
    map[r.game_id] = { count: r.cnt, avg: Number(Number(r.avg).toFixed(2)) }
  }
  return c.json(map)
})

// ── 公开：按用户查询其全部评论（看板/社交用） ───────────
reviews.get('/user/:userId', authMiddleware, async (c) => {
  const userId = c.req.param('userId')
  const rows = await db
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
reviews.get('/:gameId', async (c) => {
  const gameId = c.req.param('gameId')
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10) || 1)
  const pageSize = Math.min(50, Math.max(1, parseInt(c.req.query('pageSize') || '20', 10) || 20))
  const [rows, agg] = await Promise.all([
    selectGameReviews(gameId, pageSize, (page - 1) * pageSize),
    aggregateFor(gameId),
  ])
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

  const existing = await db
    .prepare('SELECT id FROM reviews WHERE user_id=? AND game_id=?')
    .get(userId, gameId) as any

  if (existing) {
    await db.prepare('UPDATE reviews SET rating=?, content=?, created_at=? WHERE id=?').run(
      ratingNum,
      content ?? null,
      Date.now(),
      existing.id,
    )
    return c.json({ ok: true, id: existing.id, upserted: true, review: await selectReviewRow(existing.id) })
  }

  const id = randomBytes(12).toString('hex')
  await db.prepare(
    'INSERT INTO reviews (id,user_id,game_id,rating,content,created_at) VALUES (?,?,?,?,?,?)',
  ).run(id, userId, gameId, ratingNum, content ?? null, Date.now())

  // 通知粉丝：你关注的人发布了新评测（上限 50，防刷屏）
  try {
    const followers = await db
      .prepare('SELECT follower_id FROM follows WHERE following_id = ? LIMIT 50')
      .all(userId) as any[]
    const now = Date.now()
    await Promise.all(
      followers.map((f) =>
        db
          .prepare(
            `INSERT OR IGNORE INTO notifications (id, user_id, actor_id, type, ref_id, read, created_at)
             VALUES (?, ?, ?, 'follow_review', ?, 0, ?)`,
          )
          .run(randomBytes(12).toString('hex'), f.follower_id, userId, gameId, now),
      ),
    )
  } catch {
    /* 通知失败不影响发评论 */
  }

  return c.json({ ok: true, id, upserted: false, review: await selectReviewRow(id) }, 201)
})

// ── 鉴权：编辑自己的评论 ──────────────────────────────
reviews.put('/:id', authMiddleware, async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  const row = await db.prepare('SELECT user_id FROM reviews WHERE id=?').get(id) as any
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
  await db.prepare('UPDATE reviews SET rating=?, content=? WHERE id=?').run(ratingNum, content ?? null, id)
  return c.json({ ok: true, review: await selectReviewRow(id) })
})

// ── 鉴权：删除评论（作者本人，或持 review.moderate 的版主）──
reviews.delete('/:id', authMiddleware, async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  const row = await db.prepare('SELECT user_id, game_id FROM reviews WHERE id=?').get(id) as any
  if (!row) return c.json({ error: '评论不存在' }, 404)

  const isModerator = row.user_id !== userId && (await hasPermission(userId, 'review.moderate'))
  if (row.user_id !== userId && !isModerator) {
    return c.json({ error: '只能删除自己的评论' }, 403)
  }

  await db.prepare('DELETE FROM reviews WHERE id=?').run(id)
  await db.prepare('DELETE FROM review_reports WHERE review_id=?').run(id)

  // 版主代删要留痕，并通知作者（自己删不通知自己）
  if (isModerator) {
    try {
      await db
        .prepare(
          `INSERT OR IGNORE INTO notifications (id, user_id, actor_id, type, ref_id, read, created_at)
           VALUES (?, ?, ?, 'review_moderated', ?, 0, ?)`,
        )
        .run(randomBytes(12).toString('hex'), row.user_id, userId, row.game_id, Date.now())
    } catch {
      /* 通知失败不影响删除 */
    }
  }

  await writeAudit(db, c, {
    actorId: userId,
    action: isModerator ? 'review.moderate' : 'review.delete',
    targetType: 'review',
    targetId: id,
    detail: { changes: [{ field: '评论', from: row.game_id, to: isModerator ? '版主删除' : '作者自删' }] },
  })

  return c.json({ ok: true, moderated: isModerator })
})

// ── 鉴权：举报评论（每人对同一条评论只能举报一次）──────
reviews.post('/:id/report', authMiddleware, async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  const row = await db.prepare('SELECT id, user_id FROM reviews WHERE id=?').get(id) as any
  if (!row) return c.json({ error: '评论不存在' }, 404)
  if (row.user_id === userId) return c.json({ error: '不能举报自己的评论' }, 400)

  let body: any = {}
  try {
    body = await c.req.json()
  } catch {
    /* 无 body 也允许，理由可空 */
  }
  const reason = String(body?.reason ?? '').trim().slice(0, 200) || null

  const dup = await db
    .prepare('SELECT 1 FROM review_reports WHERE review_id=? AND reporter_id=?')
    .get(id, userId)
  if (dup) return c.json({ error: '你已举报过这条评论' }, 409)

  const rid = randomBytes(12).toString('hex')
  await db
    .prepare('INSERT INTO review_reports (id, review_id, reporter_id, reason, created_at) VALUES (?,?,?,?,?)')
    .run(rid, id, userId, reason, Date.now())

  await writeAudit(db, c, {
    actorId: userId,
    action: 'review.report',
    targetType: 'review',
    targetId: id,
    detail: { changes: [{ field: '举报理由', from: null, to: reason ?? '(未填写)' }] },
  })

  return c.json({ ok: true }, 201)
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
