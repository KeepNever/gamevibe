<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import { UserPlus, UserCheck, Loader2, ArrowLeft, Star, Gamepad2, Users, Library as LibIcon, MessageSquare } from 'lucide-vue-next'
import { getUserProfile, followUser, unfollowUser, type UserProfile as Profile, type UserReview, type UserLibraryItem } from '@/lib/socialApi'
import { useAuthStore } from '@/stores/authStore'
import { useToastStore } from '@/stores/toastStore'
import { relativeTime } from '@/lib/reviewApi'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const toast = useToastStore()

const profile = ref<Profile | null>(null)
const loading = ref(true)
const error = ref('')
const following = ref(false)
const busy = ref(false)

const userId = computed(() => route.params.id as string)
const name = computed(() => profile.value?.user.display_name || profile.value?.user.username || '')
const initial = computed(() => (name.value[0] || '?').toUpperCase())
const isSelf = computed(() => auth.user?.id === userId.value)

const STATUS_LABEL: Record<string, string> = {
  playing: '在玩', completed: '已通关', wishlist: '想玩', abandoned: '弃坑', backlog: '待玩',
}
function statusLabel(s: string) {
  return STATUS_LABEL[s] || s
}
const statusColor: Record<string, string> = {
  playing: 'bg-accent-green/15 text-accent-green',
  completed: 'bg-accent/15 text-accent',
  wishlist: 'bg-accent-blue/15 text-accent-blue',
  abandoned: 'bg-[var(--surface-3)] text-[var(--text-faint)]',
  backlog: 'bg-accent-pink/15 text-accent-pink',
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    profile.value = await getUserProfile(userId.value)
    following.value = profile.value.user.isFollowing
  } catch (e: any) {
    error.value = e?.message || '加载失败'
  } finally {
    loading.value = false
  }
}

async function toggleFollow() {
  if (!auth.isLoggedIn) {
    router.push('/login')
    return
  }
  if (busy.value || isSelf.value) return
  busy.value = true
  const next = !following.value
  try {
    if (next) await followUser(userId.value)
    else await unfollowUser(userId.value)
    following.value = next
    if (profile.value) profile.value.user.isFollowing = next
    if (profile.value) profile.value.user.followerCount += next ? 1 : -1
    toast.add(next ? `已关注 ${name.value}` : `已取消关注 ${name.value}`, 'success')
  } catch (e: any) {
    toast.add(e?.message || '操作失败', 'error')
  } finally {
    busy.value = false
  }
}

const joined = computed(() => {
  const t = profile.value?.user.created_at
  if (!t) return ''
  return new Date(t).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' })
})

watch(userId, load)
onMounted(load)
</script>

<template>
  <div class="max-w-4xl mx-auto px-4 py-6">
    <!-- 返回 -->
    <RouterLink to="/social" class="inline-flex items-center gap-1 text-sm text-[var(--text-dim)] hover:text-[var(--text)] mb-4 transition-colors">
      <ArrowLeft class="w-4 h-4" /> 返回社区
    </RouterLink>

    <!-- 加载 -->
    <div v-if="loading" class="flex items-center justify-center py-20 text-[var(--text-dim)]">
      <Loader2 class="w-6 h-6 animate-spin" />
    </div>

    <!-- 错误 -->
    <div v-else-if="error" class="text-center py-20 text-[var(--text-dim)]">
      <p>{{ error }}</p>
      <button @click="load" class="mt-4 px-4 py-2 rounded-lg bg-accent text-white text-sm">重试</button>
    </div>

    <template v-else-if="profile">
      <!-- 资料卡 -->
      <section class="rounded-2xl bg-[var(--surface-2)] border border-[var(--border)] p-6">
        <div class="flex flex-col sm:flex-row sm:items-center gap-4">
          <div class="w-20 h-20 rounded-full bg-gradient-to-br from-accent to-accent-cyan flex items-center justify-center text-white text-3xl font-bold shrink-0 overflow-hidden">
            <img v-if="profile.user.avatar" :src="profile.user.avatar" :alt="name" class="w-full h-full object-cover" />
            <span v-else>{{ initial }}</span>
          </div>
          <div class="min-w-0 flex-1">
            <h1 class="text-xl font-bold text-[var(--text)] truncate">{{ name }}</h1>
            <p class="text-sm text-[var(--text-faint)]">@{{ profile.user.username }}</p>
            <p v-if="profile.user.bio" class="text-sm text-[var(--text-dim)] mt-2">{{ profile.user.bio }}</p>
            <p v-if="joined" class="text-xs text-[var(--text-faint)] mt-1">加入于 {{ joined }}</p>
          </div>
          <button
            v-if="!isSelf"
            @click="toggleFollow"
            :disabled="busy"
            class="shrink-0 flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all"
            :class="following
              ? 'bg-[var(--surface-3)] text-[var(--text-dim)] hover:text-accent-red'
              : 'bg-accent text-white hover:bg-accent-strong'"
          >
            <Loader2 v-if="busy" class="w-4 h-4 animate-spin" />
            <UserCheck v-else-if="following" class="w-4 h-4" />
            <UserPlus v-else class="w-4 h-4" />
            {{ following ? '已关注' : '关注' }}
          </button>
        </div>

        <!-- 统计 -->
        <div class="grid grid-cols-4 gap-2 mt-6 pt-5 border-t border-[var(--border)]">
          <div class="text-center">
            <div class="text-lg font-bold text-[var(--text)]">{{ profile.user.reviewCount }}</div>
            <div class="text-xs text-[var(--text-faint)] flex items-center justify-center gap-1"><MessageSquare class="w-3 h-3" />评测</div>
          </div>
          <div class="text-center">
            <div class="text-lg font-bold text-[var(--text)]">{{ profile.user.libraryCount }}</div>
            <div class="text-xs text-[var(--text-faint)] flex items-center justify-center gap-1"><LibIcon class="w-3 h-3" />库存</div>
          </div>
          <div class="text-center">
            <div class="text-lg font-bold text-[var(--text)]">{{ profile.user.followingCount }}</div>
            <div class="text-xs text-[var(--text-faint)] flex items-center justify-center gap-1"><Users class="w-3 h-3" />关注</div>
          </div>
          <div class="text-center">
            <div class="text-lg font-bold text-[var(--text)]">{{ profile.user.followerCount }}</div>
            <div class="text-xs text-[var(--text-faint)] flex items-center justify-center gap-1"><Users class="w-3 h-3" />粉丝</div>
          </div>
        </div>

        <!-- 库存状态分布 -->
        <div v-if="Object.keys(profile.statusDistribution).length" class="flex flex-wrap gap-2 mt-4">
          <span v-for="(cnt, st) in profile.statusDistribution" :key="st"
            class="text-xs px-2.5 py-1 rounded-full" :class="statusColor[st] || 'bg-[var(--surface-3)] text-[var(--text-dim)]'">
            {{ statusLabel(st) }} {{ cnt }}
          </span>
        </div>
      </section>

      <!-- 他的评测 -->
      <section class="mt-8">
        <h2 class="text-base font-semibold text-[var(--text)] mb-3 flex items-center gap-2">
          <MessageSquare class="w-4 h-4 text-accent" /> 他的评测
        </h2>
        <div v-if="!profile.reviews.length" class="text-sm text-[var(--text-faint)] py-6 text-center bg-[var(--surface-2)] rounded-xl">
          还没有评测
        </div>
        <div v-else class="space-y-3">
          <article v-for="r in profile.reviews" :key="r.id"
            class="flex gap-3 p-3 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] hover:border-accent/30 transition-colors">
            <RouterLink :to="`/game/${r.gameId}`" class="shrink-0">
              <img v-if="r.gameCover" :src="r.gameCover" :alt="r.gameName"
                class="w-16 h-20 object-cover rounded-lg bg-[var(--surface-3)]" />
              <div v-else class="w-16 h-20 rounded-lg bg-[var(--surface-3)] flex items-center justify-center text-[var(--text-faint)] text-xs">无图</div>
            </RouterLink>
            <div class="min-w-0 flex-1">
              <RouterLink :to="`/game/${r.gameId}`" class="font-medium text-[var(--text)] hover:text-accent transition-colors truncate block">{{ r.gameName }}</RouterLink>
              <div class="flex items-center gap-1 mt-1">
                <Star v-if="r.rating" class="w-3.5 h-3.5 text-accent" fill="currentColor" />
                <span class="text-sm text-accent font-semibold">{{ r.rating ? r.rating + ' 分' : '未评分' }}</span>
                <span class="text-xs text-[var(--text-faint)] ml-auto">{{ relativeTime(r.created_at) }}</span>
              </div>
              <p v-if="r.content" class="text-sm text-[var(--text-dim)] mt-1.5 line-clamp-3">{{ r.content }}</p>
            </div>
          </article>
        </div>
      </section>

      <!-- 他的游戏库 -->
      <section class="mt-8">
        <h2 class="text-base font-semibold text-[var(--text)] mb-3 flex items-center gap-2">
          <Gamepad2 class="w-4 h-4 text-accent" /> 他的游戏库
        </h2>
        <div v-if="!profile.library.length" class="text-sm text-[var(--text-faint)] py-6 text-center bg-[var(--surface-2)] rounded-xl">
          游戏库还是空的
        </div>
        <div v-else class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          <RouterLink v-for="g in profile.library" :key="g.id" :to="g.gameId ? `/game/${g.gameId}` : '#'"
            class="group rounded-xl bg-[var(--surface-2)] border border-[var(--border)] overflow-hidden hover:border-accent/40 transition-colors">
            <div class="aspect-[3/4] bg-[var(--surface-3)] relative">
              <img v-if="g.coverUrl" :src="g.coverUrl" :alt="g.name" class="w-full h-full object-cover" />
              <div v-else class="w-full h-full flex items-center justify-center text-[var(--text-faint)] text-xs px-2 text-center">{{ g.name }}</div>
              <span class="absolute top-2 right-2 text-[11px] px-2 py-0.5 rounded-full" :class="statusColor[g.status] || 'bg-[var(--surface-3)] text-[var(--text-dim)]'">
                {{ statusLabel(g.status) }}
              </span>
            </div>
            <div class="p-2 text-xs text-[var(--text)] truncate">{{ g.name }}</div>
          </RouterLink>
        </div>
      </section>
    </template>
  </div>
</template>
