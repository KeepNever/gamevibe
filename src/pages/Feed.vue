<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import { Rss, Star, Loader2, Inbox, LogIn, ArrowRight, Gamepad2 } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/authStore'
import { getFeed, type FeedItem } from '@/lib/socialApi'
import { relativeTime } from '@/lib/reviewApi'

const auth = useAuthStore()
const feed = ref<FeedItem[]>([])
const discovery = ref(false)
const message = ref('')
const loading = ref(false)
const error = ref('')

const statusLabel: Record<string, string> = {
  playing: '在玩',
  completed: '通关',
  wishlist: '想玩',
  backlog: ' backlog',
}

function avatarOf(u: FeedItem['user']) {
  return (u.display_name || u.username || '?')[0].toUpperCase()
}

async function load() {
  if (!auth.isLoggedIn) return
  loading.value = true
  error.value = ''
  try {
    const res = await getFeed(25)
    feed.value = res.feed
    discovery.value = res.discovery
    message.value = res.message || ''
  } catch (e: any) {
    error.value = e?.message || '加载失败'
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="max-w-3xl mx-auto px-4 sm:px-6 py-8">
    <header class="mb-6">
      <h1 class="text-2xl font-display font-bold text-[var(--text)] flex items-center gap-2">
        <Rss class="w-6 h-6 text-accent" /> 好友动态
      </h1>
      <p class="text-[var(--text-dim)] mt-1">你关注的玩家最近评测了什么、把什么游戏加入了库存。</p>
    </header>

    <!-- 未登录 -->
    <div v-if="!auth.isLoggedIn" class="flex flex-col items-center justify-center py-24 text-center">
      <div class="w-16 h-16 rounded-2xl bg-accent/10 flex items-center justify-center mb-4">
        <LogIn class="w-8 h-8 text-accent" />
      </div>
      <h2 class="text-xl font-display font-bold text-[var(--text)] mb-2">登录后查看好友动态</h2>
      <p class="text-[var(--text-dim)] mb-6 max-w-md">关注喜欢的玩家，他们的评测与库存更新会出现在这里。</p>
      <RouterLink to="/login" class="px-5 py-2.5 rounded-xl bg-accent text-white text-sm font-medium hover:bg-accent-strong transition-colors">
        去登录
      </RouterLink>
    </div>

    <!-- 加载 -->
    <div v-else-if="loading" class="flex flex-col items-center justify-center py-24 text-[var(--text-dim)]">
      <Loader2 class="w-8 h-8 animate-spin text-accent mb-3" /> 正在加载动态…
    </div>

    <!-- 错误 -->
    <div v-else-if="error" class="flex flex-col items-center justify-center py-24 text-center">
      <Inbox class="w-10 h-10 text-accent-red mb-3" />
      <p class="text-[var(--text-dim)]">加载失败：{{ error }}</p>
    </div>

    <!-- 发现态提示 -->
    <div v-else-if="discovery" class="mb-5 p-4 rounded-2xl bg-accent/5 border border-accent/20 flex items-center gap-3">
      <Rss class="w-5 h-5 text-accent shrink-0" />
      <p class="text-sm text-[var(--text-dim)] flex-1">{{ message }}</p>
      <RouterLink to="/social" class="shrink-0 flex items-center gap-1 text-sm font-medium text-accent hover:underline">
        去社区 <ArrowRight class="w-4 h-4" />
      </RouterLink>
    </div>

    <!-- 空态 -->
    <div v-else-if="feed.length === 0" class="flex flex-col items-center justify-center py-24 text-center">
      <div class="w-16 h-16 rounded-2xl bg-accent/10 flex items-center justify-center mb-4">
        <Rss class="w-8 h-8 text-accent" />
      </div>
      <h2 class="text-xl font-display font-bold text-[var(--text)] mb-2">动态还是空的</h2>
      <p class="text-[var(--text-dim)] mb-6 max-w-md">关注几个玩家，他们的评测和库存更新就会出现在你这里。</p>
      <RouterLink to="/social" class="px-5 py-2.5 rounded-xl bg-accent text-white text-sm font-medium hover:bg-accent-strong transition-colors inline-flex items-center gap-1.5">
        去发现用户 <ArrowRight class="w-4 h-4" />
      </RouterLink>
    </div>

    <!-- 动态流 -->
    <div v-else class="space-y-3">
      <article
        v-for="item in feed"
        :key="item.id"
        class="flex gap-3 p-4 rounded-2xl bg-[var(--surface-2)] border border-[var(--border)]"
      >
        <!-- 用户头像 -->
        <RouterLink :to="`/user/${item.user.id}`" class="w-10 h-10 rounded-full bg-gradient-to-br from-accent to-accent-cyan flex items-center justify-center text-white font-bold shrink-0 overflow-hidden">
          <img v-if="item.user.avatar" :src="item.user.avatar" :alt="item.user.display_name || item.user.username" class="w-full h-full object-cover" />
          <span v-else>{{ avatarOf(item.user) }}</span>
        </RouterLink>

        <div class="min-w-0 flex-1">
          <!-- 头部：谁 + 动作 -->
          <div class="flex items-center gap-2 flex-wrap">
            <RouterLink :to="`/user/${item.user.id}`" class="text-sm font-semibold text-[var(--text)] hover:text-accent transition-colors">{{ item.user.display_name || item.user.username }}</RouterLink>
            <span v-if="item.type === 'review'" class="text-sm text-[var(--text-dim)]">评测了</span>
            <span v-else class="text-sm text-[var(--text-dim)]">把</span>
            <RouterLink
              v-if="item.gameId"
              :to="`/game/${item.gameId}`"
              class="text-sm font-medium text-accent hover:underline truncate"
            >《{{ item.gameName }}》</RouterLink>
            <span v-else class="text-sm font-medium text-[var(--text)] truncate">《{{ item.gameName }}》</span>
            <span v-if="item.type === 'library'" class="text-xs px-2 py-0.5 rounded-full bg-accent/10 text-accent font-medium">
              {{ statusLabel[item.status] || item.status }}
            </span>
            <span class="text-xs text-[var(--text-faint)] ml-auto shrink-0">{{ relativeTime(item.created_at) }}</span>
          </div>

          <!-- 评测内容 -->
          <div v-if="item.type === 'review'" class="mt-2 flex gap-3">
            <RouterLink v-if="item.gameId" :to="`/game/${item.gameId}`" class="w-14 h-16 rounded-lg overflow-hidden bg-[var(--surface-3)] shrink-0 flex items-center justify-center text-[var(--text-faint)] text-xs font-bold">
              <img v-if="item.gameCover" :src="item.gameCover" :alt="item.gameName" class="w-full h-full object-cover" loading="lazy" />
              <span v-else>{{ item.gameName.slice(0, 1) }}</span>
            </RouterLink>
            <div class="min-w-0 flex-1">
              <div v-if="item.rating != null" class="flex items-center gap-0.5 text-accent-amber mb-1">
                <Star v-for="n in 5" :key="n" class="w-3.5 h-3.5" :class="n <= Math.round(item.rating) ? 'fill-current' : 'text-[var(--text-faint)]'" />
                <span class="text-xs text-[var(--text-dim)] ml-1">{{ item.rating }}</span>
              </div>
              <p v-if="item.content" class="text-sm text-[var(--text)] leading-relaxed">{{ item.content }}</p>
            </div>
          </div>
        </div>
      </article>

      <div class="flex items-center justify-center gap-2 text-[var(--text-faint)] text-sm py-4">
        <Gamepad2 class="w-4 h-4" /> 已经到底啦
      </div>
    </div>
  </div>
</template>
