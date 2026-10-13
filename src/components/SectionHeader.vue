<script setup lang="ts">
import { useInView } from '@/composables/useInView'

defineProps<{ title: string; subtitle?: string }>()
const { elRef, isVisible } = useInView()
</script>

<template>
  <div ref="elRef" class="mb-8" :class="{ 'opacity-0 translate-y-4': !isVisible, 'opacity-100 translate-y-0 transition-all duration-500': isVisible }">
    <div class="flex items-end justify-between">
      <div>
        <h2 class="text-2xl font-display font-bold text-[var(--text)]">{{ title }}</h2>
        <p v-if="subtitle" class="text-sm text-[var(--text-faint)] mt-1">{{ subtitle }}</p>
      </div>
      <slot name="action" />
    </div>
  </div>
</template>
