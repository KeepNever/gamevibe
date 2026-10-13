// 游戏元信息解析：把 game_id（dc_ / rawg_ / 精选库 id）解析为名称 + 封面
// 供社交动态流 / 评论列表直接渲染，避免前端再做跨源查找
import { discoverCatalog } from '../data/discoverCatalog.ts'
import { catalog } from '../data/catalog.ts'

const dcMap = new Map(discoverCatalog.map((g) => [g.id, g]))
const catMap = new Map(catalog.map((g) => [g.id, g]))

export interface GameMeta {
  name: string
  coverUrl: string | null
}

export function resolveGameMeta(gameId: string): GameMeta {
  const dc = dcMap.get(gameId)
  if (dc) return { name: dc.name, coverUrl: dc.coverUrl || null }
  const cat = catMap.get(gameId)
  if (cat) return { name: cat.name, coverUrl: cat.coverUrl || null }
  return { name: gameId, coverUrl: null }
}
