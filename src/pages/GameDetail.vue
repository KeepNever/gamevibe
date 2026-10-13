<script setup lang="ts">
import { computed, watch, onMounted, ref } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import VChart from 'vue-echarts'
import {
  Star, Users, Tv, Calendar, Monitor, HardDrive, Heart, Scale,
  ArrowLeft, ExternalLink, Gamepad2, ChevronRight, Loader2, Share2, Sparkles,
  MessagesSquare, ThumbsUp, AlertCircle,
} from 'lucide-vue-next'
import { games } from '@/data/games'
import type { Game } from '@/types/game'
import { useGameStore, collectionMeta, type CollectionKey } from '@/stores/gameStore'
import { getSimilarGames } from '@/lib/similarity'
import { getRecommendations } from '@/lib/recommendApi'
import { CHART_TEXT, CHART_BORDER, CHART_AXIS } from '@/lib/echarts'
import '@/lib/echarts'
import GameCard from '@/components/GameCard.vue'
import ReviewSection from '@/components/ReviewSection.vue'
import AchievementBoard from '@/components/AchievementBoard.vue'
import ShareCard from '@/components/ShareCard.vue'
import { getRawgDetail } from '@/lib/discoverApi'
import type { DiscoverGame } from '@/types/discover'
import { getFriendsPlaying } from '@/lib/socialApi'
import { getToken } from '@/lib/api'
import { getAiReview, getAiReviewDigest } from '@/lib/liveApi'
import type { AiReviewResult, ReviewDigestResult } from '@/types/live'

const route = useRoute()
const router = useRouter()
const store = useGameStore()

const id = computed(() => route.params.id as string)
const game = computed(() => games.find((g) => g.id === id.value))

// ── 多平台发现游戏（RAWG / 本地兜底 dc_）兼容 ──────────
const isDiscover = computed(() => id.value.startsWith('rawg_') || id.value.startsWith('dc_'))
const rawgGame = ref<DiscoverGame | null>(null)
const rawgLoading = ref(false)
const isDiscoverFav = computed(() => (rawgGame.value ? store.favorites.includes(rawgGame.value.id) : false))

watch(
  () => route.params.id,
  async () => {
    if (isDiscover.value) {
      rawgLoading.value = true
      rawgGame.value = null
      // dc_ 前缀直接传完整 ID；rawg_ 前缀去掉前缀
      const rid = id.value.startsWith('dc_') ? id.value : id.value.replace(/^rawg_/, '')
      try {
        const g = await getRawgDetail(rid)
        rawgGame.value = g
        if (g) store.addRecentlyViewed(g.id)
      } finally {
        rawgLoading.value = false
      }
    }
  },
  { immediate: true },
)

watch(
  () => route.params.id,
  () => {
    if (game.value) store.addRecentlyViewed(game.value.id)
  },
  { immediate: true },
)

const isFavorite = computed(() => (game.value ? store.favorites.includes(game.value.id) : false))
const isComparing = computed(() => (game.value ? store.compareIds.includes(game.value.id) : false))
const canCompare = computed(() => store.compareIds.length < 4 || isComparing.value)

// ── AI 一句话点评（仅精选库游戏，发现类游戏走 RAWG 不在此列）──
const aiReview = ref<AiReviewResult | null>(null)
const aiReviewLoading = ref(false)
async function loadAiReview() {
  const g = game.value
  if (!g || g.id.startsWith('rawg_') || g.id.startsWith('dc_')) {
    aiReview.value = null
    return
  }
  aiReviewLoading.value = true
  try {
    aiReview.value = await getAiReview(g.id)
  } catch {
    aiReview.value = null
  } finally {
    aiReviewLoading.value = false
  }
}

// ── AI 口碑归纳（共识 / 分歧，引用均为真实评论原文）──
const digest = ref<ReviewDigestResult | null>(null)
const digestLoading = ref(false)
async function loadDigest() {
  const g = game.value
  if (!g || g.id.startsWith('rawg_') || g.id.startsWith('dc_')) {
    digest.value = null
    return
  }
  digestLoading.value = true
  try {
    digest.value = await getAiReviewDigest(g.id)
  } catch {
    digest.value = null
  } finally {
    digestLoading.value = false
  }
}

// ── 分享卡片 ──
const showShare = ref(false)
const shareGame = computed(() => {
  const g = game.value
  if (g) {
    return { id: g.id, name: g.name, coverUrl: g.coverUrl, rating: g.rating, description: g.description, genres: g.genres }
  }
  const r = rawgGame.value
  if (r) {
    return {
      id: r.id,
      name: r.name,
      coverUrl: r.coverUrl,
      rating: (r as any).rating ?? null,
      description: (r as any).description ?? null,
      genres: (r as any).genres ?? [],
    }
  }
  return null
})
function openShare() {
  if (shareGame.value) showShare.value = true
}

const radarOption = computed(() => {
  const g = game.value
  if (!g) return {}
  return {
    radar: {
      indicator: [
        { name: '玩法', max: 10 },
        { name: '画面', max: 10 },
        { name: '剧情', max: 10 },
        { name: '音乐', max: 10 },
        { name: '重玩性', max: 10 },
        { name: '优化', max: 10 },
      ],
      axisName: { color: CHART_TEXT, fontSize: 11 },
      splitLine: { lineStyle: { color: CHART_BORDER } },
      splitArea: { areaStyle: { color: ['transparent'] } },
      axisLine: { lineStyle: { color: CHART_BORDER } },
    },
    series: [
      {
        type: 'radar',
        data: [
          {
            value: [
              g.scores.gameplay, g.scores.graphics, g.scores.story,
              g.scores.music, g.scores.replayability, g.scores.performance,
            ],
            name: g.name,
            lineStyle: { color: '#a78bfa' },
            areaStyle: { color: 'rgba(167,139,250,0.3)' },
            itemStyle: { color: '#a78bfa' },
          },
        ],
      },
    ],
  }
})

const trendOption = computed(() => {
  const g = game.value
  if (!g) return {}
  const data = g.trends.daily.map((v, i) => ({ day: `D${i + 1}`, players: v * 1000 }))
  return {
    grid: { left: 48, right: 16, top: 16, bottom: 28 },
    xAxis: {
      type: 'category',
      data: data.map((d) => d.day),
      axisLine: { lineStyle: { color: CHART_BORDER } },
      axisLabel: { color: CHART_TEXT, fontSize: 12 },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: CHART_TEXT, formatter: (v: number) => `${(v / 1000).toFixed(0)}K` },
      splitLine: { lineStyle: { color: CHART_BORDER } },
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#1e293b',
      borderColor: CHART_BORDER,
      textStyle: { color: '#e2e8f0' },
      formatter: (p: any) => `${(p[0].value / 1000).toFixed(1)}K 玩家`,
    },
    series: [
      {
        type: 'line',
        data: data.map((d) => d.players),
        smooth: true,
        showSymbol: false,
        lineStyle: { color: '#a78bfa', width: 2 },
        areaStyle: { color: 'rgba(167,139,250,0.15)' },
      },
    ],
  }
})

const similarGames = computed(() => (game.value ? getSimilarGames(game.value, games, 6) : []))

// 后端「因为你玩过」动态推荐：基于当前游戏相似度，登录时额外排除已交互游戏
const recommendedGames = ref<Game[]>([])
const recommendReason = ref<Record<string, string>>({})
const recReady = ref(false)

async function loadRecommendations() {
  const g = game.value
  if (!g || g.id.startsWith('rawg_') || g.id.startsWith('dc_')) return
  try {
    const res = await getRecommendations(g.id)
    const byId = new Map(res.recommendations.map((r) => [r.id, r]))
    const list = res.recommendations
      .map((r) => games.find((x) => x.id === r.id))
      .filter((x): x is Game => Boolean(x))
    recommendedGames.value = list
    recommendReason.value = Object.fromEntries(list.map((x) => [x.id, byId.get(x.id)?.reason ?? '']))
    recReady.value = true
  } catch {
    recommendedGames.value = []
    recReady.value = false
  }
}

watch(
  () => route.params.id,
  () => {
    if (game.value && !game.value.id.startsWith('rawg_') && !game.value.id.startsWith('dc_')) {
      loadRecommendations()
      loadAiReview()
      loadDigest()
    }
  },
  { immediate: true },
)

const positiveRate = computed(() => {
  const g = game.value
  if (!g) return 0
  return (g.reviewsSummary.positive / (g.reviewsSummary.positive + g.reviewsSummary.negative)) * 100
})

// ── 好友在玩（我关注的人里库存有这款游戏的）──
const friendsPlaying = ref<any[]>([])
const showFriendsHint = computed(() => !!getToken() && friendsPlaying.value.length === 0)
function friendStatusLabel(s: string): string {
  const map: Record<string, string> = { playing: '正在玩', completed: '已通关', wishlist: '想玩', backlog: '在清单' }
  return map[s] || s
}
async function loadFriendsPlaying() {
  friendsPlaying.value = []
  if (!game.value || !getToken()) return
  try {
    const r = await getFriendsPlaying(game.value.id)
    friendsPlaying.value = r.friends
  } catch {
    friendsPlaying.value = []
  }
}
watch(
  () => route.params.id,
  () => { if (game.value) loadFriendsPlaying() },
  { immediate: true },
)
</script>

<template>
  <!-- ════════ 多平台发现游戏详情 ════════ -->
  <div v-if="isDiscover" class="space-y-8 pb-12">
    <div class="flex items-center gap-2 mb-4">
      <button @click="router.back()" class="flex items-center gap-1 text-sm text-[var(--text-dim)] hover:text-[var(--text)] transition-colors">
        <ArrowLeft class="w-4 h-4" /> 返回
      </button>
      <button @click="openShare" class="ml-auto flex items-center gap-1 text-sm text-[var(--text-dim)] hover:text-accent transition-colors">
        <Share2 class="w-4 h-4" /> 分享
      </button>
    </div>

    <div v-if="rawgLoading" class="flex items-center justify-center py-20 text-[var(--text-dim)]">
      <Loader2 class="w-5 h-5 animate-spin mr-2" /> 加载中…
    </div>

    <div v-else-if="!rawgGame" class="flex flex-col items-center justify-center py-20">
      <Gamepad2 class="w-16 h-16 text-[var(--text-faint)] mb-4" />
      <h2 class="text-xl font-bold text-[var(--text-dim)] mb-2">游戏未找到</h2>
      <button @click="router.push('/explore')" class="text-accent hover:text-accent-strong transition-colors">前往探索</button>
    </div>

    <div v-else>
      <!-- Banner -->
      <div class="relative rounded-2xl overflow-hidden h-48 lg:h-64">
        <img v-if="rawgGame.coverUrl" :src="rawgGame.coverUrl" :alt="rawgGame.name" class="w-full h-full object-cover" />
        <div v-else class="w-full h-full bg-gradient-to-br from-accent/30 to-accent-cyan/20" />
        <div class="absolute inset-0 bg-gradient-to-r from-[var(--surface)]/95 via-[var(--surface)]/60 to-transparent" />
        <div class="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-[var(--surface)] to-transparent" />
        <div class="absolute left-6 lg:left-8 bottom-6 lg:bottom-8 flex items-end gap-5">
          <div class="w-20 lg:w-28 aspect-[3/4] rounded-xl overflow-hidden shadow-2xl border-2 border-white/10 shrink-0 bg-[var(--surface-3)] flex items-center justify-center text-3xl font-display font-bold text-[var(--text-faint)]">
            <img v-if="rawgGame.coverUrl" :src="rawgGame.coverUrl" :alt="rawgGame.name" class="w-full h-full object-cover" />
            <span v-else>{{ (rawgGame.name || '?').charAt(0).toUpperCase() }}</span>
          </div>
          <div>
            <h1 class="text-2xl lg:text-4xl font-display font-bold text-white mb-2">{{ rawgGame.name }}</h1>
            <div class="flex flex-wrap items-center gap-3 text-sm">
              <span class="flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent-amber/20 text-accent-amber">
                <Star class="w-4 h-4 fill-current" /> {{ (rawgGame.rating / 20).toFixed(1) }}
                <span class="text-[var(--text-faint)] text-xs">({{ rawgGame.ratingCount }} 评价)</span>
              </span>
              <span v-if="rawgGame.developer" class="text-[var(--text-dim)]">{{ rawgGame.developer }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="grid lg:grid-cols-3 gap-8 mt-8">
        <!-- Main -->
        <div class="lg:col-span-2 space-y-8">
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div v-for="item in [
              { label: '发售日期', value: rawgGame.releaseDate },
              { label: '平台', value: rawgGame.platforms.join(' / ') },
              { label: 'Metacritic', value: rawgGame.metacritic ? String(rawgGame.metacritic) : '—' },
              { label: '类型', value: rawgGame.genres.join(' / ') || '—' },
            ]" :key="item.label" class="p-4 rounded-xl bg-[var(--surface-2)] border border-[var(--border)]">
              <div class="text-sm font-semibold text-[var(--text)]">{{ item.value }}</div>
              <div class="text-xs text-[var(--text-faint)] mt-0.5">{{ item.label }}</div>
            </div>
          </div>

          <div v-if="rawgGame.description">
            <h2 class="text-lg font-display font-bold text-[var(--text)] mb-3">关于这款游戏</h2>
            <p class="text-[var(--text-dim)] leading-relaxed text-sm">{{ rawgGame.description }}</p>
          </div>

          <div v-if="rawgGame.tags.length">
            <h2 class="text-lg font-display font-bold text-[var(--text)] mb-3">标签</h2>
            <div class="flex flex-wrap gap-2">
              <span v-for="t in rawgGame.tags" :key="t" class="px-3 py-1 rounded-lg bg-[var(--surface-3)] text-[var(--text-dim)] text-xs">{{ t }}</span>
            </div>
          </div>

          <!-- 全球成就（免密钥真数据；本站无 Steam 版时如实说明） -->
          <AchievementBoard v-if="rawgGame" :key="rawgGame.id" :game-id="rawgGame.id" />

          <!-- 社区评价 -->
          <ReviewSection v-if="rawgGame" :game-id="rawgGame.id" />
        </div>

        <!-- Sidebar -->
        <div class="sticky top-6 self-start space-y-6">
          <div class="p-6 rounded-2xl bg-[var(--surface-2)] border border-[var(--border)] space-y-4">
            <div v-if="rawgGame.priceLabel" class="text-accent-green text-2xl font-bold">{{ rawgGame.priceLabel }}</div>
            <div v-else class="text-[var(--text-dim)] text-sm">多平台游戏 · 价格以各商店为准</div>

            <div class="flex gap-2">
              <button
                @click="store.toggleFavorite(rawgGame.id)"
                class="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-medium transition-all"
                :class="isDiscoverFav ? 'bg-accent-red/20 text-accent-red border border-accent-red/30' : 'bg-[var(--surface-3)] text-[var(--text-dim)] border border-[var(--border)] hover:text-[var(--text)]'"
              >
                <Heart class="w-4 h-4" :class="isDiscoverFav ? 'fill-current' : ''" />
                {{ isDiscoverFav ? '已收藏' : '收藏' }}
              </button>
            </div>

            <div class="pt-4 border-t border-[var(--border)]">
              <div class="text-xs text-[var(--text-faint)] mb-2">加入我的清单</div>
              <div class="flex gap-2">
                <button
                  v-for="col in (Object.keys(collectionMeta) as CollectionKey[])"
                  :key="col"
                  @click="store.toggleCollection(col, rawgGame.id)"
                  class="flex-1 px-2 py-2 rounded-lg text-xs font-medium border transition-all"
                  :class="store.collections[col].includes(rawgGame.id) ? 'border-transparent text-white' : 'bg-[var(--surface-3)] text-[var(--text-dim)] border border-[var(--border)] hover:text-[var(--text)]'"
                  :style="store.collections[col].includes(rawgGame.id) ? { backgroundColor: collectionMeta[col].color } : undefined"
                >
                  {{ collectionMeta[col].label }}
                </button>
              </div>
            </div>

            <a
              :href="rawgGame.rawgUrl"
              target="_blank"
              rel="noopener noreferrer"
              class="flex items-center justify-center gap-2 w-full px-4 py-3 rounded-xl bg-[var(--surface-3)] hover:bg-[var(--surface)] text-[var(--text-dim)] font-medium transition-colors border border-[var(--border)] text-sm"
            >
              <ExternalLink class="w-4 h-4" /> 在 RAWG 查看
            </a>
          </div>

          <div class="p-4 rounded-2xl bg-[var(--surface-2)] border border-[var(--border)]">
            <h3 class="text-sm font-semibold text-[var(--text-dim)] mb-2">关于数据来源</h3>
            <p class="text-xs text-[var(--text-faint)] leading-relaxed">
              多平台游戏数据由 RAWG.io 聚合提供（含 Steam / Xbox / PlayStation / Nintendo / 移动端 / 网页）。
              当前沙箱环境若无法直连，将显示本地多平台目录作为兜底。
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- ════════ 精选库游戏详情 ════════ -->
  <div v-else>
  <div v-if="!game" class="flex flex-col items-center justify-center py-20">
    <Gamepad2 class="w-16 h-16 text-[var(--text-faint)] mb-4" />
    <h2 class="text-xl font-bold text-[var(--text-dim)] mb-2">游戏未找到</h2>
    <button @click="router.push('/')" class="text-accent hover:text-accent-strong transition-colors">
      返回首页
    </button>
  </div>

  <div v-else class="space-y-8 pb-12">
    <!-- Back & Banner -->
    <div>
      <div class="flex items-center gap-2 mb-4">
        <button @click="router.back()" class="flex items-center gap-1 text-sm text-[var(--text-dim)] hover:text-[var(--text)] transition-colors">
          <ArrowLeft class="w-4 h-4" /> 返回
        </button>
        <button @click="openShare" class="ml-auto flex items-center gap-1 text-sm text-[var(--text-dim)] hover:text-accent transition-colors">
          <Share2 class="w-4 h-4" /> 分享
        </button>
      </div>

      <div class="relative rounded-2xl overflow-hidden h-48 lg:h-64">
        <img :src="game.bannerUrl" :alt="game.name" class="w-full h-full object-cover" />
        <div class="absolute inset-0 bg-gradient-to-r from-[var(--surface)]/95 via-[var(--surface)]/60 to-transparent" />
        <div class="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-[var(--surface)] to-transparent" />

        <div class="absolute left-6 lg:left-8 bottom-6 lg:bottom-8 flex items-end gap-5">
          <div class="w-20 lg:w-28 aspect-[3/4] rounded-xl overflow-hidden shadow-2xl border-2 border-white/10 shrink-0">
            <img :src="game.coverUrl" :alt="game.name" class="w-full h-full object-cover" />
          </div>
          <div>
            <h1 class="text-2xl lg:text-4xl font-display font-bold text-white mb-2">{{ game.name }}</h1>
            <div class="flex flex-wrap items-center gap-3 text-sm">
              <span class="flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent-amber/20 text-accent-amber">
                <Star class="w-4 h-4 fill-current" /> {{ game.rating }}
                <span class="text-[var(--text-faint)] text-xs">({{ (game.ratingCount / 1000).toFixed(0) }}K 评价)</span>
              </span>
              <span class="text-[var(--text-dim)]">{{ game.developer }}</span>
              <span class="text-[var(--text-faint)]">|</span>
              <span class="text-[var(--text-dim)]">{{ game.publisher }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="grid lg:grid-cols-3 gap-8">
      <!-- Main -->
      <div class="lg:col-span-2 space-y-8">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div v-for="item in [
            { icon: Users, label: '当前在线', value: game.playerCount >= 1000 ? `${(game.playerCount / 1000).toFixed(1)}K` : game.playerCount },
            { icon: Tv, label: 'Twitch 观众', value: game.twitchViewers >= 1000 ? `${(game.twitchViewers / 1000).toFixed(1)}K` : game.twitchViewers },
            { icon: Calendar, label: '发售日期', value: game.releaseDate },
            { icon: Monitor, label: '平台', value: game.platforms.join(' / ') },
          ]" :key="item.label" class="p-4 rounded-xl bg-[var(--surface-2)] border border-[var(--border)]">
            <component :is="item.icon" class="w-4 h-4 text-[var(--text-dim)] mb-2" />
            <div class="text-sm font-semibold text-[var(--text)]">{{ item.value }}</div>
            <div class="text-xs text-[var(--text-faint)] mt-0.5">{{ item.label }}</div>
          </div>
        </div>

        <div>
          <h2 class="text-lg font-display font-bold text-[var(--text)] mb-3">关于这款游戏</h2>
          <p class="text-[var(--text-dim)] leading-relaxed text-sm">{{ game.description }}</p>
        </div>

        <div>
          <h2 class="text-lg font-display font-bold text-[var(--text)] mb-3">游戏特色</h2>
          <div class="flex flex-wrap gap-2">
            <span v-for="f in game.features" :key="f" class="px-3 py-1.5 rounded-lg bg-accent/10 border border-accent/20 text-accent text-sm">{{ f }}</span>
          </div>
        </div>

        <div>
          <h2 class="text-lg font-display font-bold text-[var(--text)] mb-3">标签</h2>
          <div class="flex flex-wrap gap-2">
            <span v-for="t in game.tags" :key="t" class="px-3 py-1 rounded-lg bg-[var(--surface-3)] text-[var(--text-dim)] text-xs">{{ t }}</span>
          </div>
        </div>

        <!-- AI 一句话点评 -->
        <div v-if="aiReview || aiReviewLoading">
          <h2 class="text-lg font-display font-bold text-[var(--text)] mb-3 flex items-center gap-2">
            <Sparkles class="w-4 h-4 text-accent" /> AI 点评
          </h2>
          <div class="p-4 rounded-2xl bg-gradient-to-br from-accent/10 to-accent-cyan/5 border border-accent/20">
            <div v-if="aiReviewLoading" class="flex items-center gap-2 text-sm text-[var(--text-faint)]">
              <Loader2 class="w-4 h-4 animate-spin" /> 正在生成点评…
            </div>
            <p v-else-if="aiReview" class="text-sm text-[var(--text)] leading-relaxed">{{ aiReview.review }}</p>
            <p class="text-[10px] text-[var(--text-faint)] mt-2">
              由 AI 生成 · 基于真实目录数据{{ aiReview && !aiReview.aiPowered ? '（规则兜底）' : '' }}
            </p>
          </div>
        </div>

        <!-- AI 口碑归纳：共识 / 分歧（引用均为站内真实评论原文） -->
        <div v-if="digest || digestLoading">
          <h2 class="text-lg font-display font-bold text-[var(--text)] mb-3 flex items-center gap-2 flex-wrap">
            <MessagesSquare class="w-4 h-4 text-accent" /> 玩家怎么说
            <span v-if="digest && digest.count" class="text-xs font-normal text-[var(--text-faint)]">
              {{ digest.count }} 条评论 · 平均 {{ digest.average }} 分
            </span>
          </h2>

          <div
            v-if="digestLoading"
            class="p-4 rounded-2xl bg-[var(--surface-2)] border border-[var(--border)] flex items-center gap-2 text-sm text-[var(--text-faint)]"
          >
            <Loader2 class="w-4 h-4 animate-spin" /> 正在归纳玩家口碑…
          </div>

          <div v-else-if="digest" class="space-y-4">
            <!-- 评分分布 -->
            <div
              v-if="digest.count"
              class="p-4 rounded-2xl bg-[var(--surface-2)] border border-[var(--border)] space-y-1.5"
            >
              <div v-for="d in digest.distribution" :key="d.stars" class="flex items-center gap-3">
                <span class="w-9 text-xs text-[var(--text-faint)] shrink-0">{{ d.stars }} 星</span>
                <div class="flex-1 h-1.5 rounded-full bg-[var(--surface-3)] overflow-hidden">
                  <div
                    class="h-full bg-accent"
                    :style="{ width: digest.count ? (d.count / digest.count) * 100 + '%' : '0%' }"
                  />
                </div>
                <span class="w-6 text-right text-xs text-[var(--text-faint)] shrink-0">{{ d.count }}</span>
              </div>
            </div>

            <!-- 共识 -->
            <div v-if="digest.consensus.length" class="space-y-2">
              <p class="text-sm font-semibold text-[var(--text)] flex items-center gap-1.5">
                <ThumbsUp class="w-3.5 h-3.5 text-emerald-400" /> 共识
              </p>
              <div
                v-for="(t, i) in digest.consensus"
                :key="'c' + i"
                class="p-3 rounded-xl bg-[var(--surface-2)] border border-[var(--border)]"
              >
                <div class="flex items-baseline gap-2 flex-wrap">
                  <span class="px-2 py-0.5 rounded-md bg-accent/15 text-accent text-xs font-medium shrink-0">{{ t.theme }}</span>
                  <span class="text-xs text-[var(--text-dim)]">{{ t.summary }}</span>
                </div>
                <blockquote v-for="(q, j) in t.quotes" :key="j" class="mt-2 pl-3 border-l-2 border-[var(--border)]">
                  <p class="text-xs text-[var(--text-dim)] leading-relaxed">“{{ q.text }}”</p>
                  <p class="text-[10px] text-[var(--text-faint)] mt-0.5">
                    —— {{ q.author }}<span v-if="q.rating"> · {{ q.rating }} 星</span>
                  </p>
                </blockquote>
              </div>
            </div>

            <!-- 分歧 -->
            <div v-if="digest.divergence.length" class="space-y-2">
              <p class="text-sm font-semibold text-[var(--text)] flex items-center gap-1.5">
                <AlertCircle class="w-3.5 h-3.5 text-amber-400" /> 分歧
              </p>
              <div
                v-for="(t, i) in digest.divergence"
                :key="'d' + i"
                class="p-3 rounded-xl bg-[var(--surface-2)] border border-[var(--border)]"
              >
                <div class="flex items-baseline gap-2 flex-wrap">
                  <span class="px-2 py-0.5 rounded-md bg-amber-400/15 text-amber-400 text-xs font-medium shrink-0">{{ t.theme }}</span>
                  <span class="text-xs text-[var(--text-dim)]">{{ t.summary }}</span>
                </div>
                <blockquote v-for="(q, j) in t.quotes" :key="j" class="mt-2 pl-3 border-l-2 border-[var(--border)]">
                  <p class="text-xs text-[var(--text-dim)] leading-relaxed">“{{ q.text }}”</p>
                  <p class="text-[10px] text-[var(--text-faint)] mt-0.5">
                    —— {{ q.author }}<span v-if="q.rating"> · {{ q.rating }} 星</span>
                  </p>
                </blockquote>
              </div>
            </div>

            <p v-if="digest.note" class="text-xs text-[var(--text-faint)]">{{ digest.note }}</p>
            <p class="text-[10px] text-[var(--text-faint)]">
              引文照抄站内评论原文（未经改写）{{ digest.aiPowered ? ' · 主题由 AI 归纳' : ' · 未经 AI 归纳' }} · 站内评论含演示数据
            </p>
          </div>
        </div>

        <div>
          <h2 class="text-lg font-display font-bold text-[var(--text)] mb-3">玩家趋势 (近7日)</h2>
          <div class="p-6 rounded-2xl bg-[var(--surface-2)] border border-[var(--border)]" style="height: 220px">
            <VChart :option="trendOption" autoresize style="width: 100%; height: 100%" />
          </div>
        </div>

        <div>
          <h2 class="text-lg font-display font-bold text-[var(--text)] mb-3">系统需求</h2>
          <div class="grid md:grid-cols-2 gap-4">
            <div class="p-4 rounded-xl bg-[var(--surface-2)] border border-[var(--border)]">
              <div class="flex items-center gap-2 mb-2">
                <HardDrive class="w-4 h-4 text-[var(--text-dim)]" />
                <span class="text-sm font-semibold text-[var(--text)]">最低配置</span>
              </div>
              <p class="text-xs text-[var(--text-faint)] leading-relaxed">{{ game.systemRequirements.minimum }}</p>
            </div>
            <div class="p-4 rounded-xl bg-[var(--surface-2)] border border-[var(--border)]">
              <div class="flex items-center gap-2 mb-2">
                <HardDrive class="w-4 h-4 text-accent" />
                <span class="text-sm font-semibold text-[var(--text)]">推荐配置</span>
              </div>
              <p class="text-xs text-[var(--text-faint)] leading-relaxed">{{ game.systemRequirements.recommended }}</p>
            </div>
          </div>
        </div>

        <!-- 全球成就（免密钥真数据） -->
        <AchievementBoard :key="'ach-' + game.id" :game-id="game.id" />

        <!-- 社区评价 -->
        <ReviewSection :game-id="game.id" />
      </div>

      <!-- Sidebar: 整体 sticky 避免内部元素滚动重叠 -->
      <div class="sticky top-6 self-start space-y-6">
        <div class="p-6 rounded-2xl bg-[var(--surface-2)] border border-[var(--border)] space-y-4">
          <!-- price -->
          <div v-if="game.price === 0">
            <span class="text-accent-green text-2xl font-bold">免费游玩</span>
          </div>
          <div v-else-if="game.discount > 0" class="flex items-center gap-3">
            <span class="text-2xl font-bold text-accent">¥{{ game.price }}</span>
            <span class="text-lg text-[var(--text-faint)] line-through">¥{{ game.originalPrice }}</span>
            <span class="px-2 py-1 rounded-lg bg-accent/20 text-accent text-sm font-semibold">-{{ game.discount }}%</span>
          </div>
          <div v-else>
            <span class="text-2xl font-bold text-[var(--text)]">¥{{ game.price }}</span>
          </div>

          <div class="flex gap-2">
            <button
              @click="store.toggleFavorite(game.id)"
              class="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-medium transition-all"
              :class="isFavorite
                ? 'bg-accent-red/20 text-accent-red border border-accent-red/30'
                : 'bg-[var(--surface-3)] text-[var(--text-dim)] border border-[var(--border)] hover:text-[var(--text)]'"
            >
              <Heart class="w-4 h-4" :class="isFavorite ? 'fill-current' : ''" />
              {{ isFavorite ? '已收藏' : '收藏' }}
            </button>
            <button
              @click="canCompare && store.toggleCompare(game.id)"
              class="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-medium transition-all"
              :class="isComparing
                ? 'bg-accent/20 text-accent border border-accent/30'
                : 'bg-[var(--surface-3)] text-[var(--text-dim)] border border-[var(--border)] hover:text-[var(--text)]'"
              :disabled="!canCompare"
            >
              <Scale class="w-4 h-4" />
              {{ isComparing ? '已加入' : '加入对比' }}
            </button>
          </div>

          <!-- collections -->
          <div class="pt-4 border-t border-[var(--border)]">
            <div class="text-xs text-[var(--text-faint)] mb-2">加入我的清单</div>
            <div class="flex gap-2">
              <button
                v-for="col in (Object.keys(collectionMeta) as CollectionKey[])"
                :key="col"
                @click="store.toggleCollection(col, game.id)"
                class="flex-1 px-2 py-2 rounded-lg text-xs font-medium border transition-all"
                :class="store.collections[col].includes(game.id)
                  ? 'border-transparent text-white'
                  : 'bg-[var(--surface-3)] text-[var(--text-dim)] border-[var(--border)] hover:text-[var(--text)]'"
                :style="store.collections[col].includes(game.id) ? { backgroundColor: collectionMeta[col].color } : undefined"
              >
                {{ collectionMeta[col].label }}
              </button>
            </div>
          </div>

          <a
            v-if="game.steamUrl"
            :href="game.steamUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="flex items-center justify-center gap-2 w-full px-4 py-3 rounded-xl bg-[var(--surface-3)] hover:bg-[var(--surface)] text-[var(--text-dim)] font-medium transition-colors border border-[var(--border)] text-sm"
          >
            <ExternalLink class="w-4 h-4" />
            在 Steam 查看
          </a>
        </div>

        <!-- Radar -->
        <div class="p-4 rounded-2xl bg-[var(--surface-2)] border border-[var(--border)]">
          <h3 class="text-sm font-semibold text-[var(--text-dim)] mb-3">评分雷达图</h3>
          <div style="height: 250px">
            <VChart :option="radarOption" autoresize style="width: 100%; height: 100%" />
          </div>
        </div>

        <!-- Reviews -->
        <div class="p-4 rounded-2xl bg-[var(--surface-2)] border border-[var(--border)]">
          <h3 class="text-sm font-semibold text-[var(--text-dim)] mb-3">玩家评价</h3>
          <div class="flex items-center gap-4">
            <div class="flex-1">
              <div class="flex justify-between text-xs mb-1">
                <span class="text-accent-green">好评</span>
                <span class="text-[var(--text-dim)]">{{ positiveRate.toFixed(0) }}%</span>
              </div>
              <div class="h-2 rounded-full bg-[var(--surface-3)] overflow-hidden">
                <div class="h-full rounded-full bg-accent-green" :style="{ width: `${positiveRate}%` }" />
              </div>
            </div>
            <div class="text-center">
              <div class="text-2xl font-display font-bold text-accent-green">{{ positiveRate.toFixed(0) }}%</div>
              <div class="text-[10px] text-[var(--text-faint)]">好评率</div>
            </div>
          </div>
        </div>

        <!-- 好友在玩 -->
        <div v-if="friendsPlaying.length" class="p-4 rounded-2xl bg-[var(--surface-2)] border border-[var(--border)]">
          <h3 class="text-sm font-semibold text-[var(--text-dim)] mb-3 flex items-center gap-1.5">
            <Users class="w-4 h-4 text-accent" /> {{ friendsPlaying.length }} 位好友在玩
          </h3>
          <div class="space-y-2">
            <RouterLink v-for="f in friendsPlaying" :key="f.id" :to="`/user/${f.id}`" class="flex items-center gap-2 group">
              <img v-if="f.avatar" :src="f.avatar" :alt="f.display_name || ''"
                class="w-7 h-7 rounded-full object-cover bg-[var(--surface-3)]" />
              <div v-else class="w-7 h-7 rounded-full bg-gradient-to-br from-accent to-accent-cyan flex items-center justify-center text-white text-xs font-bold">
                {{ (f.display_name || '?')[0].toUpperCase() }}
              </div>
              <div class="min-w-0 flex-1">
                <div class="text-sm text-[var(--text)] truncate group-hover:text-accent transition-colors">{{ f.display_name }}</div>
                <div class="text-[11px] text-[var(--text-faint)]">{{ friendStatusLabel(f.status) }}</div>
              </div>
            </RouterLink>
          </div>
        </div>

        <!-- 未关注好友时的引导 -->
        <div v-else-if="showFriendsHint"
          class="p-4 rounded-2xl bg-[var(--surface-2)] border border-[var(--border)] text-xs text-[var(--text-faint)] leading-relaxed">
          <Users class="w-4 h-4 text-[var(--text-faint)] mb-1.5" />
          关注好友后，这里会显示他们正在玩的《{{ game.name }}》。去「社区」发现有趣的人吧。
        </div>
      </div>
    </div>

      <!-- Similar / 因为你玩过 -->
    <section v-if="(recReady && recommendedGames.length > 0) || similarGames.length > 0">
      <div class="flex items-center justify-between mb-4">
        <div>
          <h2 class="text-lg font-display font-bold text-[var(--text)]">
            {{ recReady && recommendedGames.length > 0 ? `💡 因为你玩过《${game.name}》` : '相似游戏' }}
          </h2>
          <p v-if="recReady && recommendedGames.length > 0" class="text-xs text-[var(--text-faint)] mt-1">
            基于你的收藏与评分行为智能推荐
          </p>
        </div>
        <RouterLink to="/explore" class="text-sm text-accent hover:text-accent-strong flex items-center gap-1">
          探索更多 <ChevronRight class="w-4 h-4" />
        </RouterLink>
      </div>
      <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        <div
          v-for="g in (recReady && recommendedGames.length > 0 ? recommendedGames : similarGames)"
          :key="g.id"
          class="space-y-1"
        >
          <GameCard :game="g" />
          <p v-if="recommendReason[g.id]" class="text-[11px] text-accent px-1 leading-tight">
            {{ recommendReason[g.id] }}
          </p>
        </div>
      </div>
    </section>

    <ShareCard v-if="shareGame" :game="shareGame" :open="showShare" @close="showShare = false" />
  </div>
  </div>
</template>
