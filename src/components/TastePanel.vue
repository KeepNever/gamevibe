<script setup lang="ts">
// 口味画像面板：读取后端 /api/ai/profile（四维分值 + 口味标签 + 画像依据）
// 未登录 / 冷启动 / 加载失败均优雅降级，不阻塞主聊天
import { ref, computed, onMounted, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { Brain, RefreshCw, Sparkles, LogIn, Loader2, Target } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/authStore'
import { getAiProfile, type AiProfile } from '@/lib/profileApi'

const auth = useAuthStore()
const profile = ref<AiProfile | null>(null)
const loading = ref(false)
const error = ref('')

async function load() {
  if (!auth.isLoggedIn) {
    profile.value = null
    error.value = ''
    return
  }
  loading.value = true
  error.value = ''
  try {
    profile.value = await getAiProfile()
  } catch (e: any) {
    error.value = e?.message || '画像加载失败'
    profile.value = null
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(() => auth.isLoggedIn, load)

function pct(v: number) {
  return `${Math.max(0, Math.min(100, (v / 5) * 100))}%`
}
function recentOf(key: string): number | null {
  const r = profile.value?.recentDims
  return r && typeof r[key] === 'number' ? r[key] : null
}

// 依据：优先近期，其次长期
const basis = computed(() => {
  const p = profile.value
  if (!p) return []
  return p.basis.recent.length ? p.basis.recent : p.basis.longTerm
})
const sourceLabel = computed(() => {
  const s = profile.value?.source
  if (!s || !s.batchId) return ''
  return `画像批次 ${s.batchId} · 覆盖 ${s.coveredGames}/${s.totalGames} 款`
})
</script>

<template>
  <div class="rounded-2xl bg-[var(--surface-2)] border border-[var(--border)] flex flex-col overflow-hidden">
    <div class="shrink-0 flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
      <div class="flex items-center gap-2">
        <Brain class="w-4 h-4 text-accent" />
        <span class="text-sm font-semibold text-[var(--text)]">你的口味画像</span>
      </div>
      <button
        @click="load"
        :disabled="loading || !auth.isLoggedIn"
        class="p-1 rounded text-[var(--text-faint)] hover:text-accent disabled:opacity-40 transition-colors"
        title="刷新"
      >
        <RefreshCw class="w-3.5 h-3.5" :class="loading ? 'animate-spin' : ''" />
      </button>
    </div>

    <div class="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
      <!-- 未登录 -->
      <div v-if="!auth.isLoggedIn" class="text-center py-6">
        <LogIn class="w-8 h-8 text-[var(--text-faint)] mx-auto mb-3" />
        <p class="text-[var(--text-dim)] text-xs leading-relaxed">
          登录后我才能读取你的收藏与评分，逐步画出你的口味画像。
        </p>
        <RouterLink
          to="/login"
          class="inline-block mt-3 px-3 py-1.5 rounded-lg bg-accent text-white text-xs font-medium hover:bg-accent-strong transition-colors"
        >去登录</RouterLink>
      </div>

      <!-- 加载 -->
      <div v-else-if="loading && !profile" class="flex items-center justify-center py-8 text-[var(--text-dim)]">
        <Loader2 class="w-5 h-5 animate-spin" />
      </div>

      <!-- 错误 -->
      <div v-else-if="error" class="text-xs text-[var(--text-faint)] text-center py-6">
        {{ error }}
        <button @click="load" class="block mx-auto mt-2 text-accent">重试</button>
      </div>

      <!-- 冷启动 -->
      <div v-else-if="profile && profile.coldStart" class="py-2">
        <div class="flex items-center gap-1.5 text-accent text-xs mb-2">
          <Sparkles class="w-3.5 h-3.5" />画像还没成形
        </div>
        <p class="text-[var(--text-dim)] text-xs leading-relaxed">
          先收藏或标记几款玩过的游戏，我就能按你的口味挑推荐、算匹配度。
        </p>
        <RouterLink
          to="/explore"
          class="inline-block mt-3 px-3 py-1.5 rounded-lg bg-[var(--surface-3)] text-[var(--text-dim)] text-xs hover:text-accent transition-colors"
        >去逛游戏库</RouterLink>
      </div>

      <!-- 有画像 -->
      <template v-else-if="profile">
        <div class="space-y-2.5">
          <div v-for="d in profile.dimsDetail" :key="d.key" class="space-y-1">
            <div class="flex items-center justify-between text-xs">
              <span class="text-[var(--text-dim)]">{{ d.label }}</span>
              <span class="text-[var(--text-faint)] tabular-nums">
                {{ d.value.toFixed(1) }}
                <span v-if="recentOf(d.key) !== null" class="text-accent">
                  · 近期 {{ recentOf(d.key)!.toFixed(1) }}
                </span>
              </span>
            </div>
            <div class="h-1.5 rounded-full bg-[var(--surface-3)] overflow-hidden">
              <div
                class="h-full rounded-full bg-gradient-to-r from-accent to-accent-cyan transition-all"
                :style="{ width: pct(d.value) }"
              />
            </div>
          </div>
        </div>

        <div v-if="profile.tags.length" class="space-y-1.5">
          <div class="text-[11px] text-[var(--text-faint)]">口味标签</div>
          <div class="flex flex-wrap gap-1">
            <span
              v-for="t in profile.tags"
              :key="t"
              class="text-[10px] px-1.5 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/20"
            >{{ t }}</span>
          </div>
        </div>

        <div v-if="profile.prefs.coreGameplay.length" class="space-y-1.5">
          <div class="text-[11px] text-[var(--text-faint)]">偏好核心玩法</div>
          <div class="flex flex-wrap gap-1">
            <span
              v-for="c in profile.prefs.coreGameplay.slice(0, 4)"
              :key="c.value"
              class="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--surface-3)] text-[var(--text-dim)] border border-[var(--border)]"
            >{{ c.value }}</span>
          </div>
        </div>

        <div v-if="basis.length" class="space-y-1.5">
          <div class="text-[11px] text-[var(--text-faint)] flex items-center gap-1">
            <Target class="w-3 h-3" />画像依据
          </div>
          <ul class="space-y-1">
            <li v-for="b in basis" :key="b.id" class="flex items-center justify-between gap-2 text-xs">
              <RouterLink :to="`/game/${b.id}`" class="truncate text-[var(--text-dim)] hover:text-accent transition-colors">
                {{ b.name }}
              </RouterLink>
              <span class="shrink-0 text-[10px] text-[var(--text-faint)]">{{ b.via }}</span>
            </li>
          </ul>
        </div>

        <div class="pt-2 border-t border-[var(--border)] text-[10px] text-[var(--text-faint)] leading-relaxed">
          样本 {{ profile.sampleSize }} 款 · 近 {{ profile.windowDays }} 天加权
          <template v-if="sourceLabel"><br />{{ sourceLabel }}</template>
        </div>
      </template>
    </div>
  </div>
</template>
