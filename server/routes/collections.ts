import { Hono } from 'hono'
import { randomBytes } from 'node:crypto'
import { db } from '../db/index.ts'
import { authMiddleware } from '../middleware/auth.ts'
import type { UserLibraryItem } from '../types.ts'

// 显式声明上下文变量：用 use('*', mw) 挂载时 Hono 不会把 mw 的 Variables 传播给后续 handler。
const collections = new Hono<{ Variables: { userId: string; username: string } }>()
collections.use('*', authMiddleware)

const STATUS_MAP: Record<string, string> = {
  wishlist: 'wishlist',
  playing: 'playing',
  completed: 'completed',
  favorites: 'wishlist',
}

function mapItem(row: any): UserLibraryItem {
  return {
    id: row.id,
    user_id: row.user_id,
    source: row.source,
    external_id: row.external_id ?? null,
    name: row.name,
    cover_url: row.cover_url ?? null,
    install_path: row.install_path ?? null,
    size_bytes: row.size_bytes ?? null,
    last_played: row.last_played ?? null,
    status: row.status,
    user_rating: row.user_rating ?? null,
    note: row.note ?? null,
    tags: JSON.parse(row.tags || '[]'),
    added_at: row.added_at,
  }
}

collections.get('/:kind', (c) => {
  const userId = c.get('userId')
  const kind = c.req.param('kind')

  if (kind === 'recent') {
    const rows = db
      .prepare('SELECT game_id FROM user_recent WHERE user_id=? ORDER BY viewed_at DESC LIMIT 20')
      .all(userId)
    return c.json({ items: rows.map((r: any) => r.game_id) })
  }

  const status = STATUS_MAP[kind]
  if (!status) return c.json({ error: '未知集合类型' }, 400)
  const rows = db.prepare('SELECT * FROM user_library WHERE user_id=? AND status=?').all(userId, status)
  return c.json({ items: rows.map(mapItem) })
})

collections.post('/:kind', async (c) => {
  const userId = c.get('userId')
  const kind = c.req.param('kind')
  let body: any
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: '请求体格式错误' }, 400)
  }
  const gameId = body?.gameId
  if (!gameId) return c.json({ error: '缺少 gameId' }, 400)

  if (kind === 'recent') {
    db.prepare('INSERT OR REPLACE INTO user_recent (user_id, game_id, viewed_at) VALUES (?,?,?)').run(
      userId,
      gameId,
      Date.now(),
    )
    return c.json({ ok: true })
  }

  const status = STATUS_MAP[kind]
  if (!status) return c.json({ error: '未知集合类型' }, 400)

  const exist = db.prepare('SELECT id FROM user_library WHERE user_id=? AND external_id=?').get(userId, gameId)
  if (exist) {
    db.prepare('UPDATE user_library SET status=?, name=COALESCE(?,name), cover_url=COALESCE(?,cover_url) WHERE id=?').run(
      status,
      body.name || null,
      body.coverUrl || null,
      (exist as any).id,
    )
  } else {
    const id = randomBytes(12).toString('hex')
    db.prepare(
      'INSERT INTO user_library (id,user_id,source,external_id,name,cover_url,status,added_at) VALUES (?,?,?,?,?,?,?,?)',
    ).run(id, userId, 'catalog', gameId, body.name || gameId, body.coverUrl || null, status, Date.now())
  }
  return c.json({ ok: true })
})

collections.delete('/:kind', async (c) => {
  const userId = c.get('userId')
  const kind = c.req.param('kind')
  let body: any
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: '请求体格式错误' }, 400)
  }
  const gameId = body?.gameId
  if (kind === 'recent') {
    db.prepare('DELETE FROM user_recent WHERE user_id=? AND game_id=?').run(userId, gameId)
    return c.json({ ok: true })
  }
  const status = STATUS_MAP[kind]
  if (!status) return c.json({ error: '未知集合类型' }, 400)
  db.prepare('DELETE FROM user_library WHERE user_id=? AND external_id=? AND status=?').run(userId, gameId, status)
  return c.json({ ok: true })
})

export default collections
