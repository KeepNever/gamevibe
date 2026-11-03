<script setup lang="ts">
// 游戏卡片骨架屏：封面块 + 两行文字，shimmer 用 Tailwind 自带 animate-pulse
defineProps<{ art?: string }>()
</script>

<template>
  <div class="rounded-xl overflow-hidden border border-[var(--border)] bg-[var(--surface-2)]">
    <div class="aspect-[3/4] animate-pulse bg-[var(--surface)]"></div>
    <div class="p-3 space-y-2">
      <div class="h-3.5 w-4/5 rounded animate-pulse bg-[var(--surface)]"></div>
      <div class="h-3 w-3/5 rounded animate-pulse bg-[var(--surface)]"></div>
    </div>
  </div>
</template>
