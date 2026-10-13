// 多平台发现库 API 封装（RAWG 代理 / 本地兜底）
import { api } from '@/lib/api'
import type { DiscoverGame } from '@/types/discover'
// 前端兜底目录：无后端（纯静态部署）时仍可浏览全部游戏
import fallbackCatalog from '@/data/discoverFallback.json'

export interface DiscoverParams {
  q?: string
  platforms?: string[]
  page?: number
  pageSize?: number
}

function paginate(list: DiscoverGame[], page = 1, pageSize = 40) {
  const start = (page - 1) * pageSize
  return {
    games: list.slice(start, start + pageSize),
    count: list.length,
    next: start + pageSize < list.length ? String(page + 1) : null,
  }
}

export async function getDiscover(
  params: DiscoverParams = {},
): Promise<{ games: DiscoverGame[]; count: number; next: string | null }> {
  const qs = new URLSearchParams()
  if (params.q) qs.set('q', params.q)
  if (params.platforms && params.platforms.length) qs.set('platforms', params.platforms.join(','))
  if (params.page) qs.set('page', String(params.page))
  if (params.pageSize) qs.set('pageSize', String(params.pageSize))
  try {
    const res = await api.get(`/games/discover?${qs.toString()}`)
    return res.json()
  } catch {
    // 兜底：在本地目录上做过滤 + 分页
    let list = fallbackCatalog as DiscoverGame[]
    if (params.q) {
      const q = params.q.toLowerCase()
      list = list.filter((g) => g.name.toLowerCase().includes(q))
    }
    if (params.platforms && params.platforms.length) {
      list = list.filter((g) => (g.platforms || []).some((p) => params.platforms!.includes(p)))
    }
    return paginate(list, params.page || 1, params.pageSize || 40)
  }
}

export async function searchGames(q: string): Promise<DiscoverGame[]> {
  if (!q.trim()) return []
  try {
    const res = await api.get(`/games/search?q=${encodeURIComponent(q.trim())}`)
    const d = await res.json()
    return d.games || []
  } catch {
    const kw = q.trim().toLowerCase()
    return (fallbackCatalog as DiscoverGame[]).filter((g) => g.name.toLowerCase().includes(kw)).slice(0, 20)
  }
}

export async function getRawgDetail(id: string): Promise<DiscoverGame | null> {
  try {
    const res = await api.get(`/games/rawg/${id}`)
    return await res.json()
  } catch {
    // 兜底：本地目录按 id 查找（覆盖 dc_ 前缀游戏）
    return (fallbackCatalog as DiscoverGame[]).find((g) => g.id === id) || null
  }
}
