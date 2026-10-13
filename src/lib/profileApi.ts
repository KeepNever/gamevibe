// 玩家画像客户端：读取后端 /api/ai/profile（需登录）
// 运行期不调用 LLM——画像只从已冻结的游戏语义批次只读推导
import { api } from './api'

export interface EnumPref {
  value: string
  weight: number
}

export interface ProfileDim {
  key: string
  label: string
  value: number
  level: 'high' | 'mid' | 'low'
}

export interface BasisGame {
  id: string
  name: string
  via: string
  weight: number
}

export interface ProfileSource {
  batchId: string | null
  model: string | null
  promptVersion: string | null
  generatedAt: number | null
  coveredGames: number
  totalGames: number
  degraded: boolean
}

export interface AiProfile {
  ok: boolean
  coldStart: boolean
  sampleSize: number
  windowDays: number
  /** 长期四维分值 */
  dims: Record<string, number>
  dimsDetail: ProfileDim[]
  /** 近期四维分值（可能为 null） */
  recentDims: Record<string, number> | null
  prefs: {
    coreGameplay: EnumPref[]
    multiplayer: EnumPref[]
    estimatedLength: EnumPref[]
  }
  genres: string[]
  tags: string[]
  basis: { longTerm: BasisGame[]; recent: BasisGame[] }
  source: ProfileSource
}

/** 拉取当前登录用户的口味画像（未登录会 401，调用方自行降级） */
export async function getAiProfile(): Promise<AiProfile> {
  const res = await api.get('/ai/profile')
  return res.json()
}
