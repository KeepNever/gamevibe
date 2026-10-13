<script setup lang="ts">
import { ref, watch } from 'vue'
import { Gamepad2 } from 'lucide-vue-next'

const props = defineProps<{ src: string; alt: string; className?: string }>()
const errored = ref(false)

// 当 src 变化时重置错误状态，允许重试新图片
watch(() => props.src, () => { errored.value = false })
</script>

<!--
  稳定单根节点：永远只渲染一个 <div> 容器，内部用 v-show 切换内容。
  避免 v-if/v-else 在 <div> 和 <img> 之间切换导致的 insertBefore DOM 异常。
-->
<template>
  <div :class="[className, 'overflow-hidden']" :aria-label="alt">
    <!-- 图片正常 -->
    <img
      v-show="!errored"
      :src="src"
      :alt="alt"
      class="w-full h-full object-cover"
      loading="lazy"
      @error="errored = true"
    />
    <!-- 占位兜底（v-show 保持在 DOM 中，不触发节点增删） -->
    <div
      v-show="errored"
      class="w-full h-full flex items-center justify-center bg-[var(--surface-3)]"
    >
      <Gamepad2 class="w-6 h-6 text-[var(--text-faint)] opacity-40" />
    </div>
  </div>
</template>
