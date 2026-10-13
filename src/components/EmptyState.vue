<script setup lang="ts">
import { Search } from 'lucide-vue-next'

defineProps<{ title?: string; description?: string }>()
</script>

<template>
  <div class="flex flex-col items-center justify-center py-16 text-center fade-in-up-mini">
    <slot name="icon">
      <div class="w-16 h-16 rounded-2xl bg-[var(--surface-2)] flex items-center justify-center mb-4">
        <Search class="w-7 h-7 text-[var(--text-faint)]" />
      </div>
    </slot>
    <h3 class="text-lg font-display font-bold text-[var(--text-dim)] mb-2">
      <slot name="title">{{ title || '没有找到内容' }}</slot>
    </h3>
    <p class="text-sm text-[var(--text-faint)] max-w-sm">
      <slot name="description">{{ description || '换个筛选条件试试吧' }}</slot>
    </p>
    <slot />
  </div>
</template>
