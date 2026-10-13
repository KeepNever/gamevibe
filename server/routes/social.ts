// 社交系统：关注 / 好友动态 / 分享
import { Hono } from 'hono'
import { randomBytes } from 'node:crypto'
import { db } from '../db/index.ts'
import { authMiddleware } from '../middleware/auth.ts'
import { verifyToken } from '../lib/crypto.ts'
import { resolveGameMeta } from '../lib/gameMeta.ts'

/** 从请求头可选解析当前用户 id（公开接口也能识别登录态） */
function optionalUserId(c: any): string | undefined {
  const auth = c.req.header('Authorization')
  if (!auth || !auth.startsWith('Bearer ')) return undefined
  const payload = verifyToken(auth.slice(7))
  return payload?.sub
}

const social = new Hono()

// ═══ 关注/取关 ═══

/** 关注用户 */
social.post('/follow', authMiddleware, async (c) => {
  const me = c.get('userId')
  let body: any
  try { body = await c.req.json() } catch { return c.json({ error: '请求体格式错误' }, 400) }
  const targetId = body.userId
  if (!targetId || targetId === me) return c.json({ error: '无效目标' }, 400)
  // 检查目标用户存在
  const target = db.prepare('SELECT id FROM users WHERE id = ?').get(targetId)
  if (!target) return c.json({ error: '用户不存在' }, 404)
  const existing = db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?').get(me, targetId)
  try {
    db.prepare('INSERT OR IGNORE INTO follows (follower_id, following_id, created_at) VALUES (?, ?, ?)')
      .run(me, targetId, Date.now())
    // 新关注才生成通知（重复关注不刷屏）
    if (!existing) {
      db.prepare(`INSERT INTO notifications (id, user_id, actor_id, type, ref_id, read, created_at)
                  VALUES (?, ?, ?, 'follow', ?, 0, ?)`)
        .run(randomBytes(12).toString('hex'), targetId, me, me, Date.now())
    }
    return c.json({ ok: true, following: true })
  } catch {
    return c.json({ error: '关注失败' }, 500)
  }
})

/** 取消关注 */
social.delete('/follow/:userId', authMiddleware, (c) => {
  const me = c.get('userId')
  const targetId = c.req.param('userId')
  db.prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?').run(me, targetId)
  return c.json({ ok: true, following: false })
})

// ═══ 查询关注关系 ═══

/** 我的关注列表 */
social.get('/following/:userId', (c) => {
  const userId = c.req.param('userId')
  const rows = db.prepare(`
      SELECT u.id, u.username, u.display_name, u.avatar, f.created_at
      FROM follows f JOIN users u ON u.id = f.following_id
      WHERE f.follower_id = ?
      ORDER BY f.created_at DESC LIMIT 100
  `).all(userId) as any[]
  return c.json({ following: rows })
})

/** 我的粉丝列表 */
social.get('/followers/:userId', (c) => {
  const userId = c.req.param('userId')
  const rows = db.prepare(`
      SELECT u.id, u.username, u.display_name, u.avatar, f.created_at
      FROM follows f JOIN users u ON u.id = f.follower_id
      WHERE f.following_id = ?
      ORDER BY f.created_at DESC LIMIT 100
  `).all(userId) as any[]
  return c.json({ followers: rows })
})

/** 检查是否已关注某用户（批量） */
social.post('/check', authMiddleware, async (c) => {
  const me = c.get('userId')
  let body: any
  try { body = await c.req.json() } catch { return c.json({ follows: {} }) }
  const ids: string[] = body.userIds || []
  if (!ids.length) return c.json({ follows: {} })
  const placeholders = ids.map(() => '?').join(',')
  const rows = db.prepare(
    `SELECT following_id FROM follows WHERE follower_id = ? AND following_id IN (${placeholders})`
  ).all(me, ...ids) as any[]
  const set = new Set(rows.map((r: any) => r.following_id))
  const follows: Record<string, boolean> = {}
  for (const id of ids) follows[id] = !!set.has(id)
  return c.json({ follows })
})

// ═══ 好友动态流 ═══
/** 获取我关注的用户的最近活动；未关注任何人时降级为全站发现流 */
social.get('/feed', authMiddleware, (c) => {
  const me = c.get('userId')
  const limit = Math.min(50, Math.max(1, parseInt(c.req.query('limit') || '20', 10)))

  // 收集关注列表
  const following = db.prepare(`SELECT following_id FROM follows WHERE follower_id = ?`).all(me) as any[]
  const ids = following.map((f: any) => f.following_id)
  const discovery = ids.length === 0

  let reviewRows: any[]
  let libRows: any[]

  if (discovery) {
    // 降级：展示全站最近动态（排除自己），让用户登录后就有内容可看
    reviewRows = db.prepare(`
      SELECT r.id, r.user_id, r.game_id, r.rating, r.content, r.created_at,
             u.username, u.display_name, u.avatar
      FROM reviews r JOIN users u ON u.id = r.user_id
      WHERE r.user_id != ?
      ORDER BY r.created_at DESC LIMIT ?
    `).all(me, limit) as any[]
    libRows = db.prepare(`
      SELECT l.id, l.user_id, l.name, l.status, l.added_at,
             u.username, u.display_name, l.external_id
      FROM user_library l JOIN users u ON u.id = l.user_id
      WHERE l.user_id != ?
      ORDER BY l.added_at DESC LIMIT ?
    `).all(me, Math.floor(limit / 2)) as any[]
  } else {
    const placeholders = ids.map(() => '?').join(',')
    reviewRows = db.prepare(`
      SELECT r.id, r.user_id, r.game_id, r.rating, r.content, r.created_at,
             u.username, u.display_name, u.avatar
      FROM reviews r JOIN users u ON u.id = r.user_id
      WHERE r.user_id IN (${placeholders})
      ORDER BY r.created_at DESC LIMIT ?
    `).all(...ids, limit) as any[]
    libRows = db.prepare(`
      SELECT l.id, l.user_id, l.name, l.status, l.added_at,
             u.username, u.display_name, l.external_id
      FROM user_library l JOIN users u ON u.id = l.user_id
      WHERE l.user_id IN (${placeholders})
      ORDER BY l.added_at DESC LIMIT ?
    `).all(...ids, Math.floor(limit / 2)) as any[]
  }

  // 合并并按时间排序
  const feed: any[] = []
  for (const r of reviewRows) {
    const meta = resolveGameMeta(r.game_id)
    feed.push({
      type: 'review',
      id: r.id,
      user: { id: r.user_id, username: r.username, display_name: r.display_name, avatar: r.avatar },
      gameId: r.game_id,
      gameName: meta.name,
      gameCover: meta.coverUrl,
      rating: r.rating,
      content: r.content,
      created_at: r.created_at,
    })
  }
  for (const l of libRows) {
    feed.push({
      type: 'library',
      id: l.id,
      user: { id: l.user_id, username: l.username, display_name: l.display_name },
      gameId: l.external_id,
      gameName: l.name,
      status: l.status,
      created_at: l.added_at,
    })
  }

  feed.sort((a, b) => b.created_at - a.created_at)

  return c.json({
    feed: feed.slice(0, limit),
    discovery,
    message: discovery ? '你还没有关注任何人，下面是全站最新动态，去「社区」关注感兴趣的用户吧' : undefined,
  })
})

// ═══ 推荐用户（活跃用户）═══
/** 发现用户：按评论数+库存数排序的活跃用户 */
social.get('/users', (c) => {
  const limit = Math.min(20, Math.max(1, parseInt(c.req.query('limit') || '12', 10)))
  // 排除自己
  const excludeId = c.req.query('exclude') || ''

  let sql = `
    SELECT u.id, u.username, u.display_name, u.avatar, u.created_at,
           COALESCE(rc.cnt, 0) as review_count,
           COALESCE(lc.cnt, 0) as library_count
    FROM users u
    LEFT JOIN (SELECT user_id, COUNT(*) cnt FROM reviews GROUP BY user_id) rc ON rc.user_id = u.id
    LEFT JOIN (SELECT user_id, COUNT(*) cnt FROM user_library GROUP BY user_id) lc ON lc.user_id = u.id
    WHERE 1=1
  `
  const params: any[] = []

  if (excludeId) {
    sql += ` AND u.id != ?`
    params.push(excludeId)
  }

  sql += ` ORDER BY (COALESCE(rc.cnt, 0) * 3 + COALESCE(lc.cnt, 1)) DESC LIMIT ?`
  params.push(limit)

  const rows = db.prepare(sql).all(...params) as any[]
  // 对当前登录用户标注 isFollowing
  const currentUserId = optionalUserId(c)
  if (currentUserId && rows.length) {
    const ids = rows.map((r: any) => r.id)
    const ph = ids.map(() => '?').join(',')
    const followed = db.prepare(
      `SELECT following_id FROM follows WHERE follower_id = ? AND following_id IN (${ph})`
    ).all(currentUserId, ...ids) as any[]
    const followedSet = new Set(followed.map((f: any) => f.following_id))
    for (const r of (rows as any[])) r.is_following = !!followedSet.has(r.id)
  }

  return c.json({ users: rows })
})

// ═══ 用户主页 ═══
/** 用户资料：含统计、关注状态、他的评测与游戏库 */
social.get('/users/:id', (c) => {
  const userId = c.req.param('id')
  const me = optionalUserId(c)

  const user = db.prepare(`
    SELECT u.id, u.username, u.email, u.display_name, u.avatar, u.bio, u.created_at
    FROM users u WHERE u.id = ?
  `).get(userId) as any
  if (!user) return c.json({ error: '用户不存在' }, 404)

  // 统计
  const followerCount = (db.prepare('SELECT COUNT(*) c FROM follows WHERE following_id = ?').get(userId) as any).c
  const followingCount = (db.prepare('SELECT COUNT(*) c FROM follows WHERE follower_id = ?').get(userId) as any).c
  const reviewCount = (db.prepare('SELECT COUNT(*) c FROM reviews WHERE user_id = ?').get(userId) as any).c
  const libraryCount = (db.prepare('SELECT COUNT(*) c FROM user_library WHERE user_id = ?').get(userId) as any).c

  // 当前用户是否关注 TA
  let isFollowing = false
  if (me && me !== userId) {
    isFollowing = !!(db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?')
      .get(me, userId))
  }

  // 他的评测（带游戏信息）
  const reviews = (db.prepare(`
    SELECT r.id, r.game_id, r.rating, r.content, r.created_at
    FROM reviews r WHERE r.user_id = ?
    ORDER BY r.created_at DESC LIMIT 20
  `).all(userId) as any[]).map((r) => {
    const meta = resolveGameMeta(r.game_id)
    return {
      id: r.id, gameId: r.game_id, gameName: meta.name, gameCover: meta.coverUrl,
      rating: r.rating, content: r.content, created_at: r.created_at,
    }
  })

  // 他的游戏库
  const library = (db.prepare(`
    SELECT id, external_id, name, status, cover_url, added_at
    FROM user_library WHERE user_id = ?
    ORDER BY added_at DESC LIMIT 30
  `).all(userId) as any[]).map((l) => ({
    id: l.id, gameId: l.external_id, name: l.name, status: l.status,
    coverUrl: l.cover_url, added_at: l.added_at,
  }))

  // 库存状态分布
  const statusDist: Record<string, number> = {}
  for (const l of library) statusDist[l.status] = (statusDist[l.status] || 0) + 1

  // 公开资料去掉 email
  delete user.email

  return c.json({
    user: {
      ...user,
      followerCount, followingCount, reviewCount, libraryCount, isFollowing,
    },
    reviews,
    library,
    statusDistribution: statusDist,
  })
})

// ═══ 通知 ═══
/** 我的通知列表（含未读计数） */
social.get('/notifications', authMiddleware, (c) => {
  const me = c.get('userId')
  const limit = Math.min(50, Math.max(1, parseInt(c.req.query('limit') || '30', 10)))
  const rows = db.prepare(`
    SELECT n.id, n.type, n.ref_id, n.read, n.created_at,
           u.id AS actor_id, u.username, u.display_name, u.avatar
    FROM notifications n JOIN users u ON u.id = n.actor_id
    WHERE n.user_id = ?
    ORDER BY n.created_at DESC LIMIT ?
  `).all(me, limit) as any[]
  const unread = (db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND read = 0').get(me) as any).c
  return c.json({ notifications: rows, unread })
})

/** 标记单条已读 */
social.post('/notifications/:id/read', authMiddleware, (c) => {
  const me = c.get('userId')
  const id = c.req.param('id')
  db.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?').run(id, me)
  return c.json({ ok: true })
})

/** 全部已读 */
social.post('/notifications/read-all', authMiddleware, (c) => {
  const me = c.get('userId')
  db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(me)
  return c.json({ ok: true })
})

// ═══ 好友在玩 ═══
/** 我关注的人里，库存里有这款游戏的好友列表 */
social.get('/games/:gameId/friends', authMiddleware, (c) => {
  const me = c.get('userId')
  const gameId = c.req.param('gameId')
  const following = db.prepare('SELECT following_id FROM follows WHERE follower_id = ?').all(me) as any[]
  const ids = following.map((f: any) => f.following_id)
  if (!ids.length) return c.json({ friends: [], count: 0 })
  const ph = ids.map(() => '?').join(',')
  const rows = db.prepare(`
    SELECT u.id, u.display_name, u.avatar, l.status, l.added_at
    FROM user_library l JOIN users u ON u.id = l.user_id
    WHERE l.user_id IN (${ph}) AND l.external_id = ?
    ORDER BY l.added_at DESC
  `).all(...ids, gameId) as any[]
  // 同一好友可能有多条库存状态，按用户去重，优先保留 playing
  const prio: Record<string, number> = { playing: 0, completed: 1, backlog: 2, wishlist: 3, dropped: 4 }
  const byUser = new Map<string, any>()
  for (const r of rows) {
    const prev = byUser.get(r.id)
    if (!prev || (prio[r.status] ?? 9) < (prio[prev.status] ?? 9)) byUser.set(r.id, r)
  }
  const friends = [...byUser.values()].sort((a, b) => (b.added_at ?? 0) - (a.added_at ?? 0))
  return c.json({ friends, count: friends.length })
})

export default social
