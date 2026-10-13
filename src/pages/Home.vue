<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import {
  TrendingUp, Sparkles, Zap, Flame, DollarSign, ArrowRight, Users, Gamepad2, Heart, Target,
} from 'lucide-vue-next'
import { games } from '@/data/games'
import type { Game } from '@/types/game'
import GameCard from '@/components/GameCard.vue'
import SectionHeader from '@/components/SectionHeader.vue'
import AnimatedCounter from '@/components/AnimatedCounter.vue'
import MotionGrid from '@/components/MotionGrid.vue'
import { useGameStore } from '@/stores/gameStore'
import { useAuthStore } from '@/stores/authStore'
import { getRecommendations, type MatchedDim } from '@/lib/recommendApi'
import DiscoverCard from '@/components/DiscoverCard.vue'
import { getDiscover } from '@/lib/discoverApi'
import type { DiscoverGame } from '@/types/discover'
import { useLiveStore } from '@/stores/liveStore'
import { getAiSpotlight, getAiTrend } from '@/lib/liveApi'
import type { SpotlightResult, AiTrendResult } from '@/types/live'

const store = useGameStore()
const auth = useAuthStore()
const live = useLiveStore()

// 主页 AI 精选（公开接口，登录/未登录均可）
const spotlight = ref<SpotlightResult | null>(null)
async function loadSpotlight() {
  try {
    spotlight.value = await getAiSpotlight()
  } catch {
    spotlight.value = null
  }
}

// 今日趋势：AI 定性解读 + 本地注入的实时快照数字（后端 60s 缓存）
const trend = ref<AiTrendResult | null>(null)
async function loadTrend() {
  try {
    trend.value = await getAiTrend()
  } catch {
    trend.value = null
  }
}
let trendTimer: ReturnType<typeof setInterval> | undefined

const trendTime = computed(() => {
  const t = trend.value?.snapshot?.snapshotAt
  if (!t) return ''
  const d = new Date(t)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
})

function fmtNum(n: number): string {
  return n.toLocaleString('zh-CN')
}

onMounted(() => {
  live.init()
  store.loadReviewAggregate()
  loadForYou()
  loadMultiPlatform()
  loadSpotlight()
  loadTrend()
  trendTimer = setInterval(loadTrend, 30000)
})

onUnmounted(() => {
  if (trendTimer) clearInterval(trendTimer)
})

// 多平台热游（后端 /api/games/discover 兜底 132 款跨平台大作，按热度排序展示）
const multiPlatform = ref<DiscoverGame[]>([])
const totalGameCount = ref(games.length)

async function loadMultiPlatform() {
  try {
    const res = await getDiscover({ pageSize: 12, page: 1 })
    // 按评分人数（热度）+ 评分排序，呈现最热门的跨平台大作
    multiPlatform.value = [...res.games]
      .sort((a, b) => (b.ratingCount || 0) - (a.ratingCount || 0) || b.rating - a.rating)
      .slice(0, 12)
    // 更新「收录游戏」统计：精选库 + 多平台目录总数（res.count 可能不存在时兜底 games.length）
    totalGameCount.value = games.length + (res.count || res.games.length || 0)
  } catch {
    multiPlatform.value = []
  }
}

// ── 统计卡片（computed 确保传纯数字给 AnimatedCounter）──
const statValues = computed(() => ({
  games: totalGameCount.value || games.length,
}))

// 实时指标：取自后端 /api/live。
// real 标记区分「真实数据（Steam 官方接口）」与「演示数据」——演示值一律打角标，不假装实时。
const stats = computed(() => {
  const g = live.data?.global
  const r = live.data?.real
  return [
    { icon: Gamepad2, label: '收录游戏', value: g?.totalGames ?? games.length, suffix: '+', decimals: 0, color: 'text-accent', glow: 'bg-accent/10', real: r?.totalGames ?? true },
    { icon: Users, label: '在线玩家', value: Math.round((g?.onlinePlayers ?? 0) / 10000), suffix: '万+', decimals: 0, color: 'text-accent-blue', glow: 'bg-accent-blue/10', real: r?.onlinePlayers ?? true },
    { icon: DollarSign, label: '特价中', value: g?.deals ?? 0, suffix: '', decimals: 0, color: 'text-accent-pink', glow: 'bg-accent-pink/10', real: r?.deals ?? true },
    { icon: TrendingUp, label: '今日上新', value: g?.newToday ?? 0, suffix: '+', decimals: 0, color: 'text-accent-green', glow: 'bg-accent-green/10', real: r?.newToday ?? true },
  ]
})

// 上方四张卡是否全部为真实数据（决定底部那行状态标，避免张冠李戴）
const statsAllReal = computed(() => stats.value.every((s) => s.real))

const trending = [...games].sort((a, b) => b.playerCount - a.playerCount).slice(0, 6)
const newReleases = games
  .filter((g) => new Date(g.releaseDate) >= new Date('2024-01-01'))
  .sort((a, b) => new Date(b.releaseDate).getTime() - new Date(a.releaseDate).getTime())
  .slice(0, 6)
const hotDeals = games.filter((g) => g.discount > 0).slice(0, 6)
const topStreaming = [...games].sort((a, b) => b.twitchViewers - a.twitchViewers).slice(0, 6)
const topRated = [...games].sort((a, b) => b.rating - a.rating).slice(0, 4)

const recentGames = computed(() =>
  store.recentlyViewed
    .map((id) => games.find((g) => g.id === id))
    .filter((g): g is (typeof games)[number] => Boolean(g)),
)

// 个性化推荐（后端驱动：登录时基于收藏/在玩/通关/评分构建兴趣画像；
// 未登录或冷启动返回热门兜底，personalized=false）
const forYou = ref<Game[]>([])
const forYouReason = ref<Record<string, string>>({})
const forYouPersonalized = ref(false)
const forYouLoading = ref(false)
// 画像驱动的「匹配度」与「命中维度」（仅个性化时后端下发，匿名/冷启动为空）
const forYouMatch = ref<Record<string, number>>({})
const forYouDims = ref<Record<string, MatchedDim[]>>({})
const forYouEngine = ref<string | null>(null)

async function loadForYou() {
  forYouLoading.value = true
  try {
    const res = await getRecommendations()
    const byId = new Map(res.recommendations.map((r) => [r.id, r]))
    const list = res.recommendations
      .map((r) => games.find((x) => x.id === r.id))
      .filter((x): x is Game => Boolean(x))
    forYou.value = list
    forYouReason.value = Object.fromEntries(list.map((x) => [x.id, byId.get(x.id)?.reason ?? '']))
    forYouMatch.value = Object.fromEntries(list.map((x) => [x.id, byId.get(x.id)?.match ?? 0]))
    forYouDims.value = Object.fromEntries(list.map((x) => [x.id, byId.get(x.id)?.matchedDims ?? []]))
    forYouPersonalized.value = res.personalized
    forYouEngine.value = res.engine ?? null
  } catch {
    forYou.value = []
  } finally {
    forYouLoading.value = false
  }
}

// ── 统计卡片已上移为 computed ──
</script>

<template>
  <div class="space-y-12 pb-12">
    <!-- Hero -->
    <section class="relative overflow-hidden rounded-3xl bg-[var(--surface)] border border-[var(--border)] p-8 lg:p-12">
      <div class="absolute inset-0 opacity-[0.05] [background-image:linear-gradient(var(--border)_1px,transparent_1px),linear-gradient(90deg,var(--border)_1px,transparent_1px)] [background-size:34px_34px]" />
      <div class="absolute -top-24 -right-24 w-96 h-96 bg-accent/20 rounded-full blur-3xl" />
      <div class="absolute -bottom-24 -left-24 w-80 h-80 bg-accent-cyan/15 rounded-full blur-3xl" />
      <div class="absolute top-1/3 right-1/4 w-64 h-64 bg-accent-pink/10 rounded-full blur-3xl" />

      <div class="relative z-10">
        <div class="flex items-center gap-2 mb-4 flex-wrap hero-badge-enter">
          <div class="flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent/10 border border-accent/30">
            <Sparkles class="w-3.5 h-3.5 text-accent" />
            <span class="text-xs text-accent font-medium">AI 驱动 · 智能发现</span>
          </div>
          <div class="px-3 py-1 rounded-full bg-accent-green/10 border border-accent-green/30 text-xs text-accent-green font-medium">
            v2.0 视觉焕新
          </div>
        </div>

        <h1 class="text-4xl lg:text-5xl font-display font-bold text-[var(--text)] mb-3 leading-tight">
          发现你的
          <span class="bg-gradient-to-r from-accent via-accent-cyan to-accent-pink bg-clip-text text-transparent"> 下一款游戏</span>
        </h1>
        <p class="text-[var(--text-faint)] text-lg max-w-xl mb-8">
          聚合多平台游戏库、热门排行、实时直播热度与 AI 个性化推荐——一站式发现值得玩的游戏。
        </p>

        <div class="flex flex-wrap gap-3">
          <RouterLink
            to="/explore"
            class="px-6 py-3 rounded-xl bg-accent hover:bg-accent-strong text-white font-semibold transition-all flex items-center gap-2 shadow-lg shadow-accent/25"
          >
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            开始探索
            <ArrowRight class="w-4 h-4" />
          </RouterLink>
          <RouterLink
            to="/ai"
            class="px-6 py-3 rounded-xl bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text)] font-semibold transition-all flex items-center gap-2 border border-[var(--border)]"
          >
            <Sparkles class="w-4 h-4" />
            问问 AI 助手
          </RouterLink>
        </div>

        <!-- Stats -->
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-10">
          <div
            v-for="s in stats"
            :key="s.label"
            class="p-4 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] fade-in-up"
            style="animation-delay: 0.3s"
          >
            <div :class="`w-9 h-9 rounded-lg ${s.glow} flex items-center justify-center mb-2`">
              <component :is="s.icon" :class="`w-5 h-5 ${s.color}`" />
            </div>
            <div :class="`text-2xl font-display font-bold ${s.color}`">
              <AnimatedCounter :value="s.value" :suffix="s.suffix" :decimals="s.decimals || 0" />
            </div>
            <div class="flex items-center gap-1.5 mt-1">
              <span class="text-xs text-[var(--text-faint)]">{{ s.label }}</span>
              <span
                v-if="live.data"
                :class="
                  s.real
                    ? 'bg-accent-green/10 text-accent-green border-accent-green/20'
                    : 'bg-accent-amber/10 text-accent-amber border-accent-amber/25'
                "
                class="text-[9px] leading-none px-1 py-0.5 rounded border"
              >{{ s.real ? '实时' : '演示' }}</span>
            </div>
          </div>
        </div>
        <p class="mt-4 flex flex-wrap items-center gap-2 text-xs text-[var(--text-faint)]">
          <span
            :class="
              !live.data || statsAllReal
                ? 'bg-accent-green/10 text-accent-green'
                : 'bg-accent-amber/10 text-accent-amber'
            "
            class="flex items-center gap-1.5 px-2 py-0.5 rounded-full"
          >
            <span
              :class="!live.data || statsAllReal ? 'bg-accent-green' : 'bg-accent-amber'"
              class="w-1.5 h-1.5 rounded-full animate-pulse"
            />
            {{ !live.data ? '连接中' : statsAllReal ? '实时' : '含演示数据' }}
          </span>
          <span>数据每 5 秒刷新 · 更新于 {{ live.secondsAgo }}s 前</span>
        </p>
        <p v-if="live.data?.source" class="mt-1 text-[10px] text-[var(--text-faint)] opacity-80">
          数据来源：{{ live.data.source }}
        </p>
      </div>
    </section>

    <!-- AI 精选（首屏第一块：打开即见 AI） -->
    <section v-if="spotlight" class="space-y-4">
      <SectionHeader
        title="✨ AI 精选"
        :subtitle="spotlight.aiPowered ? '由 AI 基于真实目录为你撰写' : '今日 AI 精选 · 规则推荐'"
      >
        <template #action>
          <RouterLink to="/ai" class="text-sm text-accent hover:text-accent-strong flex items-center gap-1 transition-colors">
            问 AI <ArrowRight class="w-4 h-4" />
          </RouterLink>
        </template>
      </SectionHeader>
      <div class="rounded-2xl bg-[var(--surface-2)] border border-accent/20 p-5 lg:p-6">
        <p class="text-[var(--text)] text-sm leading-relaxed">{{ spotlight.text }}</p>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
          <RouterLink
            v-for="g in spotlight.games"
            :key="g.id"
            :to="`/game/${g.id}`"
            class="group p-3 rounded-xl bg-[var(--surface-3)] hover:bg-[var(--surface)] border border-transparent hover:border-accent/30 transition-all"
          >
            <div class="text-sm font-semibold text-[var(--text)] group-hover:text-accent transition-colors">{{ g.name }}</div>
            <div class="text-xs text-accent mt-1 leading-snug">{{ g.reason }}</div>
          </RouterLink>
        </div>
      </div>
    </section>

    <!-- AI 今日趋势 -->
    <section v-if="trend" class="space-y-4">
      <SectionHeader
        title="📈 AI 今日趋势"
        :subtitle="trend.aiPowered ? '由 AI 实时解读平台热度走向' : '实时热度快照 · 规则解读'"
      >
        <template #action>
          <span class="text-xs text-[var(--text-faint)] flex items-center gap-1.5">
            <span class="inline-block w-1.5 h-1.5 rounded-full bg-accent animate-pulse"></span>
            实时 · {{ trendTime }} 快照
          </span>
        </template>
      </SectionHeader>
      <div class="rounded-2xl bg-[var(--surface-2)] border border-accent/20 p-5 lg:p-6 grid gap-5 lg:grid-cols-5">
        <div class="lg:col-span-3 flex flex-col justify-between gap-4">
          <p class="text-[var(--text)] text-sm leading-relaxed">{{ trend.text }}</p>
          <div class="flex flex-wrap gap-x-6 gap-y-2">
            <div>
              <div class="text-lg font-display font-bold text-[var(--text)] tabular-nums">{{ fmtNum(trend.snapshot.onlinePlayers) }}</div>
              <div class="text-[11px] text-[var(--text-faint)] flex items-center gap-1">
                <span>全网在线</span>
                <span v-if="trend.snapshot.real && !trend.snapshot.real.onlinePlayers" class="text-[9px] leading-none px-1 py-0.5 rounded bg-accent-amber/10 text-accent-amber border border-accent-amber/25">演示</span>
              </div>
            </div>
            <div>
              <div class="text-lg font-display font-bold text-[var(--text)] tabular-nums">{{ fmtNum(trend.snapshot.streamingViewers) }}</div>
              <div class="text-[11px] text-[var(--text-faint)] flex items-center gap-1">
                <span>直播观众</span>
                <span v-if="trend.snapshot.real && !trend.snapshot.real.streamingViewers" class="text-[9px] leading-none px-1 py-0.5 rounded bg-accent-amber/10 text-accent-amber border border-accent-amber/25">演示</span>
              </div>
            </div>
            <div>
              <div class="text-lg font-display font-bold text-[var(--text)] tabular-nums">{{ trend.snapshot.newToday }}</div>
              <div class="text-[11px] text-[var(--text-faint)] flex items-center gap-1">
                <span>今日上新</span>
                <span v-if="trend.snapshot.real && !trend.snapshot.real.newToday" class="text-[9px] leading-none px-1 py-0.5 rounded bg-accent-amber/10 text-accent-amber border border-accent-amber/25">演示</span>
              </div>
            </div>
            <div>
              <div class="text-lg font-display font-bold text-[var(--text)] tabular-nums">{{ trend.snapshot.deals }}</div>
              <div class="text-[11px] text-[var(--text-faint)] flex items-center gap-1">
                <span>今日特价</span>
                <span v-if="trend.snapshot.real && !trend.snapshot.real.deals" class="text-[9px] leading-none px-1 py-0.5 rounded bg-accent-amber/10 text-accent-amber border border-accent-amber/25">演示</span>
              </div>
            </div>
          </div>
        </div>
        <div class="lg:col-span-2 space-y-2">
          <div class="text-[11px] text-[var(--text-faint)] uppercase tracking-wide">热度榜</div>
          <RouterLink
            v-for="g in trend.snapshot.hot"
            :key="g.id"
            :to="`/game/${g.id}`"
            class="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[var(--surface-3)] hover:bg-[var(--surface)] border border-transparent hover:border-accent/30 transition-all"
          >
            <span class="text-sm text-[var(--text)] truncate">{{ g.name }}</span>
            <span class="flex items-center gap-2 shrink-0">
              <span class="text-xs text-[var(--text-faint)] tabular-nums">{{ fmtNum(g.onlinePlayers) }}</span>
              <span
                class="text-xs font-medium tabular-nums w-14 text-right"
                :class="g.delta >= 0 ? 'text-accent' : 'text-[var(--text-faint)]'"
              >{{ g.delta >= 0 ? '↗' : '↘' }}{{ Math.abs(g.delta).toFixed(1) }}%</span>
            </span>
          </RouterLink>
        </div>
      </div>
    </section>

    <!-- 推荐位：登录=画像个性化；匿名=AI 依据口碑与热度挑选（无「登录墙」） -->
    <section v-if="forYou.length > 0">
      <SectionHeader
        :title="forYouPersonalized ? '🎯 为你推荐' : '🤖 AI 推荐'"
        :subtitle="forYouPersonalized
          ? (forYouEngine === 'profile-semantic' ? '按你的口味画像匹配 · 标注匹配度与命中维度' : '基于你的收藏、在玩与评分行为')
          : 'AI 依据全站口碑与热度挑选'"
      >
        <template #action>
          <RouterLink to="/favorites" class="text-sm text-accent hover:text-accent-strong flex items-center gap-1 transition-colors">
            管理收藏 <ArrowRight class="w-4 h-4" />
          </RouterLink>
        </template>
      </SectionHeader>
      <MotionGrid class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <div v-for="game in forYou" :key="game.id" class="space-y-1">
          <GameCard :game="game" />
          <!-- 画像匹配：匹配度 + 命中维度（仅个性化推荐时出现） -->
          <div
            v-if="forYouPersonalized && (forYouMatch[game.id] || forYouDims[game.id]?.length)"
            class="flex flex-wrap items-center gap-1 px-1 pt-0.5"
          >
            <span
              v-if="forYouMatch[game.id]"
              class="inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-accent/15 text-accent border border-accent/25"
            >
              <Target class="w-2.5 h-2.5" />匹配 {{ forYouMatch[game.id] }}%
            </span>
            <span
              v-for="d in forYouDims[game.id]"
              :key="d.key"
              class="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--surface-3)] text-[var(--text-dim)] border border-[var(--border)]"
            >
              {{ d.label }}
            </span>
          </div>
          <p v-if="forYouReason[game.id]" class="text-[11px] text-accent px-1 leading-tight">
            {{ forYouReason[game.id] }}
          </p>
        </div>
      </MotionGrid>
    </section>

    <!-- 多平台热游 -->
    <section v-if="multiPlatform.length > 0">
      <SectionHeader
        title="🌍 多平台热游"
        subtitle="Xbox · PlayStation · Switch · Epic · 移动端 · 网页 —— 全网大作一站发现"
      >
        <template #action>
          <RouterLink to="/explore" class="text-sm text-accent hover:text-accent-strong flex items-center gap-1 transition-colors">
            探索全部 <ArrowRight class="w-4 h-4" />
          </RouterLink>
        </template>
      </SectionHeader>
      <MotionGrid class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <DiscoverCard v-for="g in multiPlatform" :key="g.id" :game="g" />
      </MotionGrid>
    </section>

    <!-- 最近浏览 -->
    <section v-if="recentGames.length > 0">
      <SectionHeader title="👀 最近浏览" subtitle="你最近看过的游戏">
        <template #action>
          <RouterLink to="/explore" class="text-sm text-accent hover:text-accent-strong flex items-center gap-1 transition-colors">
            探索更多 <ArrowRight class="w-4 h-4" />
          </RouterLink>
        </template>
      </SectionHeader>
      <MotionGrid class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <GameCard v-for="game in recentGames" :key="game.id" :game="game" />
      </MotionGrid>
    </section>

    <!-- 热门排行 -->
    <section>
      <SectionHeader title="🔥 热门排行" subtitle="当前在线玩家最多的游戏">
        <template #action>
          <RouterLink to="/explore?sort=playerCount" class="text-sm text-accent hover:text-accent-strong flex items-center gap-1 transition-colors">
            查看全部 <ArrowRight class="w-4 h-4" />
          </RouterLink>
        </template>
      </SectionHeader>
      <MotionGrid class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <div v-for="(game, i) in trending" :key="game.id" class="relative">
          <div
            v-if="i < 3"
            class="absolute -top-2 -left-2 z-10 w-7 h-7 rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center text-xs font-bold text-white shadow-lg"
          >
            {{ i + 1 }}
          </div>
          <GameCard :game="game" />
        </div>
      </MotionGrid>
    </section>

    <!-- 新品 + 折扣 -->
    <div class="grid lg:grid-cols-2 gap-12">
      <section>
        <SectionHeader title="🎮 新品上架" subtitle="最近发布的热门游戏">
          <template #action>
            <RouterLink to="/explore?sort=releaseDate" class="text-sm text-accent hover:text-accent-strong flex items-center gap-1 transition-colors">
              查看全部 <ArrowRight class="w-4 h-4" />
            </RouterLink>
          </template>
        </SectionHeader>
        <MotionGrid class="grid grid-cols-2 md:grid-cols-3 gap-4">
          <GameCard v-for="game in newReleases" :key="game.id" :game="game" />
        </MotionGrid>
      </section>

      <section>
        <SectionHeader title="💰 限时折扣" subtitle="超值优惠不容错过">
          <template #action>
            <RouterLink to="/deals" class="text-sm text-accent hover:text-accent-strong flex items-center gap-1 transition-colors">
              查看全部 <ArrowRight class="w-4 h-4" />
            </RouterLink>
          </template>
        </SectionHeader>
        <MotionGrid class="grid grid-cols-2 md:grid-cols-3 gap-4">
          <GameCard v-for="game in hotDeals" :key="game.id" :game="game" />
        </MotionGrid>
      </section>
    </div>

    <!-- 直播热度 -->
    <section>
      <SectionHeader title="📺 直播热游" subtitle="Twitch 观看人数最多的游戏" />
      <MotionGrid class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <GameCard v-for="game in topStreaming" :key="game.id" :game="game" />
      </MotionGrid>
    </section>

    <!-- 高分神作 -->
    <section>
      <SectionHeader title="⭐ 高分神作" subtitle="玩家口碑最好的游戏" />
      <MotionGrid class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div
          v-for="game in topRated"
          :key="game.id"
          class="relative rounded-2xl overflow-hidden bg-[var(--surface-2)] border border-[var(--border)] p-4 hover:border-accent/30 transition-all group"
        >
          <div class="flex items-start gap-4">
            <div class="w-16 h-20 rounded-xl overflow-hidden bg-[var(--surface-3)] shrink-0">
              <img :src="game.coverUrl" :alt="game.name" class="w-full h-full object-cover" loading="lazy" />
            </div>
            <div class="flex-1 min-w-0">
              <RouterLink :to="`/game/${game.id}`" class="text-sm font-semibold text-[var(--text)] hover:text-accent transition-colors line-clamp-1">
                {{ game.name }}
              </RouterLink>
              <div class="flex items-center gap-1 mt-1 text-accent-amber text-xs">
                <span v-for="i in 5" :key="i">{{ i <= Math.floor(game.rating / 2) ? '★' : '☆' }}</span>
                <span class="text-[var(--text-faint)] ml-1">{{ game.rating }}</span>
              </div>
              <p class="text-xs text-[var(--text-faint)] mt-2 line-clamp-2">{{ game.description.slice(0, 60) }}...</p>
            </div>
          </div>
        </div>
      </MotionGrid>
    </section>

    <!-- CTA -->
    <section class="text-center py-12 rounded-3xl bg-gradient-to-br from-[var(--surface-2)] to-accent/10 border border-[var(--border)]">
      <Zap class="w-10 h-10 text-accent mx-auto mb-4" />
      <h2 class="text-2xl font-display font-bold text-[var(--text)] mb-2">还没找到合适的？</h2>
      <p class="text-[var(--text-faint)] mb-6 max-w-md mx-auto">
        让 AI 助手根据你的偏好，从海量游戏中为你精准推荐
      </p>
      <RouterLink
        to="/ai"
        class="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-accent hover:bg-accent-strong text-white font-semibold transition-all shadow-lg shadow-accent/25"
      >
        <Sparkles class="w-4 h-4" />
        与 AI 助手对话
      </RouterLink>
    </section>
  </div>
</template>
