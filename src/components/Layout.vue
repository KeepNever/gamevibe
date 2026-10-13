<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter, useRoute, RouterLink } from 'vue-router'
import {
  Home, Search, Bot, Scale, Heart, Gamepad2, Grid, Trophy,
  BadgePercent, Sun, Moon, MoreHorizontal, X, Sparkles,
  Library, LogOut, User, Newspaper, BarChart, Users, Rss, Bell
} from 'lucide-vue-next'
import { useGameStore } from '@/stores/gameStore'
import { useThemeStore } from '@/stores/themeStore'
import { useAuthStore } from '@/stores/authStore'
import { getNotifications } from '@/lib/socialApi'
import AiFab from '@/components/AiFab.vue'

const router = useRouter()
const route = useRoute()
const gameStore = useGameStore()
const theme = useThemeStore()
const auth = useAuthStore()

const mobileOpen = ref(false)
const userMenuOpen = ref(false)
const menuRef = ref<HTMLElement | null>(null)

const navItems = [
  { to: '/', icon: Home, label: '首页' },
  { to: '/explore', icon: Search, label: '探索' },
  { to: '/news', icon: Newspaper, label: '新游资讯' },
  { to: '/ai', icon: Bot, label: 'AI助手' },
  { to: '/compare', icon: Scale, label: '对比' },
  { to: '/favorites', icon: Heart, label: '收藏' },
  { to: '/social', icon: Users, label: '社区' },
  { to: '/charts', icon: Trophy, label: '排行榜' },
  { to: '/deals', icon: BadgePercent, label: '折扣' },
]

const secondaryItems = [
  { to: '/library', icon: Library, label: '游戏库' },
  { to: '/feed', icon: Rss, label: '动态' },
  { to: '/stats', icon: BarChart, label: '数据看板' },
  { to: '/wrapped', icon: Sparkles, label: '年报' },
]

function navClass(isActive: boolean): string {
  const base = 'flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium transition-all '
  return isActive
    ? base + 'bg-accent/10 text-accent shadow-sm'
    : base + 'text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]'
}

function isActivePath(path: string): boolean {
  if (path === '/') return route.path === '/'
  if (path === '/user') return route.path.startsWith('/user')
  return route.path.startsWith(path)
}

// 移动端底部 Tab 栏项样式
function tabClass(active: boolean): string {
  const base = 'flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium transition-colors '
  return active ? base + 'text-accent' : base + 'text-[var(--text-dim)]'
}

// 点击外部关闭用户菜单
function handleClickOutside(e: MouseEvent) {
  if (userMenuOpen.value && menuRef.value && !menuRef.value.contains(e.target as Node)) {
    userMenuOpen.value = false
  }
}

onMounted(() => document.addEventListener('mousedown', handleClickOutside))
onUnmounted(() => document.removeEventListener('mousedown', handleClickOutside))

// 路由变化时关闭移动端抽屉
import { watch } from 'vue'
watch(() => route.path, () => { mobileOpen.value = false })

function handleLogout() {
  userMenuOpen.value = false
  auth.logout()
}

const avatarChar = computed(() =>
  (auth.user?.display_name || auth.user?.username || '?')[0].toUpperCase(),
)

// ── 通知未读计数 ──
const unreadCount = ref(0)
async function loadUnreadCount() {
  if (!auth.isLoggedIn) { unreadCount.value = 0; return }
  try {
    const r = await getNotifications(1)
    unreadCount.value = r.unread
  } catch {
    unreadCount.value = 0
  }
}
onMounted(loadUnreadCount)
watch(() => auth.isLoggedIn, (v) => { if (v) loadUnreadCount(); else unreadCount.value = 0 })
// 路由切换后刷新未读（通知页已读后返回可即时更新）
watch(() => route.path, () => { if (auth.isLoggedIn) loadUnreadCount() })
</script>

<template>
  <div class="flex h-screen overflow-hidden bg-[var(--bg)] text-[var(--text)]">
    <!-- Desktop Sidebar -->
    <aside class="hidden lg:flex flex-col w-60 shrink-0 bg-[var(--surface)] border-r border-[var(--border)]">
      <div class="p-5 flex items-center gap-2.5">
        <div class="w-8 h-8 rounded-xl bg-gradient-to-br from-accent to-accent-cyan flex items-center justify-center shadow-lg shadow-accent/20">
          <Gamepad2 class="w-4.5 h-4.5 text-white" />
        </div>
        <span class="font-display font-bold text-lg">GameVibe</span>
      </div>

      <nav class="flex-1 px-3 space-y-0.5 overflow-y-auto">
        <template v-for="{ to, icon: Icon, label } in navItems" :key="to">
          <RouterLink :to="to" :class="navClass(isActivePath(to))">
            <component :is="Icon" class="w-4.5 h-4.5" /> {{ label }}
          </RouterLink>
        </template>

        <div class="pt-2 pb-1 mt-2 border-t border-[var(--border)]">
          <template v-for="{ to, icon: Icon, label } in secondaryItems" :key="to">
            <RouterLink :to="to" :class="navClass(isActivePath(to))">
              <component :is="Icon" class="w-4.5 h-4.5" /> {{ label }}
            </RouterLink>
          </template>

          <!-- 通知（仅登录，带未读红点） -->
          <RouterLink v-if="auth.isLoggedIn" to="/notifications"
            :class="[navClass(isActivePath('/notifications')), 'relative']">
            <Bell class="w-4.5 h-4.5" /> 通知
            <span v-if="unreadCount > 0"
              class="ml-auto min-w-5 h-5 px-1.5 rounded-full bg-accent-red text-white text-[11px] font-bold flex items-center justify-center leading-none">
              {{ unreadCount > 99 ? '99+' : unreadCount }}
            </span>
          </RouterLink>
        </div>

        <!-- 主题切换（导航区底部独立一行，醒目） -->
        <button @click="theme.toggle()"
          class="flex items-center gap-2.5 px-3 py-2.5 mx-3 mt-2 rounded-xl text-sm font-medium
                 bg-[var(--surface-2)] border border-[var(--border)]
                 text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-accent/10 hover:border-accent/30 transition-all"
          :title="theme.theme === 'dark' ? '切换到亮色模式' : '切换到暗色模式'">
          <Sun v-if="theme.theme === 'dark'" class="w-4.5 h-4.5 text-amber-400" />
          <Moon v-else class="w-4.5 h-4.5 text-indigo-400" />
          <span>{{ theme.theme === 'dark' ? '亮色模式' : '暗色模式' }}</span>
        </button>
      </nav>

      <!-- Footer -->
      <div class="p-4 border-t border-[var(--border)]">
        <div class="flex items-center justify-between">
          <!-- 已登录 -->
          <template v-if="auth.isLoggedIn">
            <div ref="menuRef" class="relative flex items-center gap-2 flex-1 min-w-0">
              <div class="w-7 h-7 rounded-full bg-gradient-to-br from-accent to-accent-cyan flex items-center justify-center text-white text-xs font-bold shrink-0">
                {{ avatarChar }}
              </div>
              <button @click="userMenuOpen = !userMenuOpen" class="flex-1 min-w-0 text-left">
                <div class="text-xs font-medium text-[var(--text)] truncate">{{ auth.user?.display_name || auth.user?.username }}</div>
                <div class="text-[10px] text-[var(--text-faint)]">点击查看更多</div>
              </button>

              <!-- 用户下拉菜单 -->
              <div v-if="userMenuOpen" class="absolute bottom-full left-0 right-0 mb-2 bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-xl z-50 overflow-hidden fade-in">
                <div class="p-3 border-b border-[var(--border)]">
                  <div class="flex items-center gap-2">
                    <div class="w-8 h-8 rounded-full bg-gradient-to-br from-accent to-accent-cyan flex items-center justify-center text-white text-sm font-bold">
                      {{ avatarChar }}
                    </div>
                    <div>
                      <div class="text-sm font-medium text-[var(--text)]">{{ auth.user?.display_name || auth.user?.username }}</div>
                      <div class="text-[11px] text-[var(--text-faint)]">{{ auth.user?.email }}</div>
                    </div>
                  </div>
                </div>
                <RouterLink to="/favorites"
                  class="flex items-center gap-2 px-3 py-2 text-sm text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors"
                  @click="userMenuOpen = false">
                  <Heart class="w-4 h-4" /> 收藏 ({{ gameStore.favorites.length }})
                </RouterLink>
                <button @click="handleLogout" class="w-full flex items-center gap-2 px-3 py-2 text-sm text-accent-red hover:bg-red-5/10 transition-colors">
                  <LogOut class="w-4 h-4" /> 退出登录
                </button>
              </div>
            </div>
          </template>

          <!-- 未登录 -->
          <RouterLink v-else to="/login"
            class="flex items-center gap-2 px-3 py-2 rounded-lg bg-accent/10 text-accent text-sm font-medium hover:bg-accent/20 transition-colors flex-1 justify-center">
            <User class="w-4 h-4" /> 登录
          </RouterLink>
        </div>
        <div class="text-xs text-[var(--text-faint)] mt-2 text-center">GameVibe v2.0-vue</div>
      </div>
    </aside>

    <!-- Mobile Header -->
    <header class="lg:hidden flex items-center justify-between p-4 bg-[var(--surface)] border-b border-[var(--border)] shrink-0">
      <button @click="mobileOpen = true" class="p-2 rounded-lg hover:bg-[var(--surface-2)] transition-colors">
        <MoreHorizontal class="w-5 h-5" />
      </button>
      <div class="flex items-center gap-2">
        <div class="w-7 h-7 rounded-lg bg-gradient-to-br from-accent to-accent-cyan flex items-center justify-center">
          <Gamepad2 class="w-3.5 h-3.5 text-white" />
        </div>
        <span class="font-display font-bold">GameVibe</span>
      </div>
      <button @click="theme.toggle()" class="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[var(--surface-2)] hover:bg-accent/10 text-[var(--text-dim)] hover:text-[var(--text)] transition-colors text-xs font-medium">
        <Sun v-if="theme.theme === 'dark'" class="w-4 h-4 text-amber-400" />
        <Moon v-else class="w-4 h-4 text-indigo-400" />
        {{ theme.theme === 'dark' ? '亮色' : '暗色' }}
      </button>
    </header>

    <!-- Mobile Drawer — pure CSS slide animation -->
    <template v-if="mobileOpen">
      <div class="lg:hidden fixed inset-0 bg-black/40 z-40 sidebar-enter" style="animation-duration: 0.3s" @click="mobileOpen = false" />
      <nav class="lg:hidden fixed left-0 top-0 bottom-0 w-72 bg-[var(--surface)] border-r border-[var(--border)] z-50 overflow-y-auto sidebar-enter" style="animation-duration: 0.3s">
        <div class="p-5 flex items-center justify-between">
          <div class="flex items-center gap-2.5">
            <div class="w-8 h-8 rounded-xl bg-gradient-to-br from-accent to-accent-cyan flex items-center justify-center">
              <Gamepad2 class="w-4.5 h-4.5 text-white" />
            </div>
            <span class="font-display font-bold text-lg">GameVibe</span>
          </div>
          <button @click="mobileOpen = false" class="p-2 rounded-lg hover:bg-[var(--surface-2)] transition-colors">
            <X class="w-5 h-5" />
          </button>
        </div>

        <div class="px-3 space-y-0.5">
          <template v-for="{ to, icon: Icon, label } in navItems" :key="to">
            <RouterLink :to="to" :class="navClass(isActivePath(to))" @click="mobileOpen = false">
              <component :is="Icon" class="w-4.5 h-4.5" /> {{ label }}
            </RouterLink>
          </template>

          <div class="pt-2 mt-2 border-t border-[var(--border)]">
            <template v-for="{ to, icon: Icon, label } in secondaryItems" :key="to">
              <RouterLink :to="to" :class="navClass(isActivePath(to))" @click="mobileOpen = false">
                <component :is="Icon" class="w-4.5 h-4.5" /> {{ label }}
              </RouterLink>
            </template>

            <!-- 通知（移动端，仅登录） -->
            <RouterLink v-if="auth.isLoggedIn" to="/notifications"
              :class="[navClass(isActivePath('/notifications')), 'relative']" @click="mobileOpen = false">
              <Bell class="w-4.5 h-4.5" /> 通知
              <span v-if="unreadCount > 0"
                class="ml-auto min-w-5 h-5 px-1.5 rounded-full bg-accent-red text-white text-[11px] font-bold flex items-center justify-center leading-none">
                {{ unreadCount > 99 ? '99+' : unreadCount }}
              </span>
            </RouterLink>
          </div>

          <!-- 移动端用户信息 -->
          <template v-if="auth.isLoggedIn">
            <div class="mt-4 pt-4 border-t border-[var(--border)]">
              <div class="flex items-center gap-2 px-3 py-2">
                <div class="w-7 h-7 rounded-full bg-gradient-to-br from-accent to-accent-cyan flex items-center justify-center text-white text-xs font-bold">
                  {{ avatarChar }}
                </div>
                <div class="min-w-0"><div class="text-sm font-medium truncate">{{ auth.user?.display_name || auth.user?.username }}</div></div>
              </div>
              <button @click="handleLogout(); mobileOpen = false"
                class="flex items-center gap-2 px-3 py-2 mt-1 text-sm text-accent-red hover:bg-red-5/10 w-full rounded-xl transition-colors">
                <LogOut class="w-4 h-4" /> 退出登录
              </button>
            </div>
          </template>

          <template v-if="!auth.isLoggedIn">
            <RouterLink to="/login" @click="mobileOpen = false"
              class="block mx-3 mt-4 text-center px-3 py-2.5 rounded-xl bg-accent/10 text-accent text-sm font-medium hover:bg-accent/20 transition-colors">
              登录
            </RouterLink>
          </template>
        </div>
      </nav>
    </template>

    <!-- Mobile Bottom Tab Bar（快速导航，桌面端隐藏） -->
    <nav class="lg:hidden fixed bottom-0 inset-x-0 z-40 grid grid-cols-5 bg-[var(--surface)]/95 backdrop-blur border-t border-[var(--border)]">
      <RouterLink to="/" :class="tabClass(isActivePath('/'))" @click="mobileOpen = false">
        <Home class="w-5 h-5" /><span>首页</span>
      </RouterLink>
      <RouterLink to="/explore" :class="tabClass(isActivePath('/explore'))" @click="mobileOpen = false">
        <Search class="w-5 h-5" /><span>探索</span>
      </RouterLink>
      <RouterLink to="/social" :class="tabClass(isActivePath('/social'))" @click="mobileOpen = false">
        <Users class="w-5 h-5" /><span>社区</span>
      </RouterLink>
      <RouterLink to="/notifications" :class="[tabClass(isActivePath('/notifications')), 'relative']" @click="mobileOpen = false">
        <span class="relative flex flex-col items-center justify-center gap-0.5">
          <Bell class="w-5 h-5" />
          <span v-if="unreadCount > 0"
            class="absolute -top-1.5 -right-2.5 min-w-4 h-4 px-1 rounded-full bg-accent-red text-white text-[10px] font-bold flex items-center justify-center leading-none">
            {{ unreadCount > 99 ? '99+' : unreadCount }}
          </span>
          <span>通知</span>
        </span>
      </RouterLink>
      <RouterLink :to="auth.isLoggedIn ? `/user/${auth.user?.id}` : '/login'"
        :class="tabClass(isActivePath('/user'))" @click="mobileOpen = false">
        <User class="w-5 h-5" /><span>我的</span>
      </RouterLink>
    </nav>

    <!-- Main Content -->
    <main class="flex-1 overflow-y-auto pb-16 lg:pb-0">
      <div class="fade-in">
        <router-view />
      </div>
    </main>

    <!-- 全局 AI 浮窗：让 AI 顾问在任意页面都可一键唤起 -->
    <AiFab />
  </div>
</template>
