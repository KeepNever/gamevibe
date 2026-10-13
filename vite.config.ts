import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8792',
    },
    // 禁用 HMR — 消除 Layout.vue123 等热更新模块名泄漏
    hmr: false,
  },
  preview: {
    proxy: {
      '/api': 'http://localhost:8792',
    },
  },
})
