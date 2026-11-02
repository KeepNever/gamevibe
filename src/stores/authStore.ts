import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api, getToken, setToken } from '@/lib/api'
import type { AuthUser } from '@/types/game'
import { useGameStore } from './gameStore'

export interface RoleInfo {
  key: string
  name: string
  level: number
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<AuthUser | null>(null)
  const roles = ref<RoleInfo[]>([])
  const permissions = ref<string[]>([])
  const loading = ref(false)

  // 路由守卫需要等「会话恢复」有结果，否则刷新页面会被误判为未登录踢走
  let markReady: (() => void) | null = null
  const readyPromise = new Promise<void>((resolve) => {
    markReady = resolve
  })
  function whenReady(): Promise<void> {
    return readyPromise
  }

  const isLoggedIn = computed(() => !!user.value)
  /** 管理员：有 admin 角色，或持有后台入口权限 */
  const isAdmin = computed(
    () => roles.value.some((r) => r.key === 'admin') || permissions.value.includes('admin.access'),
  )
  /** 最高角色等级，用于前端隐藏「不能操作同级」的按钮 */
  const maxLevel = computed(() => roles.value.reduce((m, r) => Math.max(m, r.level), 0))

  function hasPermission(perm: string): boolean {
    return permissions.value.includes(perm)
  }

  function applySession(d: any) {
    user.value = d.user
    roles.value = d.roles ?? []
    permissions.value = d.permissions ?? []
  }

  function clearSession() {
    setToken(null)
    user.value = null
    roles.value = []
    permissions.value = []
  }

  async function fetchMe() {
    const t = getToken()
    if (!t) {
      loading.value = false
      markReady?.()
      return
    }
    try {
      const res = await api.get('/auth/me')
      const d = await res.json()
      applySession(d)
      useGameStore().initFromBackend()
    } catch {
      clearSession()
    } finally {
      loading.value = false
      markReady?.()
    }
  }

  async function login(email: string, password: string, remember = false) {
    const res = await api.post('/auth/login', { email, password, remember })
    const d = await res.json()
    setToken(d.token)
    applySession(d)
    // 延迟同步 store，确保 DOM 已提交
    setTimeout(() => useGameStore().initFromBackend(), 0)
  }

  async function register(username: string, email: string, password: string) {
    const res = await api.post('/auth/register', { username, email, password })
    const d = await res.json()
    setToken(d.token)
    applySession(d)
    setTimeout(() => useGameStore().initFromBackend(), 0)
  }

  function logout() {
    clearSession()
  }

  // 启动时恢复登录态
  loading.value = true
  fetchMe()

  return {
    user,
    roles,
    permissions,
    loading,
    isLoggedIn,
    isAdmin,
    maxLevel,
    hasPermission,
    whenReady,
    login,
    register,
    logout,
    clearSession,
  }
})
