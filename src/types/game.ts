import type { ChatSource, ChatWebMeta } from '@/lib/ai'

export interface Game {
  id: string
  name: string
  coverUrl: string
  bannerUrl: string
  developer: string
  publisher: string
  releaseDate: string
  price: number
  originalPrice: number
  discount: number
  platforms: Platform[]
  genres: Genre[]
  tags: string[]
  rating: number
  ratingCount: number
  description: string
  features: string[]
  systemRequirements: {
    minimum: string
    recommended: string
  }
  scores: {
    gameplay: number
    graphics: number
    story: number
    music: number
    replayability: number
    performance: number
  }
  playerCount: number // 当前在线
  peakToday: number
  trends: {
    daily: number[]
    weekly: number[]
  }
  similarGames: string[]
  steamUrl: string
  twitchViewers: number
  reviewsSummary: {
    positive: number
    negative: number
  }
}

export type Platform = 'Windows' | 'Mac' | 'Linux' | 'SteamDeck'

export type Genre =
  | '动作'
  | '冒险'
  | 'RPG'
  | '策略'
  | '模拟'
  | '体育'
  | '竞速'
  | '射击'
  | '生存'
  | '恐怖'
  | '休闲'
  | '独立'
  | '开放世界'
  | '多人'
  | 'FPS'
  | 'Roguelike'
  | '魂类'
  | '卡牌'
  | '音乐'
  | '解谜'
  | 'MMO'

export type SortKey = 'rating' | 'price' | 'playerCount' | 'releaseDate' | 'name'

export interface FilterState {
  genres: Genre[]
  platforms: Platform[]
  priceRange: [number, number]
  minRating: number
  search: string
  sortBy: SortKey
  sortOrder: 'asc' | 'desc'
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  games?: Game[] // AI 可能附带游戏推荐卡片
  /** 本轮从用户话里抽出的硬约束标签（如「价格 50 以内」），供 UI 展示「已按…筛选」 */
  constraints?: string[]
  /** 因目录内无匹配而被放宽掉的条件 */
  relaxed?: string[]
  /** 本次走的是哪条链路：constraint+llm / llm / rule / web+llm / web-rule */
  engine?: string | null
  /** 联网检索到的真实来源（标题/日期/链接来自接口原文） */
  sources?: ChatSource[]
  /** 本轮联网检索状态（未触发联网时为 null） */
  web?: ChatWebMeta | null
  timestamp: number
}

export type ViewMode = 'grid' | 'list'

/** 后端返回的用户信息（与 server/types.ts 对应） */
export interface AuthUser {
  id: string
  username: string
  email: string
  display_name: string | null
  avatar: string | null
  created_at: number
}
