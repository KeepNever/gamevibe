// 实时数据 + AI 精选/点评 的前端访问封装（通过 Vite 代理走 /api）
import { api } from '@/lib/api'
import type {
  LiveStats,
  SpotlightResult,
  AiReviewResult,
  ReviewDigestResult,
  AiTrendResult,
  AchievementsResult,
  SteamReviewsResult,
} from '@/types/live'

export async function getLiveStats(): Promise<LiveStats> {
  const res = await api.get('/live')
  return res.json()
}

export async function getAiSpotlight(): Promise<SpotlightResult> {
  const res = await api.get('/ai/spotlight')
  return res.json()
}

export async function getAiReview(id: string): Promise<AiReviewResult> {
  const res = await api.get(`/ai/review?id=${encodeURIComponent(id)}`)
  return res.json()
}

export async function getAiReviewDigest(gameId: string): Promise<ReviewDigestResult> {
  const res = await api.get(`/ai/reviewDigest?gameId=${encodeURIComponent(gameId)}`)
  return res.json()
}

export async function getAiTrend(): Promise<AiTrendResult> {
  const res = await api.get('/ai/trend')
  return res.json()
}

/** Steam 全球成就数据。后端始终 200，用 ok 标记是否真取到；取不到时 items 为空并带中文 reason。 */
export async function getAchievements(gameId: string): Promise<AchievementsResult> {
  const res = await api.get(`/games/achievements/${encodeURIComponent(gameId)}`)
  return res.json()
}

/** Steam 评测。后端始终 200，用 available 标记是否真取到（不再有编造的模拟数据）。 */
export async function getSteamReviews(gameId: string): Promise<SteamReviewsResult> {
  const res = await api.get(`/reviews/steam/${encodeURIComponent(gameId)}`)
  return res.json()
}
