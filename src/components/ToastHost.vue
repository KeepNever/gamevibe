<script setup lang="ts">
import { useToastStore } from '@/stores/toastStore'

const toast = useToastStore()

function styleFor(t: string): string {
  if (t === 'success') return 'bg-accent-green/15 text-accent-green border-accent-green/30'
  if (t === 'error') return 'bg-accent-red/15 text-accent-red border-accent-red/30'
  return 'bg-[var(--surface-3)] text-[var(--text-dim)] border-[var(--border)]'
}
</script>

<template>
  <div class="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] flex flex-col items-center gap-2 pointer-events-none">
    <div
      v-for="t in toast.toasts"
      :key="t.id"
      class="px-4 py-2.5 rounded-xl border text-sm font-medium shadow-lg backdrop-blur fade-in"
      :class="styleFor(t.type)"
    >
      {{ t.message }}
    </div>
  </div>
</template>
