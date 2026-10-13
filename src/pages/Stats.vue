<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import VChart from 'vue-echarts'
import {
  BarChart, Heart, Gamepad2, CheckCircle2, Star, Eye, Library,
  Loader2, Inbox, ArrowRight, Sparkles,
} from 'lucide-vue-next'
import { games } from '@/data/games'
import { useAuthStore } from '@/stores/authStore'
import { getMyStats, type StatsResponse } from '@/lib/statsApi'
import { relativeTime } from '@/lib/reviewApi'
import { CHART_COLORS, CHART_TEXT, CHART_BORDER } from '@/lib/echarts'

const router = useRouter()
const auth = useAuthStore()

const stats = ref<StatsResponse | null>(null)
const loading = ref(false)
const error = ref('')

onMounted(async () => {
  if (!auth.isLoggedIn) return
  loading.value = true
  error.value = ''
  try {
    stats.value = await getMyStats()
  } catch (e) {
    error.value = (e as Error).message || '加载失败'
  } finally {
    loading.value = false
  }
})

// ── 统计卡片 ──
const cards = computed(() => {
  const s = stats.value?.summary
  if (!s) return []
  return [
    { label: '想玩', value: s.wishlist, icon: Heart, color: CHART_COLORS[0] },
    { label: '在玩', value: s.playing, icon: Gamepad2, color: CHART_COLORS[1] },
    { label: '通关', value: s.completed, icon: CheckCircle2, color: CHART_COLORS[2] },
    { label: '我的评论', value: s.reviews, icon: Star, color: CHART_COLORS[3] },
    { label: '最近浏览', value: s.recent, icon: Eye, color: CHART_COLORS[4] },
    { label: '收藏', value: s.favorites, icon: Library, color: CHART_COLORS[5] },
  ]
})

// ── 类型分布（用 external_id 匹配精选库 genres，RAWG 游戏归「其他」）──
const genreData = computed(() => {
  if (!stats.value) return []
  const dist: Record<string, number> = {}
  for (const item of stats.value.library) {
    const g = games.find((x) => x.id === item.external_id)
    if (g && g.genres.length) g.genres.forEach((genre) => { dist[genre] = (dist[genre] || 0) + 1 })
    else dist['其他/未分类'] = (dist['其他/未分类'] || 0) + 1
  }
  return Object.entries(dist).map(([name, value]) => ({ name, value }))
})

// ── 评分分布（1-5 星直方图）──
const ratingBuckets = computed(() => {
  if (!stats.value) return [0, 0, 0, 0, 0]
  const b = [0, 0, 0, 0, 0]
  for (const r of stats.value.reviews) {
    if (r.rating == null) continue
    const idx = Math.min(4, Math.max(0, Math.round(r.rating) - 1))
    b[idx]++
  }
  return b
})

const isEmpty = computed(() => {
  const s = stats.value?.summary
  return !s || (s.totalLibrary === 0 && s.reviews === 0 && s.recent === 0)
})

// ── 图表 options ──
const genreOption = computed(() => ({
  tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
  legend: {
    type: 'scroll', orient: 'vertical', right: 0, top: 'middle',
    textStyle: { color: CHART_TEXT }, pageTextStyle: { color: CHART_TEXT },
  },
  series: [{
    type: 'pie',
    radius: ['42%', '70%'],
    center: ['36%', '52%'],
    avoidLabelOverlap: true,
    itemStyle: { borderColor: 'var(--surface-2)', borderWidth: 2, borderRadius: 6 },
    label: { show: false },
    data: genreData.value,
    color: CHART_COLORS,
  }],
}))

const statusOption = computed(() => {
  const s = stats.value?.summary
  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 36, right: 16, top: 16, bottom: 28 },
    xAxis: {
      type: 'category', data: ['想玩', '在玩', '通关'],
      axisLabel: { color: CHART_TEXT }, axisLine: { lineStyle: { color: CHART_BORDER } }, axisTick: { show: false },
    },
    yAxis: {
      type: 'value', minInterval: 1,
      axisLabel: { color: CHART_TEXT }, splitLine: { lineStyle: { color: CHART_BORDER } },
    },
    series: [{
      type: 'bar',
      data: [s?.wishlist || 0, s?.playing || 0, s?.completed || 0],
      color: CHART_COLORS[0],
      barWidth: '46%',
      itemStyle: { borderRadius: [6, 6, 0, 0] },
    }],
  }
})

const ratingOption = computed(() => ({
  tooltip: { trigger: 'axis' },
  grid: { left: 36, right: 16, top: 16, bottom: 28 },
  xAxis: {
    type: 'category', data: ['1星', '2星', '3星', '4星', '5星'],
    axisLabel: { color: CHART_TEXT }, axisLine: { lineStyle: { color: CHART_BORDER } }, axisTick: { show: false },
  },
  yAxis: {
    type: 'value', minInterval: 1,
    axisLabel: { color: CHART_TEXT }, splitLine: { lineStyle: { color: CHART_BORDER } },
  },
  series: [{
    type: 'bar',
    data: ratingBuckets.value,
    color: CHART_COLORS[2],
    barWidth: '52%',
    itemStyle: { borderRadius: [6, 6, 0, 0] },
  }],
}))

// ── 最近动态（浏览 + 评论合并按时间）──
function resolveGame(gameId: string) {
  const g = games.find((x) => x.id === gameId)
  if (g) return { name: g.name, cover: g.coverUrl }
  const lib = stats.value?.library.find((l) => l.external_id === gameId)
  if (lib) return { name: lib.name, cover: lib.cover_url }
  return { name: gameId, cover: null }
}

const activities = computed(() => {
  if (!stats.value) return []
  const items: { kind: 'view' | 'review'; gameId: string; time: number; rating?: number | null; content?: string | null }[] = []
  for (const r of stats.value.recent) items.push({ kind: 'view', gameId: r.game_id, time: r.viewed_at })
  for (const rv of stats.value.reviews) items.push({ kind: 'review', gameId: rv.game_id, time: rv.created_at, rating: rv.rating, content: rv.content })
  return items.sort((a, b) => b.time - a.time).slice(0, 10)
})
</script>

<template>
  <div class="max-w-6xl mx-auto px-4 sm:px-6 py-8">
    <!-- 未登录 -->
    <div v-if="!auth.isLoggedIn" class="flex flex-col items-center justify-center py-24 text-center">
      <div class="w-16 h-16 rounded-2xl bg-accent/10 flex items-center justify-center mb-4">
        <BarChart class="w-8 h-8 text-accent" />
      </div>
      <h2 class="text-xl font-display font-bold text-[var(--text)] mb-2">登录后查看你的游戏数据看板</h2>
      <p class="text-[var(--text-dim)] mb-6 max-w-md">收藏、在玩、通关、评分、最近浏览——你的全部游戏足迹都会在这里变成可视化图表。</p>
      <RouterLink to="/login" class="px-5 py-2.5 rounded-xl bg-accent text-white text-sm font-medium hover:bg-accent-strong transition-colors">
        去登录
      </RouterLink>
    </div>

    <!-- 加载 -->
    <div v-else-if="loading" class="flex flex-col items-center justify-center py-24 text-[var(--text-dim)]">
      <Loader2 class="w-8 h-8 animate-spin text-accent mb-3" />
      正在加载你的数据看板…
    </div>

    <!-- 错误 -->
    <div v-else-if="error" class="flex flex-col items-center justify-center py-24 text-center">
      <Inbox class="w-10 h-10 text-accent-red mb-3" />
      <p class="text-[var(--text-dim)]">加载失败：{{ error }}</p>
    </div>

    <!-- 空状态 -->
    <div v-else-if="isEmpty" class="flex flex-col items-center justify-center py-24 text-center">
      <div class="w-16 h-16 rounded-2xl bg-accent/10 flex items-center justify-center mb-4">
        <Sparkles class="w-8 h-8 text-accent" />
      </div>
      <h2 class="text-xl font-display font-bold text-[var(--text)] mb-2">你的数据看板还是空的</h2>
      <p class="text-[var(--text-dim)] mb-6 max-w-md">去收藏几款游戏、标记「在玩 / 通关」、发条评价，这里就会长出你的专属游戏画像。</p>
      <RouterLink to="/explore" class="px-5 py-2.5 rounded-xl bg-accent text-white text-sm font-medium hover:bg-accent-strong transition-colors inline-flex items-center gap-1.5">
        去探索游戏 <ArrowRight class="w-4 h-4" />
      </RouterLink>
    </div>

    <!-- 内容 -->
    <div v-else>
      <header class="mb-8">
        <h1 class="text-2xl font-display font-bold text-[var(--text)] flex items-center gap-2">
          <BarChart class="w-6 h-6 text-accent" /> 我的游戏数据看板
        </h1>
        <p class="text-[var(--text-dim)] mt-1">嗨 {{ auth.user?.display_name || auth.user?.username }}，这是你目前在主机的全部足迹。</p>
      </header>

      <!-- 统计卡片 -->
      <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
        <div v-for="c in cards" :key="c.label" class="p-4 rounded-2xl bg-[var(--surface-2)] border border-[var(--border)]">
          <component :is="c.icon" class="w-5 h-5 mb-2" :style="{ color: c.color }" />
          <div class="text-2xl font-display font-bold text-[var(--text)]">{{ c.value }}</div>
          <div class="text-xs text-[var(--text-faint)] mt-0.5">{{ c.label }}</div>
        </div>
      </div>

      <!-- 图表区 -->
      <div class="grid lg:grid-cols-3 gap-6 mb-8">
        <div class="p-6 rounded-2xl bg-[var(--surface-2)] border border-[var(--border)]">
          <h3 class="text-sm font-semibold text-[var(--text-dim)] mb-2">类型偏好分布</h3>
          <div style="height: 300px">
            <VChart v-if="genreData.length" :option="genreOption" autoresize style="width: 100%; height: 100%" />
            <div v-else class="flex items-center justify-center h-full text-[var(--text-faint)] text-sm">暂无收藏数据</div>
          </div>
        </div>

        <div class="p-6 rounded-2xl bg-[var(--surface-2)] border border-[var(--border)]">
          <h3 class="text-sm font-semibold text-[var(--text-dim)] mb-2">收藏状态分布</h3>
          <div style="height: 300px">
            <VChart :option="statusOption" autoresize style="width: 100%; height: 100%" />
          </div>
        </div>

        <div class="p-6 rounded-2xl bg-[var(--surface-2)] border border-[var(--border)]">
          <h3 class="text-sm font-semibold text-[var(--text-dim)] mb-2">我的评分分布</h3>
          <div style="height: 300px">
            <VChart v-if="ratingBuckets.some((b) => b > 0)" :option="ratingOption" autoresize style="width: 100%; height: 100%" />
            <div v-else class="flex items-center justify-center h-full text-[var(--text-faint)] text-sm">还没有评分</div>
          </div>
        </div>
      </div>

      <!-- 最近动态 -->
      <div class="p-6 rounded-2xl bg-[var(--surface-2)] border border-[var(--border)]">
        <h3 class="text-sm font-semibold text-[var(--text-dim)] mb-4">最近动态</h3>
        <div v-if="activities.length === 0" class="text-[var(--text-faint)] text-sm py-4 text-center">暂无动态</div>
        <ul v-else class="space-y-3">
          <li v-for="(a, i) in activities" :key="i" class="flex items-center gap-3">
            <RouterLink :to="`/game/${a.gameId}`" class="w-10 h-12 rounded-lg overflow-hidden bg-[var(--surface-3)] shrink-0 flex items-center justify-center text-[var(--text-faint)] text-xs font-bold">
              <img v-if="resolveGame(a.gameId).cover" :src="resolveGame(a.gameId).cover!" :alt="resolveGame(a.gameId).name" class="w-full h-full object-cover" loading="lazy" />
              <span v-else>{{ resolveGame(a.gameId).name.slice(0, 1) }}</span>
            </RouterLink>
            <div class="min-w-0 flex-1">
              <div class="text-sm text-[var(--text)]">
                <span v-if="a.kind === 'view'" class="text-[var(--text-dim)]">浏览了</span>
                <span v-else class="text-[var(--text-dim)]">评价了</span>
                <RouterLink :to="`/game/${a.gameId}`" class="font-medium hover:text-accent transition-colors">《{{ resolveGame(a.gameId).name }}》</RouterLink>
                <span v-if="a.kind === 'review' && a.rating != null" class="text-accent-amber ml-1">★ {{ a.rating }}</span>
              </div>
              <div v-if="a.kind === 'review' && a.content" class="text-xs text-[var(--text-faint)] truncate mt-0.5">{{ a.content }}</div>
            </div>
            <span class="text-xs text-[var(--text-faint)] shrink-0">{{ relativeTime(a.time) }}</span>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
