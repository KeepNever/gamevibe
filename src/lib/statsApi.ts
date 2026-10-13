import { api } from './api'

export interface StatsSummary {
  wishlist: number
  playing: number
  completed: number
  favorites: number
  reviews: number
  recent: number
  totalLibrary: number
}

export interface StatsLibraryItem {
  id: string
  external_id: string | null
  name: string
  cover_url: string | null
  status: 'wishlist' | 'playing' | 'completed'
  added_at: number
  user_rating: number | null
}

export interface StatsRecentItem {
  game_id: string
  viewed_at: number
}

export interface StatsReviewItem {
  id: string
  game_id: string
  rating: number | null
  content: string | null
  created_at: number
}

export interface StatsResponse {
  summary: StatsSummary
  library: StatsLibraryItem[]
  recent: StatsRecentItem[]
  reviews: StatsReviewItem[]
}

export async function getMyStats(): Promise<StatsResponse> {
  const res = await api.get('/stats')
  return res.json()
}
