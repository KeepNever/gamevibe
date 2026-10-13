import { Hono } from 'hono'
import { db } from '../db/index.ts'
import { verifyToken } from '../lib/crypto.ts'
import { catalog } from '../data/catalog.ts'
import { DIMENSIONS, DIM_LABEL } from '../lib/gameProfile.ts'
import { rankForUser } from '../lib/playerProfile.ts'

const recommend = new Hono()

// 可选解析登录用户（seed 相似推荐允许匿名，个性化推荐无 token 走兜底）
// 注意：生产环境边缘网关会覆写 Authorization，故优先读 X-Auth-Token
function getOptionalUserId(c: any): string | null {
  const custom = c.req.header('X-Auth-Token') || c.req.header('x-auth-token')
  const auth = c.req.header('Authorization')
  const raw = custom || auth
  if (!raw) return null
  const token = custom ? raw : raw.startsWith('Bearer ') ? raw.slice(7) : raw
  const payload = verifyToken(token)
  return payload ? (payload.sub as string) : null
}

// 用户已交互的游戏集合（收藏/在玩/通关/评论）
function getInteractedIds(userId: string): Set<string> {
  const rows = db
    .prepare(
      "SELECT external_id FROM user_library WHERE user_id=? AND status IN ('wishlist','playing','completed')",
    )
    .all(userId) as any[]
  const rv = db.prepare('SELECT game_id FROM reviews WHERE user_id=?').all(userId) as any[]
  const set = new Set<string>()
  rows.forEach((r) => r.external_id && set.add(r.external_id))
  rv.forEach((r) => r.game_id && set.add(r.game_id))
  return set
}

// ── 以下两个函数为「无画像批次时的兜底」口径（genres/tags 加权），保持与原实现一致 ──

// 构建兴趣画像：genres/tags -> 权重（通关权重最高，评分正向加成）
function buildProfile(userId: string): Map<string, number> {
  const profile = new Map<string, number>()
  const libRows = db
    .prepare(
      "SELECT external_id, status FROM user_library WHERE user_id=? AND status IN ('wishlist','playing','completed')",
    )
    .all(userId) as any[]
  const reviewRows = db.prepare('SELECT game_id, rating FROM reviews WHERE user_id=?').all(userId) as any[]
  const weights: Record<string, number> = {}
  for (const r of libRows) {
    const w = r.status === 'completed' ? 2 : r.status === 'playing' ? 1.5 : 1
    weights[r.external_id] = (weights[r.external_id] || 0) + w
  }
  for (const rv of reviewRows) {
    const bonus = ((rv.rating || 0) / 5) * 1.5
    weights[rv.game_id] = (weights[rv.game_id] || 0) + 1 + bonus
  }
  for (const [id, w] of Object.entries(weights)) {
    const meta = catalog.find((c) => c.id === id)
    if (!meta) continue
    for (const g of meta.genres) profile.set('g:' + g, (profile.get('g:' + g) || 0) + w)
    for (const t of meta.tags) profile.set('t:' + t, (profile.get('t:' + t) || 0) + w)
  }
  return profile
}

function topGenresTags(profile: Map<string, number>): { genres: string[]; tags: string[] } {
  const genres = [...profile.entries()]
    .filter(([k]) => k.startsWith('g:'))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k]) => k.slice(2))
  const tags = [...profile.entries()]
    .filter(([k]) => k.startsWith('t:'))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k]) => k.slice(2))
  return { genres, tags }
}

recommend.get('/', (c) => {
  const seed = c.req.query('seed')
  const userId = getOptionalUserId(c)
  const interacted = userId ? getInteractedIds(userId) : new Set<string>()

  // —— 模式 A：基于某游戏的相似推荐（匿名可用，用于游戏详情「因为你玩过」）——
  if (seed) {
    const meta = catalog.find((x) => x.id === seed)
    if (!meta) return c.json({ mode: 'similar', seed, recommendations: [] })
    const recs = catalog
      .filter((x) => x.id !== seed)
      .map((x) => {
        let score = 0
        const matched: string[] = []
        for (const g of x.genres) if (meta.genres.includes(g)) { score += 2; matched.push(g) }
        for (const t of x.tags) if (meta.tags.includes(t)) { score += 1; matched.push(t) }
        return { game: x, score, matched }
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .filter((x) => !interacted.has(x.game.id))
    return c.json({
      mode: 'similar',
      seed,
      recommendations: recs.map((r) => ({
        id: r.game.id,
        name: r.game.name,
        score: r.score,
        reason: `与《${meta.name}》相似：${[...new Set(r.matched)].slice(0, 3).join('、')}`,
      })),
    })
  }

  // —— 模式 B：个性化推荐 ——

  // 匿名 / 冷启动的接地理由：只引用目录真实字段（评分 + 标签），不调 LLM、不编造
  const publicReason = (g: (typeof catalog)[number]): string => {
    const tags = g.tags.slice(0, 2).join(' · ')
    return tags ? `评分 ${g.rating.toFixed(1)} · ${tags}` : `评分 ${g.rating.toFixed(1)} 高分之作`
  }

  if (!userId) {
    const fallback = [...catalog].sort((a, b) => b.rating - a.rating).slice(0, 12)
    return c.json({
      mode: 'fallback',
      personalized: false,
      engine: 'popular-fallback',
      recommendations: fallback.map((g) => ({
        id: g.id,
        name: g.name,
        score: 0,
        reason: publicReason(g),
      })),
    })
  }

  if (interacted.size === 0) {
    const fallback = [...catalog].sort((a, b) => b.rating - a.rating).slice(0, 12)
    return c.json({
      mode: 'cold',
      personalized: false,
      engine: 'popular-fallback',
      recommendations: fallback.map((g) => ({
        id: g.id,
        name: g.name,
        score: 0,
        reason: publicReason(g),
      })),
    })
  }

  // ── 首选：画像驱动（读已冻结的游戏语义画像，排序在本地完成、理由为接地文案）──
  const ranked = rankForUser(userId, 12)
  if (ranked && ranked.ranked.length) {
    const p = ranked.profile
    return c.json({
      mode: 'personalized',
      personalized: true,
      engine: 'profile-semantic',
      taste: {
        genres: p.genres,
        tags: p.tags,
        dims: p.dims,
        dimsDetail: DIMENSIONS.map((d) => ({ key: d, label: DIM_LABEL[d], value: p.dims[d] })),
        recentDims: p.recentDims,
        coreGameplay: p.coreGameplay.map((x) => x.value),
        basis: p.basis.recent.length ? p.basis.recent : p.basis.longTerm,
        sampleSize: p.sampleSize,
      },
      recommendations: ranked.ranked.map((r) => ({
        id: r.game.id,
        name: r.game.name,
        score: r.match,
        match: r.match,
        dimsFit: r.dimsFit,
        matchedCore: r.matchedCore,
        matchedDims: r.matchedDims.map((d) => ({ key: d, label: DIM_LABEL[d] })),
        reason: r.reason,
      })),
    })
  }

  // ── 兜底：画像表缺失或未冻结 → 旧口径 genres/tags 加权 ──
  const profile = buildProfile(userId)
  const { genres, tags } = topGenresTags(profile)
  const recs = catalog
    .filter((x) => !interacted.has(x.id))
    .map((x) => {
      let score = 0
      const matched: string[] = []
      for (const g of x.genres) {
        const w = profile.get('g:' + g) || 0
        if (w) { score += w; if (!matched.includes(g)) matched.push(g) }
      }
      for (const t of x.tags) {
        const w = profile.get('t:' + t) || 0
        if (w) { score += w; if (!matched.includes(t)) matched.push(t) }
      }
      return { game: x, score, matched }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
  return c.json({
    mode: 'personalized',
    personalized: true,
    engine: 'genre-weighted',
    taste: { genres, tags },
    recommendations: recs.map((r) => ({
      id: r.game.id,
      name: r.game.name,
      score: Math.round(r.score * 10) / 10,
      reason: '因为你喜欢 ' + [...new Set(r.matched)].slice(0, 3).join('、'),
    })),
  })
})

export default recommend
