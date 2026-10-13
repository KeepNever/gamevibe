// 多平台发现库（RAWG / 本地兜底）的轻量游戏类型
// 与后端 RawgGameLite 字段一致；不携带精选库的深度字段（评分雷达/趋势等）
export interface DiscoverGame {
  id: string
  name: string
  coverUrl: string
  /** 首图加载失败时的备选封面（如 Steam 竖版资源缺失时回退横版） */
  coverFallbackUrl?: string
  rating: number // 百分制 0-100
  ratingCount: number
  releaseDate: string
  platforms: string[]
  genres: string[]
  tags: string[]
  description: string
  rawgUrl: string
  metacritic: number | null
  developer: string
  priceLabel: string
}

// ── 各平台官方榜单直连（server/lib/platformCatalog.ts）──
export type PlatformKey = 'steam' | 'playstation' | 'nintendo' | 'xbox'

export interface PlatformGame {
  id: string
  name: string
  coverUrl: string
  coverFallbackUrl?: string
  /** 是否竖版封面 */
  portrait: boolean
  /** 封面原图宽高比（宽÷高），前端据此给卡片定画幅 */
  artRatio: number
  platform: PlatformKey
  platformLabel: string
  /** 官方标注的可玩平台 */
  platforms: string[]
  releaseDate: string
  priceLabel: string
  genres: string[]
  tags: string[]
  bucket: string
  /** 该平台内的分组名，如「特价」「最新上架」 */
  bucketLabel: string
  storeUrl: string
}

export interface PlatformFeed {
  key: PlatformKey
  label: string
  ok: boolean
  /** 失败原因（中文说明），前端如实展示，不假装有数据 */
  error?: string
  latencyMs: number
  /** 该平台封面的统一画幅（宽÷高） */
  artRatio: number
  /** 画幅来源说明，如「Steam 官方胶囊图 616×353」 */
  artNote: string
  items: PlatformGame[]
}

export interface PlatformMeta {
  key: PlatformKey
  label: string
  /** 官方接口地址，用于标注数据出处 */
  source: string
  provides: string
}

export interface PlatformsResponse {
  feeds: PlatformFeed[]
  meta: PlatformMeta[]
  updatedAt: string
  note: string
}

// 多平台筛选维度（与后端 DISPLAY_TO_SLUG 对应）
export const DISCOVER_PLATFORMS = [
  'PC',
  'Xbox',
  'PlayStation',
  'Nintendo Switch',
  '移动端',
  '网页',
] as const

export type DiscoverPlatform = (typeof DISCOVER_PLATFORMS)[number]
