import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api, setSessionHint } from '@/lib/api'
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
    setSessionHint(!!d.user)
  }

  function clearSession() {
    setSessionHint(false)
    user.value = null
    roles.value = []
    permissions.value = []
  }

  /**
   * 会话恢复
   * 凭据在 httpOnly Cookie 里，JS 看不到，所以只能盲调一次 /auth/me：
   *   - 有登录态 → 返回 authenticated:true + user
   *   - 匿名 → 返回 200 + authenticated:false（不再是 401，避免每个访客控制台报错）
   */
  async function fetchMe() {
    try {
      const res = await api.get('/auth/me')
      const d = await res.json()
      if (d?.authenticated && d.user) {
        applySession(d)
        useGameStore().initFromBackend()
      } else {
        clearSession()
      }
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
    applySession(d)
    // 延迟同步 store，确保 DOM 已提交
    setTimeout(() => useGameStore().initFromBackend(), 0)
  }

  async function register(username: string, email: string, password: string, turnstileToken?: string) {
    const res = await api.post('/auth/register', { username, email, password, turnstileToken })
    const d = await res.json()
    applySession(d)
    setTimeout(() => useGameStore().initFromBackend(), 0)
  }

  /** 退出登录：先让服务端撤销会话，再清本地状态。只清本地等于令牌被抓走仍可用 */
  async function logout() {
    try {
      await api.post('/auth/logout')
    } catch {
      /* 网络失败也要清本地，避免卡在「看起来还登录着」的状态 */
    }
    clearSession()
  }

  /** 资料修改后局部刷新，避免整页重载 */
  function patchUser(patch: Partial<AuthUser>) {
    if (!user.value) return
    user.value = { ...user.value, ...patch }
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
    patchUser,
    refresh: fetchMe,
  }
})
