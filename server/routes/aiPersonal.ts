// 需要登录的 AI 个性化接口（玩家画像 / 画像驱动推荐解说）
//
// 工程约束（见 docs/AI-UPGRADE-PLAN.md §6）：
//   1) 鉴权按路由单独挂载，禁止 use('*')——否则会污染同前缀的公开接口 /api/ai/spotlight、/api/ai/review
//   2) 运行期不调用 LLM 生成画像：画像只从已冻结批次只读读取
//   3) LLM 调用统一走 server/lib/ai.ts 的接地封装
//   4) 无画像 / 无 key / 表缺失时优雅降级，不报错

import { Hono } from 'hono'
import { authMiddleware } from '../middleware/auth.ts'
import { catalog } from '../data/catalog.ts'
import { DIMENSIONS, DIM_LABEL, getActiveBatchInfo, getGameProfile, loadGameProfiles } from '../lib/gameProfile.ts'
import { RECENT_WINDOW_DAYS, buildPlayerProfile, profileSummaryLines, rankForUser } from '../lib/playerProfile.ts'
import { composePersonalizedNarrative, describeGame, type PersonalizedNarrative } from '../lib/ai.ts'

const aiPersonal = new Hono()

const TTL_MS = 30 * 60 * 1000
const narrativeCache = new Map<string, { until: number; fingerprint: string; data: any }>()

function level(v: number): 'high' | 'mid' | 'low' {
  if (v >= 4) return 'high'
  if (v <= 2) return 'low'
  return 'mid'
}

function profileSource() {
  const batch = getActiveBatchInfo()
  const covered = loadGameProfiles().size
  return {
    batchId: batch?.batchId ?? null,
    model: batch?.model ?? null,
    promptVersion: batch?.promptVersion ?? null,
    generatedAt: batch?.createdAt ?? null,
    coveredGames: covered,
    totalGames: catalog.length,
    degraded: covered === 0,
  }
}

// ───────── 玩家画像：长期 + 近期 + 依据（必须登录）─────────
aiPersonal.get('/profile', authMiddleware, (c) => {
  const userId = c.get('userId')
  const profile = buildPlayerProfile(userId)
  return c.json({
    ok: true,
    coldStart: profile.coldStart,
    sampleSize: profile.sampleSize,
    windowDays: RECENT_WINDOW_DAYS,
    dims: profile.dims,
    dimsDetail: DIMENSIONS.map((d) => ({
      key: d,
      label: DIM_LABEL[d],
      value: profile.dims[d],
      level: level(profile.dims[d]),
    })),
    recentDims: profile.recentDims,
    prefs: {
      coreGameplay: profile.coreGameplay,
      multiplayer: profile.multiplayer,
      estimatedLength: profile.estimatedLength,
    },
    genres: profile.genres,
    tags: profile.tags,
    basis: profile.basis,
    source: profileSource(),
  })
})

// ───────── 画像驱动的推荐解说：排序在本地算，模型只负责解说（必须登录）─────────
aiPersonal.get('/recommend', authMiddleware, async (c) => {
  const userId = c.get('userId')
  const limit = Math.min(8, Math.max(1, Number(c.req.query('limit')) || 4))
  const ranked = rankForUser(userId, limit)

  // 冷启动 / 无激活画像批次 → 降级为「高评分热门 + 诚实说明」，不谎称个性化
  if (!ranked || !ranked.ranked.length) {
    const hot = [...catalog].sort((a, b) => b.rating - a.rating).slice(0, 4)
    return c.json({
      ok: true,
      aiPowered: false,
      personalized: false,
      coldStart: true,
      headline: '你的口味画像还没成形——先收藏或标记几款玩过的游戏，我就能按你的口味来挑。',
      basis: { dims: null, topGames: [], sampleSize: 0 },
      picks: hot.map((g) => ({
        id: g.id,
        name: g.name,
        score: 0,
        reason: `口碑热度兼具：${g.genres.slice(0, 2).join('/')} · 评分 ${g.rating}`,
      })),
      source: profileSource(),
      updatedAt: Date.now(),
    })
  }

  const { profile, ranked: top } = ranked
  const candidateIds = top.map((t) => t.game.id)
  const fingerprint = `${profileSource().batchId}|${profile.sampleSize}|${candidateIds.join(',')}`

  const cached = narrativeCache.get(userId)
  if (cached && cached.fingerprint === fingerprint && cached.until > Date.now()) {
    return c.json(cached.data)
  }

  const profileGames = loadGameProfiles()
  const facts = [
    '【玩家画像】',
    ...profileSummaryLines(profile),
    '',
    '【候选游戏真实事实】',
    ...top.map((t) => {
      const gp = profileGames.get(t.game.id)
      const extra = gp?.semanticSummary ? `；语义概述=${gp.semanticSummary}` : ''
      return `${describeGame(t.game)}；本地匹配度=${t.match}%${extra}`
    }),
  ].join('\n')

  const dimTags = profile.tags.slice(0, 3).join('、')
  const fallback: PersonalizedNarrative = {
    aiPowered: false,
    headline: `按你的口味（${dimTags || profile.genres.slice(0, 3).join('、') || '高分口碑'}）挑出这几款：`,
    picks: top.map((t) => ({ id: t.game.id, reason: t.reason })),
  }

  const narrative = await composePersonalizedNarrative(facts, candidateIds, fallback)
  const byId = new Map(top.map((t) => [t.game.id, t]))

  const data = {
    ok: true,
    aiPowered: narrative.aiPowered,
    personalized: true,
    coldStart: false,
    headline: narrative.headline,
    basis: {
      dims: profile.dims,
      recentDims: profile.recentDims,
      dimensionLabels: DIMENSIONS.map((d) => ({ key: d, label: DIM_LABEL[d], value: profile.dims[d], level: level(profile.dims[d]) })),
      coreGameplay: profile.coreGameplay,
      topGames: profile.basis.recent.length ? profile.basis.recent : profile.basis.longTerm,
      sampleSize: profile.sampleSize,
      windowDays: profile.windowDays,
    },
    picks: narrative.picks.map((p) => {
      const t = byId.get(p.id)!
      const gp = profileGames.get(p.id)
      return {
        id: p.id,
        name: t.game.name,
        score: t.match,
        reason: p.reason,
        // 接地信息：全部来自真实目录 / 真实画像，供前端展示「AI 的依据」
        facts: {
          genres: t.game.genres,
          tags: t.game.tags.slice(0, 3),
          rating: t.game.rating,
          price: t.game.price,
          matchedCore: t.matchedCore,
          estimatedLength: gp?.estimatedLength ?? null,
        },
      }
    }),
    source: profileSource(),
    updatedAt: Date.now(),
  }

  narrativeCache.set(userId, { until: Date.now() + TTL_MS, fingerprint, data })
  return c.json(data)
})

export default aiPersonal
