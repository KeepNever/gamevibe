import { Hono } from 'hono'
import { env } from '../env.ts'

const igdb = new Hono()

// ── IGDB 凭证与令牌缓存 ─────────────────────────────
// IGDB 通过 Twitch OAuth2（client_credentials）获取 Bearer Token。
// 免费申请：https://dev.twitch.tv/console/apps → 创建应用 → Client ID / Secret
let tokenCache: { token: string; expiresAt: number } | null = null

async function getIgdbToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.token
  }
  const res = await fetch('https://id.twitch.tv/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.IGDB_CLIENT_ID,
      client_secret: env.IGDB_CLIENT_SECRET,
      grant_type: 'client_credentials',
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`IGDB token ${res.status}`)
  const data = (await res.json()) as { access_token: string; expires_in: number }
  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  }
  return data.access_token
}

/** 补全 IGDB 图片协议头（cover.url 形如 //images.igdb.com/...） */
function fixImg(url?: string): string {
  if (!url) return ''
  return url.startsWith('//') ? `https:${url}` : url
}

interface IgdbGame {
  id: number
  name: string
  slug?: string
  summary?: string
  rating?: number
  aggregated_rating?: number
  total_rating?: number
  first_release_date?: number
  cover?: { url?: string }
  genres?: { name: string }[]
  platforms?: { name: string }[]
}

/**
 * GET /api/igdb/games?q=名称&limit=20
 * 真实代理 IGDB 搜索。无凭证时返回 501 + 说明（前端/部署方补齐凭证即可生效）。
 */
igdb.get('/games', async (c) => {
  const q = (c.req.query('q') || '').trim()
  const limit = Math.min(Number(c.req.query('limit') || '20'), 50)

  if (!env.IGDB_CLIENT_ID || !env.IGDB_CLIENT_SECRET) {
    return c.json(
      {
        error: 'IGDB 未配置',
        hint: '在 .env 设置 IGDB_CLIENT_ID 与 IGDB_CLIENT_SECRET（免费申请于 dev.twitch.tv/console/apps）后，本接口即返回真实 IGDB 数据。',
        games: [],
      },
      501,
    )
  }

  if (!q) return c.json({ games: [] })

  try {
    const token = await getIgdbToken()
    const body = `search "${q.replace(/"/g, '\\"')}"; fields name,slug,cover.url,genres.name,platforms.name,rating,aggregated_rating,total_rating,summary,first_release_date; limit ${limit};`
    const res = await fetch('https://api.igdb.com/v4/games', {
      method: 'POST',
      headers: {
        'Client-ID': env.IGDB_CLIENT_ID,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'text/plain',
      },
      body,
      signal: AbortSignal.timeout(12_000),
    })
    if (!res.ok) throw new Error(`IGDB ${res.status}`)
    const raw = (await res.json()) as IgdbGame[]

    const games = raw.map((g) => ({
      id: g.id,
      slug: g.slug || String(g.id),
      name: g.name,
      cover: fixImg(g.cover?.url),
      summary: g.summary || '',
      rating: Math.round(g.total_rating ?? g.aggregated_rating ?? g.rating ?? 0),
      releaseDate: g.first_release_date ? new Date(g.first_release_date * 1000).toISOString().slice(0, 10) : '',
      genres: (g.genres || []).map((x) => x.name),
      platforms: (g.platforms || []).map((x) => x.name),
    }))

    return c.json({ ok: true, source: 'igdb', games })
  } catch (e: any) {
    console.warn('[IGDB] 查询失败:', e?.message || e)
    return c.json(
      { error: 'IGDB 查询失败', detail: e?.message || String(e), games: [] },
      502,
    )
  }
})

export default igdb
