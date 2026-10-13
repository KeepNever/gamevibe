<script setup lang="ts">
import { ref, computed } from 'vue'
import { RouterLink } from 'vue-router'
import { Heart, Gamepad2, ArrowRight } from 'lucide-vue-next'
import { useGameStore, collectionMeta, type CollectionKey } from '@/stores/gameStore'
import { games } from '@/data/games'
import GameCard from '@/components/GameCard.vue'
import EmptyState from '@/components/EmptyState.vue'

type Tab = 'all' | CollectionKey

const store = useGameStore()
const tab = ref<Tab>('all')

const byList = computed<Record<Tab, string[]>>(() => ({
  all: Array.from(new Set([...store.collections.wishlist, ...store.collections.playing, ...store.collections.completed])),
  wishlist: store.collections.wishlist,
  playing: store.collections.playing,
  completed: store.collections.completed,
}))

const gamesInList = computed(() => games.filter((g) => byList.value[tab.value].includes(g.id)))

const tabs = computed(() => {
  const all: { key: Tab; label: string; color?: string; count: number }[] = [
    { key: 'all', label: '全部', count: byList.value.all.length },
  ]
  ;(Object.keys(collectionMeta) as CollectionKey[]).forEach((k) => {
    all.push({ key: k, label: collectionMeta[k].label, color: collectionMeta[k].color, count: byList.value[k].length })
  })
  return all
})
</script>

<template>
  <div class="space-y-6 pb-12">
    <div>
      <h1 class="text-2xl font-display font-bold text-[var(--text)]">我的收藏</h1>
      <p class="text-sm text-[var(--text-faint)] mt-1">
        {{ byList.all.length > 0 ? `共收录 ${byList.all.length} 款游戏` : '还没有收藏任何游戏' }}
      </p>
    </div>

    <!-- tabs -->
    <div class="flex flex-wrap gap-2">
      <button
        v-for="t in tabs"
        :key="t.key"
        @click="tab = t.key"
        class="flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-medium border transition-all"
        :class="tab === t.key
          ? 'bg-[var(--surface-3)] text-[var(--text)] border-[var(--border)]'
          : 'text-[var(--text-dim)] border-transparent hover:bg-[var(--surface-2)]'"
      >
        <span v-if="t.color" class="w-2 h-2 rounded-full" :style="{ backgroundColor: t.color }" />
        {{ t.label }}
        <span class="text-[var(--text-faint)] text-xs">{{ t.count }}</span>
      </button>
    </div>

    <EmptyState
      v-if="gamesInList.length === 0"
      title="收藏夹空空如也"
      description="浏览游戏时点击 ♡ 按钮，或进入详情页加入对应清单，就能把感兴趣的游戏收集起来。"
    >
      <RouterLink
        to="/explore"
        class="flex items-center gap-2 px-5 py-3 rounded-xl bg-accent hover:bg-accent-strong text-white font-medium transition-all"
      >
        <Gamepad2 class="w-4 h-4" />
        去探索游戏
        <ArrowRight class="w-4 h-4" />
      </RouterLink>
    </EmptyState>

    <div v-else class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      <GameCard v-for="game in gamesInList" :key="game.id" :game="game" />
    </div>
  </div>
</template>
