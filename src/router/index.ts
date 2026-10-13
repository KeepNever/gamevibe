import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'

// Layout 静态导入：避免懒加载 + HMR 竞态导致 "Failed to resolve component: <Layout.vue123>"
import Layout from '@/components/Layout.vue'

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
    path: '/',
    component: Layout,
    children: [
      { path: '', name: 'Home', component: () => import('@/pages/Home.vue') },
      { path: 'explore', name: 'Explore', component: () => import('@/pages/Explore.vue') },
      { path: 'ai', name: 'AI', component: () => import('@/pages/AIAssistant.vue') },
      { path: 'compare', name: 'Compare', component: () => import('@/pages/Compare.vue') },
      { path: 'favorites', name: 'Favorites', component: () => import('@/pages/Favorites.vue') },
      { path: 'genres', name: 'Genres', component: () => import('@/pages/Genres.vue') },
      { path: 'charts', name: 'Charts', component: () => import('@/pages/Charts.vue') },
      { path: 'deals', name: 'Deals', component: () => import('@/pages/Deals.vue') },
      { path: 'wrapped', name: 'Wrapped', component: () => import('@/pages/Wrapped.vue') },
      { path: 'game/:id', name: 'GameDetail', component: () => import('@/pages/GameDetail.vue'), props: true },
      { path: 'library', name: 'Library', component: () => import('@/pages/Library.vue') },
      { path: 'stats', name: 'Stats', component: () => import('@/pages/Stats.vue') },
      { path: 'news', name: 'News', component: () => import('@/pages/News.vue') },
      { path: 'social', name: 'Social', component: () => import('@/pages/Social.vue') },
      { path: 'feed', name: 'Feed', component: () => import('@/pages/Feed.vue') },
      { path: 'user/:id', name: 'UserProfile', component: () => import('@/pages/UserProfile.vue'), props: true },
      { path: 'notifications', name: 'Notifications', component: () => import('@/pages/Notifications.vue') },
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

export default router
