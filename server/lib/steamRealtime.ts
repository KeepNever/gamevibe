/**
 * 真·实时在线人数层（Steam 官方公开接口，免密钥）
 *
 * 数据源：api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=X
 *   —— 返回该游戏「当前同时在线人数」，Steam 侧分钟级刷新，是真·实时数据（非估算、非模拟）。
 *
 * ⚠️ 可达性（本项目最重要的环境约束）：
 *   - 本机：Node 走系统代理（HTTPS_PROXY + NODE_USE_ENV_PROXY=1）可直连 api.steampowered.com；
 *   - 线上沙箱：白名单只放行 store.steampowered.com，本域**不可达**（实测 8s 超时）。
 *   因此本层设计为「失败即空 + 冷却」，由调用方如实标注 real=false，绝不拿模拟数冒充真实。
 *
 * 降级策略：
 *   - 每个 appid 60 秒缓存；
 *   - 整批失败时进入 5 分钟冷却，避免线上每 5 秒一次的 /api/live 轮询反复撞超时拖慢首页；
 *   - 任何异常一律吞掉并返回 reachable=false。
 */

import { catalog } from '../data/catalog.ts'
import { STEAM_APP_ID } from '../data/steamAppIds.ts'

const PER_APP_TTL = 60 * 1000
const UNREACHABLE_COOLDOWN = 5 * 60 * 1000
const REQUEST_TIMEOUT = 3500

const playerCache = new Map<number, { players: number; until: number }>()
let cooldownUntil = 0

/** 取单个 appid 的当前在线人数（带缓存）；不可达返回 null */
export async function fetchPlayerCount(appid: number): Promise<number | null> {
  const hit = playerCache.get(appid)
  if (hit && Date.now() < hit.until) return hit.players

  try {
    const res = await fetch(
      `https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${appid}`,
      {
        headers: { 'User-Agent': 'GameVibe/1.0 (+https://gamevibe.app.workbuddy.host)' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
      },
    )
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as { response?: { player_count?: number; result?: number } }
    const n = data.response?.player_count
    if (typeof n !== 'number' || data.response?.result !== 1) return null
    playerCache.set(appid, { players: n, until: Date.now() + PER_APP_TTL })
    return n
  } catch {
    return null
  }
}

export interface RealtimePlayers {
  /** 本次是否真的取到了真实在线人数 */
  reachable: boolean
  fetchedAt: number
  /** 站内 gameId → 当前在线人数（仅含成功取到的） */
  byGame: Record<string, number>
  /** 已取到真实数据的游戏数 */
  covered: number
  /** 站内可解析 appid 的游戏总数（分母，用于如实说明覆盖率） */
  total: number
  /** 合计在线人数（仅统计已取到的） */
  sum: number
  /** 失败/降级原因（供诊断与前端提示） */
  note?: string
}

const EMPTY = (note?: string): RealtimePlayers => ({
  reachable: false,
  fetchedAt: Date.now(),
  byGame: {},
  covered: 0,
  total: Object.keys(STEAM_APP_ID).length,
  sum: 0,
  note,
})

/** 批量取站内目录游戏的实时在线人数（并发，容忍部分失败） */
export async function getRealtimePlayers(): Promise<RealtimePlayers> {
  if (Date.now() < cooldownUntil) {
    return EMPTY('实时在线接口暂不可达（冷却中，稍后自动重试）')
  }

  const targets = catalog
    .map((g) => ({ id: g.id, appid: STEAM_APP_ID[g.id] }))
    .filter((t): t is { id: string; appid: number } => typeof t.appid === 'number')

  if (!targets.length) return EMPTY('目录内无可解析 appid 的游戏')

  const settled = await Promise.allSettled(
    targets.map(async (t) => ({ id: t.id, players: await fetchPlayerCount(t.appid) })),
  )

  const byGame: Record<string, number> = {}
  for (const r of settled) {
    if (r.status === 'fulfilled' && typeof r.value.players === 'number') {
      byGame[r.value.id] = r.value.players
    }
  }

  const ids = Object.keys(byGame)
  if (!ids.length) {
    cooldownUntil = Date.now() + UNREACHABLE_COOLDOWN
    return EMPTY('api.steampowered.com 不可达（运行环境未放行该域名，已降级为演示数据）')
  }

  return {
    reachable: true,
    fetchedAt: Date.now(),
    byGame,
    covered: ids.length,
    total: targets.length,
    sum: ids.reduce((s, id) => s + byGame[id], 0),
  }
}
