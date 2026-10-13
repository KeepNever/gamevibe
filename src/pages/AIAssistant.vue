<script setup lang="ts">
import { ref, computed, nextTick, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { Send, Bot, User, Sparkles, Loader2, ArrowRight, Zap, LogIn, Globe, ExternalLink, WifiOff } from 'lucide-vue-next'
import { useGameStore } from '@/stores/gameStore'
import { useAuthStore } from '@/stores/authStore'
import { streamAIChat, type WebMode } from '@/lib/ai'
import TastePanel from '@/components/TastePanel.vue'
import { games } from '@/data/games'
import type { ChatMessage, Game } from '@/types/game'

const SUGGESTIONS = [
  '最近有什么新游戏资讯？',
  '艾尔登法环最近有什么更新？',
  '推荐几款类似艾尔登法环的游戏',
  '有什么好玩的Roguelike游戏？',
  '给我推荐几款免费游戏',
  '我喜欢像素风和独立游戏',
]

/** 联网开关：自动（按意图）/ 强制联网 / 关闭 */
const webMode = ref<WebMode>('auto')
const WEB_MODES: { value: WebMode; label: string; hint: string }[] = [
  { value: 'auto', label: '自动', hint: '命中「资讯 / 最新 / 发售 / 特价」时自动联网' },
  { value: 'on', label: '联网', hint: '每次都强制联网检索最新资讯' },
  { value: 'off', label: '关闭', hint: '只用站内目录回答，不联网' },
]
const webHint = computed(() => WEB_MODES.find((m) => m.value === webMode.value)?.hint ?? '')

function fmtDate(ms: number | null | undefined): string {
  if (!ms) return ''
  try {
    return new Date(ms).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
  } catch {
    return ''
  }
}

/** 联网来源分组：按类别折叠展示，避免一长串平铺 */
const SOURCE_GROUPS: { kind: string; label: string }[] = [
  { kind: 'web', label: '全网资讯' },
  { kind: 'related', label: '相关游戏' },
  { kind: 'news', label: '游戏资讯' },
  { kind: 'deal', label: '特价' },
  { kind: 'release', label: '最新发售' },
  { kind: 'upcoming', label: '即将发售' },
  { kind: 'top', label: '热销榜' },
]
function groupSources(list: NonNullable<ChatMessage['sources']>) {
  return SOURCE_GROUPS.map((g) => ({ label: g.label, items: list.filter((s) => s.kind === g.kind) })).filter(
    (g) => g.items.length > 0,
  )
}

const store = useGameStore()
const auth = useAuthStore()

const input = ref('')
const isThinking = ref(false)
const isStreaming = ref(false)
const chatEndRef = ref<HTMLElement | null>(null)
// 流式文本：用 ref 直接操作 DOM，绕过 Vue 重渲染，彻底规避 React 19 的 insertBefore 崩溃
const streamingText = ref('')
const streamingElRef = ref<HTMLElement | null>(null)
const sendingRef = ref(false)

const firstMessage = computed(
  () => store.chatHistory.length === 0 && !isStreaming.value && !isThinking.value,
)

function appendToken(chunk: string) {
  streamingText.value += chunk
  if (streamingElRef.value) streamingElRef.value.textContent = streamingText.value
}

function clearStreaming() {
  streamingText.value = ''
  if (streamingElRef.value) streamingElRef.value.textContent = ''
}

function scrollToEnd() {
  nextTick(() => chatEndRef.value?.scrollIntoView({ behavior: 'smooth' }))
}

watch(
  () => [store.chatHistory.length, isThinking.value, isStreaming.value],
  () => scrollToEnd(),
)

async function handleSend(message?: string) {
  const text = message || input.value.trim()
  if (!text || isThinking.value || sendingRef.value) return
  if (!auth.user) {
    alert('请先登录后再使用 AI 游戏顾问')
    return
  }
  sendingRef.value = true

  const userMsg: ChatMessage = {
    id: Date.now().toString(),
    role: 'user',
    content: text,
    timestamp: Date.now(),
  }
  store.addChatMessage(userMsg)
  input.value = ''
  isThinking.value = true
  clearStreaming()
  scrollToEnd()

  await streamAIChat(text, {
    onToken: (chunk) => {
      if (!isStreaming.value) {
        isThinking.value = false
        isStreaming.value = true
      }
      appendToken(chunk)
      scrollToEnd()
    },
    onDone: (gameIds, full, meta) => {
      const recommended: Game[] = gameIds
        .map((id) => games.find((g) => g.id === id))
        .filter((g): g is Game => Boolean(g))
      store.addChatMessage({
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: full,
        games: recommended,
        constraints: meta.constraints,
        relaxed: meta.relaxed,
        engine: meta.engine,
        sources: meta.sources,
        web: meta.web,
        timestamp: Date.now(),
      })
      isStreaming.value = false
      clearStreaming()
      isThinking.value = false
      sendingRef.value = false
      scrollToEnd()
    },
    onError: (msg) => {
      isStreaming.value = false
      clearStreaming()
      isThinking.value = false
      sendingRef.value = false
      store.addChatMessage({
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `⚠️ ${msg}`,
        timestamp: Date.now(),
      })
      scrollToEnd()
    },
  }, { web: webMode.value })
}

function handleKeyDown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSend()
  }
}
</script>

<template>
  <div class="flex flex-col xl:flex-row gap-6 max-w-6xl mx-auto items-start">
    <!-- 主聊天列 -->
    <div class="flex flex-col h-[calc(100vh-6rem)] flex-1 min-w-0 w-full">
    <!-- Header -->
    <div class="shrink-0 pb-6 border-b border-[var(--border)]">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-accent-strong to-accent-blue flex items-center justify-center">
            <Bot class="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 class="text-lg font-display font-bold text-[var(--text)] flex items-center gap-2">
              AI 游戏顾问
              <span
                class="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium"
                :class="auth.user ? 'bg-accent-green/15 text-accent-green' : 'bg-accent-amber/15 text-accent-amber'"
              >
                <Zap v-if="auth.user" class="w-3 h-3" />
                <LogIn v-else class="w-3 h-3" />
                {{ auth.user ? '已接入（后端驱动）' : '需登录' }}
              </span>
            </h1>
            <p class="text-sm text-[var(--text-faint)]">找游戏、查最新资讯，都可以问我</p>
          </div>
        </div>
        <button
          v-if="store.chatHistory.length > 0"
          @click="store.clearChat()"
          class="text-xs text-[var(--text-faint)] hover:text-[var(--text-dim)] transition-colors"
        >
          清空对话
        </button>
      </div>
    </div>

    <!-- Messages -->
    <div class="flex-1 overflow-y-auto py-6 space-y-6">
      <!-- 欢迎页：始终在 DOM 中，用 hidden 切换，保持稳定结构 -->
      <div :class="firstMessage ? '' : 'hidden'">
        <div class="text-center py-8">
          <Sparkles class="w-12 h-12 text-accent/50 mx-auto mb-4" />
          <h2 class="text-lg font-display font-bold text-[var(--text-dim)] mb-2">想玩什么？告诉我吧</h2>
          <p class="text-sm text-[var(--text-faint)] mb-6">我可以根据你的喜好推荐游戏，也能联网检索最新游戏资讯</p>
          <div class="flex flex-wrap justify-center gap-2">
            <button
              v-for="s in SUGGESTIONS"
              :key="s"
              @click="handleSend(s)"
              class="px-4 py-2 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] text-sm text-[var(--text-dim)] hover:text-accent hover:border-accent/30 transition-all"
            >
              {{ s }}
            </button>
          </div>
          <p v-if="!auth.user" class="text-xs text-[var(--text-faint)] mt-6">
            使用 AI 顾问需<RouterLink to="/login" class="text-accent hover:underline">登录</RouterLink>账号
          </p>
        </div>
      </div>

      <!-- 聊天历史 -->
      <div
        v-for="msg in store.chatHistory"
        :key="msg.id"
        class="flex gap-3"
        :class="msg.role === 'user' ? 'justify-end' : ''"
      >
        <div
          v-if="msg.role === 'assistant'"
          class="w-8 h-8 rounded-lg bg-accent/20 flex items-center justify-center shrink-0 mt-0.5"
        >
          <Bot class="w-4 h-4 text-accent" />
        </div>
        <div class="max-w-[80%]" :class="msg.role === 'user' ? 'order-first' : ''">
          <div
            class="rounded-2xl px-4 py-3"
            :class="msg.role === 'user'
              ? 'bg-accent text-white rounded-br-md'
              : 'bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text)] rounded-bl-md'"
          >
            <p class="text-sm leading-relaxed whitespace-pre-wrap">{{ msg.content }}</p>

            <!-- 需求结构化：命中的硬约束 / 被放宽的条件 / 联网状态（让「AI 听懂了」可见） -->
            <div
              v-if="msg.role === 'assistant' && (msg.constraints?.length || msg.relaxed?.length || msg.web?.used)"
              class="flex flex-wrap items-center gap-1 mt-2.5 pt-2.5 border-t border-[var(--border)]"
            >
              <span
                v-if="msg.web?.used"
                class="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border"
                :class="msg.web.reachable
                  ? 'bg-accent-blue/10 text-accent-blue border-accent-blue/25'
                  : 'bg-accent-amber/10 text-accent-amber border-accent-amber/25'"
              >
                <Globe v-if="msg.web.reachable" class="w-2.5 h-2.5" />
                <WifiOff v-else class="w-2.5 h-2.5" />
                {{ msg.web.reachable ? `已联网 · ${msg.web.count} 条` : '联网不可用' }}
              </span>
              <template v-if="msg.constraints?.length">
                <span class="text-[10px] text-[var(--text-faint)]">已按</span>
                <span
                  v-for="c in msg.constraints"
                  :key="'c-' + c"
                  class="text-[10px] px-1.5 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/20"
                >{{ c }}</span>
                <span class="text-[10px] text-[var(--text-faint)]">筛选</span>
              </template>
              <template v-if="msg.relaxed?.length">
                <span class="text-[10px] text-accent-amber ml-1">已放宽</span>
                <span
                  v-for="r in msg.relaxed"
                  :key="'r-' + r"
                  class="text-[10px] px-1.5 py-0.5 rounded-full bg-accent-amber/10 text-accent-amber border border-accent-amber/25"
                >{{ r }}</span>
              </template>
            </div>

            <!-- 推荐游戏卡片 -->
            <div v-if="msg.games && msg.games.length > 0" class="mt-4 space-y-2">
              <RouterLink
                v-for="game in msg.games"
                :key="game.id"
                :to="`/game/${game.id}`"
                class="flex items-center gap-3 p-3 rounded-xl bg-[var(--surface-3)] hover:bg-[var(--surface)] transition-colors group"
              >
                <div class="w-12 h-16 rounded-lg overflow-hidden bg-[var(--surface-3)] shrink-0">
                  <img :src="game.coverUrl" :alt="game.name" class="w-full h-full object-cover" loading="lazy" />
                </div>
                <div class="flex-1 min-w-0">
                  <div class="text-sm font-semibold text-[var(--text)] group-hover:text-accent transition-colors">
                    {{ game.name }}
                  </div>
                  <div class="flex items-center gap-1.5 mt-1">
                    <span class="text-xs text-accent-amber">★ {{ game.rating }}</span>
                    <span class="text-xs text-[var(--text-faint)]">·</span>
                    <span class="text-xs text-[var(--text-faint)]">{{ game.genres.slice(0, 2).join(' / ') }}</span>
                  </div>
                </div>
                <div class="text-right shrink-0">
                  <div class="text-xs font-semibold text-accent">
                    {{ game.price === 0 ? '免费' : `¥${game.price}` }}
                  </div>
                </div>
                <ArrowRight class="w-4 h-4 text-[var(--text-faint)] group-hover:text-accent transition-colors" />
              </RouterLink>
            </div>

            <!-- 联网来源：标题 / 日期 / 链接均来自后端接口原文，模型不参与生成 -->
            <div
              v-if="msg.sources && msg.sources.length > 0"
              class="mt-3 pt-3 border-t border-[var(--border)] space-y-2.5"
            >
              <div class="flex items-center gap-1.5 text-[10px] text-accent-blue">
                <Globe class="w-3 h-3" />
                <span>联网来源 · {{ msg.sources.length }} 条</span>
                <span
                  v-if="msg.web?.provider"
                  class="px-1 py-0.5 rounded bg-accent-blue/10 text-accent-blue/90 border border-accent-blue/20"
                >全网 + Steam</span>
              </div>
              <div v-for="grp in groupSources(msg.sources)" :key="grp.label" class="space-y-1.5">
                <div class="flex items-center gap-1.5 text-[10px]">
                  <span class="w-1 h-1 rounded-full bg-accent-blue/70"></span>
                  <span class="text-[var(--text-dim)]">{{ grp.label }}</span>
                  <span class="text-[var(--text-faint)] opacity-70">{{ grp.items.length }}</span>
                </div>
                <a
                  v-for="s in grp.items"
                  :key="s.id"
                  :href="s.url"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="block p-2 rounded-lg bg-[var(--surface-3)] hover:bg-[var(--surface)] transition-colors group"
                >
                  <div class="text-xs text-[var(--text)] leading-snug group-hover:text-accent transition-colors">{{ s.title }}</div>
                  <div class="flex items-center gap-1.5 mt-1 text-[10px] text-[var(--text-faint)]">
                    <span>{{ s.source }}</span>
                    <span v-if="fmtDate(s.date)">· {{ fmtDate(s.date) }}</span>
                    <ExternalLink class="w-2.5 h-2.5" />
                  </div>
                </a>
              </div>
            </div>
          </div>
          <div class="text-[10px] text-[var(--text-faint)] mt-1 px-1">
            {{ new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) }}
          </div>
        </div>
        <div
          v-if="msg.role === 'user'"
          class="w-8 h-8 rounded-lg bg-[var(--surface-3)] flex items-center justify-center shrink-0 mt-0.5"
        >
          <User class="w-4 h-4 text-[var(--text-dim)]" />
        </div>
      </div>

      <!-- 流式气泡：始终挂载，ref 直接写文本，零重渲染 -->
      <div :class="isStreaming ? 'flex gap-3' : 'hidden'">
        <div class="w-8 h-8 rounded-lg bg-accent/20 flex items-center justify-center shrink-0 mt-0.5">
          <Bot class="w-4 h-4 text-accent" />
        </div>
        <div class="bg-[var(--surface-2)] border border-[var(--border)] rounded-2xl rounded-bl-md px-4 py-3 max-w-[80%]">
          <p class="text-sm leading-relaxed whitespace-pre-wrap">
            <span ref="streamingElRef"></span><span class="inline-block w-1.5 h-4 align-middle bg-accent/70 animate-pulse ml-0.5" />
          </p>
        </div>
      </div>

      <!-- 思考指示器：始终挂载 -->
      <div :class="isThinking && !isStreaming ? 'flex gap-3' : 'hidden'">
        <div class="w-8 h-8 rounded-lg bg-accent/20 flex items-center justify-center shrink-0 mt-0.5">
          <Bot class="w-4 h-4 text-accent" />
        </div>
        <div class="bg-[var(--surface-2)] border border-[var(--border)] rounded-2xl rounded-bl-md px-4 py-3">
          <div class="flex items-center gap-2">
            <Loader2 class="w-4 h-4 text-accent animate-spin" />
            <span class="text-sm text-[var(--text-dim)]">正在分析你的偏好...</span>
          </div>
        </div>
      </div>

      <div ref="chatEndRef" />
    </div>

    <!-- Input — 用 form + submit.prevent 双重保险防止 Enter 导致刷新/跳转 -->
    <form class="shrink-0 pt-4 border-t border-[var(--border)]" @submit.prevent="handleSend()">
      <div class="relative">
        <textarea
          v-model="input"
          @keydown="handleKeyDown"
          :placeholder="auth.user ? '问游戏推荐，或问「最近有什么新游戏资讯」...' : '登录后可使用 AI 顾问'"
          rows="2"
          :disabled="!auth.user"
          class="w-full px-5 py-3.5 pr-14 rounded-2xl bg-[var(--surface-2)] border border-[var(--border)] text-sm text-[var(--text)] placeholder-[var(--text-faint)] focus:outline-none focus:border-accent/50 resize-none transition-colors disabled:opacity-60"
        />
        <button
          type="submit"
          :disabled="!input.trim() || isThinking || isStreaming || !auth.user"
          class="absolute right-3 bottom-3 p-2 rounded-xl bg-accent hover:bg-accent-strong disabled:bg-[var(--surface-3)] disabled:text-[var(--text-faint)] text-white transition-all"
        >
          <Loader2 v-if="isThinking || isStreaming" class="w-4 h-4 animate-spin" />
          <Send v-else class="w-4 h-4" />
        </button>
      </div>
      <div class="flex items-center justify-between gap-3 mt-2">
        <!-- 联网检索开关：自动 / 联网 / 关闭 -->
        <div class="flex items-center gap-1 shrink-0">
          <Globe class="w-3 h-3 text-[var(--text-faint)]" />
          <span class="text-[10px] text-[var(--text-faint)] mr-0.5">联网检索</span>
          <button
            v-for="m in WEB_MODES"
            :key="m.value"
            type="button"
            :disabled="!auth.user"
            @click="webMode = m.value"
            :title="m.hint"
            class="px-1.5 py-0.5 rounded-md text-[10px] border transition-colors disabled:opacity-50"
            :class="webMode === m.value
              ? 'bg-accent/15 text-accent border-accent/30'
              : 'bg-[var(--surface-2)] text-[var(--text-faint)] border-[var(--border)] hover:text-[var(--text-dim)]'"
          >{{ m.label }}</button>
        </div>
        <p class="text-[10px] text-[var(--text-faint)] text-right">
          {{ auth.user ? webHint : '登录后可使用 AI 游戏顾问' }}
        </p>
      </div>
    </form>
    </div>

    <!-- 右侧：口味画像面板（仅宽屏显示，数据来自后端 /api/ai/profile） -->
    <TastePanel class="hidden xl:block w-72 shrink-0 h-[calc(100vh-6rem)]" />
  </div>
</template>
