<script setup lang="ts">
import { ref, computed } from 'vue'
import { RouterLink } from 'vue-router'
import { games } from '@/data/games'
import { Star, Users, Tv, Calendar, Trophy } from 'lucide-vue-next'
import type { Game } from '@/types/game'

type Tab = 'rating' | 'players' | 'twitch' | 'new'

const tabs: { key: Tab; label: string; icon: typeof Star }[] = [
  { key: 'rating', label: '最高评分', icon: Star },
  { key: 'players', label: '最多在线', icon: Users },
  { key: 'twitch', label: '直播热度', icon: Tv },
  { key: 'new', label: '最新发布', icon: Calendar },
]

const tab = ref<Tab>('rating')

function getRanked(t: Tab): Game[] {
  const sorted = [...games]
  switch (t) {
    case 'rating':
      return sorted.sort((a, b) => b.rating - a.rating)
    case 'players':
      return sorted.sort((a, b) => b.playerCount - a.playerCount)
    case 'twitch':
      return sorted.sort((a, b) => b.twitchViewers - a.twitchViewers)
    case 'new':
      return sorted.sort((a, b) => new Date(b.releaseDate).getTime() - new Date(a.releaseDate).getTime())
  }
}

const ranked = computed(() => getRanked(tab.value).slice(0, 12))
const medalColors = ['text-accent-amber', 'text-[var(--text-dim)]', 'text-orange-500']
</script>

<template>
  <div class="space-y-6 pb-12">
    <div>
      <h1 class="text-2xl font-display font-bold text-[var(--text)] flex items-center gap-2">
        <Trophy class="w-6 h-6 text-accent-amber" />
        排行榜
      </h1>
      <p class="text-sm text-[var(--text-faint)] mt-1">不同维度的游戏排名</p>
    </div>

    <!-- Tabs -->
    <div class="flex flex-wrap gap-2">
      <button
        v-for="{ key, label, icon } in tabs"
        :key="key"
        @click="tab = key"
        class="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all"
        :class="tab === key
          ? 'bg-accent/20 text-accent border border-accent/30'
          : 'bg-[var(--surface-2)] text-[var(--text-dim)] border border-[var(--border)] hover:text-[var(--text)]'"
      >
        <component :is="icon" class="w-4 h-4" />
        {{ label }}
      </button>
    </div>

    <!-- Ranked list -->
    <div class="space-y-2 fade-in-up">
      <RouterLink
        v-for="(game, i) in ranked"
        :key="game.id"
        :to="`/game/${game.id}`"
        class="flex items-center gap-4 p-3 rounded-xl bg-[var(--surface-2)] hover:bg-[var(--surface-3)] transition-colors group"
      >
        <div class="w-8 text-center text-lg font-display font-bold" :class="i < 3 ? medalColors[i] : 'text-[var(--text-faint)]'">
          {{ i + 1 }}
        </div>
        <div class="w-12 h-16 rounded-lg overflow-hidden bg-[var(--surface-3)] shrink-0">
          <img :src="game.coverUrl" :alt="game.name" class="w-full h-full object-cover" loading="lazy" />
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-sm font-semibold text-[var(--text)] group-hover:text-accent transition-colors truncate">{{ game.name }}</div>
          <div class="text-xs text-[var(--text-faint)] mt-0.5">{{ game.genres.slice(0, 3).join(' / ') }}</div>
        </div>
        <div class="text-right shrink-0">
          <span v-if="tab === 'rating'" class="text-accent-amber font-semibold">★ {{ game.rating }}</span>
          <span v-else-if="tab === 'players'" class="text-accent-blue font-semibold">{{ (game.playerCount / 1000).toFixed(0) }}K</span>
          <span v-else-if="tab === 'twitch'" class="text-accent-pink font-semibold">{{ (game.twitchViewers / 1000).toFixed(0) }}K</span>
          <span v-else class="text-accent-green font-semibold">{{ game.releaseDate }}</span>
        </div>
      </RouterLink>
    </div>
  </div>
</template>
