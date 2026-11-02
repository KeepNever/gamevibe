import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'

// Layout 静态导入：避免懒加载 + HMR 竞态导致 "Failed to resolve component: <Layout.vue123>"
import Layout from '@/components/Layout.vue'
import { useAuthStore } from '@/stores/authStore'

declare module 'vue-router' {
  interface RouteMeta {
    /** 无需登录即可访问 */
    public?: boolean
    /** 需要登录，未登录会带 redirect 跳登录页 */
    requiresAuth?: boolean
    /** 需要指定权限点，缺权限回首页 */
    permission?: string
  }
}

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/pages/Login.vue'),
    meta: { public: true },
  },
  {
    path: '/register',
    name: 'Register',
    component: () => import('@/pages/Register.vue'),
    meta: { public: true },
  },
  {
    path: '/forgot-password',
    name: 'ForgotPassword',
    component: () => import('@/pages/ForgotPassword.vue'),
    meta: { public: true },
  },
  {
    path: '/reset-password',
    name: 'ResetPassword',
    component: () => import('@/pages/ResetPassword.vue'),
    meta: { public: true },
  },
  {
    path: '/',
    component: Layout,
    children: [
      { path: '', name: 'Home', component: () => import('@/pages/Home.vue') },
      { path: 'explore', name: 'Explore', component: () => import('@/pages/Explore.vue') },
      { path: 'ai', name: 'AI', component: () => import('@/pages/AIAssistant.vue') },
      { path: 'compare', name: 'Compare', component: () => import('@/pages/Compare.vue') },
      {
        path: 'favorites',
        name: 'Favorites',
        component: () => import('@/pages/Favorites.vue'),
        meta: { requiresAuth: true },
      },
      { path: 'genres', name: 'Genres', component: () => import('@/pages/Genres.vue') },
      { path: 'charts', name: 'Charts', component: () => import('@/pages/Charts.vue') },
      { path: 'deals', name: 'Deals', component: () => import('@/pages/Deals.vue') },
      {
        path: 'wrapped',
        name: 'Wrapped',
        component: () => import('@/pages/Wrapped.vue'),
        meta: { requiresAuth: true },
      },
      { path: 'game/:id', name: 'GameDetail', component: () => import('@/pages/GameDetail.vue'), props: true },
      {
        path: 'library',
        name: 'Library',
        component: () => import('@/pages/Library.vue'),
        meta: { requiresAuth: true },
      },
      {
        path: 'stats',
        name: 'Stats',
        component: () => import('@/pages/Stats.vue'),
        meta: { requiresAuth: true },
      },
      { path: 'news', name: 'News', component: () => import('@/pages/News.vue') },
      {
        path: 'social',
        name: 'Social',
        component: () => import('@/pages/Social.vue'),
        meta: { requiresAuth: true },
      },
      {
        path: 'feed',
        name: 'Feed',
        component: () => import('@/pages/Feed.vue'),
        meta: { requiresAuth: true },
      },
      { path: 'user/:id', name: 'UserProfile', component: () => import('@/pages/UserProfile.vue'), props: true },
      {
        path: 'notifications',
        name: 'Notifications',
        component: () => import('@/pages/Notifications.vue'),
        meta: { requiresAuth: true },
      },
      {
        path: 'admin',
        name: 'AdminUsers',
        component: () => import('@/pages/AdminUsers.vue'),
        meta: { requiresAuth: true, permission: 'admin.access' },
      },
    ],
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(_to, _from, savedPosition) {
    return savedPosition || { top: 0 }
  },
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  // 等会话恢复完成，避免刷新页面时把已登录用户误判为未登录
  await auth.whenReady()

  // 已登录还去登录/注册页 → 回首页（登录页本身不再重复展示）
  if (auth.isLoggedIn && (to.name === 'Login' || to.name === 'Register')) {
    return { path: '/' }
  }

  if (to.meta.requiresAuth && !auth.isLoggedIn) {
    return { name: 'Login', query: { redirect: to.fullPath } }
  }

  if (to.meta.permission && !auth.hasPermission(to.meta.permission)) {
    // 已登录但权限不足：回首页并带上原因，由页面提示
    return { path: '/', query: { denied: to.meta.permission } }
  }

  return true
})

export default router
