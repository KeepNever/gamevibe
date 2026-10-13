// 社交系统前端 API 封装
import { api } from '@/lib/api'

export interface SocialUser {
  id: string
  username: string
  display_name: string | null
  avatar: string | null
  created_at: number
  review_count?: number
  library_count?: number
  is_following?: boolean
}

export type FeedItem =
  | {
      type: 'review'
      id: string
      user: SocialUser
      gameId: string
      gameName: string
      gameCover: string | null
      rating: number | null
      content: string | null
      created_at: number
    }
  | {
      type: 'library'
      id: string
      user: SocialUser
      gameId: string | null
      gameName: string
      status: string
      created_at: number
    }

export interface FeedResponse {
  feed: FeedItem[]
  discovery: boolean
  message?: string
}

export async function getSocialUsers(limit = 12, exclude?: string): Promise<SocialUser[]> {
  const q = new URLSearchParams({ limit: String(limit) })
  if (exclude) q.set('exclude', exclude)
  const res = await api.get(`/social/users?${q}`)
  return (await res.json()).users
}

export async function followUser(userId: string) {
  const res = await api.post('/social/follow', { userId })
  return res.json()
}

export async function unfollowUser(userId: string) {
  const res = await api.del(`/social/follow/${encodeURIComponent(userId)}`)
  return res.json()
}

export async function checkFollowing(userIds: string[]): Promise<Record<string, boolean>> {
  try {
    const res = await api.post('/social/check', { userIds })
    return (await res.json()).follows || {}
  } catch {
    return {}
  }
}

export async function getFollowing(userId: string): Promise<SocialUser[]> {
  const res = await api.get(`/social/following/${encodeURIComponent(userId)}`)
  return (await res.json()).following
}

export async function getFollowers(userId: string): Promise<SocialUser[]> {
  const res = await api.get(`/social/followers/${encodeURIComponent(userId)}`)
  return (await res.json()).followers
}

export async function getFeed(limit = 20): Promise<FeedResponse> {
  const res = await api.get(`/social/feed?limit=${limit}`)
  return res.json()
}

// ═══ 用户主页 ═══
export interface UserReview {
  id: string
  gameId: string
  gameName: string
  gameCover: string | null
  rating: number | null
  content: string | null
  created_at: number
}

export interface UserLibraryItem {
  id: string
  gameId: string | null
  name: string
  status: string
  coverUrl: string | null
  added_at: number
}

export interface UserProfile {
  user: SocialUser & {
    bio: string | null
    followerCount: number
    followingCount: number
    reviewCount: number
    libraryCount: number
    isFollowing: boolean
  }
  reviews: UserReview[]
  library: UserLibraryItem[]
  statusDistribution: Record<string, number>
}

export async function getUserProfile(id: string): Promise<UserProfile> {
  const res = await api.get(`/social/users/${encodeURIComponent(id)}`)
  return res.json()
}

// ═══ 通知 ═══
export interface AppNotification {
  id: string
  type: string
  ref_id: string | null
  read: number
  created_at: number
  actor_id: string
  username: string
  display_name: string | null
  avatar: string | null
}

export interface NotificationResponse {
  notifications: AppNotification[]
  unread: number
}

export async function getNotifications(limit = 30): Promise<NotificationResponse> {
  const res = await api.get(`/social/notifications?limit=${limit}`)
  return res.json()
}

export async function markNotificationRead(id: string) {
  const res = await api.post(`/social/notifications/${encodeURIComponent(id)}/read`)
  return res.json()
}

export async function markAllNotificationsRead() {
  const res = await api.post('/social/notifications/read-all')
  return res.json()
}

// ═══ 好友在玩 ═══
export interface FriendPlaying {
  id: string
  display_name: string | null
  avatar: string | null
  status: string
  added_at: number
}

export async function getFriendsPlaying(gameId: string): Promise<{ friends: FriendPlaying[]; count: number }> {
  try {
    const res = await api.get(`/social/games/${encodeURIComponent(gameId)}/friends`)
    return res.json()
  } catch {
    return { friends: [], count: 0 }
  }
}
