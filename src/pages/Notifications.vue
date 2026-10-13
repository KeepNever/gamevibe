<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { Bell, Check, Loader2, UserPlus } from 'lucide-vue-next'
import {
  getNotifications, markNotificationRead, markAllNotificationsRead,
  type AppNotification,
} from '@/lib/socialApi'
import { useAuthStore } from '@/stores/authStore'

const router = useRouter()
const auth = useAuthStore()
const notifications = ref<AppNotification[]>([])
const loading = ref(false)
const error = ref('')

function timeAgo(ts: number): string {
  const d = Date.now() - ts
  const m = 60000, h = 3600000, day = 86400000
  if (d < m) return '刚刚'
  if (d < h) return `${Math.floor(d / m)} 分钟前`
  if (d < day) return `${Math.floor(d / h)} 小时前`
  return `${Math.floor(d / day)} 天前`
}

function textOf(n: AppNotification): string {
  const name = n.display_name || n.username
  if (n.type === 'follow') return `${name} 关注了你`
  return `${name} 与你互动`
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const r = await getNotifications(50)
    notifications.value = r.notifications
  } catch (e: any) {
    error.value = e?.message || '加载失败'
  } finally {
    loading.value = false
  }
}

async function readOne(n: AppNotification) {
  if (n.read) return
  n.read = 1
  try { await markNotificationRead(n.id) } catch { /* ignore */ }
}

async function readAll() {
  if (!notifications.value.some((n) => !n.read)) return
  notifications.value.forEach((n) => (n.read = 1))
  try { await markAllNotificationsRead() } catch { /* ignore */ }
}

function openActor(n: AppNotification) {
  readOne(n)
  router.push(`/user/${n.actor_id}`)
}

onMounted(load)
</script>

<template>
  <div class="max-w-3xl mx-auto px-4 py-8">
    <div class="flex items-center justify-between mb-6">
      <div class="flex items-center gap-2">
        <Bell class="w-6 h-6 text-accent" />
        <h1 class="text-2xl font-display font-bold">通知</h1>
      </div>
      <button
        v-if="notifications.some((n) => !n.read)"
        @click="readAll"
        class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-[var(--text-dim)] hover:text-[var(--text)] bg-[var(--surface-2)] border border-[var(--border)] transition-colors"
      >
        <Check class="w-4 h-4" /> 全部已读
      </button>
    </div>

    <div v-if="loading" class="flex items-center justify-center py-20 text-[var(--text-dim)]">
      <Loader2 class="w-5 h-5 animate-spin mr-2" /> 加载中…
    </div>

    <div v-else-if="error" class="text-center py-16 text-accent-red">{{ error }}</div>

    <div v-else-if="!notifications.length" class="flex flex-col items-center justify-center py-20 text-center">
      <Bell class="w-14 h-14 text-[var(--text-faint)] mb-4" />
      <p class="text-[var(--text-dim)]">暂时没有新通知</p>
      <p class="text-xs text-[var(--text-faint)] mt-1">去「社区」关注感兴趣的人，互动会在这里提醒你</p>
    </div>

    <div v-else class="space-y-2">
      <button
        v-for="n in notifications"
        :key="n.id"
        @click="openActor(n)"
        class="w-full flex items-center gap-3 p-4 rounded-2xl border text-left transition-colors"
        :class="n.read ? 'bg-[var(--surface-2)] border-[var(--border)]' : 'bg-accent/5 border-accent/30'"
      >
        <div class="relative shrink-0">
          <img v-if="n.avatar" :src="n.avatar" :alt="n.display_name || ''"
            class="w-10 h-10 rounded-full object-cover bg-[var(--surface-3)]" />
          <div v-else class="w-10 h-10 rounded-full bg-gradient-to-br from-accent to-accent-cyan flex items-center justify-center text-white font-bold">
            {{ (n.display_name || n.username || '?')[0].toUpperCase() }}
          </div>
          <span class="absolute -bottom-0.5 -right-0.5 w-5 h-5 rounded-full bg-accent flex items-center justify-center border-2 border-[var(--surface-2)]">
            <UserPlus class="w-3 h-3 text-white" />
          </span>
        </div>
        <div class="min-w-0 flex-1">
          <div class="text-sm text-[var(--text)]">{{ textOf(n) }}</div>
          <div class="text-xs text-[var(--text-faint)] mt-0.5">{{ timeAgo(n.created_at) }}</div>
        </div>
        <span v-if="!n.read" class="w-2 h-2 rounded-full bg-accent shrink-0" />
      </button>
    </div>
  </div>
</template>
