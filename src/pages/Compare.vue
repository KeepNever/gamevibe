<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import VChart from 'vue-echarts'
import { X, Scale, ArrowRight, Star, Users, Tv, Gamepad2 } from 'lucide-vue-next'
import { useGameStore } from '@/stores/gameStore'
import { games } from '@/data/games'
import { CHART_TEXT, CHART_BORDER, CHART_COLORS } from '@/lib/echarts'
import '@/lib/echarts'
import EmptyState from '@/components/EmptyState.vue'

const store = useGameStore()
const compareGames = computed(() => games.filter((g) => store.compareIds.includes(g.id)))

const scoreKeys: Record<string, keyof (typeof games)[number]['scores']> = {
  玩法: 'gameplay',
  画面: 'graphics',
  剧情: 'story',
  音乐: 'music',
  重玩性: 'replayability',
  优化: 'performance',
}

const radarOption = computed(() => {
  const gs = compareGames.value
  if (gs.length < 2) return {}
  return {
    radar: {
      indicator: Object.keys(scoreKeys).map((k) => ({ name: k, max: 10 })),
      axisName: { color: CHART_TEXT, fontSize: 11 },
      splitLine: { lineStyle: { color: CHART_BORDER } },
      splitArea: { areaStyle: { color: ['transparent'] } },
      axisLine: { lineStyle: { color: CHART_BORDER } },
    },
    legend: { bottom: 0, textStyle: { color: CHART_TEXT, fontSize: 11 } },
    series: [
      {
        type: 'radar',
        data: gs.map((g, i) => ({
          value: Object.values(scoreKeys).map((k) => g.scores[k]),
          name: g.name,
          lineStyle: { color: CHART_COLORS[i] },
          areaStyle: { color: CHART_COLORS[i] + '1a' },
          itemStyle: { color: CHART_COLORS[i] },
        })),
      },
    ],
  }
})

const barOption = computed(() => {
  const gs = compareGames.value
  if (gs.length < 2) return {}
  const metrics = [
    { label: '评分', fn: (g: (typeof gs)[number]) => g.rating },
    { label: '价格', fn: (g: (typeof gs)[number]) => g.price },
    { label: '在线(千)', fn: (g: (typeof gs)[number]) => +(g.playerCount / 1000).toFixed(1) },
    { label: '直播(千)', fn: (g: (typeof gs)[number]) => +(g.twitchViewers / 1000).toFixed(1) },
  ]
  const data = metrics.map((m) => {
    const row: Record<string, string | number> = { metric: m.label }
    gs.forEach((g) => (row[g.name] = m.fn(g)))
    return row
  })
  return {
    grid: { left: 70, right: 20, top: 20, bottom: 20 },
    legend: { bottom: 0, textStyle: { color: CHART_TEXT, fontSize: 11 } },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: '#1e293b',
      borderColor: CHART_BORDER,
      textStyle: { color: '#e2e8f0' },
    },
    xAxis: { type: 'value', axisLabel: { color: CHART_TEXT, fontSize: 11 }, splitLine: { lineStyle: { color: CHART_BORDER } } },
    yAxis: { type: 'category', data: metrics.map((m) => m.label), axisLabel: { color: CHART_TEXT, fontSize: 11 } },
    series: gs.map((g, i) => ({
      name: g.name,
      type: 'bar',
      data: metrics.map((m) => m.fn(g)),
      itemStyle: { color: CHART_COLORS[i], borderRadius: [0, 4, 4, 0] },
    })),
  }
})

const tableRows = [
  { label: '评分', render: (g: (typeof compareGames.value)[number]) => `★ ${g.rating}` },
  { label: '价格', render: (g: (typeof compareGames.value)[number]) => (g.price === 0 ? '免费' : `¥${g.price}`) },
  { label: '类型', render: (g: (typeof compareGames.value)[number]) => g.genres.join(' / ') },
  { label: '平台', render: (g: (typeof compareGames.value)[number]) => g.platforms.join(' / ') },
  { label: '发行商', render: (g: (typeof compareGames.value)[number]) => g.publisher },
  { label: '发售日', render: (g: (typeof compareGames.value)[number]) => g.releaseDate },
  {
    label: '好评率',
    render: (g: (typeof compareGames.value)[number]) =>
      `${((g.reviewsSummary.positive / (g.reviewsSummary.positive + g.reviewsSummary.negative)) * 100).toFixed(0)}%`,
  },
  {
    label: '在线玩家',
    render: (g: (typeof compareGames.value)[number]) =>
      g.playerCount >= 1000 ? `${(g.playerCount / 1000).toFixed(1)}K` : g.playerCount,
  },
  {
    label: '直播观众',
    render: (g: (typeof compareGames.value)[number]) =>
      g.twitchViewers >= 1000 ? `${(g.twitchViewers / 1000).toFixed(1)}K` : g.twitchViewers,
  },
]

const insight = computed(() => {
  const gs = compareGames.value
  if (gs.length < 2) return '添加更多游戏来获取对比分析见解。'
  const lead = gs[0].rating > gs[1].rating ? gs[0].name : gs[1].name
  const lag = gs[0].rating > gs[1].rating ? gs[1].name : gs[0].name
  const freeNote = gs.some((g) => g.price === 0) ? '其中有免费游戏可以零成本试玩。' : ''
  return `《${lead}》在综合评分上领先《${lag}》，${freeNote}建议结合你的游戏偏好（更看重剧情还是玩法？喜欢高难度还是轻松？）来做最终选择。`
})
</script>

<template>
  <EmptyState
    v-if="compareGames.length === 0"
    title="还没有添加对比游戏"
    description="在游戏卡片上点击 ⚖️ 按钮，或在游戏详情页点击「加入对比」，最多可以对比 4 款游戏。"
  >
    <RouterLink
      to="/explore"
      class="flex items-center gap-2 px-5 py-3 rounded-xl bg-accent hover:bg-accent-strong text-white font-medium transition-all"
    >
      <Gamepad2 class="w-4 h-4" />
      去探索游戏
      <ArrowRight class="w-4 h-4" />
    </RouterLink>
  </EmptyState>

  <div v-else class="space-y-8 pb-12">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-display font-bold text-[var(--text)]">游戏对比</h1>
        <p class="text-sm text-[var(--text-faint)] mt-1">对比 {{ compareGames.length }} 款游戏</p>
      </div>
      <button @click="store.clearCompare()" class="text-sm text-[var(--text-dim)] hover:text-[var(--text)] transition-colors">
        清空全部
      </button>
    </div>

    <!-- cards -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <div
        v-for="(game, i) in compareGames"
        :key="game.id"
        class="relative p-4 rounded-2xl bg-[var(--surface-2)] border border-[var(--border)]"
        :style="{ borderColor: `${CHART_COLORS[i]}40` }"
      >
        <button
          @click="store.toggleCompare(game.id)"
          class="absolute top-3 right-3 p-1 rounded-lg bg-[var(--surface-3)] hover:bg-[var(--surface)] text-[var(--text-dim)] hover:text-[var(--text)] transition-colors"
        >
          <X class="w-4 h-4" />
        </button>
        <RouterLink :to="`/game/${game.id}`" class="flex items-center gap-3">
          <div class="w-16 h-20 rounded-lg overflow-hidden bg-[var(--surface-3)] shrink-0">
            <img :src="game.coverUrl" :alt="game.name" class="w-full h-full object-cover" loading="lazy" />
          </div>
          <div class="min-w-0">
            <div class="text-sm font-semibold text-[var(--text)] hover:text-accent transition-colors truncate">{{ game.name }}</div>
            <div class="flex items-center gap-1 mt-1">
              <Star class="w-3 h-3 fill-accent-amber text-accent-amber" />
              <span class="text-xs text-[var(--text-dim)]">{{ game.rating }}</span>
            </div>
            <div class="text-xs text-[var(--text-faint)] mt-0.5">
              {{ game.price === 0 ? '免费' : `¥${game.price}` }} · {{ game.genres.slice(0, 2).join(' / ') }}
            </div>
          </div>
        </RouterLink>
      </div>
      <RouterLink
        v-if="compareGames.length < 4"
        to="/explore"
        class="flex flex-col items-center justify-center p-4 rounded-2xl border-2 border-dashed border-[var(--border)] hover:border-accent/50 transition-colors text-[var(--text-faint)] hover:text-accent min-h-[100px]"
      >
        <Scale class="w-6 h-6 mb-1" />
        <span class="text-xs">添加游戏</span>
      </RouterLink>
    </div>

    <!-- charts -->
    <div class="grid lg:grid-cols-2 gap-6">
      <div class="p-6 rounded-2xl bg-[var(--surface-2)] border border-[var(--border)]">
        <h3 class="text-sm font-semibold text-[var(--text-dim)] mb-4">六维评分对比</h3>
        <div v-if="compareGames.length >= 2" style="height: 320px">
          <VChart :option="radarOption" autoresize style="width: 100%; height: 100%" />
        </div>
        <div v-else class="flex items-center justify-center h-80 text-[var(--text-faint)] text-sm">
          需要至少 2 款游戏才能显示对比图表
        </div>
      </div>

      <div class="p-6 rounded-2xl bg-[var(--surface-2)] border border-[var(--border)]">
        <h3 class="text-sm font-semibold text-[var(--text-dim)] mb-4">核心指标对比</h3>
        <div v-if="compareGames.length >= 2" style="height: 320px">
          <VChart :option="barOption" autoresize style="width: 100%; height: 100%" />
        </div>
        <div v-else class="flex items-center justify-center h-80 text-[var(--text-faint)] text-sm">
          需要至少 2 款游戏才能显示对比图表
        </div>
      </div>
    </div>

    <!-- table -->
    <div class="rounded-2xl bg-[var(--surface-2)] border border-[var(--border)] overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-[var(--border)]">
              <th class="text-left p-4 text-[var(--text-dim)] font-medium w-24">属性</th>
              <th v-for="(g, i) in compareGames" :key="g.id" class="text-center p-4 font-semibold" :style="{ color: CHART_COLORS[i] }">
                {{ g.name }}
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-[var(--border)]">
            <tr v-for="row in tableRows" :key="row.label">
              <td class="p-4 text-[var(--text-dim)]">{{ row.label }}</td>
              <td v-for="g in compareGames" :key="g.id" class="p-4 text-center text-[var(--text)]">{{ row.render(g) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- insight -->
    <div class="p-6 rounded-2xl bg-gradient-to-r from-accent/10 to-accent-blue/10 border border-accent/10">
      <h3 class="text-sm font-semibold text-accent mb-2">析的锐评</h3>
      <p class="text-sm text-[var(--text-dim)] leading-relaxed">{{ insight }}</p>
    </div>
  </div>
</template>
