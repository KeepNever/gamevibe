<script setup lang="ts">
import { ref } from 'vue'
import { Bot, X, Sparkles } from 'lucide-vue-next'
import AIAssistant from '@/pages/AIAssistant.vue'

const open = ref(false)
</script>

<template>
  <!-- 遮罩 -->
  <transition name="fade">
    <div v-if="open" class="fixed inset-0 bg-black/40 z-40 lg:hidden" @click="open = false" />
  </transition>

  <!-- 抽屉（右侧滑入的 AI 对话） -->
  <transition name="slide-in">
    <div
      v-if="open"
      class="fixed top-0 right-0 bottom-0 w-full max-w-md z-50 bg-[var(--surface)] border-l border-[var(--border)] shadow-2xl flex flex-col"
    >
      <div class="flex items-center justify-between p-4 border-b border-[var(--border)] shrink-0">
        <span class="flex items-center gap-2 font-display font-bold text-[var(--text)]">
          <Sparkles class="w-4 h-4 text-accent" /> AI 游戏顾问
        </span>
        <button @click="open = false" class="p-2 rounded-lg hover:bg-[var(--surface-2)] transition-colors">
          <X class="w-5 h-5 text-[var(--text-dim)]" />
        </button>
      </div>
      <div class="flex-1 overflow-hidden">
        <AIAssistant />
      </div>
    </div>
  </transition>

  <!-- 常驻悬浮按钮 -->
  <button
    @click="open = !open"
    class="fixed bottom-20 lg:bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-gradient-to-br from-accent to-accent-cyan text-white shadow-lg shadow-accent/30 flex items-center justify-center hover:scale-105 active:scale-95 transition-transform group"
    :title="open ? '关闭 AI 顾问' : '问问 AI 助手'"
  >
    <Bot class="w-6 h-6" />
    <span class="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-accent-green border-2 border-[var(--surface)] animate-pulse" />
  </button>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
.slide-in-enter-active,
.slide-in-leave-active {
  transition: transform 0.25s ease;
}
.slide-in-enter-from,
.slide-in-leave-to {
  transform: translateX(100%);
}
</style>
