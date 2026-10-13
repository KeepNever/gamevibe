<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { games, genreList } from '@/data/games'
import { Gamepad2, ArrowRight } from 'lucide-vue-next'
import type { Genre, Game } from '@/types/game'

const router = useRouter()

const genreData = computed(() =>
  genreList
    .map((genre) => {
      const inGenre = games.filter((g) => g.genres.includes(genre as Genre))
      const top = [...inGenre].sort((a, b) => b.rating - a.rating)[0]
      return { genre, count: inGenre.length, top }
    })
    .filter((g) => g.count > 0),
)

function goExplore(genre: string) {
  router.push(`/explore?genre=${encodeURIComponent(genre)}`)
}
</script>

<template>
  <div class="space-y-6 pb-12">
    <div>
      <h1 class="text-2xl font-display font-bold text-[var(--text)]">类型中心</h1>
      <p class="text-sm text-[var(--text-faint)] mt-1">按游戏类型探索，找到你的菜</p>
    </div>

    <div class="stagger-grid grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      <button
        v-for="{ genre, count, top } in genreData"
        :key="genre"
        @click="goExplore(genre)"
        class="group relative overflow-hidden rounded-2xl bg-[var(--surface-2)] border border-[var(--border)] p-5 text-left hover:border-accent/40 transition-all hover:-translate-y-1 cursor-pointer"
      >
        <div class="absolute top-0 right-0 w-24 h-24 bg-accent/5 rounded-full blur-2xl group-hover:bg-accent/10 transition-all" />
        <div class="flex items-center gap-2 mb-3">
          <div class="w-9 h-9 rounded-lg bg-accent/15 flex items-center justify-center">
            <Gamepad2 class="w-4 h-4 text-accent" />
          </div>
          <span class="text-lg font-display font-bold text-[var(--text)]">{{ genre }}</span>
        </div>
        <div class="text-sm text-[var(--text-faint)] mb-3">{{ count }} 款游戏</div>
        <div v-if="top" class="flex items-center justify-between">
          <span class="text-xs text-[var(--text-faint)] truncate">热门：{{ top.name }}</span>
          <ArrowRight class="w-4 h-4 text-[var(--text-faint)] group-hover:text-accent transition-colors shrink-0" />
        </div>
      </button>
    </div>
  </div>
</template>
