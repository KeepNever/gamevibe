/**
 * 新游戏信息聚合服务
 *
 * 数据源：
 *   1. RAWG.io  — 免费、全面的游戏数据库（新发售/即将发售/热门）
 *   2. Steam Store — 免费商店API（特价/新品/热销）
 *
 * 缓存策略：内存缓存 10 分钟，避免频繁请求外部 API。
 */

// ── 类型定义 ───────────────────────────────────────

export interface RawgGame {
  id: number
  slug: string
  name: string
  released: string | null
  tba: boolean
  background_image: string | null
  rating: number
  rating_top: number
  metacritic: number | null
  playtime: number
  platforms: { platform: { id: number; name: string; slug: string } }[]
  genres: { id: number; name: string }[]

  tags: { id: number; name: string; slug: string }[]
  esrb_rating: { id: number; name: string; slug: string } | null
  short_screenshots: { id: number; image: string }[]
}

export interface NewsItem {
  id: string
  source: 'rawg' | 'steam'
  name: string
  coverUrl: string
  releaseDate: string
  rating?: number
  genres: string[]
  platforms: string[]
  price?: string
  originalPrice?: string
  discount?: number
  url: string
  fetchedAt: number
}

// ── 内存缓存 ───────────────────────────────────────

const CACHE_TTL = 10 * 60 * 1000 // 10 分钟
const cache = new Map<string, { data: any; until: number }>()

function getCached<T>(key: string): T | null {
  const entry = cache.get(key)
  if (entry && Date.now() < entry.until) return entry.data as T
  cache.delete(key)
  return null
}

function setCache(key: string, data: unknown): void {
  cache.set(key, { data, until: Date.now() + CACHE_TTL })
}

// ── RAWG.io API ────────────────────────────────────

const RAWG_BASE = 'https://api.rawg.io/api'
const RAWG_KEY = process.env.RAWG_API_KEY || '' // 可选，无 key 也能用但有速率限制

async function rawg<T>(path: string): Promise<T> {
  const url = `${RAWG_BASE}${path}${path.includes('?') ? '&' : '?'}key=${RAWG_KEY}`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'GameVibe/1.0' },
    signal: AbortSignal.timeout(15000), // 15s 超时（RAWG 有时较慢）
  })
  if (!res.ok) throw new Error(`RAWG ${res.status}: ${path}`)
  return res.json() as Promise<T>
}

// ── Steam Store API ────────────────────────────────

const STEAM_SPECIALS = 'https://store.steampowered.com/api/featuredcategories?l=english'

interface SteamApp {
  // 注意：featuredcategories 实际返回的字段是 id（应用 id），没有 appid。
  // 早期代码按 appid 取值，导致 id 生成为 "steam_undefined"，此处已修正。
  id: number
  type: string
  name: string
  header_image: string
  large_capsule_image: string
  discount_percent: number
  final_price: number
  original_price: number
  currency: string
}

async function fetchSteamSpecials(): Promise<SteamApp[]> {
  try {
    const res = await fetch(STEAM_SPECIALS, {
      headers: { 'User-Agent': 'GameVibe/1.0' },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) throw new Error(`Steam ${res.status}`)
    const json = await res.json()
    // 从 featured categories 中提取 specials（打折）和 coming_soon（即将发售）
    const items: SteamApp[] = []
    const categories = json?.specials?.items || []
    const comingSoon = json?.coming_soon?.items || []
    items.push(...categories, ...comingSoon)
    return items.filter((a: SteamApp) => a.type === 'app' || !a.type)
  } catch (e) {
    console.warn('[News] Steam Store 获取失败:', e)
    return []
  }
}

// ── 公开方法 ───────────────────────────────────────

/** 最新发售的游戏（来自 RAWG，按发售日期倒序） */
export async function getRecentReleases(page = 1, pageSize = 20): Promise<{ items: NewsItem[]; total: number }> {
  const cacheKey = `releases_p${page}_${pageSize}`
  const cached = getCached<{ items: NewsItem[]; total: number }>(cacheKey)
  if (cached) return cached

  try {
    const data = await rawg<{
      results: RawgGame[]
      count: number
      next: string | null
    }>(`/games?dates=${getDateString(-90)},${getDateString(7)}&ordering=-released&page_size=${pageSize}&page=${page}`)

    const items: NewsItem[] = data.results.map((g) => ({
      id: `rawg_${g.id}`,
      source: 'rawg' as const,
      name: g.name,
      coverUrl: g.background_image || '',
      releaseDate: g.released || 'TBD',
      rating: Math.round(g.rating * 20), // 转换为百分制
      genres: g.genres.map((genre) => genre.name),
      platforms: g.platforms.map((p) => p.platform.name),
      url: `https://www.rawg.io/games/${g.slug}`,
      fetchedAt: Date.now(),
    }))

    const result = { items, total: data.count || 0 }
    setCache(cacheKey, result)
    return result
  } catch (e) {
    console.warn('[News] getRecentReleases 失败:', e)
    return { items: [], total: 0 }
  }
}

/** 即将发售的游戏 */
export async function getUpcoming(page = 1, pageSize = 20): Promise<{ items: NewsItem[]; total: number }> {
  const cacheKey = `upcoming_p${page}_${pageSize}`
  const cached = getCached<{ items: NewsItem[]; total: number }>(cacheKey)
  if (cached) return cached

  try {
    const data = await rawg<{
      results: RawgGame[]
      count: number
    }>(`/games?dates=${getDateString(0)},${getDateString(365)}&ordering=-added&page_size=${pageSize}&page=${page}`)

    const items: NewsItem[] = data.results.map((g) => ({
      id: `rawg_up_${g.id}`,
      source: 'rawg' as const,
      name: g.name,
      coverUrl: g.background_image || '',
      releaseDate: g.released || 'TBA',
      rating: undefined,
      genres: g.genres.map((genre) => genre.name),
      platforms: g.platforms.map((p) => p.platform.name),
      url: `https://www.rawg.io/games/${g.slug}`,
      fetchedAt: Date.now(),
    }))

    const result = { items, total: data.count || 0 }
    setCache(cacheKey, result)
    return result
  } catch (e) {
    console.warn('[News] getUpcoming 失败:', e)
    return { items: [], total: 0 }
  }
}

/** Steam 特价 + 即将发售 */
export async function getSteamNews(): Promise<NewsItem[]> {
  const cacheKey = 'steam_news'
  const cached = getCached<NewsItem[]>(cacheKey)
  if (cached) return cached

  const apps = await fetchSteamSpecials()
  const items: NewsItem[] = apps.slice(0, 15).map((app) => ({
    id: `steam_${app.id}`,
    source: 'steam' as const,
    name: app.name,
    coverUrl: app.header_image || app.large_capsule_image || '',
    releaseDate: '', // Steam specials 没有发售日期字段
    price: formatPrice(app.final_price),
    originalPrice: formatPrice(app.original_price),
    discount: app.discount_percent,
    genres: [],
    platforms: ['PC (Steam)'],
    url: `https://store.steampowered.com/app/${app.id}`,
    fetchedAt: Date.now(),
  }))

  setCache(cacheKey, items)
  return items
}

/** 综合聚合：合并所有来源的新游戏信息 */
export async function getAggregatedNews(): Promise<{
  recentReleases: NewsItem[]
  upcoming: NewsItem[]
  steamSpecials: NewsItem[]
}> {
  const [recentReleases, upcoming, steamSpecials] = await Promise.allSettled([
    getRecentReleases(1, 12),
    getUpcoming(1, 8),
    getSteamNews(),
  ])

  return {
    recentReleases: recentReleases.status === 'fulfilled' ? recentReleases.value.items : [],
    upcoming: upcoming.status === 'fulfilled' ? upcoming.value.items : [],
    steamSpecials: steamSpecials.status === 'fulfilled' ? steamSpecials.value : [],
  }
}

// ── 工具函数 ───────────────────────────────────────

/** 获取 N 天前/后的日期字符串 YYYY-MM-DD */
function getDateString(daysOffset: number): string {
  const d = new Date()
  d.setDate(d.getDate() + daysOffset)
  return d.toISOString().split('T')[0]
}

/** Steam 价格分转 ¥ 字符串（Steam 以分为单位） */
function formatPrice(cents: number): string {
  if (!cents || cents <= 0) return '免费'
  const yuan = cents / 100
  if (yuan < 1) return `¥${Math.round(yuan * 10) / 10}`
  return `¥${yuan.toFixed(0)}`
}
