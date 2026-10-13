<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import { Users, UserCheck, UserPlus, Loader2, Inbox, LogIn } from 'lucide-vue-next'
import UserCard from '@/components/UserCard.vue'
import { useAuthStore } from '@/stores/authStore'
import { getSocialUsers, getFollowing, getFollowers, type SocialUser } from '@/lib/socialApi'

const router = useRouter()
const auth = useAuthStore()

type Tab = 'discover' | 'following' | 'followers'
const tab = ref<Tab>('discover')

const discover = ref<SocialUser[]>([])
const following = ref<SocialUser[]>([])
const followers = ref<SocialUser[]>([])
const loading = ref(false)
const error = ref('')

const tabs = [
  { key: 'discover', label: '发现用户', icon: Users },
  { key: 'following', label: '我的关注', icon: UserCheck },
  { key: 'followers', label: '我的粉丝', icon: UserPlus },
] as const

function tabClass(key: Tab) {
  const base = 'flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all '
  return tab.value === key
    ? base + 'bg-accent/10 text-accent'
    : base + 'text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]'
}

async function loadDiscover() {
  loading.value = true
  error.value = ''
  try {
    discover.value = await getSocialUsers(20, auth.user?.id)
  } catch (e: any) {
    error.value = e?.message || '加载失败'
  } finally {
    loading.value = false
  }
}

async function loadRelations() {
  if (!auth.user) return
  loading.value = true
  error.value = ''
  try {
    const [f, fo] = await Promise.all([getFollowing(auth.user.id), getFollowers(auth.user.id)])
    following.value = f
    followers.value = fo
  } catch (e: any) {
    error.value = e?.message || '加载失败'
  } finally {
    loading.value = false
  }
}

function onSwitch(t: Tab) {
  tab.value = t
  if ((t === 'following' || t === 'followers') && auth.isLoggedIn && !following.value.length && !followers.value.length) {
    loadRelations()
  }
}

// 关注状态变化时，关系列表可能需要刷新
function handleUpdated() {
  if (auth.isLoggedIn && (following.value.length || followers.value.length)) {
    loadRelations()
  } else {
    loadDiscover()
  }
}

const currentList = computed<SocialUser[]>(() => {
  if (tab.value === 'following') return following.value
  if (tab.value === 'followers') return followers.value
  return discover.value
})

onMounted(loadDiscover)
watch(
  () => auth.isLoggedIn,
  (v) => {
    if (v && (tab.value === 'following' || tab.value === 'followers')) loadRelations()
  },
)
</script>

<template>
  <div class="max-w-5xl mx-auto px-4 sm:px-6 py-8">
    <header class="mb-6">
      <h1 class="text-2xl font-display font-bold text-[var(--text)] flex items-center gap-2">
        <Users class="w-6 h-6 text-accent" /> 社区 · 发现玩伴
      </h1>
      <p class="text-[var(--text-dim)] mt-1">关注志同道合的玩家，在「动态」里看他们的评测与库存更新。</p>
    </header>

    <!-- 标签页 -->
    <div class="flex flex-wrap gap-2 mb-6">
      <button v-for="{ key, label, icon } in tabs" :key="key" :class="tabClass(key)" @click="onSwitch(key)">
        <component :is="icon" class="w-4 h-4" /> {{ label }}
      </button>
    </div>

    <!-- 未登录提示（关系页） -->
    <div v-if="(tab === 'following' || tab === 'followers') && !auth.isLoggedIn" class="flex flex-col items-center justify-center py-20 text-center">
      <div class="w-16 h-16 rounded-2xl bg-accent/10 flex items-center justify-center mb-4">
        <LogIn class="w-8 h-8 text-accent" />
      </div>
      <h2 class="text-lg font-display font-bold text-[var(--text)] mb-2">登录后查看关注关系</h2>
      <p class="text-[var(--text-dim)] mb-6 max-w-sm">关注喜欢的玩家，这里会显示你关注的人和关注你的人。</p>
      <RouterLink to="/login" class="px-5 py-2.5 rounded-xl bg-accent text-white text-sm font-medium hover:bg-accent-strong transition-colors">
        去登录
      </RouterLink>
    </div>

    <!-- 加载 -->
    <div v-else-if="loading" class="flex flex-col items-center justify-center py-20 text-[var(--text-dim)]">
      <Loader2 class="w-8 h-8 animate-spin text-accent mb-3" /> 加载中…
    </div>

    <!-- 错误 -->
    <div v-else-if="error" class="flex flex-col items-center justify-center py-20 text-center">
      <Inbox class="w-10 h-10 text-accent-red mb-3" />
      <p class="text-[var(--text-dim)]">加载失败：{{ error }}</p>
    </div>

    <!-- 空状态 -->
    <div v-else-if="currentList.length === 0" class="flex flex-col items-center justify-center py-20 text-center">
      <div class="w-16 h-16 rounded-2xl bg-accent/10 flex items-center justify-center mb-4">
        <component :is="tab === 'discover' ? Users : tab === 'following' ? UserCheck : UserPlus" class="w-8 h-8 text-accent" />
      </div>
      <h2 class="text-lg font-display font-bold text-[var(--text)] mb-1">
        {{ tab === 'discover' ? '还没有可发现的用户' : tab === 'following' ? '你还没有关注任何人' : '还没有人关注你' }}
      </h2>
      <p class="text-[var(--text-dim)] max-w-sm">
        {{ tab === 'discover' ? '稍后再来看看吧。' : '去「发现用户」关注几个志同道合的玩家吧。' }}
      </p>
    </div>

    <!-- 列表 -->
    <div v-else class="grid sm:grid-cols-2 gap-3">
      <UserCard
        v-for="u in currentList"
        :key="u.id"
        :user="u"
        @updated="handleUpdated"
      />
    </div>
  </div>
</template>
