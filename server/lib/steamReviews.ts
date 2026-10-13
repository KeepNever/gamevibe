// Steam 评测 / 评测摘要获取模块
//
// 数据源（只有真实来源，**没有任何编造数据**）：
//   1. https://store.steampowered.com/appreviews/{appid} — 真实评测摘要 + 样本评论
//   2. https://store.steampowered.com/api/appdetails?appids={appid} — 游戏基础信息
//
// ⚠️ 2026-09-24 变更：删除了原先的 MOCK_DB（7 款游戏的「仿真」评论）与 genericMock()
//   （随机好评率 / 随机评测数 / 随机作者名）。理由：那些数字与文案是编造的，却会被用户
//   当成真实 Steam 数据读；带一个「模拟数据」小角标不足以抵消误解，细节越像真的越容易骗到人。
//   现在取不到就如实说「取不到」——summary 全 0、reviews 为空、available=false + 中文原因，
//   与全项目「取不到就说不取到，绝不假装」的口径一致。
//
// 用法：getSteamReviews(appid) → SteamReviewsResult
//      getSteamSummary(appid) → 摘要（不可用时 null）

import { resolveSteamAppId } from './steamAppIds.ts'

const STEAM_REVIEWS_URL = 'https://store.steampowered.com/appreviews'
const STEAM_DETAILS_URL = 'https://store.steampowered.com/api/appdetails'
const CACHE_TTL = 15 * 60 * 1000 // 成功结果缓存 15 分钟
const FAIL_TTL = 3 * 60 * 1000 // 失败结果短缓存 3 分钟，避免线上抖动时被反复锤
const FETCH_TIMEOUT = 9000

const cache = new Map<string, { data: unknown; until: number }>()

function get<T>(k: string): T | undefined {
  const e = cache.get(k)
  if (e && Date.now() < e.until) return e.data as T
  cache.delete(k)
  return undefined
}
function set(k: string, v: unknown, ttl = CACHE_TTL): void {
  cache.set(k, { data: v, until: Date.now() + ttl })
}

// ── 类型定义 ────────────────────────────────────────
export interface SteamReviewSummary {
  totalPositive: number
  totalReviews: number
  reviewScore: number // 0~1 正面评价占比
  totalNegative?: number
}

export interface SteamReviewItem {
  id: string
  author: string // Steam 用户名
  playtime_forever: number // 总游玩时间(分钟)
  playtime_last_two_weeks: number
  voteup: boolean // 有用投票
  language: string
  review: string // 评论正文
  rating: 'Recommended' | 'Not Recommended' | null
  created: number // unix timestamp
}

export interface SteamReviewsResult {
  gameId: string
  steamAppId: string
  /** 是否真的从 Steam 拿到了数据。false 时 summary 恒为全 0、reviews 恒为空 —— 不做任何填充 */
  available: boolean
  /** available=false 时的中文原因，前端照实展示 */
  reason?: string
  summary: SteamReviewSummary
  reviews: SteamReviewItem[]
  source: 'live' | 'unavailable'
  fetchedAt: number
}

const EMPTY_SUMMARY: SteamReviewSummary = {
  totalPositive: 0,
  totalReviews: 0,
  reviewScore: 0,
  totalNegative: 0,
}

function unavailable(appid: string | number, gameId: string, reason: string): SteamReviewsResult {
  return {
    gameId,
    steamAppId: String(appid),
    available: false,
    reason,
    summary: { ...EMPTY_SUMMARY },
    reviews: [],
    source: 'unavailable',
    fetchedAt: Date.now(),
  }
}

// ── 网络请求 ────────────────────────────────────────
async function jsonFetch(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'GameVibe/1.0', 'Accept-Language': 'zh-CN,zh;q=0.9' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  })
  if (!res.ok) throw new Error(`Steam HTTP ${res.status}`)
  return res.json()
}

function describeError(e: unknown): string {
  const code = (e as any)?.cause?.code || (e as any)?.code
  const msg = (e as Error)?.message || String(e)
  if (code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ETIMEDOUT' || /timeout/i.test(msg)) {
    return '连接 Steam 超时（当前网络环境可能无法访问 store.steampowered.com）'
  }
  if (code === 'ECONNRESET' || code === 'ECONNREFUSED') return '连接被重置（该域名在当前网络环境不可达）'
  if (/^Steam HTTP 5/.test(msg)) return `Steam 服务端错误（${msg}）`
  return `请求失败：${msg}`
}

// ── 真实数据获取 ─────────────────────────────────────
async function fetchLiveReviews(appid: string, gameId: string): Promise<SteamReviewsResult> {
  try {
    const [reviewData, detailData] = await Promise.all([
      jsonFetch(
        `${STEAM_REVIEWS_URL}/${appid}?json=1&purchase_type=all&language=schinese&num_per_page=6&review_type=all`,
      ),
      jsonFetch(`${STEAM_DETAILS_URL}?appids=${appid}&l=english`).catch(() => null),
    ])

    // Steam 对下架 / 地区受限的 appid 会返回 200 + success:false
    if (reviewData?.success === false) {
      return unavailable(appid, gameId, 'Steam 未返回该游戏的评测数据（可能已下架或当前地区不可见）')
    }

    const qs = reviewData?.query_summary
    const items: SteamReviewItem[] = (reviewData?.reviews || []).map((r: any, i: number) => ({
      id: String(r.recommendationid || r.author?.steamid || `${appid}-${i}`),
      author: r.author?.display_name || r.author?.steamid || 'Steam 用户',
      playtime_forever: r.author?.playtime_forever || 0,
      playtime_last_two_weeks: r.author?.playtime_last_two_weeks || 0,
      voteup: r.votes_up || false,
      language: r.language || '',
      review: r.review || '',
      rating: r.voted_up ? 'Recommended' : 'Not Recommended',
      created: r.timestamp_created || 0,
    }))

    // detailData 只用于确认这个 appid 确实是款游戏；取不到不影响评测本身
    const details = detailData?.[appid]?.data

    // 好评率直接用 total_positive / total_reviews 算真实比值。
    // Steam 自己还有个 review_score（0–9 档，如 9 = 好评如潮），那是**分档不是百分比**，
    // 折算成 89% 会和同一张卡片里的 227.1K / 250.4K 对不上，看着就假 —— 只在前者缺失时兜底。
    const totalReviews = qs?.total_reviews || 0
    const totalPositive = qs?.total_positive || 0
    const score = totalReviews > 0 ? totalPositive / totalReviews : qs?.review_score ? qs.review_score / 9 : 0

    const summary: SteamReviewSummary = {
      totalPositive,
      totalReviews,
      reviewScore: Number(score.toFixed(4)),
      totalNegative: qs?.total_negative || 0,
    }

    const note = !details && summary.totalReviews === 0 ? 'Steam 未返回该游戏的详情与评测' : undefined
    if (note) return unavailable(appid, gameId, note)

    return {
      gameId,
      steamAppId: appid,
      available: true,
      summary,
      reviews: items.filter((r) => r.review),
      source: 'live',
      fetchedAt: Date.now(),
    }
  } catch (e) {
    console.warn('[Steam] fetchLiveReviews 失败:', (e as Error).message)
    return unavailable(appid, gameId, describeError(e))
  }
}

// ══════════ 公开 API ══════════

/** 获取某款游戏的 Steam 评测（带缓存）。取不到时返回 available=false，绝不用编造数据填充。 */
export async function getSteamReviews(appid: string | number, gameId?: string): Promise<SteamReviewsResult> {
  const id = String(appid)
  const gid = gameId || `dc_steam_${id}`
  const key = `steam_reviews_${id}`
  const cached = get<SteamReviewsResult>(key)
  if (cached) return cached

  const result = await fetchLiveReviews(id, gid)
  set(key, result, result.available ? CACHE_TTL : FAIL_TTL)
  return result
}

/** 按站内 gameId 取 Steam 评测；本站未映射 Steam appid 时返回 available=false（不猜 appid） */
export async function getSteamReviewsByGameId(gameId: string): Promise<SteamReviewsResult> {
  const appid = resolveSteamAppId(gameId)
  if (!appid) {
    return {
      gameId,
      steamAppId: '',
      available: false,
      reason: '本站目录里这款游戏没有对应的 Steam 版本（如主机独占、手游或网页游戏）',
      summary: { ...EMPTY_SUMMARY },
      reviews: [],
      source: 'unavailable',
      fetchedAt: Date.now(),
    }
  }
  return getSteamReviews(appid, gameId)
}

/** 仅获取评测摘要（轻量，用于卡片展示）；不可用时返回 null */
export async function getSteamSummary(appid: string | number): Promise<SteamReviewSummary | null> {
  const result = await getSteamReviews(appid)
  return result.available ? result.summary : null
}
