import { api } from './api'

/** 命中的画像维度（含中文标签，来自后端 DIM_LABEL） */
export interface MatchedDim {
  key: string
  label: string
}

/** 口味画像明细维度（1-5 分 + 中文标签） */
export interface TasteDim {
  key: string
  label: string
  value: number
}

/** 近期（或长期）依据游戏 */
export interface BasisGame {
  id: string
  name: string
  via: string
  weight: number
}

export interface TasteProfile {
  genres: string[]
  tags: string[]
  /** 四维分值：story/difficulty/exploration/combat */
  dims?: Record<string, number>
  dimsDetail?: TasteDim[]
  recentDims?: Record<string, number> | null
  coreGameplay?: string[]
  basis?: BasisGame[]
  sampleSize?: number
}

export interface RecommendItem {
  id: string
  name: string
  score: number
  reason: string
  /** 画像驱动时的匹配度（0-100） */
  match?: number
  /** 四维贴合度 */
  dimsFit?: Record<string, number>
  /** 命中的核心玩法 */
  matchedCore?: string[]
  /** 命中的画像维度（含中文标签） */
  matchedDims?: MatchedDim[]
}

export interface RecommendResponse {
  mode: 'personalized' | 'similar' | 'fallback' | 'cold'
  personalized: boolean
  /** 排序引擎：profile-semantic（画像语义）/ genre-weighted（旧口径兜底） */
  engine?: string
  taste?: TasteProfile
  recommendations: RecommendItem[]
}

// 个性化推荐（无 seed）/ 基于某游戏的相似推荐（带 seed，匿名可用）
export async function getRecommendations(seed?: string): Promise<RecommendResponse> {
  const url = seed ? `/recommendations?seed=${encodeURIComponent(seed)}` : '/recommendations'
  const res = await api.get(url)
  return res.json()
}
