import type { Game, Genre } from '@/types/game'
import type { CollectionKey } from '@/stores/gameStore'
import { games } from '@/data/games'

export interface CollectionState {
  collections: Record<CollectionKey, string[]>
  recentlyViewed: string[]
  compareIds: string[]
}

export interface WrappedStats {
  year: number
  exploredCount: number
  genreCounts: { genre: Genre; count: number }[]
  topGenres: { genre: Genre; count: number; pct: number }[]
  persona: { key: string; title: string; emoji: string; desc: string }
  topRated: Game | null
  savedMoney: number
  libraryValue: number
  collections: { wishlist: number; playing: number; completed: number }
  completionRate: number
  comparedCount: number
  facts: string[]
}

const HARDCORE: Genre[] = ['动作', '魂类', 'FPS', '射击', 'Roguelike', '多人']
const CHILL: Genre[] = ['独立', '休闲', '解谜', '音乐', '模拟', '冒险']
const RPG: Genre[] = ['RPG', '开放世界', 'MMO']
const STRAT: Genre[] = ['策略', '卡牌']

function inCat(genre: Genre, cat: Genre[]): boolean {
  return cat.includes(genre)
}

interface Persona {
  key: string
  title: string
  emoji: string
  desc: string
  score: (s: {
    hardcore: number
    chill: number
    rpg: number
    strat: number
    total: number
    completed: number
    wishlist: number
    explored: number
  }) => number
}

const PERSONAS: Persona[] = [
  {
    key: 'completer',
    title: '通关达人',
    emoji: '🏆',
    desc: '你的清单上通关数遥遥领先，从不半途而废。游戏在你手里，没有「弃坑」二字。',
    score: (s) => (s.completed >= 3 ? 60 + s.completed * 6 : s.completed * 8),
  },
  {
    key: 'hardcore',
    title: '硬核动作党',
    emoji: '⚔️',
    desc: '魂类、动作、射击是你的主场。难度越高你越兴奋，手柄都被你搓出了火星。',
    score: (s) => (s.total ? (s.hardcore / s.total) * 100 : 0),
  },
  {
    key: 'healer',
    title: '治愈系玩家',
    emoji: '🌿',
    desc: '独立、休闲、解谜构成了你的游戏时光。你玩游戏，是为了在忙碌一天后喘口气。',
    score: (s) => (s.total ? (s.chill / s.total) * 100 : 0),
  },
  {
    key: 'strategist',
    title: '策略大脑',
    emoji: '🧠',
    desc: '卡牌、策略让你着迷。你享受在棋盘与战局里算无遗策的掌控感。',
    score: (s) => (s.total ? (s.strat / s.total) * 120 : 0),
  },
  {
    key: 'collector',
    title: '收藏大师',
    emoji: '📚',
    desc: '你的「想玩」清单长得看不到头。买游戏如藏书，快乐在于拥有，而非通关。',
    score: (s) => (s.wishlist >= 4 && s.wishlist >= s.completed * 2 ? 55 + s.wishlist * 4 : 0),
  },
  {
    key: 'explorer',
    title: '云玩家探索者',
    emoji: '🔍',
    desc: '你逛了好多游戏却很少下手，是标准的「云玩家」。下一款，会不会就是你的本命？',
    score: (s) => (s.explored >= 5 && s.completed === 0 && s.wishlist <= 1 ? 70 : 0),
  },
]

export function computeWrapped(state: CollectionState): WrappedStats {
  const { collections, recentlyViewed, compareIds } = state
  const touchedIds = new Set<string>([
    ...collections.wishlist,
    ...collections.playing,
    ...collections.completed,
    ...recentlyViewed,
  ])
  const myGames = games.filter((g) => touchedIds.has(g.id))
  const exploredCount = touchedIds.size

  // 类型频次
  const genreMap = new Map<Genre, number>()
  for (const g of myGames) {
    for (const genre of g.genres) {
      genreMap.set(genre, (genreMap.get(genre) ?? 0) + 1)
    }
  }
  const genreCounts = [...genreMap.entries()]
    .map(([genre, count]) => ({ genre, count }))
    .sort((a, b) => b.count - a.count)
  const maxCount = genreCounts[0]?.count ?? 1
  const topGenres = genreCounts.slice(0, 3).map((g) => ({
    ...g,
    pct: Math.round((g.count / maxCount) * 100),
  }))

  // 类别占比
  let hardcore = 0
  let chill = 0
  let rpg = 0
  let strat = 0
  for (const g of myGames) {
    for (const genre of g.genres) {
      if (inCat(genre, HARDCORE)) hardcore++
      else if (inCat(genre, CHILL)) chill++
      else if (inCat(genre, RPG)) rpg++
      else if (inCat(genre, STRAT)) strat++
    }
  }
  const catTotal = hardcore + chill + rpg + strat

  // 人格
  let best = PERSONAS[PERSONAS.length - 1]
  let bestScore = -1
  for (const p of PERSONAS) {
    const sc = p.score({
      hardcore,
      chill,
      rpg,
      strat,
      total: catTotal,
      completed: collections.completed.length,
      wishlist: collections.wishlist.length,
      explored: exploredCount,
    })
    if (sc > bestScore) {
      bestScore = sc
      best = p
    }
  }

  // 神作
  const topRated = myGames.length
    ? [...myGames].sort((a, b) => b.rating - a.rating)[0]
    : null

  // 省钱 / 库价值
  const ownedIds = new Set<string>([
    ...collections.wishlist,
    ...collections.playing,
    ...collections.completed,
  ])
  const ownedGames = games.filter((g) => ownedIds.has(g.id))
  const savedMoney = ownedGames.reduce((sum, g) => sum + (g.originalPrice - g.price), 0)
  const libraryValue = ownedGames.reduce((sum, g) => sum + g.price, 0)

  const coll = {
    wishlist: collections.wishlist.length,
    playing: collections.playing.length,
    completed: collections.completed.length,
  }
  const collTotal = coll.wishlist + coll.playing + coll.completed
  const completionRate = collTotal ? Math.round((coll.completed / collTotal) * 100) : 0

  // 趣味事实
  const facts: string[] = []
  if (topGenres[0]) facts.push(`你对「${topGenres[0].genre}」类游戏最上头`)
  if (topRated) facts.push(`年度神作是《${topRated.name}》，给了 ${topRated.rating} 分`)
  if (coll.completed > 0) facts.push(`通关了 ${coll.completed} 款，清单完成度 ${completionRate}%`)
  if (savedMoney > 0) facts.push(`靠折扣省下了 ¥${savedMoney}`)
  if (compareIds.length > 0) facts.push(`认真对比过 ${compareIds.length} 款游戏`)

  return {
    year: new Date().getFullYear(),
    exploredCount,
    genreCounts,
    topGenres,
    persona: { key: best.key, title: best.title, emoji: best.emoji, desc: best.desc },
    topRated,
    savedMoney,
    libraryValue,
    collections: coll,
    completionRate,
    comparedCount: compareIds.length,
    facts,
  }
}
