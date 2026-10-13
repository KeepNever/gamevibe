// 玩家画像：把「请求时临时算的 genres/tags 加权」升级为显性、多维、区分长期与近期的画像
//
// 数据源：user_library（wishlist / playing / completed）、reviews（评分加成）、user_recent（浏览）
// 权重沿用原 recommendations.ts 的口径，保证升级前后可比：
//   completed 2.0 / playing 1.5 / wishlist 1.0 / 评论 +1 + (rating/5)×1.5 / 浏览 0.5
// 时间窗：长期 = 全部历史；近期 = 最近 30 天（user_library.added_at / reviews.created_at / user_recent.viewed_at）
// 降级：无激活画像批次 / 无交互 / 交互游戏无画像 → coldStart 或返回 null，调用方回退到旧逻辑

import { db } from '../db/index.ts'
import { catalog } from '../data/catalog.ts'
import type { CatalogGame } from '../types.ts'
import {
  DIMENSIONS,
  DIM_HIGH_LABEL,
  DIM_LABEL,
  DIM_LOW_LABEL,
  loadGameProfiles,
  type Dimension,
  type GameProfile,
} from './gameProfile.ts'

export const RECENT_WINDOW_DAYS = 30
const DAY_MS = 86400_000

const STATUS_WEIGHT: Record<string, number> = { completed: 2.0, playing: 1.5, wishlist: 1.0 }
const STATUS_LABEL: Record<string, string> = { completed: '已通关', playing: '在玩', wishlist: '想玩' }
const REVIEW_BASE = 1.0
const REVIEW_RATING_FACTOR = 1.5
const VIEW_WEIGHT = 0.5

// 排序权重（画像驱动排序的构成）
const SCORE_W = { dims: 0.6, core: 0.25, legacy: 0.15 }

export interface InteractionEvent {
  gameId: string
  weight: number
  at: number
  via: string
}

export interface BasisGame {
  id: string
  name: string
  via: string
  weight: number
}

export interface EnumPref {
  value: string
  weight: number
}

export type DimMap = Record<Dimension, number>

export interface PlayerProfile {
  userId: string
  coldStart: boolean
  sampleSize: number
  windowDays: number
  dims: DimMap
  recentDims: DimMap | null
  coreGameplay: EnumPref[]
  multiplayer: EnumPref[]
  estimatedLength: EnumPref[]
  genres: string[]
  tags: string[]
  basis: { longTerm: BasisGame[]; recent: BasisGame[] }
}

// ───────────────────────── 采集 ─────────────────────────

export function collectEvents(userId: string): InteractionEvent[] {
  const events: InteractionEvent[] = []

  try {
    const lib = db
      .prepare(
        "SELECT external_id, status, added_at FROM user_library WHERE user_id=? AND status IN ('wishlist','playing','completed') AND external_id IS NOT NULL",
      )
      .all(userId) as any[]
    for (const r of lib) {
      events.push({
        gameId: r.external_id,
        weight: STATUS_WEIGHT[r.status] ?? 1,
        at: Number(r.added_at) || 0,
        via: STATUS_LABEL[r.status] ?? '已收藏',
      })
    }
  } catch {
    /* 表缺失 → 跳过 */
  }

  try {
    const rv = db.prepare('SELECT game_id, rating, created_at FROM reviews WHERE user_id=?').all(userId) as any[]
    for (const r of rv) {
      if (!r.game_id) continue
      events.push({
        gameId: r.game_id,
        weight: REVIEW_BASE + ((Number(r.rating) || 0) / 5) * REVIEW_RATING_FACTOR,
        at: Number(r.created_at) || 0,
        via: '已评价',
      })
    }
  } catch {
    /* 表缺失 → 跳过 */
  }

  try {
    const rc = db.prepare('SELECT game_id, viewed_at FROM user_recent WHERE user_id=?').all(userId) as any[]
    for (const r of rc) {
      if (!r.game_id) continue
      events.push({ gameId: r.game_id, weight: VIEW_WEIGHT, at: Number(r.viewed_at) || 0, via: '浏览过' })
    }
  } catch {
    /* 表缺失 → 跳过 */
  }

  return events
}

/** 已交互游戏集合（用于把已玩过的排除出推荐） */
export function getInteractedIds(userId: string): Set<string> {
  return new Set(collectEvents(userId).map((e) => e.gameId))
}

// ───────────────────────── 计算 ─────────────────────────

const DIM_ZERO: DimMap = { story: 0, difficulty: 0, exploration: 0, combat: 0 }
const DIM_DEFAULT = 3.0
const COLD_DIMS: DimMap = { story: DIM_DEFAULT, difficulty: DIM_DEFAULT, exploration: DIM_DEFAULT, combat: DIM_DEFAULT }

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function clamp15(n: number): number {
  return Math.min(5, Math.max(1, n))
}

/** 加权平均四个维度；无可用样本返回 null */
function weightedDims(events: InteractionEvent[], profiles: Map<string, GameProfile>): DimMap | null {
  const acc: DimMap = { ...DIM_ZERO }
  let sw = 0
  for (const e of events) {
    const p = profiles.get(e.gameId)
    if (!p) continue
    sw += e.weight
    acc.story += e.weight * p.storyIntensity
    acc.difficulty += e.weight * p.difficulty
    acc.exploration += e.weight * p.exploration
    acc.combat += e.weight * p.combatIntensity
  }
  if (sw <= 0) return null
  return {
    story: round1(clamp15(acc.story / sw)),
    difficulty: round1(clamp15(acc.difficulty / sw)),
    exploration: round1(clamp15(acc.exploration / sw)),
    combat: round1(clamp15(acc.combat / sw)),
  }
}

/** 枚举字段加权频次 topN */
function weightedEnum(
  events: InteractionEvent[],
  profiles: Map<string, GameProfile>,
  pick: (p: GameProfile) => string[],
  topN: number,
): EnumPref[] {
  const acc = new Map<string, number>()
  for (const e of events) {
    const p = profiles.get(e.gameId)
    if (!p) continue
    for (const v of pick(p)) {
      const key = v.trim()
      if (!key) continue
      acc.set(key, (acc.get(key) || 0) + e.weight)
    }
  }
  return [...acc.entries()]
    .map(([value, weight]) => ({ value, weight: round1(weight) }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, topN)
}

/** 目录侧 genres/tags 加权（保留旧口径，用于兜底与口味展示） */
function weightedCatalog(events: InteractionEvent[], key: 'genres' | 'tags', topN: number): string[] {
  const acc = new Map<string, number>()
  for (const e of events) {
    const g = catalog.find((x) => x.id === e.gameId)
    if (!g) continue
    for (const v of g[key]) acc.set(v, (acc.get(v) || 0) + e.weight)
  }
  return [...acc.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([k]) => k)
}

/** 贡献最大的若干款（同款去重取最大权重），作为「为什么这样推荐」的可解释依据 */
function topContributors(events: InteractionEvent[], n: number): BasisGame[] {
  const best = new Map<string, InteractionEvent>()
  for (const e of events) {
    const cur = best.get(e.gameId)
    if (!cur || e.weight > cur.weight) best.set(e.gameId, e)
  }
  return [...best.values()]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, n)
    .map((e) => ({
      id: e.gameId,
      name: catalog.find((g) => g.id === e.gameId)?.name ?? e.gameId,
      via: e.via,
      weight: round1(e.weight),
    }))
}

export function buildPlayerProfile(userId: string, now = Date.now()): PlayerProfile {
  const profiles = loadGameProfiles()
  const all = collectEvents(userId)
  const recent = all.filter((e) => e.at > 0 && now - e.at <= RECENT_WINDOW_DAYS * DAY_MS)

  const longDims = weightedDims(all, profiles)
  const recentDims = weightedDims(recent, profiles)

  const empty: PlayerProfile = {
    userId,
    coldStart: true,
    sampleSize: 0,
    windowDays: RECENT_WINDOW_DAYS,
    dims: { ...COLD_DIMS },
    recentDims: null,
    coreGameplay: [],
    multiplayer: [],
    estimatedLength: [],
    genres: [],
    tags: [],
    basis: { longTerm: [], recent: [] },
  }
  if (!longDims) return empty

  const sample = new Set(all.map((e) => e.gameId).filter((id) => profiles.has(id))).size

  return {
    userId,
    coldStart: false,
    sampleSize: sample,
    windowDays: RECENT_WINDOW_DAYS,
    dims: longDims,
    recentDims,
    coreGameplay: weightedEnum(all, profiles, (p) => p.coreGameplay, 5),
    multiplayer: weightedEnum(all, profiles, (p) => [p.multiplayer], 3),
    estimatedLength: weightedEnum(all, profiles, (p) => [p.estimatedLength], 3),
    genres: weightedCatalog(all, 'genres', 5),
    tags: weightedCatalog(all, 'tags', 5),
    basis: { longTerm: topContributors(all, 3), recent: topContributors(recent, 3) },
  }
}

/** 维度的口语化标签（≥4 高 / ≤2 低），用于接地理由 */
export function dimLabels(dims: DimMap): string[] {
  const out: string[] = []
  for (const d of DIMENSIONS) {
    if (dims[d] >= 4) out.push(DIM_HIGH_LABEL[d])
    else if (dims[d] <= 2) out.push(DIM_LOW_LABEL[d])
  }
  return out
}

// ───────────────────────── 画像驱动排序 ─────────────────────────

export interface RankedGame {
  game: CatalogGame
  /** 0–100 匹配度（可解释：维度贴合度 + 核心玩法重合 + 口味标签重合） */
  match: number
  dimsFit: number
  matchedCore: string[]
  matchedDims: Dimension[]
  /** 接地理由：只引用真实画像字段与真实互动记录 */
  reason: string
}

/** 近期优先的偏好向量（近期权重更高，用于排序与理由） */
function blendDims(p: PlayerProfile): DimMap {
  if (!p.recentDims) return p.dims
  const out = {} as DimMap
  for (const d of DIMENSIONS) out[d] = p.dims[d] * 0.5 + p.recentDims[d] * 0.5
  return out
}

/**
 * 为指定用户排序候选游戏。
 * 无激活画像批次 / 无交互 / 全部候选无画像 → 返回 null，调用方回退到旧逻辑。
 */
export function rankForUser(
  userId: string,
  limit = 12,
): { profile: PlayerProfile; interacted: Set<string>; ranked: RankedGame[] } | null {
  const profiles = loadGameProfiles()
  if (profiles.size === 0) return null

  const profile = buildPlayerProfile(userId)
  if (profile.coldStart) return null

  const interacted = new Set(collectEvents(userId).map((e) => e.gameId))
  const pref = blendDims(profile)
  const topCore = profile.coreGameplay.map((c) => c.value)

  // 目录侧口味权重（旧口径），用于 legacy 分项
  const legacyRaw = new Map<string, number>()
  {
    const acc = new Map<string, number>()
    for (const e of collectEvents(userId)) {
      const g = catalog.find((x) => x.id === e.gameId)
      if (!g) continue
      for (const v of [...g.genres, ...g.tags]) acc.set(v, (acc.get(v) || 0) + e.weight)
    }
    let max = 0
    for (const g of catalog) {
      let s = 0
      for (const v of [...g.genres, ...g.tags]) s += acc.get(v) || 0
      legacyRaw.set(g.id, s)
      if (s > max) max = s
    }
    for (const [k, v] of legacyRaw) legacyRaw.set(k, max > 0 ? v / max : 0)
  }

  const candidates = catalog.filter((g) => !interacted.has(g.id))
  const scored: RankedGame[] = []

  for (const g of candidates) {
    const p = profiles.get(g.id)
    if (!p) continue

    // 1) 维度贴合度：1 - 平均绝对偏差/4
    const diffs =
      Math.abs(pref.story - p.storyIntensity) +
      Math.abs(pref.difficulty - p.difficulty) +
      Math.abs(pref.exploration - p.exploration) +
      Math.abs(pref.combat - p.combatIntensity)
    const dimsFit = Math.max(0, 1 - diffs / (4 * DIMENSIONS.length))

    // 2) 核心玩法重合
    const matchedCore = p.coreGameplay.filter((c) => topCore.slice(0, 3).includes(c))
    const coreFit = Math.min(1, matchedCore.length / Math.max(1, Math.min(3, topCore.length)))

    // 3) 目录口味标签重合（旧口径）
    const legacy = legacyRaw.get(g.id) ?? 0

    const total = SCORE_W.dims * dimsFit + SCORE_W.core * coreFit + SCORE_W.legacy * legacy

    // 命中的「强偏好维度」中，该游戏同样不低的那些
    const matchedDims = DIMENSIONS.filter((d) => {
      const key = ({ story: 'storyIntensity', difficulty: 'difficulty', exploration: 'exploration', combat: 'combatIntensity' } as const)[d]
      return pref[d] >= 3.6 && (p as any)[key] >= 3
    })

    scored.push({
      game: g,
      match: Math.round(total * 100),
      dimsFit: round1(dimsFit),
      matchedCore,
      matchedDims,
      reason: buildGroundedReason(g, p, profile, matchedCore, matchedDims, Math.round(total * 100), profiles.get(basisIdOf(profile)) ?? null),
    })
  }

  scored.sort((a, b) => b.match - a.match || b.game.rating - a.game.rating)
  return { profile, interacted, ranked: scored.slice(0, limit) }
}

/** 画像的首要依据游戏 id（近期优先），用于接地理由 */
export function basisIdOf(profile: PlayerProfile): string {
  const list = profile.basis.recent.length ? profile.basis.recent : profile.basis.longTerm
  return list[0]?.id ?? ''
}

/** 接地理由：只用真实画像字段 + 真实互动记录拼装，不含任何模型生成内容 */
export function buildGroundedReason(
  g: CatalogGame,
  p: GameProfile,
  profile: PlayerProfile,
  matchedCore: string[],
  matchedDims: Dimension[],
  match: number,
  basisProfile?: GameProfile | null,
): string {
  const basisList = profile.basis.recent.length ? profile.basis.recent : profile.basis.longTerm
  const basis = basisList[0]
  const bits: string[] = []

  if (matchedDims.length) {
    bits.push(`契合你偏好的「${matchedDims.map((d) => DIM_HIGH_LABEL[d]).join(' · ')}」`)
  } else if (matchedCore.length) {
    bits.push(`你在意的「${matchedCore.join('、')}」正是它的核心玩法`)
  } else {
    bits.push(`综合口味匹配度 ${match}%`)
  }

  // 引用真实重合点：候选与该玩家依据游戏的共同核心玩法，没有共同点则退回共同类型
  if (basis && basis.id !== g.id) {
    const overlap = basisProfile ? p.coreGameplay.filter((c) => basisProfile.coreGameplay.includes(c)) : []
    const shared = overlap.length
      ? overlap.slice(0, 2).join('、')
      : g.genres.filter((x) => (catalog.find((c) => c.id === basis.id)?.genres ?? []).includes(x)).slice(0, 2).join('、')
    bits.push(
      shared
        ? `与你${basis.via}的《${basis.name}》在「${shared}」上一致`
        : `与你${basis.via}的《${basis.name}》口味相近`,
    )
  }

  const tail = p.estimatedLength && p.estimatedLength !== 'unknown' ? `主线约 ${lengthText(p.estimatedLength)}` : ''
  if (tail) bits.push(tail)

  return bits.join('；')
}

function lengthText(v: string): string {
  const map: Record<string, string> = {
    '<5h': '5 小时内',
    '5-15h': '5–15 小时',
    '15-30h': '15–30 小时',
    '30-60h': '30–60 小时',
    '>60h': '60 小时以上',
    ongoing: '长期运营',
  }
  return map[v] ?? v
}

/** 画像的中文可读摘要（供前端展示与 LLM 接地事实块复用） */
export function profileSummaryLines(p: PlayerProfile): string[] {
  if (p.coldStart) return ['暂无足够交互记录，尚未生成口味画像']
  const lines: string[] = []
  lines.push(
    `维度（1-5）：${DIMENSIONS.map((d) => `${DIM_LABEL[d]}=${p.dims[d]}`).join('，')}`,
  )
  if (p.recentDims) {
    lines.push(`近 ${p.windowDays} 天：${DIMENSIONS.map((d) => `${DIM_LABEL[d]}=${p.recentDims![d]}`).join('，')}`)
  }
  if (p.coreGameplay.length) lines.push(`核心玩法偏好：${p.coreGameplay.map((c) => c.value).join('、')}`)
  if (p.genres.length) lines.push(`类型偏好：${p.genres.join('、')}`)
  if (p.tags.length) lines.push(`标签偏好：${p.tags.join('、')}`)
  const basis = p.basis.recent.length ? p.basis.recent : p.basis.longTerm
  if (basis.length) lines.push(`主要依据：${basis.map((b) => `${b.via}《${b.name}》`).join('、')}`)
  return lines
}
