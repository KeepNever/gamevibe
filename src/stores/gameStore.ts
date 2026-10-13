import { defineStore } from 'pinia'
import type { Ref } from 'vue'
import { ref, computed } from 'vue'
import type { FilterState, SortKey, Genre, Platform, ChatMessage, ViewMode, Game } from '@/types/game'
import { games } from '@/data/games'
import { api, getToken } from '@/lib/api'
import { getReviewAggregate } from '@/lib/reviewApi'

export type CollectionKey = 'wishlist' | 'playing' | 'completed'

export const collectionMeta: Record<CollectionKey, { label: string; color: string }> = {
  wishlist: { label: '想玩', color: 'var(--color-accent)' },
  playing: { label: '在玩', color: 'var(--color-accent-cyan)' },
  completed: { label: '通关', color: 'var(--color-accent-green)' },
}

const defaultFilters: FilterState = {
  genres: [],
  platforms: [],
  priceRange: [0, 500],
  minRating: 0,
  search: '',
  sortBy: 'rating',
  sortOrder: 'desc',
}

function applyFilters(filters: FilterState): Game[] {
  const { genres, platforms, priceRange, minRating, search, sortBy, sortOrder } = filters

  let filtered = games.filter((g) => {
    if (genres.length > 0 && !genres.some((genre) => g.genres.includes(genre))) return false
    if (platforms.length > 0 && !platforms.some((p) => g.platforms.includes(p))) return false
    if (g.price < priceRange[0] || g.price > priceRange[1]) return false
    if (g.rating < minRating) return false
    if (search && !g.name.toLowerCase().includes(search.toLowerCase()) && !g.tags.some((t) => t.includes(search)))
      return false
    return true
  })

  filtered.sort((a, b) => {
    let cmp = 0
    switch (sortBy) {
      case 'rating': cmp = a.rating - b.rating; break
      case 'price': cmp = a.price - b.price; break
      case 'playerCount': cmp = a.playerCount - b.playerCount; break
      case 'releaseDate': cmp = new Date(a.releaseDate).getTime() - new Date(b.releaseDate).getTime(); break
      case 'name': cmp = a.name.localeCompare(b.name); break
    }
    return sortOrder === 'desc' ? -cmp : cmp
  })

  return filtered
}

// 后端同步（仅登录后触发）
async function syncCollection(kind: string, gameId: string, add: boolean) {
  if (!getToken()) return
  try {
    if (add) await api.post(`/collections/${kind}`, { gameId })
    else await api.del(`/collections/${kind}`, { gameId })
  } catch {
    /* ignore */
  }
}

async function syncRecent(gameId: string) {
  if (!getToken()) return
  try {
    await api.post('/collections/recent', { gameId })
  } catch {
    /* ignore */
  }
}

export const useGameStore = defineStore('game', () => {
  // State
  const filters = ref<FilterState>({ ...defaultFilters })
  const viewMode = ref<ViewMode>('grid')
  const compareIds = ref<string[]>([])
  const chatHistory = ref<ChatMessage[]>([])
  const favorites = ref<string[]>([])
  const collections = ref<Record<CollectionKey, string[]>>({
    wishlist: [],
    playing: [],
    completed: [],
  })
  const recentlyViewed = ref<string[]>([])

  // 社区评分聚合（真实平均分），由 Home/Explore 挂载时拉取
  const reviewStats = ref<Record<string, { avg: number; count: number }>>({})

  // Computed
  const filteredGames = computed(() => applyFilters(filters.value))

  // Actions — 筛选
  function setGenre(genre: Genre) {
    const exists = filters.value.genres.includes(genre)
    filters.value.genres = exists ? filters.value.genres.filter((g) => g !== genre) : [...filters.value.genres, genre]
  }
  function setPlatform(platform: Platform) {
    const exists = filters.value.platforms.includes(platform)
    filters.value.platforms = exists ? filters.value.platforms.filter((p) => p !== platform) : [...filters.value.platforms, platform]
  }
  function setPriceRange(range: [number, number]) { filters.value.priceRange = range }
  function setMinRating(rating: number) { filters.value.minRating = rating }
  function setSearch(search: string) { filters.value.search = search }
  function setSortBy(sortBy: SortKey) { filters.value.sortBy = sortBy }
  function setSortOrder(order: 'asc' | 'desc') { filters.value.sortOrder = order }
  function resetFilters() { Object.assign(filters.value, { ...defaultFilters }) }

  // Actions — 视图
  function setViewMode(mode: ViewMode) { viewMode.value = mode }

  // Actions — 对比
  function toggleCompare(id: string) {
    const idx = compareIds.value.indexOf(id)
    if (idx >= 0) compareIds.value.splice(idx, 1)
    else if (compareIds.value.length < 4) compareIds.value.push(id)
  }
  function clearCompare() { compareIds.value = [] }

  // Actions — 聊天
  function addChatMessage(msg: ChatMessage) { chatHistory.value.push(msg) }
  function clearChat() { chatHistory.value = [] }

  // Actions — 收藏
  function toggleFavorite(id: string) {
    const wasIn = collections.value.wishlist.includes(id)
    if (wasIn) collections.value.wishlist = collections.value.wishlist.filter((i) => i !== id)
    else collections.value.wishlist.push(id)
    favorites.value = [...collections.value.wishlist]
    syncCollection('wishlist', id, !wasIn)
  }

  function toggleCollection(col: CollectionKey, id: string) {
    const wasIn = collections.value[col].includes(id)
    if (wasIn) collections.value[col] = collections.value[col].filter((i) => i !== id)
    else collections.value[col].push(id)
    favorites.value = [...collections.value.wishlist]
    syncCollection(col, id, !wasIn)
  }

  function moveGame(id: string, from: CollectionKey, to: CollectionKey) {
    if (from === to) return
    collections.value[from] = collections.value[from].filter((i) => i !== id)
    if (!collections.value[to].includes(id)) collections.value[to].push(id)
    favorites.value = [...collections.value.wishlist]
  }

  // Actions — 最近浏览
  function addRecentlyViewed(id: string) {
    recentlyViewed.value = [id, ...recentlyViewed.value.filter((i) => i !== id)].slice(0, 8)
    syncRecent(id)
  }

  // 后端初始化同步
  async function initFromBackend() {
    if (!getToken()) return
    try {
      const [w, p, c, r] = await Promise.all([
        api.get('/collections/wishlist').then((x) => x.json()),
        api.get('/collections/playing').then((x) => x.json()),
        api.get('/collections/completed').then((x) => x.json()),
        api.get('/collections/recent').then((x) => x.json()),
      ])
      collections.value = {
        wishlist: (w.items || []).map((i: any) => i.external_id).filter(Boolean),
        playing: (p.items || []).map((i: any) => i.external_id).filter(Boolean),
        completed: (c.items || []).map((i: any) => i.external_id).filter(Boolean),
      }
      favorites.value = [...collections.value.wishlist]
      recentlyViewed.value = (r.items || []).map((i: any) => i.external_id).filter(Boolean)
    } catch {
      /* ignore */
    }
  }

  // 社区评分聚合（公开端点，登录/未登录均可用）
  async function loadReviewAggregate() {
    try {
      reviewStats.value = await getReviewAggregate()
    } catch {
      /* ignore */
    }
  }

  return {
    filters,
    viewMode,
    compareIds,
    chatHistory,
    favorites,
    collections,
    recentlyViewed,
    filteredGames,
    setGenre,
    setPlatform,
    setPriceRange,
    setMinRating,
    setSearch,
    setSortBy,
    setSortOrder,
    resetFilters,
    setViewMode,
    toggleCompare,
    clearCompare,
    addChatMessage,
    clearChat,
    toggleFavorite,
    toggleCollection,
    moveGame,
    addRecentlyViewed,
    initFromBackend,
    reviewStats,
    loadReviewAggregate,
  }
})
