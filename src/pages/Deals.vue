<script setup lang="ts">
import { computed } from 'vue'
import { games } from '@/data/games'
import GameCard from '@/components/GameCard.vue'
import MotionGrid from '@/components/MotionGrid.vue'
import SectionHeader from '@/components/SectionHeader.vue'
import { DollarSign, Sparkles } from 'lucide-vue-next'

const deals = computed(() =>
  games
    .filter((g) => g.discount > 0)
    .sort((a, b) => b.discount - a.discount),
)
const totalSaved = computed(() => deals.value.reduce((sum, g) => sum + (g.originalPrice - g.price), 0))
const bestDeal = computed(() => deals.value[0])
</script>

<template>
  <div class="space-y-6 pb-12">
    <div>
      <h1 class="text-2xl font-display font-bold text-[var(--text)] flex items-center gap-2">
        <DollarSign class="w-6 h-6 text-accent-green" />
        折扣专区
      </h1>
      <p class="text-sm text-[var(--text-faint)] mt-1">限时优惠，手慢无</p>
    </div>

    <!-- Summary -->
    <div
      v-if="bestDeal"
      class="relative overflow-hidden rounded-2xl bg-gradient-to-r from-accent-green/15 to-[var(--surface-2)] border border-accent-green/20 p-6"
    >
      <Sparkles class="absolute top-4 right-4 w-6 h-6 text-accent-green/50" />
      <div class="flex flex-wrap items-center gap-8">
        <div>
          <div class="text-xs text-[var(--text-faint)] uppercase tracking-wider">当前折扣游戏</div>
          <div class="text-3xl font-display font-bold text-[var(--text)]">{{ deals.length }} 款</div>
        </div>
        <div>
          <div class="text-xs text-[var(--text-faint)] uppercase tracking-wider">最高折扣</div>
          <div class="text-3xl font-display font-bold text-accent-green">-{{ bestDeal.discount }}%</div>
        </div>
        <div>
          <div class="text-xs text-[var(--text-faint)] uppercase tracking-wider">合计可省</div>
          <div class="text-3xl font-display font-bold text-[var(--text)]">¥{{ totalSaved }}</div>
        </div>
      </div>
    </div>

    <SectionHeader title="全部折扣游戏" subtitle="按折扣力度排序" />

    <div v-if="deals.length === 0" class="text-center py-20 text-[var(--text-faint)]">
      <DollarSign class="w-12 h-12 mx-auto mb-4 text-[var(--text-faint)]" />
      <p>暂时没有折扣游戏</p>
    </div>

    <MotionGrid v-else class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      <GameCard v-for="game in deals" :key="game.id" :game="game" />
    </MotionGrid>
  </div>
</template>
