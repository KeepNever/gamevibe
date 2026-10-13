import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api } from '@/lib/api'
import type { LiveStats } from '@/types/live'

// 全局实时数据 store：每 5 秒轮询 /api/live，驱动主页"实时"指标。
// 同时维护一个每秒走动的 now，用于显示"更新于 X 秒前"。
export const useLiveStore = defineStore('live', () => {
  const data = ref<LiveStats | null>(null)
  const loading = ref(false)
  const error = ref(false)
  const now = ref(Date.now())
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let clockTimer: ReturnType<typeof setInterval> | null = null

  const secondsAgo = computed(() =>
    data.value ? Math.max(0, Math.round((now.value - data.value.updatedAt) / 1000)) : 0,
  )

  async function fetchOnce() {
    loading.value = true
    try {
      const res = await api.get('/live')
      data.value = (await res.json()) as LiveStats
      error.value = false
    } catch {
      error.value = true
    } finally {
      loading.value = false
    }
  }

  function init() {
    if (pollTimer) return
    fetchOnce()
    pollTimer = setInterval(fetchOnce, 5000)
    clockTimer = setInterval(() => {
      now.value = Date.now()
    }, 1000)
  }

  function stop() {
    if (pollTimer) clearInterval(pollTimer)
    if (clockTimer) clearInterval(clockTimer)
    pollTimer = null
    clockTimer = null
  }

  return { data, loading, error, secondsAgo, now, init, stop, fetchOnce }
})
