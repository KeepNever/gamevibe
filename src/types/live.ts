export interface LiveGame {
  id: string
  name: string
  onlinePlayers: number
  twitchViewers: number
  delta: number
}

/** 每个指标「是否来自真实数据源」（false = 演示数据） */
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
  /** 数据来源说明 */
  source: string
  /** 逐指标真实 / 演示标记 */
  real: LiveRealFlags
  /** 实时在线覆盖情况（来自 Steam 官方接口；不可达时带 note） */
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

export interface SpotlightGame {
  id: string
  name: string
  reason: string
}

export interface SpotlightResult {
  ok: true
  aiPowered: boolean
  updatedAt: number
  text: string
  games: SpotlightGame[]
}

export interface AiReviewResult {
  ok: true
  aiPowered: boolean
  id: string
  name: string
  review: string
}

/** 口碑归纳（共识 / 分歧），引用均为库内真实评论原文 */
export interface DigestQuote {
  author: string
  rating: number | null
  text: string
}

export interface DigestTheme {
  theme: string
  summary: string
  quotes: DigestQuote[]
}

export interface ReviewDigestResult {
  ok: true
  aiPowered: boolean
  gameId: string
  name: string
  count: number
  average: number
  distribution: { stars: number; count: number }[]
  consensus: DigestTheme[]
  divergence: DigestTheme[]
  note?: string
  updatedAt: number
}

/** 今日趋势：定性解读（不含数字）+ 实时快照（数字由本地注入） */
export interface TrendHotGame {
  id: string
  name: string
  onlinePlayers: number
  delta: number
}

export interface AiTrendSnapshot {
  onlinePlayers: number
  streamingViewers: number
  newToday: number
  deals: number
  snapshotAt: number
  /** 各指标是否真实（false = 演示数据） */
  real: LiveRealFlags
  hot: TrendHotGame[]
}

export interface AiTrendResult {
  ok: true
  aiPowered: boolean
  source: string
  updatedAt: number
  text: string
  snapshot: AiTrendSnapshot
}

// ── Steam 评测（/api/reviews/steam/:gameId）──────────
// available=false 表示「真的没取到」，此时 summary 全 0、reviews 为空，reason 是中文原因。
// 后端已不再返回任何编造的「模拟数据」。
export interface SteamReviewSummary {
  totalPositive: number
  totalReviews: number
  reviewScore: number
  totalNegative?: number
}

export interface SteamReviewItem {
  id: string
  author: string
  playtime_forever: number
  playtime_last_two_weeks: number
  voteup: boolean
  language: string
  review: string
  rating: 'Recommended' | 'Not Recommended' | null
  created: number
}

export interface SteamReviewsResult {
  gameId: string
  steamAppId: string
  available: boolean
  reason?: string
  summary: SteamReviewSummary
  reviews: SteamReviewItem[]
  source: 'live' | 'unavailable'
  fetchedAt: number
}

// ── Steam 全球成就（/api/games/achievements/:gameId）──
export interface SteamAchievement {
  apiName: string
  name: string
  desc: string
  /** 全球解锁率（%）；Steam 未公布时为 null */
  percent: number | null
  iconUrl: string
  iconFallbackUrl: string
}

export interface AchievementBuckets {
  '0-10': number
  '10-25': number
  '25-50': number
  '50-75': number
  '75-100': number
  unknown: number
}

export interface AchievementDifficulty {
  key: 'easy' | 'medium' | 'hard' | 'brutal' | 'nightmare' | 'unknown'
  label: string
  note: string
}

export interface AchievementsResult {
  ok: boolean
  gameId: string
  appid: string
  reason?: string
  total: number
  rated: number
  avgPercent: number
  ceilingPercent: number
  /** 解锁率低于 10% 的成就占比（%，派生值） */
  rareRatio: number
  difficulty: AchievementDifficulty
  buckets: AchievementBuckets
  rarest: SteamAchievement[]
  items: SteamAchievement[]
  truncated: boolean
  fetchedAt: number
  source: 'steamcommunity'
  note: string
}
