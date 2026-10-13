// 后端共享类型定义

export interface User {
  id: string
  username: string
  email: string
  display_name: string | null
  avatar: string | null
  created_at: number
}

export type LibraryStatus = 'wishlist' | 'playing' | 'completed'

export interface UserLibraryItem {
  id: string
  user_id: string
  source: 'steam_scan' | 'manual' | 'catalog'
  external_id: string | null
  name: string
  cover_url: string | null
  install_path: string | null
  size_bytes: number | null
  last_played: number | null
  status: LibraryStatus
  user_rating: number | null
  note: string | null
  tags: string[]
  added_at: number
}

export interface ChatMessageRow {
  id: string
  user_id: string
  role: 'user' | 'assistant'
  content: string
  game_ids: string[]
  created_at: number
}

export interface JwtPayload {
  sub: string
  username: string
  iat: number
  exp: number
}

// AI 检索用的精简游戏目录（避免发送完整 Game）
export interface CatalogGame {
  id: string
  name: string
  genres: string[]
  tags: string[]
  rating: number
  price: number
  /** 封面图路径。gen-catalog.ts 生成时本就带此字段，此前接口漏声明导致 catalog.ts / gameMeta.ts 报错 */
  coverUrl: string
}
