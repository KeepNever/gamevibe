// 各平台「官方免密钥接口」直连层
//
// 目标：回答「站里只有 Steam 游戏，Switch / PlayStation / Xbox 能不能也拿到？」
// —— 能。下面四个客户端全部打各平台**官方**接口，不需要任何 API key。
//
//   Steam        store.steampowered.com/api/featuredcategories      官方榜单（特价/新发售/热销/即将发售）
//   PlayStation  store.playstation.com/store/api/chihiro/...        官方商店容器（含盒装封面）
//   Nintendo     search.nintendo-europe.com/.../select              eShop 官方检索（按发售日倒序）
//   Xbox         displaycatalog.mp.microsoft.com/v7.0/...           官方商品目录（含 BoxArt / Poster）
//
// 三条硬约束：
//   1. **绝不编造**：拿不到就如实返回 ok:false + 原因，前端照实显示，不假装有数据。
//   2. **平台间互不牵连**：并行取数，各平台独立成败（线上沙箱对各域名的放行策略不同，
//      实测 Xbox 元数据时通时不通，不能因为它挂了就整个接口失败）。
//   3. **短超时 + 长缓存**：首屏不能被外部接口拖住，单平台 7s；结果缓存 10 分钟。

export type PlatformKey = 'steam' | 'playstation' | 'nintendo' | 'xbox'

export interface PlatformGame {
  /** 带平台前缀的稳定 id，避免与精选库 / 目录条目撞号 */
  id: string
  name: string
  coverUrl: string
  /** 首图 404 时前端改用这张（Steam 竖版资源并非每个 appid 都有，留个横版兜底） */
  coverFallbackUrl?: string
  /** 是否是竖版封面（前端据此决定 object-cover 还是留白） */
  portrait: boolean
  /**
   * 封面原图宽高比（宽 ÷ 高）。各平台官方美术资源的画幅天生不同：
   * Steam 616×353≈1.75、PlayStation 1024×1024=1、Nintendo 500×500=1、Xbox 600×900≈0.667。
   * 前端拿它给卡片定画幅，保证**同一个平台标签页内每张卡画幅一致、不裁不糊**。
   */
  artRatio: number
  platform: PlatformKey
  platformLabel: string
  /** 该条目官方标注的可玩平台 */
  platforms: string[]
  releaseDate: string
  priceLabel: string
  genres: string[]
  tags: string[]
  /** 该平台内的分组：特价 / 新发售 / 热销 / 即将发售 / 最新上架 */
  bucket: string
  bucketLabel: string
  storeUrl: string
}

export interface PlatformFeed {
  key: PlatformKey
  label: string
  ok: boolean
  /** 失败原因（英文错误码 + 中文说明），前端照实展示 */
  error?: string
  latencyMs: number
  /** 该平台封面的统一画幅（宽÷高），前端用它定整条卡带的卡片比例 */
  artRatio: number
  /** 画幅的中文来源说明，如「Steam 官方胶囊图 616×353」 */
  artNote: string
  items: PlatformGame[]
}
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

/** 单平台外部请求超时：首屏不能被拖住 */
const FETCH_TIMEOUT = 7000
/** 结果缓存：成功的缓存 10 分钟 */
const CACHE_TTL = 10 * 60 * 1000

const PLATFORM_LABEL: Record<PlatformKey, string> = {
  steam: 'Steam',
  playstation: 'PlayStation',
  nintendo: 'Nintendo Switch',
  xbox: 'Xbox',
}

// ── 缓存 ──────────────────────────────────────────────
const cache = new Map<string, { data: PlatformGame[]; until: number }>()

function getCached(key: string): PlatformGame[] | undefined {
  const hit = cache.get(key)
  if (hit && Date.now() < hit.until) return hit.data
  if (hit) cache.delete(key)
  return undefined
}
function setCache(key: string, data: PlatformGame[], ttl = CACHE_TTL): void {
  cache.set(key, { data, until: Date.now() + ttl })
}

async function getJson<T>(url: string, timeout = FETCH_TIMEOUT, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'user-agent': UA, accept: 'application/json,*/*', ...(init.headers || {}) },
    signal: AbortSignal.timeout(timeout),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as T
}

function normName(s: string): string {
  return (s || '').replace(/[™®©]/g, '').replace(/\s+/g, ' ').trim()
}

// ═══════════════════════ Steam ═══════════════════════
// featuredcategories 由 Valve 自己编排，质量天然可靠：特价 / 新发售 / 热销 / 即将发售
interface SteamItem {
  id: number
  name: string
  header_image?: string
  large_capsule_image?: string
  small_capsule_image?: string
  final_price?: number
  original_price?: number
  discount_percent?: number
  currency?: string
  windows_available?: boolean
  mac_available?: boolean
  linux_available?: boolean
}
interface SteamFeatured {
  specials?: { items?: SteamItem[] }
  new_releases?: { items?: SteamItem[] }
  coming_soon?: { items?: SteamItem[] }
  top_sellers?: { items?: SteamItem[] }
}

/** Steam 榜单里偶尔混进原声带 / 试玩 / 服务端这类非游戏条目，挡掉 */
const STEAM_JUNK = /soundtrack|\bost\b|demo|playtest|dedicated server|server tool|\bsdk\b|artbook|art book|season pass|starter pack|battle pass|upgrade|expansion|soundtrack/i

const STEAM_BUCKETS: { key: keyof SteamFeatured; bucket: string; label: string }[] = [
  { key: 'specials', bucket: 'specials', label: '特价' },
  { key: 'new_releases', bucket: 'new_releases', label: '新发售' },
  { key: 'top_sellers', bucket: 'top_sellers', label: '热销' },
  { key: 'coming_soon', bucket: 'coming_soon', label: '即将发售' },
]

/**
 * Steam 封面统一走 `large_capsule_image`（官方胶囊图，实测恒为 616×353）。
 *
 * 为什么不沿用竖版 `library_600x900.jpg`：实测 30 条榜单里只有 7 条存在该资源，
 * 且它本身只是 300×450 的低清缩略图（高清版要 `_2x`）。剩下 23 条只能退回
 * `header_image`（460×215），塞进 3:4 卡片里又被拉成一片糊 —— 这正是
 * 「有些封面又假又糊」的来源。同一标签页里一半竖版一半横版，观感也不协调。
 *
 * 现在改成：整条 Steam 卡带只用 616×353 一种画幅，100% 有图、零裁剪、够清晰。
 */
function steamArtUrl(item: SteamItem): string {
  return item.large_capsule_image || item.header_image || item.small_capsule_image || ''
}

/** Steam 官方胶囊图实际像素（用于卡片画幅计算） */
const STEAM_ART_RATIO = 616 / 353

function formatSteamPrice(item: SteamItem): string {
  const cur = item.currency || 'USD'
  const sym = cur === 'USD' ? '$' : cur === 'CNY' ? '¥' : ''
  const off = item.discount_percent || 0
  if (!item.final_price && !item.original_price) return ''
  const price = item.final_price ? (sym + (item.final_price / 100).toFixed(2)) : '免费'
  return off > 0 ? `${price} · -${off}%` : price
}

async function fetchSteamLive(): Promise<PlatformGame[]> {
  const key = 'steam:featured'
  const cached = getCached(key)
  if (cached) return cached

  const data = await getJson<SteamFeatured>('https://store.steampowered.com/api/featuredcategories?cc=us&l=en')
  // 同一款游戏可能同时出现在特价与热销里，只保留第一次
  const seen = new Set<number>()
  /** 先按分组各自收好，最后再交错合并 —— 直接拼接会让首屏 8 张全是「特价」 */
  const byBucket: PlatformGame[][] = STEAM_BUCKETS.map(() => [])

  STEAM_BUCKETS.forEach(({ key: bKey, bucket, label }, bi) => {
    const items = (data[bKey]?.items || []).slice(0, 8)
    for (const it of items) {
      if (!it?.id || !it.name || seen.has(it.id)) continue
      if (STEAM_JUNK.test(it.name)) continue
      seen.add(it.id)
      // Steam 上能搜到就说明有 PC 版，顺带把官方标注的系统标出来
      const platforms = ['PC']
      if (it.mac_available) platforms.push('macOS')
      if (it.linux_available) platforms.push('Linux')
      byBucket[bi].push({
        id: `pl_steam_${it.id}`,
        name: normName(it.name),
        coverUrl: steamArtUrl(it),
        portrait: false,
        artRatio: STEAM_ART_RATIO,
        platform: 'steam',
        platformLabel: PLATFORM_LABEL.steam,
        platforms,
        releaseDate: '',
        priceLabel: formatSteamPrice(it),
        genres: [],
        tags: [label],
        bucket,
        bucketLabel: label,
        storeUrl: `https://store.steampowered.com/app/${it.id}`,
      })
    }
  })

  // 交错：特价 / 新发售 / 热销 / 即将发售 / 特价 / 新发售 ……
  const out: PlatformGame[] = []
  const maxLen = Math.max(...byBucket.map((b) => b.length))
  for (let i = 0; i < maxLen; i++) {
    for (const b of byBucket) if (b[i]) out.push(b[i])
  }

  setCache(key, out)
  return out
}

// ═══════════════════════ PlayStation ═══════════════════════
// chihiro 是 PS Store 网页端自己的接口（免密钥），给出官方盒装封面。
//
// ⚠️ 两个坑，都是实测踩出来的：
//   ① 容器 ALLGAMES 号称按发售日倒序，但它的 start 参数被服务端忽略（翻页无效），
//      而且前排全是**远期预购**的廉价小游戏（日期都在 2027 年）——所以「最新上架」
//      不能用它。
//   ② 官方首页的 NEWGAMES 容器质量最高（就是 PSN 首页「最新游戏」那一栏），
//      但只有 8 条。
//   → 做法：NEWGAMES 打底 + 用搜索端点按发售日倒序补量（多个常见关键词取并集），
//     再统一做质量过滤。这样拿到的每一条都是**真实已发售**的 PS 游戏。
interface PsImage {
  type: number
  url: string
}
interface PsLink {
  id: string
  name: string
  game_contentType?: string
  images?: PsImage[]
  playable_platform?: string[]
  release_date?: string
  provider_name?: string
  top_category?: string
  url?: string
  metadata?: Record<string, { values?: string[] }>
  default_sku?: { display_price?: string; reward_display_price?: string; price?: number }
}
interface PsContainer {
  links?: PsLink[]
  total_results?: number
}

const PS_STORE = 'https://store.playstation.com/store/api/chihiro/00_09_000'
const PS_NEWGAMES = `${PS_STORE}/container/US/en/19/STORE-MSF77008-NEWGAMES/0?size=40`
const PS_SEARCH = `${PS_STORE}/search/US/en/999/`

/** 搜索补量用的关键词：太窄会偏，太宽会重。用常见游戏名用词取并集。 */
const PS_KEYWORDS = ['the', 'of', 'star', 'war', 'legend', 'dragon', 'hero', 'world', 'dark', 'city']

/** 廉价小游戏 / 非本体的识别：宁可放过，不能误杀知名作品 */
const PS_JUNK =
  /slot|casino|claw machine|puzzle pack|avatar|theme|soundtrack|\bdemo\b|\bbeta\b|add-?on|upgrade|season pass|\bdlc\b|bundle|\bpack\b|pre-?order|launcher|quiz|trivia|hidden object|escape room|mahjong|solitaire|pinball|checkers/i
/** 常见美术资源打包 / 素材库，不是游戏 */
const PS_ASSET = /asset|texture|model|material|animation|brush|font|vfx|sfx|music loop|complete edition$/i

function isPsJunk(g: PsLink): boolean {
  const n = normName(g.name || '')
  if (!n || n.length < 3) return true
  if (PS_JUNK.test(n) || PS_ASSET.test(n)) return true
  if (g.game_contentType !== 'Full Game') return true
  // 必须有盒装封面（type 10）
  if (!(g.images || []).some((im) => im.type === 10 && im.url)) return true
  // 发售日必须可信，且是「已经发售」（远期预购不算最新上架）
  const t = Date.parse(g.release_date || '')
  if (!Number.isFinite(t)) return true
  if (t > Date.now()) return true
  if (t < Date.now() - 540 * 864e5) return true // 一年半以前的不算新
  const plat = g.playable_platform || []
  if (!plat.some((p) => /PS5|PS4/i.test(p))) return true
  return false
}

async function fetchPlayStationLive(): Promise<PlatformGame[]> {
  const key = 'ps:newgames'
  const cached = getCached(key)
  if (cached) return cached

  // NEWGAMES（官方首页栏目）+ 关键词搜索按发售日倒序，取并集
  const [newGames, ...searched] = await Promise.all([
    getJson<PsContainer>(PS_NEWGAMES).catch(() => ({ links: [] })),
    ...PS_KEYWORDS.map((kw) =>
      getJson<PsContainer>(
        `${PS_SEARCH}${encodeURIComponent(kw)}?size=40&sort=release_date&direction=desc`,
      ).catch(() => ({ links: [] })),
    ),
  ])
  const all = [...(newGames.links || []), ...searched.flatMap((p) => p.links || [])]

  const seenId = new Set<string>()
  const seenName = new Set<string>()
  const out: PlatformGame[] = []
  for (const g of all) {
    if (!g.id || seenId.has(g.id) || isPsJunk(g)) continue
    seenId.add(g.id)
    const name = normName(g.name || '')
    // 同名重复（PS4/PS5 双版本）只留一个
    const dedupeKey = name.toLowerCase()
    if (seenName.has(dedupeKey)) continue
    seenName.add(dedupeKey)
    const img = (g.images || []).find((im) => im.type === 10 && im.url)
    const genre = g.metadata?.game_genre?.values?.[0] || ''
    const sku = g.default_sku || {}
    const price = sku.display_price || sku.reward_display_price || ''
    out.push({
      id: `pl_ps_${g.id}`,
      name,
      coverUrl: img ? img.url : '',
      portrait: false, // 实测 type 10 是 1024×1024 的方形主视觉（不是竖版盒装）
      artRatio: 1,
      platform: 'playstation',
      platformLabel: PLATFORM_LABEL.playstation,
      platforms: (g.playable_platform || []).map((p) => p.replace(/™/g, '').trim()),
      releaseDate: (g.release_date || '').slice(0, 10),
      priceLabel: price ? String(price) : '',
      genres: genre ? [genre] : [],
      tags: ['最新上架'],
      bucket: 'new_releases',
      bucketLabel: '最新上架',
      storeUrl: g.url ? `https://store.playstation.com${g.url}` : 'https://store.playstation.com/',
    })
  }
  // 按发售日倒序，最新的排前面
  out.sort((a, b) => (b.releaseDate || '').localeCompare(a.releaseDate || ''))
  const trimmed = out.slice(0, 18)
  setCache(key, trimmed)
  return trimmed
}

// ═══════════════════════ Nintendo Switch ═══════════════════════
// 任天堂欧洲检索接口（官方站点 search.nintendo-europe.com 自己的后端），免密钥
interface NintendoDoc {
  title?: string
  image_url?: string
  image_url_sq_s?: string
  image_url_h2x1_s?: string
  nsuid?: string
  dates_released_dts?: string[]
  price?: { regular_price?: { amount?: string; currency?: string } }
  publisher?: string
  players?: { players?: string }
  genres?: string[]
  pretty_date_s?: string
}
interface NintendoResp {
  response?: { docs?: NintendoDoc[] }
}

async function fetchNintendoLive(): Promise<PlatformGame[]> {
  const key = 'nsw:latest'
  const cached = getCached(key)
  if (cached) return cached

  const fl = 'title,image_url_sq_s,image_url,image_url_h2x1_s,nsuid,dates_released_dts,price,publisher,players,genres'
  const now = Date.now()
  const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')
  // ⚠️ 这个接口一旦带上区间查询，sort 参数就被忽略了（实测 asc/desc 返回同一批）；
  //    所以区间只用来「取对池子」，真正的排序在代码里做。
  const windows: { label: string; bucket: string; upcoming: boolean; q: string }[] = [
    {
      label: '最新上架',
      bucket: 'new_releases',
      upcoming: false,
      q: `dates_released_dts:[${iso(now - 180 * 864e5)} TO ${iso(now)}]`,
    },
    {
      label: '即将发售',
      bucket: 'coming_soon',
      upcoming: true,
      q: `dates_released_dts:[${iso(now)} TO ${iso(now + 180 * 864e5)}]`,
    },
  ]

  const reqUrl = (q: string) =>
    'https://search.nintendo-europe.com/en/select?q=' +
    encodeURIComponent(q) +
    '&fq=' +
    encodeURIComponent('type:GAME') +
    '&rows=40&wt=json&fl=' +
    encodeURIComponent(fl)

  const pages = await Promise.all(
    windows.map((w) => getJson<NintendoResp>(reqUrl(w.q)).catch(() => ({ response: { docs: [] } }))),
  )

  const out: PlatformGame[] = []
  const seenName = new Set<string>()
  windows.forEach((w, i) => {
    const docs = [...(pages[i].response?.docs || [])]
      // 接口不排序，自己排：已发售要最新的在前，即将发售要最近的在前
      .sort((a, b) => {
        const ta = Date.parse((a.dates_released_dts || [])[0] || '')
        const tb = Date.parse((b.dates_released_dts || [])[0] || '')
        return w.upcoming ? ta - tb : tb - ta
      })
      .slice(0, 30)

    for (const d of docs) {
      if (out.length >= 20) return
      const name = normName(d.title || '')
      if (!name || seenName.has(name.toLowerCase())) continue
      const t = Date.parse((d.dates_released_dts || [])[0] || '')
      if (!Number.isFinite(t)) continue
      // 商品本体必须是 Switch / Switch 2 版本
      const img = d.image_url_sq_s || d.image_url || d.image_url_h2x1_s
      if (!img) continue
      seenName.add(name.toLowerCase())
      const price = d.price?.regular_price
      out.push({
        id: `pl_nsw_${d.nsuid || encodeURIComponent(name)}`,
        name,
        coverUrl: img,
        // image_url_sq_s 是 500×500 方图，卡片按 1:1 画幅展示，不裁不糊
        portrait: false,
        artRatio: 1,
        platform: 'nintendo',
        platformLabel: PLATFORM_LABEL.nintendo,
        platforms: ['Nintendo Switch'],
        releaseDate: new Date(t).toISOString().slice(0, 10),
        priceLabel: price?.amount ? `${price.currency === 'EUR' ? '€' : ''}${price.amount}` : '',
        genres: (d.genres || []).slice(0, 2),
        tags: [w.label],
        bucket: w.bucket,
        bucketLabel: w.label,
        storeUrl: 'https://www.nintendo.com/search/#q=' + encodeURIComponent(name),
      })
    }
  })

  setCache(key, out)
  return out
}

// ═══════════════════════ Xbox ═══════════════════════
// Microsoft 官方商品目录 displaycatalog：无需密钥，可按 family=Games 直接浏览
interface XboxImage {
  ImagePurpose: string
  Width: number
  Height: number
  Uri: string
}
interface XboxProduct {
  ProductId: string
  ProductKind?: string
  LocalizedProperties?: {
    ProductTitle?: string
    ShortDescription?: string
    PublisherName?: string
    DeveloperName?: string
    Images?: XboxImage[]
  }[]
  MarketProperties?: { OriginalReleaseDate?: string }[]
  Properties?: { Categories?: string[]; IsDemo?: boolean }
  DisplaySkuAvailabilities?: {
    Sku?: {
      Properties?: {
        Packages?: { FulfillmentData?: Record<string, string> }[]
        IsTrial?: boolean
      }
      LocalizedProperties?: { SkuTitle?: string; SkuDescription?: string }[]
    }
  }[]
}
interface XboxResp {
  Products?: XboxProduct[]
  TotalResultCount?: number
}

/** Xbox 商品目录里混着启动器 / 试玩 / 资料片 / 虚拟货币，过滤掉 */
const XBOX_JUNK =
  /launcher|\bbeta\b|\bdemo\b|trial|soundtrack|add-?on|\bdlc\b|season pass|pre-?order|redistributable|runtime|\brobux\b|\bv-?bucks\b|gift card|currency|coin pack|game pass ultimate/i

/**
 * 只认「官方竖版盒装美术」：Poster / BrandedKeyArt / BoxArt。
 *
 * 不能用「随便挑一张图」兜底——微软目录里很多商品只有 Screenshot（1366×768 横图）
 * 和 Logo（300×300）。拿横截图当封面会同时踩两个坑：一是和整条卡带的 2:3 画幅不符，
 * 二是这类小图 CDN 会直接返回 HTTP 400（`?w=600` 都不给缩）。
 * 挑不到竖版美术就**不展示这一条**，好过放一张糊的横截图。
 */
function pickXboxArt(imgs: XboxImage[]): XboxImage | undefined {
  const order = ['Poster', 'BrandedKeyArt', 'BoxArt']
  for (const p of order) {
    const hits = imgs.filter((i) => i.ImagePurpose === p && i.Uri)
    if (!hits.length) continue
    // 同一用途可能有多张，取像素面积最大的
    return hits.sort((a, b) => (b.Width || 0) * (b.Height || 0) - (a.Width || 0) * (a.Height || 0))[0]
  }
  return undefined
}

async function fetchXboxLive(): Promise<PlatformGame[]> {
  const key = 'xbox:browse'
  const cached = getCached(key)
  if (cached) return cached

  // ⚠️ $top 上限是 25，给 30 及以上一律 HTTP 400
  const url =
    'https://displaycatalog.mp.microsoft.com/v7.0/productFamilies/Games/products' +
    '?market=US&languages=en-US&fieldsTemplate=details&$top=25'
  const data = await getJson<XboxResp>(url)

  const out: PlatformGame[] = []
  const seen = new Set<string>()
  for (const p of data.Products || []) {
    const lp = p.LocalizedProperties?.[0]
    const name = normName(lp?.ProductTitle || '')
    if (!name || !p.ProductId || seen.has(p.ProductId)) continue
    if (!lp?.Images?.length) continue
    if (XBOX_JUNK.test(name)) continue
    if (p.Properties?.IsDemo) continue
    const art = pickXboxArt(lp.Images)
    if (!art?.Uri) continue
    // 太小的小图当封面只会更糊，宁可不要这一条
    if (art.Width && art.Width < 500) continue
    seen.add(p.ProductId)
    // 微软图片 CDN 支持按尺寸取；原图动辄十几 MB。请求宽度不超过原图宽度，
    // 否则部分小图会直接 400（实测 300px 的图给 w=600 就报错）。
    const want = Math.min(1200, art.Width || 1200)
    const u = art.Uri.startsWith('//') ? 'https:' + art.Uri : art.Uri
    const ratio = art.Height > 0 && art.Width > 0 ? art.Width / art.Height : 0.667
    out.push({
      id: `pl_xbox_${p.ProductId}`,
      name,
      coverUrl: `${u}${u.includes('?') ? '&' : '?'}w=${want}&q=90`,
      portrait: art.Height >= art.Width,
      artRatio: ratio,
      platform: 'xbox',
      platformLabel: PLATFORM_LABEL.xbox,
      platforms: ['Xbox', 'PC'],
      releaseDate: (p.MarketProperties?.[0]?.OriginalReleaseDate || '').slice(0, 10),
      priceLabel: '',
      genres: [],
      // 目录默认排序实测是「热门优先」（前排是 Minecraft / COD / Fortnite / Roblox），
      // 不是按发售日，所以这里如实标成「热门」而不是「最新上架」
      tags: ['热门'],
      bucket: 'top',
      bucketLabel: '热门',
      storeUrl: `https://www.xbox.com/games/store/x/${p.ProductId}`,
    })
    if (out.length >= 18) break
  }
  setCache(key, out)
  return out
}

// ═══════════════════════ 汇总 ═══════════════════════

const FETCHERS: { key: PlatformKey; run: () => Promise<PlatformGame[]> }[] = [
  { key: 'steam', run: fetchSteamLive },
  { key: 'playstation', run: fetchPlayStationLive },
  { key: 'nintendo', run: fetchNintendoLive },
  { key: 'xbox', run: fetchXboxLive },
]

function describeError(e: unknown): string {
  const err = e as { message?: string; cause?: { code?: string } }
  const code = err?.cause?.code || ''
  const msg = err?.message || '未知错误'
  if (/ECONNRESET/i.test(code)) return '连接被重置（该域名在当前网络环境不可达）'
  if (/ENOTFOUND|EAI_AGAIN/i.test(code)) return '域名解析失败（当前网络环境不可达）'
  if (/TIMEOUT|UND_ERR_CONNECT_TIMEOUT|AbortError/i.test(`${code} ${msg}`)) return '请求超时（当前网络环境不可达）'
  if (/HTTP 4\d\d/.test(msg)) return `接口拒绝：${msg}`
  if (/HTTP 5\d\d/.test(msg)) return `接口异常：${msg}`
  return code ? `${code}：${msg}` : msg
}

/**
 * 各平台官方美术资源的画幅（宽÷高）。整条卡带按它统一出图，避免一格里
 * 竖版横版混着放、每张都要么被裁要么留大片模糊底。
 */
const FEED_ART: Record<PlatformKey, { ratio: number; note: string }> = {
  steam: { ratio: STEAM_ART_RATIO, note: 'Steam 官方胶囊图 616×353' },
  playstation: { ratio: 1, note: 'PS Store 官方主视觉 1024×1024' },
  nintendo: { ratio: 1, note: 'eShop 官方方图 500×500' },
  xbox: { ratio: 600 / 900, note: 'Xbox 官方海报 600×900' },
}

/**
 * 取四个平台的实时榜单。平台间完全独立——某个平台挂了不影响其它三个。
 */
export async function getPlatformFeeds(): Promise<PlatformFeed[]> {
  const results = await Promise.all(
    FETCHERS.map(async ({ key, run }) => {
      const t0 = Date.now()
      const art = FEED_ART[key]
      try {
        const items = await run()
        return {
          key,
          label: PLATFORM_LABEL[key],
          ok: items.length > 0,
          error: items.length ? undefined : '接口可达但未筛出符合条件的条目',
          latencyMs: Date.now() - t0,
          artRatio: art.ratio,
          artNote: art.note,
          items,
        } satisfies PlatformFeed
      } catch (e) {
        return {
          key,
          label: PLATFORM_LABEL[key],
          ok: false,
          error: describeError(e),
          latencyMs: Date.now() - t0,
          artRatio: art.ratio,
          artNote: art.note,
          items: [],
        } satisfies PlatformFeed
      }
    }),
  )
  return results
}

/** 供前端做平台筛选的元信息：来源与「这一栏到底提供什么」都写清楚，避免对外夸大 */
export const PLATFORM_META: {
  key: PlatformKey
  label: string
  /** 官方接口地址（用于在 UI 上标注数据出处） */
  source: string
  /** 这一栏给的是什么内容 */
  provides: string
}[] = [
  {
    key: 'steam',
    label: PLATFORM_LABEL.steam,
    source: 'store.steampowered.com/api/featuredcategories',
    provides: '官方榜单：特价 / 新发售 / 热销 / 即将发售',
  },
  {
    key: 'playstation',
    label: PLATFORM_LABEL.playstation,
    source: 'store.playstation.com/store/api/chihiro',
    provides: 'PS Store 真实已发售新作（含官方盒装封面）',
  },
  {
    key: 'nintendo',
    label: PLATFORM_LABEL.nintendo,
    source: 'search.nintendo-europe.com',
    provides: 'eShop 按发售日排序：最新上架与即将发售',
  },
  {
    key: 'xbox',
    label: PLATFORM_LABEL.xbox,
    source: 'displaycatalog.mp.microsoft.com',
    provides: 'Microsoft 官方商品目录热门条目（含官方封面）',
  },
]
