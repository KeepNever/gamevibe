<template>
  <router-view />
  <ToastHost />
</template>

<script setup lang="ts">
import { onMounted } from 'vue'
import ToastHost from '@/components/ToastHost.vue'
import { useLiveStore } from '@/stores/liveStore'

const live = useLiveStore()
onMounted(() => live.init())
</script>
