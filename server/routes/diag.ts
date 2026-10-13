/**
 * 出网诊断（只读）
 *
 * 用途：确定运行环境（尤其是部署沙箱）到底能连哪些外网站点。
 * 为什么需要它：本机与沙箱的出网策略不同——本机 Steam 可达、沙箱则不然，
 * 而「联网检索」「实时在线人数」能否在线上真正取到数据完全取决于这一点。
 *
 * 目标主机写死在代码里、不接受任何用户输入，因此不构成 SSRF 面。
 *
 * GET /api/diag/egress    —— 直连连通性
 * GET /api/diag/providers —— 第三方搜索 provider（Serper / Tavily）可用性
 * GET /api/diag/realtime  —— Steam 实时在线接口可用性
 */

import { Hono } from 'hono'
import { probeProviders } from '../lib/searchProviders.ts'
import { getRealtimePlayers } from '../lib/steamRealtime.ts'

const diag = new Hono()

interface Target {
  name: string
  url: string
  /**
   * 仅用于标注。注意：带鉴权的接口（Twitch / Serper / Tavily）预期返回 401，
   * 那代表「网络已连通、只缺凭证」，与超时是两回事 —— 判据见 probeOne。
   */
  note?: string
}

const TARGETS: Target[] = [
  // ── Steam（PC 主数据源）──
  { name: 'steam-store', url: 'https://store.steampowered.com/api/featuredcategories?l=english', note: '联网检索主数据源' },
  { name: 'steam-api', url: 'https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=730&count=1', note: '游戏新闻 / 实时在线人数接口' },
  { name: 'steam-storesearch', url: 'https://store.steampowered.com/api/storesearch/?term=elden&cc=us&l=en', note: '游戏名 → appid 解析（封面/元数据依赖）' },

  // ── 主机平台商店（免密钥，非官方接口；决定「非 Steam 游戏」能否真实接入）──
  {
    name: 'xbox-catalog',
    url: 'https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=9NKX70BBCDRN&market=US&languages=en-us&MS-CV=DGU1mcuYo0WMMp+F.1',
    note: 'Xbox 商店目录（免密钥，含 BoxArt）',
  },
  {
    name: 'xbox-images',
    url: 'https://store-images.s-microsoft.com/image/apps.18975.13718773309227929.bebdcc0e-1ed5-4778-8732-f4ef65a2f445.125d6b3b-492f-4e5f-8037-7ade230c8224',
    note: 'Xbox 封面图 CDN',
  },
  {
    name: 'ps-store',
    url: 'https://store.playstation.com/store/api/chihiro/00_09_000/container/US/en/999/STORE-MSF77008-ALLGAMES/0?size=3',
    note: 'PS Store 目录（免密钥，含封面）',
  },
  { name: 'ps-image-api', url: 'https://image.api.playstation.com/', note: 'PS 封面图 CDN（任意响应即算连通）' },
  { name: 'ps-image-vulcan', url: 'https://vulcan.dl.playstation.net/', note: 'PS 封面图 CDN 备用（任意响应即算连通）' },
  {
    name: 'nintendo-search',
    url: 'https://search.nintendo-europe.com/en/select?q=zelda&fq=type%3AGAME&rows=1&wt=json',
    note: 'Switch eShop 搜索（免密钥，含封面）',
  },
  { name: 'nintendo-price', url: 'https://api.ec.nintendo.com/v1/price?country=US&lang=en&ids=70010000000025', note: '任天堂价格接口（免密钥）' },
  { name: 'nintendo-images', url: 'https://www.nintendo.com/eu/media/images/migration/games_7/packshot/gameboyadvance_1/other_5/the_legend_of_zelda_rdax_90x90_image500w.png', note: '任天堂封面图 CDN' },

  // ── 封面图 CDN ──
  { name: 'steam-cover-hi', url: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1240440/library_600x900.jpg', note: 'Steam 竖版高清封面 600x900（当前横图仅 460x215）' },
  { name: 'steam-cdn-akamai', url: 'https://cdn.akamai.steamstatic.com/steam/apps/1240440/library_600x900.jpg', note: 'Steam CDN 备用域' },
  { name: 'steam-cdn-shared', url: 'https://shared.steamstatic.com/store_item_assets/steam/apps/1240440/library_600x900.jpg', note: 'Steam 新版资源域' },
  {
    name: 'steam-community-ach',
    url: 'https://steamcommunity.com/stats/620/achievements/?l=schinese',
    note: 'Steam 社区成就页（全球成就难度榜的数据源，免密钥）',
  },
  {
    name: 'steam-ach-icon-cf',
    url: 'https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/620/SURVIVE_CONTAINER_RIDE.jpg',
    note: '成就图标 CDN（cloudflare 域，成就榜默认图源）',
  },
  {
    name: 'steam-ach-icon-akamai',
    url: 'https://shared.akamai.steamstatic.com/community_assets/images/apps/620/SURVIVE_CONTAINER_RIDE.jpg',
    note: '成就图标 CDN 备用域（akamai）',
  },
  { name: 'steam-appdetails', url: 'https://store.steampowered.com/api/appdetails?appids=620&cc=cn&l=zh', note: '游戏详情 / 现价（免密钥）' },
  { name: 'steam-reviews', url: 'https://store.steampowered.com/appreviews/620?json=1&num_per_page=1', note: 'Steam 评测接口（详情页 Steam 评测区）' },
  { name: 'wikimedia-cover', url: 'https://upload.wikimedia.org/wikipedia/en/4/4b/The_Legend_of_Zelda_Tears_of_the_Kingdom_cover_art.jpg', note: '维基封面（实测突发请求会 429 限流）' },
  { name: 'steamgriddb-api', url: 'https://www.steamgriddb.com/api/v2/search/autocomplete/zelda', note: 'SteamGridDB 全平台美术库（4xx = 网络通、仅缺 key）' },

  // ── 第三方服务与对照组 ──
  { name: 'twitch-api', url: 'https://api.twitch.tv/helix/streams', note: '直播观众数（返回 401 = 网络通、仅缺 token）' },
  { name: 'twitch-oauth', url: 'https://id.twitch.tv/oauth2/token', note: 'Twitch / IGDB 共用凭证端点（GET 不被支持，返回 4xx 即视为连通）' },
  { name: 'serper', url: 'https://google.serper.dev/search', note: '第三方搜索（4xx = 网络通、仅缺 key）' },
  { name: 'tavily', url: 'https://api.tavily.com/search', note: '第三方搜索（4xx = 网络通、仅缺 key）' },
  { name: 'rawg', url: 'https://api.rawg.io/api/games?page_size=1', note: '多平台库（4xx = 网络通、仅缺 key）' },
  { name: 'igdb', url: 'https://api.igdb.com/v4/games', note: '多平台库（4xx = 网络通、仅缺 key）' },
  { name: 'deepseek', url: 'https://api.deepseek.com', note: 'LLM 出口（对照组）' },
  { name: 'baidu', url: 'https://www.baidu.com', note: '通用出口（对照组）' },
  { name: 'github-api', url: 'https://api.github.com/zen', note: '通用出口（对照组）' },
]

interface ProbeResult {
  name: string
  url: string
  /** 拿到 2xx/3xx —— 接口本身可用 */
  ok: boolean
  /** 拿到了任意 HTTP 响应（含 401/403/404）—— 网络层面通，只是缺凭证或请求方式不符 */
  reachable: boolean
  /** 401/403 —— 网络通但缺凭证；这正是判断「能不能接这家服务」的关键信号 */
  needsAuth: boolean
  status: number | null
  ms: number
  bytes: number
  /** 响应内容类型 —— 图片目标（jpg/png）与 JSON 目标分开看，便于判断拿到的是不是图 */
  contentType: string | null
  error: string | null
  note?: string
}

async function probeOne(t: Target): Promise<ProbeResult> {
  const t0 = Date.now()
  try {
    const res = await fetch(t.url, {
      headers: { 'User-Agent': 'GameVibe/1.0' },
      signal: AbortSignal.timeout(8000),
    })
    const ctype = res.headers.get('content-type')
    // 图片等二进制目标不读正文，只看 Content-Length，避免为了探测下载整张图
    let bytes = 0
    if (ctype && /json|text|html|xml|javascript/.test(ctype)) {
      const text = await res.text().catch(() => '')
      bytes = text.length
    } else {
      const len = res.headers.get('content-length')
      bytes = len ? Number(len) : 0
      await res.body?.cancel().catch(() => {})
    }
    const ok = res.status >= 200 && res.status < 400
    return {
      name: t.name,
      url: t.url,
      ok,
      reachable: true,
      needsAuth: !ok && (res.status === 401 || res.status === 403),
      status: res.status,
      ms: Date.now() - t0,
      bytes,
      contentType: ctype,
      error: null,
      note: t.note,
    }
  } catch (e) {
    const cause = (e as { cause?: { code?: string; message?: string } })?.cause
    return {
      name: t.name,
      url: t.url,
      ok: false,
      reachable: false,
      needsAuth: false,
      status: null,
      ms: Date.now() - t0,
      bytes: 0,
      contentType: null,
      error: cause?.code || cause?.message || (e instanceof Error ? e.message : String(e)),
      note: t.note,
    }
  }
}

diag.get('/egress', async (c) => {
  const results = await Promise.all(TARGETS.map(probeOne))
  // 三个梯度分开报，避免把「网络通但缺 token」误读成「被墙」：
  // healthy    服务可用（2xx/3xx）
  // needsAuth  网络通、仅缺凭证或方法不符（401/403/404）
  // blocked    连不上（DNS/超时/连接被拒）
  const healthy = results.filter((r) => r.ok).map((r) => r.name)
  const needsAuth = results.filter((r) => r.needsAuth).map((r) => r.name)
  const blocked = results.filter((r) => !r.reachable).map((r) => r.name)
  return c.json({
    ok: true,
    node: process.version,
    env: {
      NODE_ENV: process.env.NODE_ENV ?? null,
      NODE_USE_ENV_PROXY: process.env.NODE_USE_ENV_PROXY ?? null,
      HTTPS_PROXY: process.env.HTTPS_PROXY ? '(set)' : null,
      HTTP_PROXY: process.env.HTTP_PROXY ? '(set)' : null,
    },
    healthy,
    needsAuth,
    blocked,
    /** 兼容旧字段：曾等价于 healthy，现改为「网络可达」的并集 */
    reachable: results.filter((r) => r.reachable).map((r) => r.name),
    results,
    checkedAt: Date.now(),
  })
})

diag.get('/realtime', async (c) => {
  const rt = await getRealtimePlayers()
  return c.json({
    ok: true,
    reachable: rt.reachable,
    covered: rt.covered,
    total: rt.total,
    sum: rt.sum,
    byGame: rt.byGame,
    note: rt.note ?? null,
    checkedAt: Date.now(),
  })
})

diag.get('/providers', async (c) => {
  const results = await probeProviders()
  return c.json({
    ok: true,
    anyUsable: results.some((r) => r.ok),
    results,
    checkedAt: Date.now(),
  })
})

export default diag
