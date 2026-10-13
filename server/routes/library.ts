import { Hono } from 'hono'
import { randomBytes } from 'node:crypto'
import { db } from '../db/index.ts'
import { authMiddleware } from '../middleware/auth.ts'
import { scanSteamLibrary } from '../lib/steam.ts'
import type { UserLibraryItem } from '../types.ts'

// 显式声明上下文变量：用 use('*', mw) 挂载时 Hono 不会把 mw 的 Variables 传播给后续 handler。
const lib = new Hono<{ Variables: { userId: string; username: string } }>()
lib.use('*', authMiddleware)

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

// 扫描本机 Steam 库（不自动入库，由前端确认后导入）
lib.get('/scan', (c) => {
  const games = scanSteamLibrary()
  return c.json({ games, count: games.length })
})

// 批量导入扫描结果
lib.post('/import', async (c) => {
  const userId = c.get('userId')
  let body: any
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: '请求体格式错误' }, 400)
  }
  const items: any[] = body?.items || []
  if (!Array.isArray(items) || items.length === 0) {
    return c.json({ error: 'items 为空' }, 400)
  }
  let inserted = 0
  for (const it of items) {
    const id = randomBytes(12).toString('hex')
    db.prepare(
      `INSERT INTO user_library (id,user_id,source,external_id,name,cover_url,install_path,size_bytes,last_played,status,added_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id,
      userId,
      'steam_scan',
      it.external_id ?? null,
      it.name,
      it.cover_url ?? null,
      it.install_path ?? null,
      it.size_bytes ?? null,
      it.last_played ?? null,
      'wishlist',
      Date.now(),
    )
    inserted++
  }
  return c.json({ inserted })
})

// 列出用户库
lib.get('/', (c) => {
  const userId = c.get('userId')
  const rows = db.prepare('SELECT * FROM user_library WHERE user_id=? ORDER BY added_at DESC').all(userId)
  return c.json({ items: rows.map(mapItem) })
})

// 更新条目（状态/评分/备注/标签）
lib.put('/:id', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  let body: any
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: '请求体格式错误' }, 400)
  }
  const allowed = ['status', 'user_rating', 'note', 'tags', 'name', 'cover_url']
  const sets: string[] = []
  const vals: any[] = []
  for (const k of allowed) {
    if (body[k] !== undefined) {
      sets.push(`${k}=?`)
      vals.push(k === 'tags' ? JSON.stringify(body[k]) : body[k])
    }
  }
  if (sets.length === 0) return c.json({ error: '无更新字段' }, 400)
  vals.push(id, userId)
  db.prepare(`UPDATE user_library SET ${sets.join(',')} WHERE id=? AND user_id=?`).run(...vals)
  return c.json({ ok: true })
})

lib.delete('/:id', (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  db.prepare('DELETE FROM user_library WHERE id=? AND user_id=?').run(id, userId)
  return c.json({ ok: true })
})

export default lib
