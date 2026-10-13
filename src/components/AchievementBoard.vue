<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { Trophy, Loader2, ExternalLink, TriangleAlert, ChevronDown, ChevronUp, Flame } from 'lucide-vue-next'
import { getAchievements } from '@/lib/liveApi'
import type { AchievementsResult, SteamAchievement } from '@/types/live'

const props = defineProps<{ gameId: string }>()

const data = ref<AchievementsResult | null>(null)
const loading = ref(false)
const expanded = ref(false)

async function load() {
  loading.value = true
  try {
    data.value = await getAchievements(props.gameId)
  } catch {
    // 连后端都没通：不显示任何成就内容，也不编造（保持 null）
    data.value = null
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(() => props.gameId, () => {
  expanded.value = false
  data.value = null
  load()
})

/** 难度分档的配色（跟项目主题走：涨红/暖色用 amber，冷色用 accent） */
const DIFF_STYLE: Record<string, string> = {
  easy: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  medium: 'bg-accent/15 text-accent border-accent/30',
  hard: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  brutal: 'bg-red-500/15 text-red-400 border-red-500/30',
  nightmare: 'bg-red-600/20 text-red-300 border-red-600/40',
  unknown: 'bg-[var(--surface-3)] text-[var(--text-faint)] border-[var(--border)]',
}

const difficultyClass = computed(() =>
  DIFF_STYLE[data.value?.difficulty.key || 'unknown'] || DIFF_STYLE.unknown,
)

/** 解锁率分布条（复用后端算好的分档，只做展示） */
const BUCKET_META = [
  { key: '0-10', label: '0–10%', color: '#dc2626' },
  { key: '10-25', label: '10–25%', color: '#f59e0b' },
  { key: '25-50', label: '25–50%', color: '#38bdf8' },
  { key: '50-75', label: '50–75%', color: '#34d399' },
  { key: '75-100', label: '75–100%', color: '#10b981' },
] as const

const dist = computed(() => {
  const b = data.value?.buckets
  if (!b) return []
  const total = BUCKET_META.reduce((n, m) => n + (b[m.key] || 0), 0)
  if (!total) return []
  return BUCKET_META.map((m) => ({
    ...m,
    count: b[m.key] || 0,
    pct: ((b[m.key] || 0) / total) * 100,
  })).filter((x) => x.count > 0)
})

const shown = computed<SteamAchievement[]>(() => {
  const d = data.value
  if (!d) return []
  return expanded.value ? d.items : d.rarest
})

const hiddenCount = computed(() => Math.max(0, (data.value?.total || 0) - (data.value?.rarest.length || 0)))

const steamUrl = computed(() =>
  data.value?.appid ? `https://steamcommunity.com/stats/${data.value.appid}/achievements/` : '',
)

/** 每个成就图标的兜底链（cloudflare → akamai → 占位） */
const iconFallback = ref<Record<string, boolean>>({})
function iconSrc(a: SteamAchievement): string {
  return iconFallback.value[a.apiName] ? a.iconFallbackUrl || a.iconUrl : a.iconUrl
}
function onIconError(a: SteamAchievement) {
  if (!iconFallback.value[a.apiName] && a.iconFallbackUrl) {
    iconFallback.value = { ...iconFallback.value, [a.apiName]: true }
  }
}
</script>

<template>
  <section class="rounded-2xl bg-[var(--surface-2)] border border-[var(--border)] p-5 space-y-4">
    <!-- ═══ 头部 ═══ -->
    <div class="flex items-center justify-between gap-3 flex-wrap">
      <div class="flex items-center gap-2">
        <Trophy class="w-4 h-4 text-accent-amber" />
        <h2 class="text-base font-display font-bold text-[var(--text)]">全球成就</h2>
        <span v-if="data?.ok" class="text-xs text-[var(--text-faint)]">
          {{ data.total }} 个 · 已收录 {{ data.rated }} 个解锁率
        </span>
      </div>
      <a
        v-if="steamUrl"
        :href="steamUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="text-[11px] text-[var(--text-dim)] hover:text-accent flex items-center gap-1 transition-colors"
      >
        Steam 成就页 <ExternalLink class="w-3 h-3" />
      </a>
    </div>

    <!-- ═══ 加载中 ═══ -->
    <div v-if="loading" class="flex items-center justify-center py-8 text-[var(--text-dim)]">
      <Loader2 class="w-4 h-4 animate-spin mr-2" /> 正在读取 Steam 成就数据…
    </div>

    <!-- ═══ 没取到：如实说明，不展示任何编造内容 ═══ -->
    <div
      v-else-if="data && !data.ok"
      class="rounded-xl bg-[var(--surface)] border border-[var(--border)] p-3 flex items-start gap-2"
    >
      <TriangleAlert class="w-3.5 h-3.5 text-accent-amber shrink-0 mt-0.5" />
      <div class="min-w-0">
        <p class="text-[11px] text-[var(--text-dim)]">暂未获取到成就数据</p>
        <p class="text-[10px] text-[var(--text-faint)] mt-0.5 break-words">{{ data.reason }}</p>
      </div>
    </div>

    <!-- ═══ 正常数据 ═══ -->
    <template v-else-if="data && data.ok">
      <!-- 概览：难度分档 + 三个派生指标 -->
      <div class="rounded-xl bg-[var(--surface)] border border-[var(--border)] p-4 space-y-3">
        <div class="flex items-start gap-3 flex-wrap">
          <span :class="['text-xs font-semibold px-2.5 py-1 rounded-lg border', difficultyClass]">
            全成就难度 · {{ data.difficulty.label }}
          </span>
          <p class="text-[11px] text-[var(--text-dim)] flex-1 min-w-[180px]">{{ data.difficulty.note }}</p>
        </div>

        <div class="grid grid-cols-3 gap-3">
          <div>
            <div class="text-lg font-display font-bold text-[var(--text)]">{{ data.ceilingPercent }}%</div>
            <div class="text-[10px] text-[var(--text-faint)] leading-tight">全成就占比上限<br />最稀有成就解锁率</div>
          </div>
          <div>
            <div class="text-lg font-display font-bold text-[var(--text)]">{{ data.avgPercent }}%</div>
            <div class="text-[10px] text-[var(--text-faint)] leading-tight">平均解锁率<br />全部成就均值</div>
          </div>
          <div>
            <div class="text-lg font-display font-bold text-[var(--text)]">{{ data.rareRatio }}%</div>
            <div class="text-[10px] text-[var(--text-faint)] leading-tight">
              极稀有成就占比<br />
              <span class="text-[var(--text-faint)]">解锁率 &lt; 10% 共 {{ data.buckets['0-10'] }} 个</span>
            </div>
          </div>
        </div>

        <!-- 解锁率分布条 -->
        <div v-if="dist.length" class="space-y-1.5 pt-1">
          <div class="flex h-2 rounded-full overflow-hidden bg-[var(--surface-3)]">
            <div
              v-for="d in dist"
              :key="d.key"
              :style="{ width: d.pct + '%', backgroundColor: d.color }"
              :title="`${d.label}：${d.count} 个`"
            />
          </div>
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span v-for="d in dist" :key="d.key" class="flex items-center gap-1 text-[10px] text-[var(--text-faint)]">
              <i class="w-2 h-2 rounded-sm inline-block" :style="{ backgroundColor: d.color }" />
              {{ d.label }} · {{ d.count }}
            </span>
          </div>
        </div>
      </div>

      <!-- 成就清单（默认最难的 8 个） -->
      <ul class="space-y-2">
        <li
          v-for="a in shown"
          :key="a.apiName || a.name"
          class="flex items-center gap-3 rounded-xl bg-[var(--surface)] border border-[var(--border)] p-2.5"
        >
          <div class="w-10 h-10 rounded-lg overflow-hidden bg-[var(--surface-3)] shrink-0">
            <img
              :src="iconSrc(a)"
              :alt="a.name"
              class="w-full h-full object-cover"
              loading="lazy"
              decoding="async"
              @error="onIconError(a)"
            />
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="text-[13px] font-medium text-[var(--text)] truncate">{{ a.name }}</span>
              <span v-if="a.percent != null && a.percent < 10" class="flex items-center gap-0.5 text-[9px] text-red-400 shrink-0">
                <Flame class="w-2.5 h-2.5" />极稀有
              </span>
            </div>
            <p v-if="a.desc" class="text-[11px] text-[var(--text-faint)] truncate">{{ a.desc }}</p>
          </div>
          <div class="w-24 shrink-0 text-right">
            <div class="text-[13px] font-bold" :class="a.percent == null ? 'text-[var(--text-faint)]' : 'text-[var(--text)]'">
              {{ a.percent == null ? '未公布' : a.percent + '%' }}
            </div>
            <div class="h-1 rounded-full bg-[var(--surface-3)] overflow-hidden mt-1">
              <div
                v-if="a.percent != null"
                class="h-full rounded-full bg-accent"
                :style="{ width: Math.max(4, a.percent) + '%' }"
              />
            </div>
          </div>
        </li>
      </ul>

      <!-- 展开/收起 -->
      <div v-if="hiddenCount > 0 || expanded" class="flex items-center justify-between gap-3 flex-wrap">
        <button
          type="button"
          @click="expanded = !expanded"
          class="flex items-center gap-1 text-[11px] text-[var(--text-dim)] hover:text-accent transition-colors"
        >
          <component :is="expanded ? ChevronUp : ChevronDown" class="w-3.5 h-3.5" />
          {{ expanded ? '只看最难的 8 个' : `展开全部 ${data.items.length} 个成就` }}
        </button>
        <p v-if="data.truncated" class="text-[10px] text-[var(--text-faint)]">
          成就数过多，仅展示解锁率最低的 {{ data.items.length }} 个
        </p>
      </div>

      <!-- 口径说明（必须展示，避免把派生值当官方指标） -->
      <p class="text-[10px] text-[var(--text-faint)] leading-relaxed border-t border-[var(--border)] pt-3">
        {{ data.note }}
      </p>
    </template>
  </section>
</template>
