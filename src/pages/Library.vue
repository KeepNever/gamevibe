<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { RouterLink } from 'vue-router'
import {
  HardDrive,
  RefreshCw,
  Download,
  Trash2,
  Loader2,
  Gamepad2,
  CheckCircle2,
  Circle,
  Star,
  LogIn,
} from 'lucide-vue-next'
import { useAuthStore } from '@/stores/authStore'
import { api } from '@/lib/api'
import SafeImg from '@/components/SafeImg.vue'

interface ScannedGame {
  external_id: string
  name: string
  install_path: string
  size_bytes: number
  last_played: number | null
  cover_url: string
  source: string
}

interface LibItem {
  id: string
  name: string
  cover_url: string | null
  status: 'wishlist' | 'playing' | 'completed'
  user_rating: number | null
  note: string | null
  size_bytes: number | null
  external_id: string | null
  source: string
}

const STATUS_OPTIONS: { key: LibItem['status']; label: string }[] = [
  { key: 'wishlist', label: '想玩' },
  { key: 'playing', label: '在玩' },
  { key: 'completed', label: '通关' },
]

function fmtSize(b?: number | null): string {
  if (!b) return '—'
  return `${(b / 1e9).toFixed(1)} GB`
}

const auth = useAuthStore()
const scanned = ref<ScannedGame[]>([])
const selected = ref<Set<string>>(new Set())
const items = ref<LibItem[]>([])
const scanning = ref(false)
const saving = ref(false)

async function loadLib() {
  try {
    const r = await api.get('/library')
    const d = await r.json()
    items.value = d.items ?? []
  } catch {
    /* 忽略 */
  }
}

onMounted(() => {
  if (auth.user) loadLib()
})

watch(
  () => auth.user,
  (u) => {
    if (u) loadLib()
  },
)

async function doScan() {
  scanning.value = true
  try {
    const r = await api.get('/library/scan')
    const d = await r.json()
    scanned.value = d.games ?? []
    selected.value = new Set((d.games ?? []).map((g: ScannedGame) => g.external_id))
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    alert(msg || '扫描失败')
  } finally {
    scanning.value = false
  }
}

function toggleSel(id: string) {
  const n = new Set(selected.value)
  if (n.has(id)) n.delete(id)
  else n.add(id)
  selected.value = n
}

async function doImport() {
  saving.value = true
  try {
    const toImport = scanned.value.filter((g) => selected.value.has(g.external_id))
    await api.post('/library/import', { items: toImport })
    scanned.value = []
    selected.value = new Set()
    await loadLib()
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    alert(msg || '导入失败')
  } finally {
    saving.value = false
  }
}

async function updateItem(id: string, patch: Partial<LibItem>) {
  items.value = items.value.map((it) => (it.id === id ? { ...it, ...patch } : it))
  try {
    await api.put(`/library/${id}`, patch)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    alert(msg || '更新失败')
  }
}

async function deleteItem(id: string) {
  if (!confirm('确定从你的库中移除这款游戏？')) return
  try {
    await api.del(`/library/${id}`)
    items.value = items.value.filter((i) => i.id !== id)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    alert(msg || '删除失败')
  }
}
</script>

<template>
  <div class="min-h-[60vh]">
    <!-- 未登录 -->
    <div v-show="!auth.user" class="flex flex-col items-center justify-center py-24 text-center">
      <div class="w-20 h-20 rounded-2xl bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center mb-5">
        <Gamepad2 class="w-10 h-10 text-[var(--text-faint)]" />
      </div>
      <h2 class="text-lg font-display font-bold text-[var(--text)] mb-2">我的游戏库</h2>
      <p class="text-sm text-[var(--text-dim)] mb-6 max-w-sm">
        扫描本机已安装的游戏，记录状态、评分与备注
      </p>
      <RouterLink
        to="/login"
        class="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-accent hover:bg-accent-strong text-white text-sm font-medium transition-all"
      >
        <LogIn class="w-4 h-4" />
        去登录
      </RouterLink>
    </div>

    <!-- 已登录 -->
    <div v-show="auth.user" class="space-y-8">
      <!-- Header -->
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 class="text-2xl font-display font-bold text-[var(--text)] flex items-center gap-2">
            <HardDrive class="w-6 h-6 text-accent" /> 我的游戏库
          </h1>
          <p class="text-sm text-[var(--text-faint)] mt-1">
            共 {{ items.length }} 款游戏 · 点击扫描导入本机 Steam 游戏
          </p>
        </div>
        <button
          @click="doScan"
          :disabled="scanning"
          class="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-accent hover:bg-accent-strong text-white text-sm font-medium transition-all disabled:opacity-60"
        >
          <Loader2 v-if="scanning" class="w-4 h-4 animate-spin" />
          <RefreshCw v-else class="w-4 h-4" />
          {{ scanning ? '扫描中…' : '扫描本机游戏' }}
        </button>
      </div>

      <!-- 扫描结果 (v-show 避免挂载/卸载时 DOM 节点增删导致 removeChild(null)) -->
      <section v-show="scanned.length > 0" class="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5">
        <div class="flex items-center justify-between mb-4">
          <h2 class="font-display font-semibold text-[var(--text)]">
            发现 {{ scanned.length }} 款本机游戏
          </h2>
          <button
            @click="doImport"
            :disabled="saving || selected.size === 0"
            class="flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium transition-all disabled:opacity-50"
          >
            <Loader2 v-if="saving" class="w-4 h-4 animate-spin" />
            <Download v-else class="w-4 h-4" />
            导入选中（{{ selected.size }}）
          </button>
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          <button
            v-for="g in scanned"
            :key="g.external_id"
            @click="toggleSel(g.external_id)"
            class="relative flex gap-3 p-3 rounded-xl border text-left transition-all"
            :class="selected.has(g.external_id)
              ? 'border-accent bg-accent/10 ring-1 ring-accent/30'
              : 'border-[var(--border)] bg-[var(--surface-2)] hover:border-accent/40'"
          >
            <SafeImg
              :src="g.cover_url"
              :alt="g.name"
              className="w-14 h-18 rounded-lg object-cover bg-[var(--surface-3)] shrink-0"
            />
            <div class="min-w-0 flex-1 py-0.5">
              <div class="text-sm font-semibold text-[var(--text)] truncate leading-tight">{{ g.name }}</div>
              <div class="text-xs text-[var(--text-faint)] mt-1">{{ fmtSize(g.size_bytes) }}</div>
            </div>
            <div class="absolute top-2 right-2">
              <CheckCircle2 v-if="selected.has(g.external_id)" class="w-5 h-5 text-accent" />
              <Circle v-else class="w-5 h-5 text-[var(--text-faint)]" />
            </div>
          </button>
        </div>
      </section>

      <!-- 我的游戏库 -->
      <section>
        <h2 class="font-display font-semibold text-[var(--text)] mb-4">
          我的游戏（{{ items.length }}）
        </h2>
        <div
          v-show="items.length === 0"
          class="text-center py-16 text-[var(--text-faint)] border border-dashed border-[var(--border)] rounded-2xl bg-[var(--surface)]"
        >
          <Gamepad2 class="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>还没有游戏，点击右上角「扫描本机游戏」开始</p>
        </div>
        <div v-show="items.length > 0" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div
            v-for="it in items"
            :key="it.id"
            class="group relative flex flex-col rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-4 hover:border-accent/30 transition-all"
          >
            <!-- 封面 + 信息 -->
            <div class="flex gap-3">
              <SafeImg
                :src="it.cover_url || ''"
                :alt="it.name"
                className="w-16 h-20 rounded-xl object-cover bg-[var(--surface-3)] shrink-0"
              />
              <div class="min-w-0 flex-1">
                <div class="text-sm font-semibold text-[var(--text)] truncate">{{ it.name }}</div>
                <div class="text-[11px] text-[var(--text-faint)] mt-0.5">
                  {{ fmtSize(it.size_bytes) }} · {{ it.source === 'steam_scan' ? '本机扫描' : '手动添加' }}
                </div>

                <!-- 状态 pill -->
                <div class="mt-2 flex flex-wrap gap-1.5">
                  <button
                    v-for="s in STATUS_OPTIONS"
                    :key="s.key"
                    @click="updateItem(it.id, { status: s.key })"
                    class="px-2.5 py-1 rounded-md text-[11px] font-medium transition-all"
                    :class="it.status === s.key
                      ? 'bg-accent text-white shadow-sm shadow-accent/20'
                      : 'bg-[var(--surface-2)] text-[var(--text-dim)] hover:text-[var(--text)] border border-[var(--border)]'"
                  >
                    {{ s.label }}
                  </button>
                </div>
              </div>
            </div>

            <!-- 评分 + 备注 + 删除 -->
            <div class="mt-3 pt-3 border-t border-[var(--border)] flex items-center gap-3">
              <div class="flex items-center gap-0.5 shrink-0">
                <button
                  v-for="v in [2, 4, 6, 8, 10]"
                  :key="v"
                  @click="updateItem(it.id, { user_rating: v })"
                  :title="`${v} 分`"
                  class="p-0.5 hover:scale-110 transition-transform"
                >
                  <Star
                    class="w-3.5 h-3.5"
                    :class="(it.user_rating ?? 0) >= v ? 'text-amber-400 fill-amber-400' : 'text-[var(--text-faint)]'"
                  />
                </button>
                <span class="text-[10px] text-[var(--text-faint)] ml-1">{{ it.user_rating ? `${it.user_rating}` : '—' }}</span>
              </div>

              <input
                :value="it.note || ''"
                @input="updateItem(it.id, { note: ($event.target as HTMLInputElement).value })"
                placeholder="备注…"
                class="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-xs text-[var(--text)] outline-none focus:border-accent/50 placeholder:text-[var(--text-faint)]"
              />

              <button
                @click="deleteItem(it.id)"
                class="shrink-0 p-1.5 rounded-lg text-[var(--text-faint)] hover:text-red-400 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100"
                title="移除"
              >
                <Trash2 class="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
