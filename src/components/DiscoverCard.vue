<script setup lang="ts">
import { ref, computed } from 'vue'
import { RouterLink } from 'vue-router'
import { Star, Heart, Gamepad2 } from 'lucide-vue-next'
import type { DiscoverGame } from '@/types/discover'
import { useGameStore } from '@/stores/gameStore'

const props = defineProps<{ game: DiscoverGame }>()
const store = useGameStore()

// 封面三态：loading（骨架）/ ok / error（占位卡）
// 没有 coverUrl 就直接进 error，走设计好的占位卡——不再拿 favicon、logo 凑，
// 也不再显示一个孤零零的大写字母（那看起来像报错）。
const status = ref<'loading' | 'ok' | 'error'>(props.game.coverUrl ? 'loading' : 'error')
const imgEl = ref<HTMLImageElement | null>(null)
// 封面真实宽高比（加载完成后由 onLoad 写入），默认按竖版起手
const aspect = ref(2 / 3)
// 宽高比决定排版方式：
//   真竖版（3:4 及更瘦，如 Steam 600×900=0.667）→ object-cover 铺满，最多裁掉一点上下；
//   方图/横图（Nintendo 500×500、iTunes 1024×1024、网页游戏 og 图）→ object-contain 整幅显示，
//   否则居中裁切会把两侧的标题直接切掉（马里奥、银河战士那些 logo 都被切过），一眼就是「假图」。
// ⚠️ 之前这里写的是 ratio <= 1.9，等于把所有方图和横图都当成竖版去裁 —— 那才是「图片看着假」的来源。
const isPortrait = computed(() => aspect.value <= 0.85)

// 首图挂了就换备选封面（例如 Steam 竖版资源缺失 → 回退官方横版图），
// 备选也挂才落到占位卡。这样「有真图」的条目不会因为单张 404 退化成占位。
const usingFallback = ref(false)
const activeSrc = computed(() =>
  usingFallback.value && props.game.coverFallbackUrl ? props.game.coverFallbackUrl : props.game.coverUrl,
)

const rating5 = computed(() => (props.game.rating / 20).toFixed(1))
const isFav = computed(() => store.favorites.includes(props.game.id))
const platformChips = computed(() => props.game.platforms.slice(0, 3))
const subtitle = computed(() => props.game.developer || props.game.genres.slice(0, 2).join(' · '))

function onLoad() {
  const el = imgEl.value
  if (el && el.naturalWidth) aspect.value = el.naturalWidth / el.naturalHeight
  status.value = 'ok'
}

function onError() {
  if (!usingFallback.value && props.game.coverFallbackUrl) {
    usingFallback.value = true
    return
  }
  status.value = 'error'
}

function toggleFav(e: Event) {
  e.preventDefault()
  e.stopPropagation()
  store.toggleFavorite(props.game.id)
}
</script>

<template>
  <RouterLink
    :to="`/game/${game.id}`"
    class="group flex flex-col rounded-2xl bg-[var(--surface)] border border-[var(--border)] overflow-hidden hover:border-accent/40 hover:shadow-lg hover:shadow-black/20 transition-all card-3d-hover"
  >
    <!-- ═══ 封面 ═══ -->
    <div class="relative aspect-[3/4] overflow-hidden bg-[var(--surface-2)]">
      <!-- ⚠️ 主图必须**始终挂载**：它靠 @load 把状态从 loading 翻到 ok，
           一旦把它放进 v-if="status==='ok'" 之类分支里，就永远不挂载 → 永远不加载
           → 状态卡死在 loading，卡片只剩骨架（这正是之前「一堆游戏没封面」的真因）。 -->
      <img
        v-if="activeSrc"
        ref="imgEl"
        :src="activeSrc"
        :alt="game.name"
        class="absolute inset-0 w-full h-full transition-opacity duration-500"
        :class="[
          status === 'ok' ? 'opacity-100' : 'opacity-0',
          isPortrait ? 'object-cover' : 'object-contain',
        ]"
        loading="lazy"
        referrerpolicy="no-referrer"
        @load="onLoad"
        @error="onError"
      />

      <!-- 非竖版图：用自身放大模糊作底，让卡片视觉尺寸始终一致 -->
      <img
        v-if="status === 'ok' && !isPortrait && activeSrc"
        :src="activeSrc"
        alt=""
        aria-hidden="true"
        class="absolute inset-0 w-full h-full object-cover blur-lg scale-110 opacity-35"
      />

      <!-- 骨架：盖在主图上方，图加载完成后消失 -->
      <div
        v-if="status === 'loading'"
        class="absolute inset-0 z-10 animate-pulse bg-gradient-to-br from-[var(--surface-3)] via-[var(--surface-2)] to-[var(--surface-3)]"
      />

      <!-- 占位卡：拿不到真图时的统一设计，避免又灰又糊的字母块 -->
      <div
        v-else-if="status === 'error'"
        class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2.5 px-4 text-center bg-gradient-to-br from-[var(--surface-3)] via-[var(--surface-2)] to-[var(--surface-3)]"
      >
        <Gamepad2 class="w-9 h-9 text-[var(--text-faint)] opacity-45" />
        <span class="text-[11px] leading-snug text-[var(--text-faint)] line-clamp-2">{{ game.name }}</span>
      </div>

      <!-- 多平台标签 -->
      <div class="absolute bottom-2 left-2 flex flex-wrap gap-1 max-w-[calc(100%-1rem)]">
        <span
          v-for="p in platformChips"
          :key="p"
          class="px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-black/60 backdrop-blur-sm text-white/90"
        >
          {{ p }}
        </span>
      </div>

      <!-- 收藏 -->
      <button
        @click="toggleFav"
        class="absolute top-2 right-2 p-1.5 rounded-full bg-black/45 backdrop-blur-sm text-white/70 hover:text-accent-yellow transition-colors"
        :class="{ '!text-accent-yellow': isFav }"
        :title="isFav ? '已收藏' : '加入收藏'"
      >
        <Heart class="w-3.5 h-3.5" :fill="isFav ? 'currentColor' : 'none'" />
      </button>
    </div>

    <!-- ═══ 信息 ═══ -->
    <div class="flex flex-col gap-1 p-3 flex-1">
      <h3 class="text-sm font-semibold text-[var(--text)] group-hover:text-accent truncate transition-colors">
        {{ game.name }}
      </h3>
      <p class="text-[11px] text-[var(--text-faint)] truncate">{{ subtitle }}</p>

      <div class="flex items-center gap-2 mt-auto pt-1.5">
        <span class="text-xs font-bold text-accent-amber flex items-center gap-0.5">
          <Star class="w-3 h-3" /> {{ rating5 }}
        </span>
        <span
          v-if="game.metacritic"
          class="text-[10px] font-bold text-[var(--text-dim)] bg-[var(--surface-2)] px-1 rounded"
        >
          M{{ game.metacritic }}
        </span>
        <span v-if="game.priceLabel" class="text-xs font-bold text-accent-green">{{ game.priceLabel }}</span>
        <span v-else class="text-[10px] text-[var(--text-faint)]">多平台</span>
      </div>
    </div>
  </RouterLink>
</template>
