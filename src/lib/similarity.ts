import type { Game } from '@/types/game'

/**
 * 基于「类型 + 标签 + 同厂商」重叠度计算相似游戏。
 * 不依赖外部 id（原数据的 similarGames 指向库外游戏，已弃用），
 * 始终能返回结果，适合纯前端演示。
 */
export function getSimilarGames(game: Game, all: Game[], limit = 6): Game[] {
  const score = (other: Game): number => {
    let s = 0
    for (const g of other.genres) if (game.genres.includes(g)) s += 2
    for (const t of other.tags) if (game.tags.includes(t)) s += 1
    if (other.developer === game.developer) s += 1.5
    return s
  }

  return all
    .filter((g) => g.id !== game.id)
    .map((g) => ({ g, s: score(g) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.g)
}
