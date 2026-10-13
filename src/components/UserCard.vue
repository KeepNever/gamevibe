<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { UserPlus, UserCheck, Loader2 } from 'lucide-vue-next'
import type { SocialUser } from '@/lib/socialApi'
import { followUser, unfollowUser } from '@/lib/socialApi'
import { useAuthStore } from '@/stores/authStore'
import { useToastStore } from '@/stores/toastStore'

const props = defineProps<{ user: SocialUser }>()
const emit = defineEmits<{ (e: 'updated', following: boolean): void }>()

const router = useRouter()
const auth = useAuthStore()
const toast = useToastStore()

const following = ref(!!props.user.is_following)
const loading = ref(false)

const isSelf = computed(() => auth.user?.id === props.user.id)
const initial = computed(() => (props.user.display_name || props.user.username || '?')[0].toUpperCase())
const name = computed(() => props.user.display_name || props.user.username)

async function toggle() {
  if (!auth.isLoggedIn) {
    router.push('/login')
    return
  }
  if (loading.value) return
  loading.value = true
  const next = !following.value
  try {
    if (next) await followUser(props.user.id)
    else await unfollowUser(props.user.id)
    following.value = next
    emit('updated', next)
    toast.add(next ? `已关注 ${name.value}` : `已取消关注 ${name.value}`, 'success')
  } catch (e: any) {
    toast.add(e?.message || '操作失败', 'error')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="flex items-center gap-3 p-3 rounded-2xl bg-[var(--surface-2)] border border-[var(--border)] hover:border-accent/40 transition-colors">
    <!-- 头像 -->
    <RouterLink :to="`/user/${user.id}`" class="w-11 h-11 rounded-full bg-gradient-to-br from-accent to-accent-cyan flex items-center justify-center text-white font-bold shrink-0 overflow-hidden">
      <img v-if="user.avatar" :src="user.avatar" :alt="name" class="w-full h-full object-cover" />
      <span v-else>{{ initial }}</span>
    </RouterLink>

    <!-- 信息 -->
    <RouterLink :to="`/user/${user.id}`" class="min-w-0 flex-1">
      <div class="text-sm font-semibold text-[var(--text)] truncate hover:text-accent transition-colors">{{ name }}</div>
      <div class="text-xs text-[var(--text-faint)] truncate">@{{ user.username }}</div>
      <div class="text-[11px] text-[var(--text-dim)] mt-0.5">
        {{ user.review_count ?? 0 }} 评测 · {{ user.library_count ?? 0 }} 库存
      </div>
    </RouterLink>

    <!-- 关注按钮 -->
    <button
      v-if="!isSelf"
      @click="toggle"
      :disabled="loading"
      class="shrink-0 flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm font-medium transition-all"
      :class="following
        ? 'bg-[var(--surface-3)] text-[var(--text-dim)] hover:text-accent-red'
        : 'bg-accent text-white hover:bg-accent-strong'"
    >
      <Loader2 v-if="loading" class="w-4 h-4 animate-spin" />
      <UserCheck v-else-if="following" class="w-4 h-4" />
      <UserPlus v-else class="w-4 h-4" />
      {{ following ? '已关注' : '关注' }}
    </button>
    <span v-else class="shrink-0 text-xs text-[var(--text-faint)] px-2">我</span>
  </div>
</template>
