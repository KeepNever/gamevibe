<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { RouterLink } from 'vue-router'
import { Star, Trash2, Send, Loader2, MessageSquare, ExternalLink, ThumbsUp, ThumbsDown, Clock, TriangleAlert } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/authStore'
import { useGameStore } from '@/stores/gameStore'
import { useToastStore } from '@/stores/toastStore'
import { getSteamReviews } from '@/lib/liveApi'
import type { SteamReviewsResult } from '@/types/live'
import { getReviews, postReview, deleteReview, relativeTime, type ReviewItem } from '@/lib/reviewApi'

const props = defineProps<{ gameId: string }>()

const auth = useAuthStore()
const gameStore = useGameStore()
const toast = useToastStore()

// ── 本地社区评论 ──
const reviews = ref<ReviewItem[]>([])
const average = ref(0)
const count = ref(0)
const loading = ref(false)
const error = ref('')

const myRating = ref(0)
const hoverRating = ref(0)
const myContent = ref('')
const submitting = ref(false)
const deletingId = ref<string | null>(null)

async function refresh() {
  loading.value = true
  error.value = ''
  try {
    const res = await getReviews(props.gameId, 1, 50)
    reviews.value = res.reviews
    average.value = res.average
    count.value = res.count
  } catch (e: any) {
    error.value = e?.message || '加载评论失败'
  } finally {
    loading.value = false
  }
}

async function submit() {
  if (!auth.isLoggedIn) return
  if (!myContent.value.trim() && myRating.value === 0) {
    toast.addToast('写点内容或打个分再提交吧', 'info')
    return
  }
  submitting.value = true
  try {
    await postReview(props.gameId, myRating.value || null, myContent.value.trim())
    myContent.value = ''
    myRating.value = 0
    toast.addToast('评价已发布', 'success')
    await refresh()
    await gameStore.loadReviewAggregate()
  } catch (e: any) {
    toast.addToast(e?.message || '发布失败', 'error')
  } finally {
    submitting.value = false
  }
}

async function remove(id: string) {
  deletingId.value = id
  try {
    await deleteReview(id)
    toast.addToast('已删除评论', 'success')
    await refresh()
    await gameStore.loadReviewAggregate()
  } catch (e: any) {
    toast.addToast(e?.message || '删除失败', 'error')
  } finally {
    deletingId.value = null
  }
}

const displayName = (r: ReviewItem) => r.display_name || r.username

// ── Steam 评测数据 ──
// 后端约定：始终 200，用 available 标记是否真取到。
// available=false 时 summary 全 0、reviews 为空 —— 这里如实显示「没取到」，不显示任何编造数字。
const steamData = ref<SteamReviewsResult | null>(null)
const steamLoading = ref(false)

/** 评论区计数：站内真实评论数 + Steam 真实评测数（未取到 Steam 时不加） */
const totalCount = computed(() => count.value + (steamData.value?.available ? steamData.value.summary.totalReviews : 0))

function fmtPlaytime(minutes: number): string {
  if (minutes < 60) return `${minutes} 分钟`
  const h = Math.floor(minutes / 60)
  return h < 24 ? `${h} 小时` : `${Math.floor(h / 24)} 天 ${h % 24} 小时`
}

function steamRelativeTime(ts: number): string {
  if (!ts) return ''
  const diff = Math.floor(Date.now() / 1000) - ts
  if (diff < 3600) return '刚刚'
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
  if (diff < 2592000) return `${Math.floor(diff / 86400)} 天前`
  return `${Math.floor(diff / 2592000)} 月前`
}

async function loadSteam() {
  // 只对 dc_ 前缀（多平台发现游戏）尝试加载 Steam 数据
  if (!props.gameId.startsWith('dc_') && !props.gameId.startsWith('rawg_')) return
  steamLoading.value = true
  try {
    steamData.value = await getSteamReviews(props.gameId)
  } catch {
    // 连后端都没通：保持 null，界面不显示 Steam 区块（不编造数据顶上）
  } finally {
    steamLoading.value = false
  }
}

onMounted(() => { refresh(); loadSteam() })
</script>

<template>
  <section class="rounded-2xl bg-[var(--surface-2)] border border-[var(--border)] p-5 space-y-4">
    <!-- ═══ 头部 ═══ -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <MessageSquare class="w-4 h-4 text-accent" />
        <h2 class="text-base font-display font-bold text-[var(--text)]">社区评价</h2>
        <span class="text-xs text-[var(--text-faint)]">({{ totalCount.toLocaleString('zh-CN') }})</span>
      </div>
      <div v-if="count > 0" class="flex items-center gap-1.5">
        <div class="flex">
          <Star v-for="i in 5" :key="i" class="w-3.5 h-3.5"
            :class="i <= Math.round(average) ? 'text-accent-amber fill-current' : 'text-[var(--text-faint)]'" />
        </div>
        <span class="text-sm font-bold text-accent-amber">{{ average.toFixed(1) }}</span>
      </div>
    </div>

    <!-- ═══ Steam 评测摘要条（真的取到 Steam 数据时才显示）═══ -->
    <div v-if="steamData && steamData.available" class="rounded-xl bg-gradient-to-r from-[#1b2838]/90 to-[#171a21]/90 border border-[#3d4f5f]/50 p-4 space-y-3">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="text-xs font-semibold text-white/70 uppercase tracking-wider">Steam 评测</span>
          <a :href="`https://store.steampowered.com/app/${steamData.steamAppId}`" target="_blank"
            rel="noopener noreferrer" class="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-0.5 transition-colors">
            在 Steam 查看 <ExternalLink class="w-3 h-3" />
          </a>
          <span class="text-[9px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400/80">Steam 实时</span>
        </div>
        <div class="flex items-center gap-4">
          <div class="text-right">
            <div class="text-lg font-display font-bold text-white">{{ Math.round(steamData.summary.reviewScore * 100) }}%</div>
            <div class="text-[10px] text-white/50">好评率</div>
          </div>
          <div class="text-right">
            <div class="text-sm font-bold text-green-400">{{ (steamData.summary.totalPositive / 1000).toFixed(1) }}K</div>
            <div class="text-[10px] text-white/50">好评 / 总 {{ (steamData.summary.totalReviews / 1000).toFixed(1) }}K</div>
          </div>
        </div>
      </div>

      <!-- Steam 评论样本 -->
      <div v-if="steamData.reviews.length > 0" class="space-y-2 pt-1 border-t border-white/5">
        <div class="flex items-center gap-1.5 mb-2">
          <ThumbsUp class="w-3 h-3 text-green-400" />
          <span class="text-[11px] font-medium text-white/60">Steam 用户评价样本</span>
        </div>
        <div v-for="sr in steamData.reviews.slice(0, 3)" :key="sr.id"
          class="rounded-lg bg-black/25 p-3 space-y-1.5">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2 min-w-0">
              <div class="w-6 h-6 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-[10px] font-bold text-white shrink-0">
                {{ sr.author.charAt(0).toUpperCase() }}
              </div>
              <span class="text-xs font-medium text-white/80 truncate">{{ sr.author }}</span>
              <span :class="sr.rating === 'Recommended' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'"
                class="text-[9px] px-1.5 py-0.5 rounded font-medium">
                {{ sr.rating === 'Recommended' ? '推荐' : '不推荐' }}
              </span>
              <span class="flex items-center gap-0.5 text-[10px] text-white/40 ml-auto">
                <Clock class="w-2.5 h-2.5" />{{ fmtPlaytime(sr.playtime_forever) }}
              </span>
            </div>
            <span class="text-[10px] text-white/30 shrink-0">{{ steamRelativeTime(sr.created) }}</span>
          </div>
          <p class="text-[12px] text-white/65 leading-relaxed line-clamp-3">{{ sr.review }}</p>
        </div>
      </div>
    </div>

    <!-- ═══ Steam 数据没取到：如实说明，不用编造数据填充 ═══ -->
    <div
      v-else-if="steamData && !steamData.available"
      class="rounded-xl bg-[var(--surface)] border border-[var(--border)] p-3 flex items-start gap-2"
    >
      <TriangleAlert class="w-3.5 h-3.5 text-accent-amber shrink-0 mt-0.5" />
      <div class="min-w-0">
        <p class="text-[11px] text-[var(--text-dim)]">暂未获取到 Steam 评测</p>
        <p class="text-[10px] text-[var(--text-faint)] mt-0.5 break-words">{{ steamData.reason }}</p>
      </div>
    </div>

    <!-- ═══ 发表表单 ═══ -->
    <div v-if="auth.isLoggedIn" class="rounded-xl bg-[var(--surface)] border border-[var(--border)] p-3 space-y-2">
      <div class="flex items-center gap-2">
        <span class="text-xs text-[var(--text-dim)]">打分</span>
        <button v-for="i in 5" :key="i" type="button"
          @click="myRating = i" @mouseenter="hoverRating = i" @mouseleave="hoverRating = 0"
          class="transition-transform hover:scale-110">
          <Star class="w-5 h-5" :class="(hoverRating || myRating) >= i ? 'text-accent-amber fill-current' : 'text-[var(--text-faint)]'" />
        </button>
        <span v-if="myRating" class="text-xs text-accent-amber ml-1">{{ myRating }}.0</span>
      </div>
      <textarea v-model="myContent" rows="2" placeholder="分享你的真实体验…"
        class="w-full px-3 py-2 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-sm text-[var(--text)] placeholder-[var(--text-faint)] focus:outline-none focus:border-accent/50 resize-none" />
      <div class="flex justify-end">
        <button @click="submit" :disabled="submitting"
          class="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-accent hover:bg-accent-strong text-white text-sm font-medium transition-colors disabled:opacity-50">
          <Loader2 v-if="submitting" class="w-3.5 h-3.5 animate-spin" />
          <Send v-else class="w-3.5 h-3.5" />
          发布
        </button>
      </div>
    </div>
    <div v-else class="rounded-xl bg-[var(--surface)] border border-[var(--border)] p-3 text-center">
      <RouterLink to="/login" class="text-sm text-accent hover:text-accent-strong">登录</RouterLink>
      <span class="text-xs text-[var(--text-faint)]"> 后参与评价</span>
    </div>

    <!-- ═══ 社区本地评论列表 ═══ -->
    <div v-if="loading" class="flex items-center justify-center py-8 text-[var(--text-dim)]">
      <Loader2 class="w-5 h-5 animate-spin mr-2" /> 加载评论…
    </div>
    <div v-else-if="error" class="text-center text-accent-red text-sm py-6">{{ error }}</div>
    <div v-else-if="reviews.length === 0" class="text-center text-[var(--text-faint)] text-sm py-6">
      还没有评价，来做第一个吧～
    </div>
    <ul v-else class="space-y-3">
      <li v-for="r in reviews" :key="r.id"
        class="flex gap-3 rounded-xl bg-[var(--surface)] border border-[var(--border)] p-3">
        <div class="w-9 h-9 rounded-full bg-gradient-to-br from-accent to-accent-cyan flex items-center justify-center text-white text-sm font-bold shrink-0 overflow-hidden">
          <img v-if="r.avatar" :src="r.avatar" class="w-full h-full object-cover" alt="" />
          <span v-else>{{ (displayName(r).charAt(0) || '?').toUpperCase() }}</span>
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <span class="text-sm font-semibold text-[var(--text)] truncate">{{ displayName(r) }}</span>
            <span v-if="r.rating" class="flex items-center gap-0.5">
              <Star v-for="i in 5" :key="i" class="w-3 h-3"
                :class="i <= r.rating ? 'text-accent-amber fill-current' : 'text-[var(--text-faint)]'" />
            </span>
            <span class="text-[11px] text-[var(--text-faint)] ml-auto">{{ relativeTime(r.created_at) }}</span>
            <button v-if="auth.user && r.user_id === auth.user.id" @click="remove(r.id)"
              :disabled="deletingId === r.id"
              class="text-[var(--text-faint)] hover:text-accent-red transition-colors disabled:opacity-50" title="删除我的评论">
              <Loader2 v-if="deletingId === r.id" class="w-3.5 h-3.5 animate-spin" />
              <Trash2 v-else class="w-3.5 h-3.5" />
            </button>
          </div>
          <p v-if="r.content" class="text-sm text-[var(--text-dim)] leading-relaxed mt-1 break-words">{{ r.content }}</p>
        </div>
      </li>
    </ul>
  </section>
</template>
