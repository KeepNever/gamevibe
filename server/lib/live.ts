// 本地动态实时数据层（真实优先 · 模拟兜底 · 逐指标诚实标记）
//
// 数据来源分工（2026-09-23 起）：
//   - 在线玩家   → Steam 官方接口 ISteamUserStats/GetNumberOfCurrentPlayers（真·实时）；
//                  线上沙箱未放行 api.steampowered.com，自动降级为演示数据并标 real=false。
//   - 特价数/上新数 → Steam 商店 featuredcategories 真实计数（store 域，线上也通）。
//   - 收录游戏数 → 站内目录（真实）。
//   - 直播观众   → 未接入 Twitch，始终为演示数据（real=false），不假装。
//
// 设计原则：凡是模拟值，一律在 real 标记里如实暴露，前端据此给「演示数据」角标。
// 旧版全量模拟（simulated: true 常量）已不再适用。

import { catalog } from '../data/catalog.ts'
import { discoverCatalog } from '../data/discoverCatalog.ts'
import { getRealtimePlayers } from './steamRealtime.ts'
import { getStoreCounts } from './webSearch.ts'

export interface LiveGame {
  id: string
  name: string
  onlinePlayers: number
  twitchViewers: number
  /** 相对上一个采样窗口的趋势百分比（真实在线时为真实变化，否则为演示波动） */
  delta: number
}

/** 每个指标「是否来自真实数据源」 */
export interface LiveRealFlags {
  totalGames: boolean
  onlinePlayers: boolean
  streamingViewers: boolean
  newToday: boolean
  deals: boolean
}

export interface LiveStats {
  ok: true
  updatedAt: number
  /** 整体是否含演示成分（任一指标为演示即 true） */
  simulated: boolean
  /** 数据来源说明（人类可读，供界面与诊断） */
  source: string
  /** 逐指标真实 / 演示标记 */
  real: LiveRealFlags
  /** 实时在线的覆盖情况（来自 Steam 官方接口；不可达时带 note） */
  realtime: { covered: number; total: number; note?: string }
  global: {
    onlinePlayers: number
    streamingViewers: number
    totalGames: number
    newToday: number
    deals: number
  }
  trending: LiveGame[]
}

// 稳定哈希：字符串 -> [0,1)，保证同一游戏每次的波动相位固定（不会乱跳）
function hash01(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 100000) / 100000
}

// 由热度派生基础在线人数（数万级），让不同游戏量级有区分（仅用于演示兜底）
function basePop(g: { id: string; rating: number }): number {
  const seed = hash01(g.id)
  return Math.round((g.rating * 1200 + seed * 8000) * 40)
}

// 随时间平滑波动：phase 固定 -> 同一游戏在固定节奏上起伏（仅用于演示兜底）
function wave(now: number, periodMs: number, phase: number, amp: number): number {
  return 1 + amp * Math.sin((now / periodMs) * 2 * Math.PI + phase * 2 * Math.PI)
}

// 10 分钟周期的趋势百分比（-8% ~ +8%），制造"正在升温/降温"的观感（仅用于演示兜底）
function trendPct(id: string, now: number): number {
  const phase = hash01(id + 'trend')
  const v = Math.sin((now / 600000) * 2 * Math.PI + phase * 2 * Math.PI)
  return Math.round(v * 80) / 10
}

// 真实在线的上一个采样窗口，用于算「真实」趋势（而非演示波动）
let prevRealSample: { at: number; byGame: Record<string, number> } | null = null

export async function getLiveStats(): Promise<LiveStats> {
  const now = Date.now()
  const top = [...catalog].sort((a, b) => b.rating - a.rating).slice(0, 24)

  // 两个真实源并发取；均带缓存与冷却，失败不抛
  const [rt, counts] = await Promise.all([getRealtimePlayers(), getStoreCounts()])

  const playersReal = rt.reachable

  // 真实趋势：与上一个真实采样窗口对比（窗口间隔约等于实时层的 60s 缓存）
  const deltas: Record<string, number> = {}
  if (playersReal) {
    for (const [id, n] of Object.entries(rt.byGame)) {
      const p = prevRealSample?.byGame[id]
      if (typeof p === 'number' && p > 0) deltas[id] = Math.round(((n - p) / p) * 1000) / 10
    }
    if (!prevRealSample || now - prevRealSample.at >= 55_000) {
      prevRealSample = { at: now, byGame: { ...rt.byGame } }
    }
  }

  const trending: LiveGame[] = top.map((g) => {
    const realPlayers = rt.byGame[g.id]
    return {
      id: g.id,
      name: g.name,
      // 有真实值用真实值；否则用演示值（real 标记会如实说明）
      onlinePlayers:
        typeof realPlayers === 'number'
          ? realPlayers
          : Math.round(basePop(g) * wave(now, 45000, hash01(g.id), 0.14)),
      // 直播观众：始终为演示（未接入 Twitch）
      twitchViewers: Math.round(basePop(g) * 0.32 * wave(now, 30000, hash01(g.id) + 0.5, 0.22)),
      delta: playersReal ? (deltas[g.id] ?? 0) : trendPct(g.id, now),
    }
  })

  const dayIdx = Math.floor(now / 86400000)
  const dealsReal = Boolean(counts)
  const newReal = Boolean(counts)

  const real: LiveRealFlags = {
    totalGames: true,
    onlinePlayers: playersReal,
    streamingViewers: false,
    newToday: newReal,
    deals: dealsReal,
  }
  const simulated = Object.values(real).some((v) => !v)

  const onlinePlayers = playersReal ? rt.sum : trending.reduce((s, g) => s + g.onlinePlayers, 0)
  const streamingViewers = trending.reduce((s, g) => s + g.twitchViewers, 0)
  const deals = counts ? counts.specials : 8 + ((dayIdx * 7) % 23)
  const newToday = counts ? counts.newReleases : 12 + (dayIdx % 37)
  const totalGames = catalog.length + discoverCatalog.length

  const srcParts = [
    counts ? '特价/上新：Steam 商店实时' : '特价/上新：演示数据',
    playersReal ? `在线玩家：Steam 官方实时（覆盖 ${rt.covered}/${rt.total} 款）` : '在线玩家：演示数据',
    '直播观众：演示数据（未接入 Twitch）',
  ]

  return {
    ok: true,
    updatedAt: now,
    simulated,
    source: srcParts.join(' · '),
    real,
    realtime: { covered: rt.covered, total: rt.total, note: rt.note },
    global: { onlinePlayers, streamingViewers, totalGames, newToday, deals },
    trending,
  }
}
