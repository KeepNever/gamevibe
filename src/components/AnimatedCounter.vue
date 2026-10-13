<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

const props = withDefaults(defineProps<{
  value: number
  suffix?: string
  prefix?: string
  decimals?: number
  duration?: number
}>(), { suffix: '', prefix: '', decimals: 0, duration: 1500 })

const display = ref(0)
let raf = 0

function format(n: number): string {
  if (props.decimals > 0) return n.toFixed(props.decimals)
  return Math.round(n).toLocaleString()
}

onMounted(() => {
  const start = performance.now()
  function tick(now: number) {
    const p = Math.min((now - start) / props.duration, 1)
    const eased = p === 1 ? 1 : 1 - Math.pow(2, -10 * p)
    display.value = props.value * eased
    if (p < 1) raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)
})
onUnmounted(() => cancelAnimationFrame(raf))
</script>

<template>{{ prefix }}{{ format(display) }}{{ suffix }}</template>
