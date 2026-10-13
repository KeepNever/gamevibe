import { api } from './api'

export interface ReviewItem {
  id: string
  user_id: string
  game_id: string
  rating: number | null
  content: string | null
  created_at: number
  username: string
  display_name: string | null
  avatar: string | null
}

export interface ReviewsResponse {
  reviews: ReviewItem[]
  average: number
  count: number
}

export async function getReviews(gameId: string, page = 1, pageSize = 50): Promise<ReviewsResponse> {
  const res = await api.get(`/reviews/${encodeURIComponent(gameId)}?page=${page}&pageSize=${pageSize}`)
  return res.json()
}

export async function getReviewAggregate(): Promise<Record<string, { avg: number; count: number }>> {
  const res = await api.get('/reviews/aggregate')
  return res.json()
}

export async function postReview(gameId: string, rating: number | null, content: string) {
  const res = await api.post('/reviews', { gameId, rating, content })
  return res.json()
}

export async function updateReview(id: string, rating: number | null, content: string) {
  const res = await api.put(`/reviews/${id}`, { rating, content })
  return res.json()
}

export async function deleteReview(id: string) {
  const res = await api.del(`/reviews/${id}`)
  return res.json()
}

export async function getUserReviews(userId: string): Promise<ReviewItem[]> {
  const res = await api.get(`/reviews/user/${userId}`)
  const d = await res.json()
  return d.reviews as ReviewItem[]
}

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return '刚刚'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} 分钟前`
  const hour = Math.floor(min / 60)
  if (hour < 24) return `${hour} 小时前`
  const day = Math.floor(hour / 24)
  if (day < 30) return `${day} 天前`
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
