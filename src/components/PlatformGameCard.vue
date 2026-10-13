<script setup lang="ts">
import { ref, computed } from 'vue'
import { Gamepad2, ExternalLink, Calendar, Tag } from 'lucide-vue-next'
import type { PlatformGame } from '@/types/discover'

const props = defineProps<{
  game: PlatformGame
  /** 该平台封面的统一画幅（宽÷高）。整条卡带共用一个值，卡片才能整整齐齐 */
  artRatio: number
}>()

const status = ref<'loading' | 'ok' | 'error'>(props.game.coverUrl ? 'loading' : 'error')
const usingFallback = ref(false)
const art = ref(props.game.artRatio || props.artRatio || 2 / 3)

const activeSrc = computed(() =>
  usingFallback.value && props.game.coverFallbackUrl ? props.game.coverFallbackUrl : props.game.coverUrl,
)

// 卡片画幅 = 该平台官方美术资源的原生画幅。
// 这样每张图都按自己的比例整幅铺满：既不裁掉标题，也不会出现
// 「横图塞进竖框 → 上下两条模糊底」那种一眼假的观感。
const frameStyle = computed(() => ({ aspectRatio: String(props.artRatio || art.value) }))
// 万一某张图的真实比例和平台声明差太多（比如兜底图换成了别的画幅），
// 才退回 object-contain + 模糊底，作为最后保底。
const ratioOff = computed(() => {
  const want = props.artRatio || art.value
  if (!art.value || !want) return false
  return Math.abs(art.value / want - 1) > 0.22
})

/** 平台品牌色：既做识别也做视觉锚点 */
const BRAND: Record<string, string> = {
  steam: '#1b6fa8',
  playstation: '#0b5fa5',
  nintendo: '#c8102e',
  xbox: '#107c10',
}
const brandColor = computed(() => BRAND[props.game.platform] || 'var(--surface-3)')

function onLoad(e: Event) {
  const el = e.target as HTMLImageElement
  if (el?.naturalWidth && el?.naturalHeight) art.value = el.naturalWidth / el.naturalHeight
  status.value = 'ok'
}
function onError() {
  if (!usingFallback.value && props.game.coverFallbackUrl) {
    usingFallback.value = true
    return
  }
  status.value = 'error'
}
</script>

<template>
  <a
    :href="game.storeUrl"
    target="_blank"
    rel="noopener noreferrer"
    :title="`前往 ${game.platformLabel} 官方商店`"
    class="group flex flex-col rounded-2xl bg-[var(--surface)] border border-[var(--border)] overflow-hidden hover:border-accent/40 hover:shadow-lg hover:shadow-black/20 transition-all card-3d-hover"
  >
    <!-- ═══ 封面 ═══ -->
    <div class="relative overflow-hidden bg-[var(--surface-2)]" :style="frameStyle">
      <!-- ⚠️ 主图必须始终挂载（靠 @load 把状态从 loading 翻到 ok），
           放进条件分支会导致状态卡死、卡片永远只剩骨架。详见 DiscoverCard 注释。 -->
      <img
        v-if="activeSrc"
        :src="activeSrc"
        :alt="game.name"
        class="absolute inset-0 w-full h-full transition-opacity duration-500"
        :class="[status === 'ok' ? 'opacity-100' : 'opacity-0', ratioOff ? 'object-contain p-3' : 'object-cover']"
        loading="lazy"
        referrerpolicy="no-referrer"
        @load="onLoad"
        @error="onError"
      />

      <!-- 仅在画幅意外不符时才需要的模糊底（正常情况走不到） -->
      <img
        v-if="status === 'ok' && ratioOff && activeSrc"
        :src="activeSrc"
        alt=""
        aria-hidden="true"
        class="absolute inset-0 w-full h-full object-cover blur-xl scale-125 opacity-40"
      />

      <div
        v-if="status === 'loading'"
        class="absolute inset-0 z-10 animate-pulse bg-gradient-to-br from-[var(--surface-3)] via-[var(--surface-2)] to-[var(--surface-3)]"
      />
      <div
        v-else-if="status === 'error'"
        class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 px-4 text-center bg-gradient-to-br from-[var(--surface-3)] via-[var(--surface-2)] to-[var(--surface-3)]"
      >
        <Gamepad2 class="w-8 h-8 text-[var(--text-faint)] opacity-45" />
        <span class="text-[11px] leading-snug text-[var(--text-faint)] line-clamp-2">{{ game.name }}</span>
      </div>

      <!-- 平台徽标：所有卡片左上角统一位置，扫一眼就知道来自哪个平台 -->
      <span
        class="absolute top-2 left-2 px-1.5 py-0.5 rounded-md text-[10px] font-semibold text-white shadow-sm"
        :style="{ backgroundColor: brandColor }"
      >
        {{ game.platformLabel }}
      </span>

      <!-- 分组标签：特价 / 最新上架 / 即将发售 / 热门 -->
      <span
        v-if="game.bucketLabel"
        class="absolute top-2 right-2 px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-black/55 backdrop-blur-sm text-white/90"
      >
        {{ game.bucketLabel }}
      </span>

      <!-- 外链提示：这些条目不在站内库里，点开是平台官方商店页 -->
      <span
        class="absolute bottom-2 right-2 p-1 rounded-md bg-black/55 backdrop-blur-sm text-white/80 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <ExternalLink class="w-3 h-3" />
      </span>
    </div>

    <!-- ═══ 信息 ═══ -->
    <div class="flex flex-col gap-1 p-3 flex-1">
      <h3 class="text-sm font-semibold text-[var(--text)] group-hover:text-accent truncate transition-colors">
        {{ game.name }}
      </h3>
      <p class="text-[11px] text-[var(--text-faint)] truncate flex items-center gap-1">
        <Calendar v-if="game.releaseDate" class="w-3 h-3 shrink-0" />
        <span>{{ game.releaseDate || game.platforms.slice(0, 2).join(' · ') || game.platformLabel }}</span>
      </p>

      <div class="flex items-center gap-2 mt-auto pt-1.5 min-h-[20px]">
        <span
          v-if="game.priceLabel"
          class="text-xs font-bold text-accent-green flex items-center gap-0.5 truncate"
        >
          <Tag class="w-3 h-3 shrink-0" /> {{ game.priceLabel }}
        </span>
        <span v-else class="text-[10px] text-[var(--text-faint)] truncate">
          {{ game.platformLabel }} 官方条目
        </span>
      </div>
    </div>
  </a>
</template>
