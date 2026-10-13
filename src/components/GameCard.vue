<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { ArrowRight, Scale } from 'lucide-vue-next'
import type { Game } from '@/types/game'
import { useGameStore } from '@/stores/gameStore'

const props = defineProps<{ game: Game; viewMode?: 'grid' | 'list' }>()
const store = useGameStore()

const isFav = computed(() => store.favorites.includes(props.game.id))
const community = computed(() => store.reviewStats[props.game.id])
const shownRating = computed(() =>
  community.value && community.value.count > 0 ? community.value.avg * 2 : props.game.rating,
)
const discountPct = computed(() =>
  props.game.originalPrice > 0 ? Math.round((1 - props.game.price / props.game.originalPrice) * 100) : 0,
)

function handleToggle(e: Event) {
  e.preventDefault()
  e.stopPropagation()
  store.toggleFavorite(props.game.id)
}
</script>

<template>
  <RouterLink :to="`/game/${game.id}`"
    class="group block rounded-2xl bg-[var(--surface)] border border-[var(--border)] overflow-hidden hover:border-accent/30 transition-all card-3d-hover"
    :class="viewMode === 'list' ? 'flex' : ''">

    <!-- 封面 -->
    <div :class="viewMode === 'list' ? 'w-40 shrink-0' : ''" class="relative overflow-hidden bg-[var(--surface-3)]">
      <img :src="game.coverUrl" :alt="game.name" class="w-full h-full object-cover" :class="viewMode === 'grid' ? 'aspect-[3/4]' : 'aspect-video'" loading="lazy" />
      <!-- 折扣标签 -->
      <div v-if="discountPct > 0" class="absolute top-2 left-2 bg-accent-red text-white text-[10px] font-bold px-1.5 py-0.5 rounded-md">
        -{{ discountPct }}%
      </div>
      <!-- 收藏按钮 -->
      <button @click="handleToggle"
        class="absolute top-2 right-2 p-1.5 rounded-full bg-black/40 backdrop-blur-sm text-white/70 hover:text-accent-yellow transition-colors"
        :class="{ '!text-accent-yellow': isFav }">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" :fill="isFav ? 'currentColor' : 'none'" />
        </svg>
      </button>
    </div>

    <!-- 信息 -->
    <div class="p-3 flex flex-col gap-1 flex-1 min-w-0">
      <h3 class="text-sm font-semibold text-[var(--text)] group-hover:text-accent truncate transition-colors">{{ game.name }}</h3>
      <p class="text-[11px] text-[var(--text-faint)] truncate">{{ game.developer }}</p>

      <div class="flex items-center gap-2 mt-auto pt-1">
        <span class="text-xs font-bold text-accent-amber">★ {{ shownRating.toFixed(1) }}</span>
        <span v-if="community && community.count > 0" class="text-[10px] text-[var(--text-faint)]">社区 {{ community.count }}</span>
        <span v-if="game.price > 0" class="text-xs font-bold text-[var(--text)]">¥{{ game.price }}</span>
        <span v-else class="text-xs font-bold text-accent-green">免费</span>
        <span v-if="game.originalPrice > game.price && game.originalPrice > 0" class="text-[10px] text-[var(--text-faint)] line-through">¥{{ game.originalPrice }}</span>

        <!-- 对比按钮 -->
        <button @click.prevent="store.toggleCompare(game.id)" class="ml-auto p-1 rounded hover:bg-[var(--surface-2)] transition-colors"
          :class="{ 'text-accent': store.compareIds.includes(game.id), 'text-[var(--text-faint)]': !store.compareIds.includes(game.id) }">
          <Scale class="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  </RouterLink>
</template>
