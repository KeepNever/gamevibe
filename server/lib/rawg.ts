// RAWG.io 多平台游戏数据源客户端
//
// 设计目标：
//   1. 真实多平台覆盖（Steam / Xbox / PlayStation / Nintendo Switch / 移动端 / 网页）
//   2. 网络受限或限频时，自动降级到本地多平台目录（server/data/discoverCatalog.ts）
//   3. 内存缓存 10 分钟，避免频繁打外部 API
//
// 注意：RAWG 在本开发沙箱可能被网络层屏蔽，此时所有端点返回本地多平台目录，
//       功能与 UI 完全可用；部署到可联网环境即自动切换为真实数据。

import { discoverCatalog, type RawgGameLite } from '../data/discoverCatalog.ts'

const RAWG_BASE = 'https://api.rawg.io/api'
const RAWG_KEY = process.env.RAWG_API_KEY || ''
// 外部 API 超时（兜底前最多等这么久）。较短以保证首屏不卡。
const REACHABLE_TIMEOUT = 4000
// 兜底结果也缓存，避免每次请求都空等超时
const FALLBACK_TTL = 2 * 60 * 1000

// ── 内存缓存 ───────────────────────────────────────
const CACHE_TTL = 10 * 60 * 1000
const cache = new Map<string, { data: unknown; until: number }>()

function getCached<T>(key: string): T | undefined {
  const entry = cache.get(key)
  if (entry && Date.now() < entry.until) return entry.data as T
  cache.delete(key)
  return undefined
}
function setCache(key: string, data: unknown, ttl: number = CACHE_TTL): void {
  cache.set(key, { data, until: Date.now() + ttl })
}

// ── 平台映射（展示名 -> RAWG platform id）────────────
// 前端筛选使用展示名，后端映射为 RAWG 整数 id
const DISPLAY_TO_SLUG: Record<string, string> = {
  PC: 'pc',
  Xbox: 'xbox',
  PlayStation: 'playstation',
  'Nintendo Switch': 'nintendo-switch',
  移动端: 'ios',
  网页: '',
}
const PLATFORM_ID: Record<string, number> = {
  pc: 4,
  xbox: 186,
  playstation: 187,
  'nintendo-switch': 7,
  ios: 3,
  android: 21,
}
function mapPlatforms(displayNames: string[]): { platformParam: string; tagParam: string } {
  const slugs = displayNames.map((d) => DISPLAY_TO_SLUG[d]).filter(Boolean)
  const ids = slugs.map((s) => PLATFORM_ID[s]).filter(Boolean)
  // “网页”无对应 RAWG platform，改用 tag 近似
  const tagParam = displayNames.includes('网页') ? '&tags=browser' : ''
  return { platformParam: ids.length ? `&platforms=${ids.join(',')}` : '', tagParam }
}

async function rawgFetch<T>(path: string): Promise<T> {
  const sep = path.includes('?') ? '&' : '?'
  const url = `${RAWG_BASE}${path}${sep}key=${RAWG_KEY}`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'GameVibe/1.0' },
    signal: AbortSignal.timeout(REACHABLE_TIMEOUT),
  })
  if (!res.ok) throw new Error(`RAWG ${res.status}`)
  return res.json() as Promise<T>
}

function mapGame(g: any): RawgGameLite {
  return {
    id: `rawg_${g.id}`,
    name: g.name,
    coverUrl: g.background_image || '',
    rating: Math.round((g.rating || 0) * 20),
    ratingCount: g.ratings_count || 0,
    releaseDate: g.released || 'TBD',
    platforms: (g.platforms || []).map((p: any) => p.platform.name),
    genres: (g.genres || []).map((x: any) => x.name),
    tags: (g.tags || []).slice(0, 6).map((x: any) => x.name),
    description: g.description_raw || g.description || '',
    rawgUrl: `https://rawg.io/games/${g.slug}`,
    metacritic: g.metacritic ?? null,
    developer: (g.developers && g.developers[0] && g.developers[0].name) || '',
    priceLabel: '',
  }
}

function fallbackFilter(q: string, platforms: string[]): RawgGameLite[] {
  let list = discoverCatalog
  if (q) {
    const t = q.toLowerCase()
    list = list.filter(
      (g) =>
        g.name.toLowerCase().includes(t) ||
        g.tags.some((tg) => tg.toLowerCase().includes(t)) ||
        g.genres.some((ge) => ge.toLowerCase().includes(t)),
    )
  }
  if (platforms.length) {
    list = list.filter((g) => g.platforms.some((p) => platforms.includes(p)))
  }
  return list
}

export async function searchGames(
  q: string,
  page = 1,
  pageSize = 20,
  platforms: string[] = [],
): Promise<{ games: RawgGameLite[]; count: number; next: string | null }> {
  const cacheKey = `search_${q}_${page}_${pageSize}_${platforms.join(',')}`
  const cached = getCached<{ games: RawgGameLite[]; count: number; next: string | null }>(cacheKey)
  if (cached) return cached
  try {
    const { platformParam, tagParam } = mapPlatforms(platforms)
    const data = await rawgFetch<{ results: any[]; count: number; next: string | null }>(
      `/games?search=${encodeURIComponent(q)}&page_size=${pageSize}&page=${page}&ordering=-rating${platformParam}${tagParam}`,
    )
    const games = data.results.map(mapGame)
    const result = { games, count: data.count || games.length, next: data.next }
    setCache(cacheKey, result)
    return result
  } catch (e) {
    console.warn('[RAWG] search 不可用，使用本地多平台目录兜底:', (e as Error).message)
    const games = fallbackFilter(q, platforms).slice((page - 1) * pageSize, page * pageSize)
    const result = { games, count: discoverCatalog.length, next: null }
    setCache(cacheKey, result, FALLBACK_TTL)
    return result
  }
}

export async function getPopularGames(
  page = 1,
  pageSize = 24,
  platforms: string[] = [],
): Promise<{ games: RawgGameLite[]; count: number; next: string | null }> {
  const cacheKey = `popular_${page}_${pageSize}_${platforms.join(',')}`
  const cached = getCached<{ games: RawgGameLite[]; count: number; next: string | null }>(cacheKey)
  if (cached) return cached
  try {
    const { platformParam, tagParam } = mapPlatforms(platforms)
    const data = await rawgFetch<{ results: any[]; count: number; next: string | null }>(
      `/games?ordering=-rating&page_size=${pageSize}&page=${page}${platformParam}${tagParam}`,
    )
    const games = data.results.map(mapGame)
    const result = { games, count: data.count || games.length, next: data.next }
    setCache(cacheKey, result)
    return result
  } catch (e) {
    console.warn('[RAWG] popular 不可用，使用本地多平台目录兜底:', (e as Error).message)
    const games = fallbackFilter('', platforms).slice((page - 1) * pageSize, page * pageSize)
    const result = { games, count: discoverCatalog.length, next: null }
    setCache(cacheKey, result, FALLBACK_TTL)
    return result
  }
}

export async function getRawgGameDetail(rawgId: string): Promise<RawgGameLite | null> {
  const key = `detail_${rawgId}`
  if (cache.has(key)) return cache.get(key)!.data as RawgGameLite | null

  // ① dc_ 前缀：直接从本地多平台目录查找（discoverCatalog）
  if (rawgId.startsWith('dc_')) {
    const local = discoverCatalog.find((g) => g.id === rawgId) || null
    setCache(key, local)
    return local
  }

  // ② rawg_ 前缀或纯数字：尝试 RAWG API
  try {
    const g = await rawgFetch<any>(`/games/${rawgId}`)
    const mapped = mapGame(g)
    setCache(key, mapped)
    return mapped
  } catch {
    const local = discoverCatalog.find((g) => g.id === `rawg_${rawgId}`) || null
    setCache(key, local)
    return local
  }
}
