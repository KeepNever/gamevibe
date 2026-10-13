<script setup lang="ts">
defineProps<{ title: string; extra?: string }>()
</script>

<template>
  <div>
    <div class="flex items-center justify-between mb-2">
      <label class="text-[11px] font-semibold text-[var(--text-dim)] uppercase tracking-wider">{{ title }}</label>
      <span v-if="extra" class="text-xs">{{ extra }}</span>
    </div>
    <slot />
  </div>
</template>
