<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { ExternalLink, Calendar, Star, TrendingUp, Gamepad2, Loader2 } from 'lucide-vue-next'
import SafeImg from '@/components/SafeImg.vue'
import SectionHeader from '@/components/SectionHeader.vue'
import EmptyState from '@/components/EmptyState.vue'
import { api } from '@/lib/api'

interface NewsItem {
  id: string
  source: 'rawg' | 'steam'
  name: string
  coverUrl: string
  releaseDate: string
  rating?: number
  genres: string[]
  platforms: string[]
  price?: string
  originalPrice?: string
  discount?: number
  url: string
}

type Tab = 'releases' | 'upcoming' | 'steam'

const activeTab = ref<Tab>('releases')
const loading = ref(true)
const error = ref('')
const releases = ref<NewsItem[]>([])
const upcoming = ref<NewsItem[]>([])
const steamSpecials = ref<NewsItem[]>([])

const tabs = [
  { key: 'releases' as Tab, label: '最新发售', icon: TrendingUp },
  { key: 'upcoming' as Tab, label: '即将发售', icon: Calendar },
  { key: 'steam' as Tab, label: 'Steam 特价', icon: Star },
] as const

const currentItems = computed(() => {
  switch (activeTab.value) {
    case 'releases': return releases.value
    case 'upcoming': return upcoming.value
    case 'steam': return steamSpecials.value
    default: return []
  }
})

async function fetchNews() {
  loading.value = true
  error.value = ''
  try {
    const r = await api.get('/news')
    const d = await r.json()
    if (d.ok) {
      releases.value = d.recentReleases || []
      upcoming.value = d.upcoming || []
      steamSpecials.value = d.steamSpecials || []
    } else {
      error.value = d.error || '获取失败'
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    // 网络错误时用提示信息（可能后端在拉取外部 API）
    error.value = `网络异常: ${msg.substring(0, 60)}`
  } finally {
    loading.value = false
  }
}

function sourceLabel(source: string): string {
  return source === 'rawg' ? 'RAWG' : source === 'steam' ? 'Steam' : ''
}

function sourceColor(source: string): string {
  if (source === 'rawg') return 'bg-purple-500/20 text-purple-400 border-purple-500/30'
  if (source === 'steam') return 'bg-blue-500/20 text-blue-400 border-blue-500/30'
  return ''
}

onMounted(fetchNews)
</script>

<template>
  <div class="min-h-[70vh] space-y-8 pb-12">
    <!-- Header -->
    <SectionHeader title="新游资讯" subtitle="来自 RAWG.io / Steam Store 的实时游戏动态" />

    <!-- Tabs -->
    <div class="flex gap-2">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        @click="activeTab = tab.key"
        class="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all"
        :class="
          activeTab === tab.key
            ? 'bg-accent text-white shadow-sm shadow-accent/20'
            : 'bg-[var(--surface-2)] text-[var(--text-dim)] border border-[var(--border)] hover:text-[var(--text)] hover:border-accent/30'
        "
      >
        <component :is="tab.icon" class="w-4 h-4" />
        {{ tab.label }}
        <span v-if="tab.key === 'releases'" class="text-xs opacity-70">({{ releases.length }})</span>
        <span v-if="tab.key === 'upcoming'" class="text-xs opacity-70">({{ upcoming.length }})</span>
        <span v-if="tab.key === 'steam'" class="text-xs opacity-70">({{ steamSpecials.length }})</span>
      </button>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex items-center justify-center py-20">
      <Loader2 class="w-6 h-6 animate-spin text-accent" />
      <span class="ml-3 text-[var(--text-dim)]">正在从各平台获取最新游戏信息...</span>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="flex flex-col items-center justify-center py-16">
      <Gamepad2 class="w-12 h-12 text-[var(--text-faint)] mb-3 opacity-30" />
      <p class="text-[var(--text-dim)]">{{ error }}</p>
      <button @click="fetchNews" class="mt-4 px-4 py-2 rounded-xl bg-accent text-white text-sm font-medium hover:bg-accent-strong transition-colors">
        重试
      </button>
    </div>

    <!-- Content -->
    <div v-else-if="currentItems.length > 0" class="space-y-5">
      <!-- Game Card Grid -->
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        <a
          v-for="item in currentItems"
          :key="item.id"
          :href="item.url"
          target="_blank"
          rel="noopener noreferrer"
          class="group relative flex flex-col rounded-2xl bg-[var(--surface)] border border-[var(--border)] overflow-hidden hover:border-accent/40 hover:shadow-lg hover:shadow-accent/5 transition-all duration-300"
        >
          <!-- Cover -->
          <div class="relative aspect-[3/4] sm:aspect-[16/9] overflow-hidden bg-[var(--surface-2)]">
            <SafeImg
              :src="item.coverUrl"
              :alt="item.name"
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            />
            <!-- Source Badge -->
            <span
              class="absolute top-2.5 left-2.5 px-2 py-0.5 rounded-md text-[10px] font-semibold border backdrop-blur-sm"
              :class="sourceColor(item.source)"
            >
              {{ sourceLabel(item.source) }}
            </span>
            <!-- Discount Badge (Steam) -->
            <span
              v-if="item.discount && item.discount > 0"
              class="absolute top-2.5 right-2.5 px-2 py-0.5 rounded-md text-[10px] font-bold bg-green-500 text-white"
            >
              -{{ item.discount }}%
            </span>
          </div>

          <!-- Info -->
          <div class="p-4 flex-1 flex flex-col">
            <h3 class="text-sm font-semibold text-[var(--text)] leading-tight line-clamp-2 group-hover:text-accent transition-colors">
              {{ item.name }}
            </h3>

            <div class="flex flex-wrap items-center gap-2 mt-2 text-[11px] text-[var(--text-faint)]">
              <span v-if="item.releaseDate && item.releaseDate !== 'TBD'" class="flex items-center gap-1">
                <Calendar class="w-3 h-3" />
                {{ item.releaseDate?.substring(0, 10) }}
              </span>
              <span v-if="item.rating" class="flex items-center gap-1 text-amber-400">
                <Star class="w-3 h-3 fill-current" />
                {{ item.rating }}%
              </span>
              <span v-if="item.price" class="font-semibold" :class="item.discount ? 'text-green-400' : 'text-[var(--text-dim)]'">
                {{ item.price }}
                <span v-if="item.originalPrice && item.originalPrice !== item.price" class="line-through opacity-50 ml-1">{{ item.originalPrice }}</span>
              </span>
            </div>

            <!-- Genres -->
            <div v-if="item.genres.length > 0" class="flex flex-wrap gap-1 mt-2">
              <span
                v-for="g in item.genres.slice(0, 3)"
                :key="g"
                class="px-1.5 py-0.5 rounded bg-[var(--surface-2)] text-[10px] text-[var(--text-faint)]"
              >
                {{ g }}
              </span>
            </div>

            <!-- Platforms -->
            <div v-if="item.platforms.length > 0" class="flex flex-wrap gap-1 mt-1.5">
              <span
                v-for="p in item.platforms.slice(0, 3)"
                :key="p"
                class="px-1.5 py-0.5 rounded bg-[var(--surface-3)] text-[10px] text-[var(--text-dim)]"
              >
                {{ p }}
              </span>
            </div>

            <!-- External Link -->
            <div class="mt-auto pt-3 flex items-center gap-1 text-[11px] text-[var(--text-faint)] opacity-0 group-hover:opacity-100 transition-opacity">
              <ExternalLink class="w-3 h-3" />
              查看详情
            </div>
          </div>
        </a>
      </div>

      <p class="text-center text-xs text-[var(--text-faint)] pt-4">
        数据每 10 分钟刷新一次 · 来自 RAWG.io & Steam Store
      </p>
    </div>

    <!-- Empty -->
    <EmptyState v-else title="暂无游戏数据" description="未能获取到游戏信息，请稍后重试或检查网络连接" />
  </div>
</template>

<style scoped>
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
