// 各平台官方榜单直连 API 封装
//
// 数据来自后端 /api/games/platforms，背后是 Steam / PlayStation / Nintendo / Xbox
// 四家**官方免密钥接口**。某个平台在当前网络环境不可达时，后端会返回 ok:false + 原因，
// 前端照实显示「该平台数据源不可达」，不拿别的东西冒充。
import { api } from '@/lib/api'
import type { PlatformGame, PlatformMeta, PlatformFeed, PlatformsResponse } from '@/types/discover'

export interface PlatformBundle {
  feeds: PlatformFeed[]
  meta: PlatformMeta[]
  updatedAt: string
  note: string
  /** 接口整体不可用（后端异常 / 离线静态部署） */
  offline?: boolean
}

const EMPTY_META: PlatformMeta[] = [
  { key: 'steam', label: 'Steam', source: 'store.steampowered.com', provides: '官方榜单' },
  { key: 'playstation', label: 'PlayStation', source: 'store.playstation.com', provides: '官方商店新作' },
  { key: 'nintendo', label: 'Nintendo Switch', source: 'search.nintendo-europe.com', provides: 'eShop 发售日历' },
  { key: 'xbox', label: 'Xbox', source: 'displaycatalog.mp.microsoft.com', provides: '官方商品目录' },
]

/** 各平台封面的原生画幅（与后端 FEED_ART 保持一致），离线兜底时也要有 */
const EMPTY_ART: Record<string, { ratio: number; note: string }> = {
  steam: { ratio: 616 / 353, note: 'Steam 官方胶囊图 616×353' },
  playstation: { ratio: 1, note: 'PS Store 官方主视觉 1024×1024' },
  nintendo: { ratio: 1, note: 'eShop 官方方图 500×500' },
  xbox: { ratio: 600 / 900, note: 'Xbox 官方海报 600×900' },
}

export async function getPlatformBundle(): Promise<PlatformBundle> {
  try {
    const res = await api.get('/games/platforms')
    const data = (await res.json()) as PlatformsResponse
    return {
      feeds: data.feeds || [],
      meta: data.meta?.length ? data.meta : EMPTY_META,
      updatedAt: data.updatedAt || '',
      note: data.note || '',
    }
  } catch {
    // 离线 / 纯静态部署：整体标记 offline，由 UI 明确告知而不是静默空白
    return {
      feeds: EMPTY_META.map((m) => ({
        key: m.key,
        label: m.label,
        ok: false,
        error: '当前部署未连接后端，无法读取各平台实时数据',
        latencyMs: 0,
        artRatio: EMPTY_ART[m.key]?.ratio ?? 2 / 3,
        artNote: EMPTY_ART[m.key]?.note ?? '',
        items: [] as PlatformGame[],
      })),
      meta: EMPTY_META,
      updatedAt: '',
      note: '',
      offline: true,
    }
  }
}
