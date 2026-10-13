<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { RouterLink } from 'vue-router'
import { toPng } from 'html-to-image'
import {
  Sparkles, ArrowRight, ArrowLeft, RefreshCw, Download, Copy, Check, Compass, Gamepad2, Trophy, Layers,
} from 'lucide-vue-next'
import { useGameStore } from '@/stores/gameStore'
import { useToastStore } from '@/stores/toastStore'
import { computeWrapped } from '@/lib/wrapped'
import AnimatedCounter from '@/components/AnimatedCounter.vue'

const store = useGameStore()
const toast = useToastStore()

const stats = computed(() =>
  computeWrapped({
    collections: store.collections,
    recentlyViewed: store.recentlyViewed,
    compareIds: store.compareIds,
  }),
)

const step = ref(0)
const dir = ref(1)
const copied = ref(false)
const captureRef = ref<HTMLElement | null>(null)

const totalSteps = computed(() => (stats.value.exploredCount > 0 ? 7 : 1))
const hasData = computed(() => stats.value.exploredCount > 0)

function next() {
  dir.value = 1
  step.value = Math.min(step.value + 1, totalSteps.value - 1)
}
function prev() {
  dir.value = -1
  step.value = Math.max(step.value - 1, 0)
}
function restart() {
  dir.value = -1
  step.value = 0
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'ArrowRight') next()
  if (e.key === 'ArrowLeft') prev()
}
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))

const shareText = computed(() => {
  const s = stats.value
  const genres = s.topGenres.map((g) => g.genre).join('、') || '—'
  return [
    `我的 ${s.year} 游戏年报 🎮`,
    `${s.persona.emoji} 人格：${s.persona.title}`,
    `探索了 ${s.exploredCount} 款游戏`,
    `最爱的类型：${genres}`,
    `年度神作：${s.topRated?.name ?? '—'}（${s.topRated?.rating ?? '—'} 分）`,
    `通关 ${s.collections.completed} 款，清单完成度 ${s.completionRate}%`,
    `靠折扣省下 ¥${s.savedMoney}`,
    `#GameVibe`,
  ].join('\n')
})

async function handleCopy() {
  try {
    await navigator.clipboard.writeText(shareText.value)
    copied.value = true
    toast.addToast('分享文案已复制', 'success')
    setTimeout(() => (copied.value = false), 2000)
  } catch {
    toast.addToast('复制失败，请手动选择', 'error')
  }
}

async function handleExport() {
  if (!captureRef.value) return
  try {
    toast.addToast('正在生成图片…', 'info')
    const url = await toPng(captureRef.value, { pixelRatio: 2, backgroundColor: '#0b0a12' })
    const a = document.createElement('a')
    a.href = url
    a.download = `GameVibe-${stats.value.year}-Wrapped.png`
    a.click()
    toast.addToast('年报图片已导出', 'success')
  } catch {
    toast.addToast('导出失败，请重试', 'error')
  }
}

const listCards = computed(() => [
  { label: '想玩', val: stats.value.collections.wishlist, color: 'text-accent' },
  { label: '在玩', val: stats.value.collections.playing, color: 'text-accent-cyan' },
  { label: '通关', val: stats.value.collections.completed, color: 'text-accent-green' },
])
</script>

<template>
  <div v-if="!hasData" ref="captureRef" class="min-h-[70vh] flex flex-col items-center justify-center text-center px-6">
    <div class="w-20 h-20 rounded-3xl bg-gradient-to-br from-accent to-accent-pink flex items-center justify-center shadow-lg shadow-accent/30 mb-6">
      <Sparkles class="w-9 h-9 text-white" />
    </div>
    <h1 class="text-3xl font-display font-bold text-[var(--text)] mb-3">你的 {{ stats.year }} 游戏年报</h1>
    <p class="text-[var(--text-dim)] max-w-sm mb-8">
      还没有足够的足迹来生成年报。去逛逛游戏、收藏几款，或把玩过的标记为「在玩 / 通关」，就能看到专属回顾。
    </p>
    <div class="flex gap-3">
      <RouterLink to="/explore" class="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-accent text-white font-semibold transition-all hover:bg-accent-strong">
        <Compass class="w-4 h-4" /> 去探索游戏
      </RouterLink>
      <RouterLink to="/" class="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[var(--surface-2)] text-[var(--text)] font-semibold border border-[var(--border)] transition-colors">
        返回首页
      </RouterLink>
    </div>
  </div>

  <div v-else class="py-2">
    <div class="flex items-center gap-2 mb-4 text-sm text-[var(--text-faint)]">
      <Sparkles class="w-4 h-4 text-accent" />
      <span>GameVibe 年度回顾 · {{ stats.year }}</span>
    </div>

    <div ref="captureRef" class="relative overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface)]">
      <div class="pointer-events-none absolute -top-24 -right-24 w-72 h-72 rounded-full bg-accent/20 blur-3xl" />
      <div class="pointer-events-none absolute -bottom-24 -left-24 w-72 h-72 rounded-full bg-accent-cyan/15 blur-3xl" />

      <div class="relative min-h-[58vh] flex items-center justify-center p-6 sm:p-10">
        <!-- 用 key=step 触发重挂载 + CSS 动画做切换，零 portal、零 DOM 冲突 -->
        <div :key="step" class="w-full max-w-xl text-center fade-in">
          <!-- step 0 -->
          <div v-if="step === 0" class="flex flex-col items-center">
            <div class="text-6xl mb-5">🎮</div>
            <h1 class="text-4xl font-display font-bold text-[var(--text)] mb-3">
              你的 {{ stats.year }}<br />游戏年报
            </h1>
            <p class="text-[var(--text-dim)] mb-8 max-w-sm">
              基于你的收藏、清单与浏览足迹，生成专属的一年游戏回顾。
            </p>
            <button
              @click="next"
              class="inline-flex items-center gap-2 px-8 py-3.5 rounded-xl bg-gradient-to-r from-accent to-accent-pink text-white font-semibold shadow-lg shadow-accent/30 transition-transform hover:scale-105"
            >
              开始回顾 <ArrowRight class="w-4 h-4" />
            </button>
          </div>

          <!-- step 1 -->
          <div v-else-if="step === 1">
            <div class="text-5xl mb-4">🧭</div>
            <p class="text-[var(--text-dim)] mb-2">这一年，你探索了</p>
            <div class="text-7xl font-display font-extrabold text-accent mb-3">
              <AnimatedCounter :value="stats.exploredCount" />
            </div>
            <p class="text-[var(--text-faint)]">款游戏 —— 好奇心，是你最好的装备。</p>
          </div>

          <!-- step 2 -->
          <div v-else-if="step === 2">
            <div class="text-5xl mb-4">🎯</div>
            <p class="text-[var(--text-dim)] mb-6">你最偏爱的类型是</p>
            <div class="space-y-3">
              <div v-for="(g, i) in stats.topGenres" :key="g.genre" class="flex items-center gap-3">
                <span class="w-7 text-lg font-bold text-[var(--text-faint)]">{{ i + 1 }}</span>
                <div class="flex-1 text-left">
                  <div class="flex justify-between text-sm mb-1">
                    <span class="font-medium text-[var(--text)]">{{ g.genre }}</span>
                    <span class="text-[var(--text-faint)]">{{ g.count }} 款</span>
                  </div>
                  <div class="h-2 rounded-full bg-[var(--surface-3)] overflow-hidden">
                    <div
                      class="h-full rounded-full bg-gradient-to-r from-accent to-accent-cyan progress-bar-fill"
                      :style="{ '--target-width': g.pct + '%' }"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- step 3 -->
          <div v-else-if="step === 3" class="flex flex-col items-center">
            <div class="text-7xl mb-5 scale-in-spring">{{ stats.persona.emoji }}</div>
            <p class="text-[var(--text-dim)] mb-1">你的游戏人格是</p>
            <h2 class="text-3xl font-display font-bold bg-gradient-to-r from-accent via-accent-cyan to-accent-pink bg-clip-text text-transparent mb-4">
              {{ stats.persona.title }}
            </h2>
            <p class="text-[var(--text-dim)] max-w-md leading-relaxed">{{ stats.persona.desc }}</p>
          </div>

          <!-- step 4 -->
          <div v-else-if="step === 4 && stats.topRated" class="flex flex-col items-center">
            <div class="text-5xl mb-4">🏅</div>
            <p class="text-[var(--text-dim)] mb-4">你心中的年度神作</p>
            <div class="relative w-32 h-44 rounded-2xl overflow-hidden shadow-xl shadow-accent/20 mb-4 ring-1 ring-[var(--border)]">
              <img :src="stats.topRated.coverUrl" :alt="stats.topRated.name" class="w-full h-full object-cover" />
            </div>
            <h3 class="text-xl font-bold text-[var(--text)]">{{ stats.topRated.name }}</h3>
            <div class="flex items-center gap-1 text-accent-amber mt-1">
              {{ '★'.repeat(Math.floor(stats.topRated.rating / 2)) }}
              <span class="text-[var(--text-faint)] ml-2 text-sm">{{ stats.topRated.rating }} 分</span>
            </div>
          </div>

          <!-- step 5 -->
          <div v-else-if="step === 5">
            <div class="text-5xl mb-4">📚</div>
            <p class="text-[var(--text-dim)] mb-6">你的游戏清单</p>
            <div class="grid grid-cols-3 gap-3 mb-6">
              <div v-for="c in listCards" :key="c.label" class="rounded-2xl bg-[var(--surface-2)] py-4">
                <div class="text-3xl font-display font-bold" :class="c.color">
                  <AnimatedCounter :value="c.val" />
                </div>
                <div class="text-xs text-[var(--text-faint)] mt-1">{{ c.label }}</div>
              </div>
            </div>
            <p class="text-sm text-[var(--text-dim)]">
              通关完成度
              <span class="font-bold text-accent-green">
                <AnimatedCounter :value="stats.completionRate" suffix="%" />
              </span>
              <template v-if="stats.savedMoney > 0">
                · 靠折扣省下 <span class="font-bold text-accent-amber">¥<AnimatedCounter :value="stats.savedMoney" /></span>
              </template>
            </p>
          </div>

          <!-- step 6 -->
          <div v-else-if="step === 6" class="flex flex-col items-center">
            <div class="text-5xl mb-4">✨</div>
            <h2 class="text-2xl font-display font-bold text-[var(--text)] mb-5">今年，你这样玩</h2>
            <ul class="text-left space-y-2.5 mb-7 max-w-md">
              <li
                v-for="(f, i) in stats.facts"
                :key="i"
                class="flex items-start gap-2 text-sm text-[var(--text-dim)] fade-in-left"
                :style="{ animationDelay: 0.15 * i + 's' }"
              >
                <span class="text-accent mt-0.5">▹</span>
                <span>{{ f }}</span>
              </li>
            </ul>
            <div class="flex flex-wrap gap-3 justify-center">
              <button
                @click="handleCopy"
                class="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-accent text-white font-medium hover:bg-accent-strong transition-colors"
              >
                <Check v-if="copied" class="w-4 h-4" />
                <Copy v-else class="w-4 h-4" />
                {{ copied ? '已复制' : '复制文案' }}
              </button>
              <button
                @click="handleExport"
                class="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[var(--surface-3)] text-[var(--text)] font-medium border border-[var(--border)] hover:bg-[var(--surface-2)] transition-colors"
              >
                <Download class="w-4 h-4" /> 保存图片
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 进度 + 导航 -->
    <div class="flex items-center justify-between mt-5">
      <button
        @click="prev"
        :disabled="step === 0"
        class="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm text-[var(--text-dim)] hover:text-[var(--text)] disabled:opacity-30 transition-colors"
      >
        <ArrowLeft class="w-4 h-4" /> 上一页
      </button>

      <div class="flex items-center gap-1.5">
        <span
          v-for="i in totalSteps"
          :key="i"
          class="h-1.5 rounded-full transition-all"
          :class="i - 1 === step ? 'w-6 bg-accent' : 'w-1.5 bg-[var(--surface-3)]'"
        />
      </div>

      <button
        v-if="step < totalSteps - 1"
        @click="next"
        class="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm text-[var(--text-dim)] hover:text-[var(--text)] transition-colors"
      >
        下一页 <ArrowRight class="w-4 h-4" />
      </button>
      <button
        v-else
        @click="restart"
        class="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm text-[var(--text-dim)] hover:text-[var(--text)] transition-colors"
      >
        <RefreshCw class="w-4 h-4" /> 再看一遍
      </button>
    </div>

    <div class="mt-6 flex items-center justify-center gap-4 text-xs text-[var(--text-faint)]">
      <span class="inline-flex items-center gap-1"><Gamepad2 class="w-3.5 h-3.5" /> 数据来自本地足迹</span>
      <span class="inline-flex items-center gap-1"><Trophy class="w-3.5 h-3.5" /> 纯前端生成</span>
      <span class="inline-flex items-center gap-1"><Layers class="w-3.5 h-3.5" /> 可导出分享</span>
    </div>
  </div>
</template>
