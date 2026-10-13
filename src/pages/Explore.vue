<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  Search, Grid3X3, List, X, RotateCcw, PanelLeftClose, PanelLeft,
  Compass, Library as LibraryIcon, Loader2, Radio, TriangleAlert, ExternalLink, RefreshCw,
} from 'lucide-vue-next'
import { useGameStore } from '@/stores/gameStore'
import { genreList, platformList, sortOptions } from '@/data/games'
import GameCard from '@/components/GameCard.vue'
import DiscoverCard from '@/components/DiscoverCard.vue'
import PlatformGameCard from '@/components/PlatformGameCard.vue'
import EmptyState from '@/components/EmptyState.vue'
import MotionGrid from '@/components/MotionGrid.vue'
import FilterSection from '@/components/FilterSection.vue'
import type { Genre, Platform, ViewMode } from '@/types/game'
import { getDiscover, searchGames } from '@/lib/discoverApi'
import type { DiscoverGame, PlatformFeed, PlatformKey } from '@/types/discover'
import { DISCOVER_PLATFORMS } from '@/types/discover'
import { getPlatformBundle } from '@/lib/platformApi'

const route = useRoute()
const store = useGameStore()
const sidebarOpen = ref(false)

// ── 模式：精选库 / 多平台发现 ──────────────────────
type ExploreMode = 'curated' | 'discover'
const mode = ref<ExploreMode>('discover')

// ── 精选库（本地 16 款）──
const hasFilters = computed(
  () =>
    store.filters.genres.length > 0 ||
    store.filters.platforms.length > 0 ||
    store.filters.priceRange[0] > 0 ||
    store.filters.priceRange[1] < 500 ||
    store.filters.minRating > 0 ||
    store.filters.search !== '',
)

const presets = computed(() => [
  {
    id: 'free',
    label: '🆓 免费',
    active: store.filters.priceRange[0] === 0 && store.filters.priceRange[1] === 0,
    toggle: () => (store.filters.priceRange[1] === 0 ? store.setPriceRange([0, 500]) : store.setPriceRange([0, 0])),
  },
  {
    id: 'top',
    label: '⭐ 9分+',
    active: store.filters.minRating === 9,
    toggle: () => store.setMinRating(store.filters.minRating === 9 ? 0 : 9),
  },
  {
    id: 'players',
    label: '🔥 最多在线',
    active: store.filters.sortBy === 'playerCount',
    toggle: () => store.setSortBy('playerCount'),
  },
  {
    id: 'new',
    label: '🆕 最新发布',
    active: store.filters.sortBy === 'releaseDate',
    toggle: () => store.setSortBy('releaseDate'),
  },
  {
    id: 'cheap',
    label: '💰 50以下',
    active: store.filters.priceRange[0] === 0 && store.filters.priceRange[1] === 50,
    toggle: () => (store.filters.priceRange[1] === 50 ? store.setPriceRange([0, 500]) : store.setPriceRange([0, 50])),
  },
])

const priceQuickButtons = [100, 300]

// ── 多平台发现 ───────────────────────────────────
const discoverQuery = ref('')
const discoverPlatforms = ref<string[]>([])
const discoverGames = ref<DiscoverGame[]>([])
const discoverPage = ref(1)
const discoverPageSize = 40
const discoverLoading = ref(false)
const discoverHasMore = ref(true)
const discoverError = ref('')
// 结果总数由后端给出（本地分页时等于目录条数），用于顶部计数与「已加载 N / 共 M」
const discoverTotal = ref(0)
const suggestions = ref<DiscoverGame[]>([])
const showSuggest = ref(false)
let suggestTimer: ReturnType<typeof setTimeout> | undefined

function buildParams(page: number) {
  return {
    q: discoverQuery.value.trim(),
    platforms: discoverPlatforms.value,
    page,
    pageSize: discoverPageSize,
  }
}

async function loadDiscover(reset = false) {
  if (discoverLoading.value) return
  if (reset) {
    discoverPage.value = 1
    discoverGames.value = []
    discoverHasMore.value = true
    discoverError.value = ''
  }
  discoverLoading.value = true
  try {
    const res = await getDiscover(buildParams(discoverPage.value))
    if (reset) discoverGames.value = res.games
    else discoverGames.value.push(...res.games)
    discoverTotal.value = res.count || discoverGames.value.length
    discoverHasMore.value = res.games.length >= discoverPageSize && res.next !== null
  } catch {
    discoverError.value = '加载失败，请稍后重试'
  } finally {
    discoverLoading.value = false
  }
}

function loadMore() {
  if (discoverHasMore.value && !discoverLoading.value) {
    discoverPage.value += 1
    loadDiscover(false)
  }
}

function toggleDiscoverPlatform(p: string) {
  const i = discoverPlatforms.value.indexOf(p)
  if (i >= 0) discoverPlatforms.value.splice(i, 1)
  else discoverPlatforms.value.push(p)
  loadDiscover(true)
}

// 一键清空搜索与平台筛选——有筛选条件时才显示按钮
const hasDiscoverFilters = computed(
  () => discoverPlatforms.value.length > 0 || discoverQuery.value.trim().length > 0,
)

function clearDiscoverFilters() {
  discoverPlatforms.value = []
  discoverQuery.value = ''
  suggestions.value = []
  showSuggest.value = false
  loadDiscover(true)
}

function onDiscoverInput() {
  showSuggest.value = true
  if (suggestTimer) clearTimeout(suggestTimer)
  suggestTimer = setTimeout(async () => {
    try {
      suggestions.value = await searchGames(discoverQuery.value)
    } catch {
      suggestions.value = []
    }
  }, 350)
}

function applySearch() {
  showSuggest.value = false
  suggestions.value = []
  loadDiscover(true)
}

function pickSuggestion(g: DiscoverGame) {
  discoverQuery.value = g.name
  showSuggest.value = false
  suggestions.value = []
  loadDiscover(true)
}

function onModeChange(m: ExploreMode) {
  mode.value = m
  if (m === 'discover') {
    if (discoverGames.value.length === 0) loadDiscover(true)
    if (!platformFeeds.value.length && !platformLoading.value) loadPlatforms()
  }
}

// ── 各平台官方榜单直连 ──────────────────────────────
// 这一块回答的是「除了 Steam，Switch / PS / Xbox 的内容能不能拿到」——
// 四个平台各自打官方免密钥接口，谁挂了就在标签上如实标出来，不拿别的东西顶替。
const platformFeeds = ref<PlatformFeed[]>([])
const platformMetaNote = ref('')
const platformOffline = ref(false)
const platformLoading = ref(false)
const platformUpdatedAt = ref('')
const activePlatform = ref<PlatformKey>('steam')
const platformExpanded = ref(false)

const activeFeed = computed(() => platformFeeds.value.find((f) => f.key === activePlatform.value) || null)
const platformTotal = computed(() => platformFeeds.value.reduce((n, f) => n + (f.ok ? f.items.length : 0), 0))
const okPlatformCount = computed(() => platformFeeds.value.filter((f) => f.ok).length)
/** 默认收起时只展示一行（8 条），展开后全部铺开 */
const visiblePlatformItems = computed(() => {
  const items = activeFeed.value?.items || []
  return platformExpanded.value ? items : items.slice(0, 8)
})

// 卡片画幅跟着平台走：Steam 胶囊图是横的 616×353，PS/Nintendo 是方图，
// Xbox 是竖海报 600×900。整条卡带共用一个画幅，一屏里不会横竖混排。
const platformArtRatio = computed(() => activeFeed.value?.artRatio || 2 / 3)
/** 横画幅卡片矮，给 3 列放大一点；方图/竖图维持 4 列 */
const platformGridCols = computed(() =>
  platformArtRatio.value > 1.4
    ? 'grid-cols-2 md:grid-cols-3 xl:grid-cols-3'
    : 'grid-cols-2 md:grid-cols-3 xl:grid-cols-4',
)

const updatedLabel = computed(() => {
  if (!platformUpdatedAt.value) return ''
  const d = new Date(platformUpdatedAt.value)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())} 抓取`
})

async function loadPlatforms() {
  if (platformLoading.value) return
  platformLoading.value = true
  try {
    const b = await getPlatformBundle()
    platformFeeds.value = b.feeds
    platformMetaNote.value = b.note
    platformOffline.value = Boolean(b.offline)
    platformUpdatedAt.value = b.updatedAt
    // 默认选第一个有数据的平台，避免落在空标签上
    const firstOk = b.feeds.find((f) => f.ok)
    if (firstOk) activePlatform.value = firstOk.key
  } finally {
    platformLoading.value = false
  }
}

function pickPlatform(k: PlatformKey) {
  activePlatform.value = k
  platformExpanded.value = false
}

// 路由带 genre 参数时预筛精选库
onMounted(() => {
  store.loadReviewAggregate()
  // 默认发现模式，预加载多平台游戏
  loadDiscover(true)
  // 平台榜单独立加载，不阻塞目录首屏
  loadPlatforms()
  const genre = route.query.genre
  if (genre && !store.filters.genres.includes(genre as Genre)) {
    store.setGenre(genre as Genre)
  }
  const sort = route.query.sort
  if (typeof sort === 'string' && ['rating', 'price', 'playerCount', 'releaseDate', 'name'].includes(sort)) {
    store.setSortBy(sort as typeof store.filters.sortBy)
  }
})

watch(
  () => route.query.q,
  (q) => {
    if (typeof q === 'string' && q) {
      mode.value = 'discover'
      discoverQuery.value = q
      loadDiscover(true)
    }
  },
  { immediate: true },
)
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- 顶栏 -->
    <header class="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[var(--border)]">
      <div class="flex items-center gap-3">
        <button
          v-if="mode === 'curated'"
          @click="sidebarOpen = !sidebarOpen"
          class="lg:hidden p-2 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--text)] transition-colors"
          title="筛选"
        >
          <PanelLeftClose v-if="sidebarOpen" class="w-4 h-4" />
          <PanelLeft v-else class="w-4 h-4" />
        </button>
        <div>
          <h1 class="text-xl font-display font-bold text-[var(--text)]">探索游戏</h1>
          <p class="text-xs text-[var(--text-faint)] mt-0.5">
            <template v-if="mode === 'curated'">精选库 · 找到 {{ store.filteredGames.length }} 款</template>
            <template v-else>多平台发现 · 共 {{ discoverTotal || discoverGames.length }} 款</template>
          </p>
        </div>
      </div>

      <!-- 右侧动作区：模式切换始终靠右，避免切换模式时整条顶栏重心左右跳 -->
      <div class="flex items-center gap-2 ml-auto">
        <div v-if="mode === 'curated'" class="flex items-center gap-2">
          <button
            v-if="hasFilters"
            @click="store.resetFilters()"
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
          >
            <RotateCcw class="w-3.5 h-3.5" />
            重置
          </button>
          <div class="hidden sm:flex rounded-lg bg-[var(--surface-2)] border border-[var(--border)] p-0.5">
            <button
              v-for="m in (['grid', 'list'] as ViewMode[])"
              :key="m"
              @click="store.setViewMode(m)"
              class="p-2 rounded-md transition-colors"
              :class="store.viewMode === m ? 'bg-[var(--surface-3)] text-[var(--text)]' : 'text-[var(--text-dim)] hover:text-[var(--text)]'"
            >
              <Grid3X3 v-if="m === 'grid'" class="w-4 h-4" />
              <List v-else class="w-4 h-4" />
            </button>
          </div>
        </div>

        <div class="flex rounded-lg bg-[var(--surface-2)] border border-[var(--border)] p-0.5">
          <button
            @click="onModeChange('curated')"
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
            :class="mode === 'curated' ? 'bg-accent text-white shadow-sm shadow-accent/20' : 'text-[var(--text-dim)] hover:text-[var(--text)]'"
          >
            <LibraryIcon class="w-4 h-4" /> 精选库
          </button>
          <button
            @click="onModeChange('discover')"
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
            :class="mode === 'discover' ? 'bg-accent text-white shadow-sm shadow-accent/20' : 'text-[var(--text-dim)] hover:text-[var(--text)]'"
          >
            <Compass class="w-4 h-4" /> 多平台发现
          </button>
        </div>
      </div>
    </header>

    <!-- ════════ 精选库模式 ════════ -->
    <template v-if="mode === 'curated'">
      <!-- 快捷预设 -->
      <div class="flex flex-wrap gap-2 py-3">
        <button
          v-for="p in presets"
          :key="p.id"
          @click="p.toggle"
          class="px-3 py-1.5 rounded-full text-xs font-medium transition-all"
          :class="p.active
            ? 'bg-accent text-white shadow-sm shadow-accent/20'
            : 'bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--text)] hover:border-[var(--text-faint)]'"
        >
          {{ p.label }}
        </button>
      </div>

      <!-- 主体 -->
      <div class="flex flex-1 min-h-0 gap-5 relative">
        <!-- 左侧筛选 -->
        <aside :class="sidebarOpen ? 'block' : 'hidden'" class="lg:block w-60 xl:w-64 shrink-0 overflow-y-auto pr-2 py-1">
          <div class="space-y-5 sticky top-0">
            <!-- 搜索 -->
            <div class="relative">
              <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-dim)]" />
              <input
                type="text"
                placeholder="搜索游戏或标签..."
                :value="store.filters.search"
                @input="store.setSearch(($event.target as HTMLInputElement).value)"
                class="w-full pl-10 pr-8 py-2 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] text-sm text-[var(--text)] placeholder-[var(--text-faint)] focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all"
              />
              <button
                v-if="store.filters.search"
                @click="store.setSearch('')"
                class="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-dim)] hover:text-[var(--text)]"
              >
                <X class="w-3.5 h-3.5" />
              </button>
            </div>

            <!-- 排序 -->
            <FilterSection title="排序方式">
              <div class="flex gap-2">
                <select
                  :value="store.filters.sortBy"
                  @change="store.setSortBy(($event.target as HTMLSelectElement).value as typeof store.filters.sortBy)"
                  class="flex-1 px-3 py-2 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-sm text-[var(--text)] focus:outline-none focus:border-accent/50"
                >
                  <option v-for="opt in sortOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
                </select>
                <button
                  @click="store.setSortOrder(store.filters.sortOrder === 'desc' ? 'asc' : 'desc')"
                  class="px-3 py-2 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-sm font-bold text-[var(--text-dim)] hover:text-[var(--text)] transition-colors"
                  :title="store.filters.sortOrder === 'desc' ? '降序' : '升序'"
                >
                  {{ store.filters.sortOrder === 'desc' ? '↓' : '↑' }}
                </button>
              </div>
            </FilterSection>

            <!-- 类型 -->
            <FilterSection title="游戏类型">
              <div class="flex flex-wrap gap-1.5">
                <button
                  v-for="genre in genreList"
                  :key="genre"
                  @click="store.setGenre(genre as Genre)"
                  class="px-2.5 py-1 rounded-md text-xs font-medium transition-all"
                  :class="store.filters.genres.includes(genre as Genre)
                    ? 'bg-accent/15 text-accent border border-accent/30'
                    : 'bg-[var(--surface-2)] text-[var(--text-dim)] border border-[var(--border)] hover:text-[var(--text)] hover:border-[var(--text-faint)]'"
                >
                  {{ genre }}
                </button>
              </div>
            </FilterSection>

            <!-- 平台 -->
            <FilterSection title="平台">
              <div class="flex flex-wrap gap-1.5">
                <button
                  v-for="platform in platformList"
                  :key="platform"
                  @click="store.setPlatform(platform as Platform)"
                  class="px-2.5 py-1 rounded-md text-xs font-medium transition-all"
                  :class="store.filters.platforms.includes(platform as Platform)
                    ? 'bg-blue-500/15 text-blue-400 border border-blue-500/30'
                    : 'bg-[var(--surface-2)] text-[var(--text-dim)] border border-[var(--border)] hover:text-[var(--text)] hover:border-[var(--text-faint)]'"
                >
                  {{ platform }}
                </button>
              </div>
            </FilterSection>

            <!-- 价格 -->
            <FilterSection title="价格区间" :extra="`¥${store.filters.priceRange[0]} - ¥${store.filters.priceRange[1]}`">
              <input
                type="range"
                min="0"
                max="500"
                :value="store.filters.priceRange[1]"
                @input="store.setPriceRange([store.filters.priceRange[0], Number(($event.target as HTMLInputElement).value)])"
                class="w-full accent-[var(--accent)]"
              />
              <div class="flex gap-1.5 mt-2">
                <button
                  v-for="v in priceQuickButtons"
                  :key="v"
                  @click="store.setPriceRange(v === 100 ? [0, 100] : [Math.max(100, store.filters.priceRange[0]), Math.min(500, v * 2)])"
                  class="flex-1 px-2 py-1 rounded-md text-[10px] font-medium transition-all"
                  :class="(store.filters.priceRange[1] <= v && (v === 100 ? store.filters.priceRange[0] === 0 : store.filters.priceRange[0] === 100 || store.filters.priceRange[0] <= v))
                    ? 'bg-accent/15 text-accent' : 'bg-[var(--surface-2)] text-[var(--text-dim)]'"
                >
                  ¥{{ v === 100 ? `0-${v}` : `${v}+` }}
                </button>
              </div>
            </FilterSection>

            <!-- 最低评分 -->
            <FilterSection title="最低评分" :extra="store.filters.minRating > 0 ? `≥${store.filters.minRating.toFixed(1)}` : '不限'">
              <div class="flex gap-1.5">
                <button
                  v-for="r in [0, 7, 8, 9, 9.5]"
                  :key="r"
                  @click="store.setMinRating(r)"
                  class="flex-1 py-1.5 rounded-lg text-xs font-medium transition-all"
                  :class="store.filters.minRating === r
                    ? 'bg-amber-400/15 text-amber-400 border border-amber-400/30'
                    : 'bg-[var(--surface-2)] text-[var(--text-dim)] border border-[var(--border)] hover:text-[var(--text)]'"
                >
                  {{ r === 0 ? '不限' : `≥${r}` }}
                </button>
              </div>
            </FilterSection>
          </div>
        </aside>

        <!-- 右侧游戏网格 -->
        <main class="flex-1 min-w-0 pb-8">
          <EmptyState
            v-if="store.filteredGames.length === 0"
            title="没有找到符合条件的游戏"
            description="试试调整筛选条件，或重置后重新探索。"
          >
            <button
              @click="store.resetFilters()"
              class="px-4 py-2 rounded-xl bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text)] transition-colors text-sm border border-[var(--border)]"
            >
              重置所有筛选
            </button>
          </EmptyState>

          <template v-else>
            <MotionGrid
              v-if="store.viewMode === 'grid'"
              class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-4 gap-4"
            >
              <GameCard v-for="game in store.filteredGames" :key="game.id" :game="game" />
            </MotionGrid>
            <div v-else class="space-y-2">
              <GameCard v-for="game in store.filteredGames" :key="game.id" :game="game" view-mode="list" />
            </div>
          </template>
        </main>

        <!-- 移动端遮罩 -->
        <div
          v-if="sidebarOpen"
          class="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm lg:hidden"
          @click="sidebarOpen = false"
          aria-hidden="true"
        />
      </div>
    </template>

    <!-- ════════ 多平台发现模式 ════════ -->
    <template v-else>
      <!-- ── 平台官方直连 ──────────────────────────────────────────
           独立成一整块（自带底色与圆角），与下面的「目录检索」在视觉上分开，
           避免和搜索/筛选条挤在一起显得杂乱。 -->
      <section class="mt-4 rounded-2xl bg-[var(--surface-2)]/60 border border-[var(--border)] overflow-hidden">
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 pt-3.5 pb-3">
          <h2 class="text-sm font-semibold text-[var(--text)] flex items-center gap-1.5">
            <Radio class="w-4 h-4 text-accent-green" />
            平台官方直连
          </h2>
          <p class="text-[11px] text-[var(--text-faint)]">
            <template v-if="platformLoading">正在向四个平台官方接口取数…</template>
            <template v-else-if="platformOffline">当前部署未连接后端，无法读取实时数据</template>
            <template v-else-if="okPlatformCount === 0">
              四个平台官方接口当前都不可达，各平台的具体原因见下方
            </template>
            <template v-else>
              Steam / PlayStation / Nintendo / Xbox 共 <span class="text-[var(--text-dim)] font-medium">{{ platformTotal }}</span> 条实时条目
              <span v-if="updatedLabel" class="ml-1.5">· {{ updatedLabel }}</span>
            </template>
          </p>
          <button
            @click="loadPlatforms"
            :disabled="platformLoading"
            class="ml-auto flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--surface-3)] transition-colors disabled:opacity-50"
            title="重新抓取"
          >
            <RefreshCw class="w-3 h-3" :class="{ 'animate-spin': platformLoading }" />
            刷新
          </button>
        </div>

        <!-- 平台标签：带条数与可达状态 -->
        <div class="flex flex-wrap items-center gap-2 px-4 pb-3">
          <button
            v-for="f in platformFeeds"
            :key="f.key"
            @click="pickPlatform(f.key)"
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all border"
            :class="activePlatform === f.key
              ? 'bg-accent text-white border-accent shadow-sm shadow-accent/20'
              : 'bg-[var(--surface)] border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--text)] hover:border-[var(--text-faint)]'"
          >
            <span>{{ f.label }}</span>
            <span v-if="f.ok" class="tabular-nums opacity-70">{{ f.items.length }}</span>
            <TriangleAlert v-else-if="!platformLoading" class="w-3 h-3 text-accent-amber" />
          </button>
        </div>

        <!-- 当前平台内容 -->
        <div class="px-4 pb-4">
          <div v-if="platformLoading" :class="['grid gap-3', platformGridCols]">
            <div
              v-for="i in 6"
              :key="i"
              class="rounded-2xl border border-[var(--border)] overflow-hidden bg-[var(--surface)]"
            >
              <div
                class="animate-pulse bg-gradient-to-br from-[var(--surface-3)] via-[var(--surface-2)] to-[var(--surface-3)]"
                :style="{ aspectRatio: String(platformArtRatio) }"
              />
              <div class="p-3 space-y-2">
                <div class="h-3 rounded bg-[var(--surface-3)] animate-pulse" />
                <div class="h-2.5 w-2/3 rounded bg-[var(--surface-3)] animate-pulse" />
              </div>
            </div>
          </div>

          <!-- 该平台不可达：如实说明原因，不放任何占位游戏充数 -->
          <div
            v-else-if="activeFeed && !activeFeed.ok"
            class="flex items-start gap-2.5 rounded-xl border border-accent-amber/30 bg-accent-amber/[0.06] px-3.5 py-3"
          >
            <TriangleAlert class="w-4 h-4 text-accent-amber shrink-0 mt-0.5" />
            <div class="text-[12px] leading-relaxed">
              <p class="text-[var(--text)] font-medium">{{ activeFeed.label }} 官方接口当前不可达</p>
              <p class="text-[var(--text-dim)] mt-0.5">{{ activeFeed.error }}</p>
              <p class="text-[var(--text-faint)] mt-1">
                其余平台不受影响，可切换到上方其它标签查看；本平台下一次刷新会自动重试。
              </p>
            </div>
          </div>

          <template v-else-if="activeFeed">
            <MotionGrid :class="['grid gap-3', platformGridCols]">
              <PlatformGameCard
                v-for="g in visiblePlatformItems"
                :key="g.id"
                :game="g"
                :art-ratio="platformArtRatio"
              />
            </MotionGrid>

            <div class="flex items-center justify-between gap-3 mt-3 flex-wrap">
              <p class="text-[11px] text-[var(--text-faint)] flex items-center gap-1">
                <ExternalLink class="w-3 h-3" />
                条目与封面均来自平台官方接口（{{ activeFeed.artNote }}），点击前往对应平台商店页
              </p>
              <button
                v-if="activeFeed.items.length > 8"
                @click="platformExpanded = !platformExpanded"
                class="px-3 py-1.5 rounded-lg text-[11px] font-medium bg-[var(--surface)] border border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--text)] transition-colors"
              >
                {{ platformExpanded ? '收起' : `展开全部 ${activeFeed.items.length} 条` }}
              </button>
            </div>
          </template>
        </div>
      </section>

      <!-- 搜索 + 平台筛选：与精选库顶栏保持同一种分隔方式（底边框 + 一致的间距） -->
      <div class="py-3.5 border-b border-[var(--border)] space-y-3">
        <div class="flex items-start gap-2">
          <div class="relative flex-1 max-w-xl">
            <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-dim)]" />
            <input
              type="text"
              placeholder="搜索 Xbox / 任天堂 / PS / Epic / 网页游戏..."
              :value="discoverQuery"
              @input="discoverQuery = ($event.target as HTMLInputElement).value; onDiscoverInput()"
              @keyup.enter="applySearch"
              @focus="showSuggest = true"
              class="w-full pl-10 pr-8 py-2.5 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] text-sm text-[var(--text)] placeholder-[var(--text-faint)] focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-all"
            />
            <button
              v-if="discoverQuery"
              @click="discoverQuery = ''; applySearch()"
              class="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-dim)] hover:text-[var(--text)]"
            >
              <X class="w-3.5 h-3.5" />
            </button>

            <!-- 搜索联想 -->
            <div
              v-if="showSuggest && suggestions.length"
              class="absolute z-40 mt-1 w-full bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-xl overflow-hidden"
            >
              <button
                v-for="s in suggestions"
                :key="s.id"
                @click="pickSuggestion(s)"
                class="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-[var(--surface-2)] transition-colors"
              >
                <div class="w-8 h-10 rounded bg-[var(--surface-3)] overflow-hidden shrink-0 flex items-center justify-center text-xs font-bold text-[var(--text-faint)]">
                  <img v-if="s.coverUrl" :src="s.coverUrl" class="w-full h-full object-cover" alt="" />
                  <span v-else>{{ s.name.charAt(0).toUpperCase() }}</span>
                </div>
                <div class="min-w-0">
                  <div class="text-sm text-[var(--text)] truncate">{{ s.name }}</div>
                  <div class="text-[11px] text-[var(--text-faint)] truncate">{{ s.platforms.join(' · ') }}</div>
                </div>
              </button>
            </div>
          </div>

          <button
            v-if="hasDiscoverFilters"
            @click="clearDiscoverFilters"
            class="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors shrink-0"
          >
            <RotateCcw class="w-3.5 h-3.5" />
            重置
          </button>
        </div>

        <!-- 平台筛选条 -->
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-[11px] text-[var(--text-faint)] mr-0.5">平台</span>
          <button
            v-for="p in DISCOVER_PLATFORMS"
            :key="p"
            @click="toggleDiscoverPlatform(p)"
            class="px-3 py-1.5 rounded-full text-xs font-medium transition-all"
            :class="discoverPlatforms.includes(p)
              ? 'bg-accent text-white shadow-sm shadow-accent/20'
              : 'bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--text)] hover:border-[var(--text-faint)]'"
          >
            {{ p }}
          </button>
        </div>
      </div>

      <!-- 结果网格 -->
      <main class="flex-1 min-w-0 pb-8">
        <div v-if="discoverLoading && discoverGames.length === 0" class="flex items-center justify-center py-20 text-[var(--text-dim)]">
          <Loader2 class="w-5 h-5 animate-spin mr-2" /> 正在加载多平台游戏…
        </div>

        <EmptyState
          v-else-if="discoverGames.length === 0 && !discoverLoading"
          title="没有找到匹配的游戏"
          description="试试其它关键词，或清除平台筛选。"
        />

        <template v-else>
          <MotionGrid class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
            <DiscoverCard v-for="g in discoverGames" :key="g.id" :game="g" />
          </MotionGrid>

          <div v-if="discoverError" class="text-center text-accent-red text-sm py-4">{{ discoverError }}</div>

          <div v-if="discoverHasMore" class="flex justify-center pt-6">
            <button
              @click="loadMore"
              :disabled="discoverLoading"
              class="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] text-sm font-medium text-[var(--text-dim)] hover:text-[var(--text)] transition-colors disabled:opacity-50"
            >
              <Loader2 v-if="discoverLoading" class="w-4 h-4 animate-spin" />
              {{ discoverLoading ? '加载中…' : '加载更多' }}
            </button>
          </div>
        </template>
      </main>
    </template>
  </div>
</template>
