import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api, getToken, setToken } from '@/lib/api'
import type { AuthUser } from '@/types/game'
import { useGameStore } from './gameStore'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<AuthUser | null>(null)
  const loading = ref(false)

  const isLoggedIn = computed(() => !!user.value)

  async function fetchMe() {
    const t = getToken()
    if (!t) { loading.value = false; return }
    try {
      const res = await api.get('/auth/me')
      const d = await res.json()
      user.value = d.user
      useGameStore().initFromBackend()
    } catch {
      setToken(null)
      user.value = null
    } finally {
      loading.value = false
    }
  }

  async function login(email: string, password: string) {
    const res = await api.post('/auth/login', { email, password })
    const d = await res.json()
    setToken(d.token)
    user.value = d.user
    // 延迟同步 store，确保 DOM 已提交
    setTimeout(() => useGameStore().initFromBackend(), 0)
  }

  async function register(username: string, email: string, password: string) {
    const res = await api.post('/auth/register', { username, email, password })
    const d = await res.json()
    setToken(d.token)
    user.value = d.user
    setTimeout(() => useGameStore().initFromBackend(), 0)
  }

  function logout() {
    setToken(null)
    user.value = null
  }

  // 启动时恢复登录态
  loading.value = true
  fetchMe()

  return { user, loading, isLoggedIn, login, register, logout }
})
