/**
 * 联网检索层（Steam 公开接口，全部免密钥）
 *
 * 数据源（网页版商店背后就是这几个接口，无需申请、无需 key）：
 *   1. store.steampowered.com/api/storesearch  —— 按名字搜游戏（支持中文）→ 解析 appid
 *   2. api.steampowered.com/ISteamNews/GetNewsForApp/v2 —— 某款游戏的官方新闻与媒体资讯
 *   3. store.steampowered.com/api/featuredcategories   —— 全局特价 / 最新发售 / 即将发售 / 热销
 *
 * 设计原则（沿用本项目防幻觉哲学）：
 *   - 本地只负责「取回真实条目」，标题 / 日期 / 链接 / 来源 全部来自接口原文，
 *     交给 LLM 的只有这些真实条目，模型不接触链接，因此结构上不可能编造出处。
 *   - 每一个请求都是短超时 + 失败即空（绝不抛），并如实回报 reachable，
 *     让前端可以诚实标注「当前离线」而不是假装联网成功。
 */

import { env } from '../env.ts'
import { catalog } from '../data/catalog.ts'
import type { CatalogGame } from '../types.ts'
import { hasSearchProvider, searchWeb } from './searchProviders.ts'

// ───────────────────────── 类型 ─────────────────────────

export type WebItemKind = 'news' | 'web' | 'deal' | 'release' | 'upcoming' | 'top' | 'related'

export interface WebSourceItem {
  /** 稳定 id，便于前端 key 与去重 */
  id: string
  /** 真实标题（来自接口原文） */
  title: string
  /** 真实链接（来自接口原文，模型不参与生成） */
  url: string
  /** 发布时间（毫秒时间戳；拿不到为 null） */
  date: number | null
  /** 来源标签，如「Steam 社区公告」「Rock, Paper, Shotgun」 */
  source: string
  kind: WebItemKind
  /** 纯文本摘要（已去 HTML，截断） */
  summary: string
  /** 关联的 Steam 应用 id（游戏资讯时为数字） */
  appid?: number
  /** 关联游戏名 */
  gameName?: string
  /** 折扣百分比（仅特价条目） */
  discount?: number
}

export interface WebSearchResult {
  /** 本次是否真的从外网取到了数据 */
  reachable: boolean
  /** 检索范围：game = 指定游戏资讯；global = 全局新游/特价 */
  scope: 'game' | 'global' | 'none'
  /** 实际使用的检索词（如「艾尔登法环」） */
  term: string | null
  /** 解析到的游戏（若有） */
  game: { appid: number; name: string } | null
  items: WebSourceItem[]
  /** 命中的「口味 → 相关游戏」在站内目录里的 id（供前端连带展示游戏卡片） */
  relatedIds?: string[]
  /** 本次全网搜索使用的 provider（serper / tavily）；未使用为 null */
  provider?: string | null
  /** 诊断信息（超时、失败原因等），供排查，不展示为主内容 */
  notes: string[]
}

// ───────────────────────── 缓存 ─────────────────────────

const TTL = 10 * 60 * 1000 // 10 分钟
const cache = new Map<string, { data: unknown; until: number }>()

function getCached<T>(key: string): T | null {
  const hit = cache.get(key)
  if (hit && Date.now() < hit.until) return hit.data as T
  cache.delete(key)
  return null
}

function setCached(key: string, data: unknown, ttl = TTL): void {
  cache.set(key, { data, until: Date.now() + ttl })
}

// ───────────────────────── 基础工具 ─────────────────────────

// stripHtml / clip 已抽到 textUtil.ts（与 searchProviders.ts 共用）
// stripHtml 继续对外导出，保持既有调用方（验证脚本）不变。
import { stripHtml, clip } from './textUtil.ts'

export { stripHtml }

interface FetchOpts {
  timeoutMs?: number
  /** 失败重试次数（仅网络层失败才有意义；请求均为幂等 GET，重试安全） */
  retries?: number
}

/** 统一的外网 JSON 请求：带超时、带 UA、可重试，失败抛出（由上层决定是否降级） */
async function fetchJson<T>(url: string, opts: FetchOpts = {}): Promise<T> {
  const { timeoutMs = 8000, retries = 0 } = opts
  let lastErr: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'GameVibe/1.0 (+https://gamevibe.app.workbuddy.host)' },
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()) as T
    } catch (e) {
      lastErr = e
      if (attempt < retries) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
    }
  }
  throw lastErr
}

/**
 * 站内目录 → Steam 官方英文名。
 * 为什么需要：Steam 商店搜索对中文关键词基本不命中（实测「空洞骑士」搜不到，而「Hollow Knight」能命中），
 * 站内目录只有 17 款精选，直接内置映射比每轮都调一次 LLM 做名字规范化更稳、更快，且完全确定。
 */
const STEAM_EN_NAME: Record<string, string> = {
  'elden-ring': 'Elden Ring',
  'baldurs-gate-3': "Baldur's Gate 3",
  'hades-2': 'Hades II',
  palworld: 'Palworld',
  'cyberpunk-2077': 'Cyberpunk 2077',
  'stardew-valley': 'Stardew Valley',
  'lies-of-p': 'Lies of P',
  valorant: 'VALORANT',
  'dead-cells': 'Dead Cells',
  'hollow-knight': 'Hollow Knight',
  cs2: 'Counter-Strike 2',
  'dave-the-diver': 'Dave the Diver',
  'disco-elysium': 'Disco Elysium',
  'monster-hunter-wilds': 'Monster Hunter Wilds',
  'vampire-survivors': 'Vampire Survivors',
  'god-of-war': 'God of War',
}

// ───────────────────────── 1. 按名字搜游戏 ─────────────────────────

interface StoreSearchItem {
  type: string
  name: string
  id: number
  price?: { currency: string; initial: number; final: number }
  tiny_image?: string
  metascore?: string
}

export interface StoreAppHit {
  appid: number
  name: string
  price: { currency: string; initial: number; final: number } | null
  coverUrl: string
  metascore: number | null
}

/** 用 Steam 商店搜索把「游戏名」解析成 appid（中文/英文均可） */
export async function searchSteamApp(term: string): Promise<StoreAppHit | null> {
  const q = term.trim()
  if (!q) return null
  const key = `store:${q.toLowerCase()}`
  const cached = getCached<StoreAppHit | null>(key)
  if (cached !== null) return cached

  try {
    const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(q)}&l=schinese&cc=cn`
    const data = await fetchJson<{ total: number; items: StoreSearchItem[] }>(url, { timeoutMs: 6000 })
    const app = (data.items || []).find((i) => (i.type ? i.type === 'app' : true) && typeof i.id === 'number')
    if (!app) {
      setCached(key, null)
      return null
    }
    const hit: StoreAppHit = {
      appid: app.id,
      name: app.name,
      price: app.price ?? null,
      coverUrl: app.tiny_image || '',
      metascore: app.metascore ? Number(app.metascore) || null : null,
    }
    setCached(key, hit, 30 * 60 * 1000)
    return hit
  } catch {
    return null
  }
}

/**
 * 把中文游戏名规范化成 Steam 上的官方英文名（用于检索）。
 *
 * 为什么需要：Steam 商店搜索对中文关键词基本不命中（实测「艾尔登法环」返回 0，
 * 而「elden」能命中 ELDEN RING），但英文关键词能正常返回本地化游戏名。
 *
 * 安全边界：这一步只产出「检索词」，最终是否命中、命中的是哪款游戏，完全由 Steam
 * 真实解析决定（resolveApp）。模型即使给出不存在的名字，也只是查不到，不会产生假数据。
 */
const nameNormCache = new Map<string, string | null>()

async function normalizeGameName(term: string): Promise<string | null> {
  const key = term.trim().toLowerCase()
  if (nameNormCache.has(key)) return nameNormCache.get(key) ?? null
  if (!(env.DEEPSEEK_API_KEY || env.AI_API_KEY)) return null

  const useDeepSeek = Boolean(env.DEEPSEEK_API_KEY)
  const baseUrl = useDeepSeek ? env.DEEPSEEK_BASE_URL : env.AI_BASE_URL
  const apiKey = useDeepSeek ? env.DEEPSEEK_API_KEY : env.AI_API_KEY
  const model = useDeepSeek ? env.DEEPSEEK_MODEL : env.AI_MODEL

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content:
              '你的任务：把用户给出的游戏名转换成它在 Steam 商店上的官方英文原名。只输出这个英文名本身（不要书名号、不要解释、不要标点）。如果你无法确定，只输出 NONE。',
          },
          { role: 'user', content: term },
        ],
        temperature: 0,
      }),
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    const out = (data.choices?.[0]?.message?.content ?? '').trim().replace(/^[《"'“”\s]+|[》"'“”\s]+$/g, '')
    const value = !out || /^NONE$/i.test(out) ? null : out.slice(0, 60)
    nameNormCache.set(key, value)
    return value
  } catch {
    nameNormCache.set(key, null)
    return null
  }
}

/** 解析游戏名 → appid：先直接搜；中文名搜不到时，用官方英文名再搜一次 */
export async function resolveApp(
  term: string,
): Promise<{ hit: StoreAppHit; via: 'direct' | 'english-name'; englishTerm?: string } | null> {
  const direct = await searchSteamApp(term)
  if (direct) return { hit: direct, via: 'direct' }

  if (/[\u4e00-\u9fa5]/.test(term)) {
    const en = await normalizeGameName(term)
    if (en && en.toLowerCase() !== term.toLowerCase()) {
      const hit = await searchSteamApp(en)
      if (hit) return { hit, via: 'english-name', englishTerm: en }
    }
  }
  return null
}

// ───────────────────────── 2. 某款游戏的新闻 / 公告 ─────────────────────────
interface SteamNewsItem {
  gid: number
  title: string
  url: string
  is_external: boolean
  feedlabel: string
  date: number // unix 秒
  contents: string
  feedname?: string
  author?: string
}

/** 取某款 Steam 游戏的最新官方新闻与媒体资讯（真实条目，含标题/日期/链接） */
export async function getAppNews(appid: number, count = 6): Promise<WebSourceItem[]> {
  const key = `appnews:${appid}:${count}`
  const cached = getCached<WebSourceItem[]>(key)
  if (cached) return cached

  const url =
    `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${appid}` +
    `&count=${count}&maxlength=400&format=json`
  const data = await fetchJson<{ appnews?: { newsitems?: SteamNewsItem[] } }>(url, { timeoutMs: 6000 })
  const raw = data.appnews?.newsitems || []

  const items: WebSourceItem[] = raw
    .filter((n) => n && n.title && n.url)
    .map((n) => ({
      id: `steamnews_${n.gid}`,
      title: stripHtml(n.title),
      url: n.url,
      date: n.date ? n.date * 1000 : null,
      source: n.feedlabel || n.feedname || 'Steam 资讯',
      kind: 'news' as const,
      summary: clip(stripHtml(n.contents || '')),
      appid,
    }))

  setCached(key, items)
  return items
}

// ───────────────────────── 3. 全局：特价 / 最新发售 / 即将发售 / 热销 ─────────────────────────

interface FeaturedApp {
  id: number
  type: number
  name: string
  header_image?: string
  large_capsule_image?: string
  discount_percent?: number
  final_price?: number
  original_price?: number
}

interface FeaturedResponse {
  specials?: { items?: FeaturedApp[] }
  new_releases?: { items?: FeaturedApp[] }
  coming_soon?: { items?: FeaturedApp[] }
  top_sellers?: { items?: FeaturedApp[] }
}

const FEATURED_URL = 'https://store.steampowered.com/api/featuredcategories?l=schinese&cc=cn'

function toItem(app: FeaturedApp, kind: WebItemKind): WebSourceItem {
  const disc = app.discount_percent && app.discount_percent > 0 ? app.discount_percent : undefined
  return {
    id: `steamfeat_${kind}_${app.id}`,
    title: app.name,
    url: `https://store.steampowered.com/app/${app.id}`,
    date: null,
    source: kind === 'deal' ? 'Steam 特价' : kind === 'release' ? 'Steam 最新发售' : kind === 'upcoming' ? 'Steam 即将发售' : 'Steam 热销榜',
    kind,
    summary: disc ? `当前折扣 -${disc}%` : 'Steam 商店在售',
    appid: app.id,
    discount: disc,
  }
}

/** 取全局商店动态（特价 / 最新发售 / 即将发售 / 热销），合并为一个条目数组 */
export async function getFeatured(perCategory = 6): Promise<WebSourceItem[]> {
  const key = `featured:${perCategory}`
  const cached = getCached<WebSourceItem[]>(key)
  if (cached) return cached

  // 商店动态是线上唯一稳定的数据源（store.steampowered.com 在沙箱时通时不通），
  // 给它一次重试以提高命中率；超时压到 6s 避免拖长整体响应。
  const data = await fetchJson<FeaturedResponse>(FEATURED_URL, { timeoutMs: 6000, retries: 1 })
  const take = (arr: FeaturedApp[] | undefined, kind: WebItemKind) =>
    (arr || []).filter((a) => a && a.name && typeof a.id === 'number').slice(0, perCategory).map((a) => toItem(a, kind))

  const items: WebSourceItem[] = [
    ...take(data.specials?.items, 'deal'),
    ...take(data.new_releases?.items, 'release'),
    ...take(data.coming_soon?.items, 'upcoming'),
    ...take(data.top_sellers?.items, 'top'),
  ]
  setCached(key, items)
  return items
}

// ───────────────────────── 3b. 商店真实计数（供 /api/live 用真实数据替换模拟值） ─────────────────────────

export interface StoreCounts {
  /** 当前特价条目数 */
  specials: number
  /** 最新发售条目数 */
  newReleases: number
  /** 即将发售条目数 */
  comingSoon: number
  /** 热销榜条目数 */
  topSellers: number
}

/** 取商店各板块的真实条目数（store.steampowered.com，线上沙箱也通）；失败返回 null */
export async function getStoreCounts(): Promise<StoreCounts | null> {
  const key = 'storecounts'
  const cached = getCached<StoreCounts>(key)
  if (cached) return cached

  try {
    const data = await fetchJson<FeaturedResponse>(FEATURED_URL, { timeoutMs: 6000, retries: 1 })
    const counts: StoreCounts = {
      specials: data.specials?.items?.length || 0,
      newReleases: data.new_releases?.items?.length || 0,
      comingSoon: data.coming_soon?.items?.length || 0,
      topSellers: data.top_sellers?.items?.length || 0,
    }
    if (!counts.specials && !counts.newReleases && !counts.comingSoon && !counts.topSellers) return null
    setCached(key, counts)
    return counts
  } catch {
    return null
  }
}

// ───────────────────────── 4. 口味 → 相关游戏（轻量相关性） ─────────────────────────

/** 全局商店动态每类取几条（四类各 N，共 4N） */
export const GLOBAL_PER_CATEGORY = 5
/** 口味相关性最多补几款相关游戏 */
const RELATED_LIMIT = 5

/**
 * 口味 / 类型关键词表。
 * 命中后从站内 17 款精选里挑出标签对得上的代表游戏，再取这些游戏的**真实 Steam 动态**。
 * 说明：Steam 免密钥公开接口只支持「按名字搜」，不支持按标签搜，所以相关性这层只能靠站内目录先映射，
 * 这是本方案能做到的最准的形态（详见 docs/AI-UPGRADE-PLAN.md 第 17 节）。
 */
const TASTE_RULES: { label: string; re: RegExp; match: string[] }[] = [
  { label: '像素风', re: /像素|pixel/i, match: ['像素风'] },
  { label: '独立', re: /独立|indie/i, match: ['独立'] },
  { label: 'Roguelike', re: /roguelike|肉鸽|rogue/i, match: ['Roguelike', '肉鸽'] },
  { label: '魂类', re: /魂类|魂系|魂like|soulslike/i, match: ['魂类', '魂like'] },
  { label: '银河城', re: /银河城|恶魔城|metroidvania/i, match: ['银河城'] },
  { label: '射击', re: /射击|fps|打枪/i, match: ['射击', 'FPS'] },
  { label: '开放世界', re: /开放世界|open\s?world/i, match: ['开放世界'] },
  { label: '生存建造', re: /生存|建造|沙盒|sandbox/i, match: ['生存', '沙盒', '生存建造'] },
  { label: '模拟经营', re: /模拟|经营|养成|农场|种田/i, match: ['模拟', '农场', '经营'] },
  { label: '动作', re: /动作|爽快/i, match: ['动作'] },
  { label: '角色扮演', re: /rpg|角色扮演|角色养成|跑团/i, match: ['RPG', '角色养成'] },
  { label: '策略', re: /策略|回合制|战棋/i, match: ['策略', '回合制'] },
  { label: '多人联机', re: /多人|联机|合作|co-?op|开黑/i, match: ['多人'] },
  { label: '剧情', re: /剧情|叙事|故事/i, match: ['剧情丰富', '剧情驱动'] },
  { label: '休闲治愈', re: /休闲|摸鱼|放松|治愈/i, match: ['休闲', '治愈'] },
]

/** 从用户话里识别口味 / 类型标签（返回规范化标签，如 ['像素风','独立']） */
export function detectTasteLabels(message: string): string[] {
  const msg = message || ''
  return TASTE_RULES.filter((r) => r.re.test(msg)).map((r) => r.label)
}

/** 按口味标签从站内目录挑代表游戏：命中标签数优先，其次按评分排序 */
function findRelatedCatalogGames(labels: string[], limit = RELATED_LIMIT): CatalogGame[] {
  if (!labels.length) return []
  const wanted = new Set<string>()
  for (const rule of TASTE_RULES) {
    if (labels.includes(rule.label)) for (const m of rule.match) wanted.add(m)
  }
  if (!wanted.size) return []
  const tokens = [...wanted]
  return catalog
    .map((g) => {
      const fields = [...g.tags, ...g.genres]
      const hits = fields.filter((f) => tokens.some((t) => f === t || f.includes(t) || t.includes(f))).length
      return { g, hits }
    })
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits || b.g.rating - a.g.rating)
    .slice(0, limit)
    .map((x) => x.g)
}

/** Steam 以「分」为单位返回价格 */
function fmtStorePrice(p: StoreAppHit['price']): string {
  if (!p) return ''
  if (!p.final) return '免费'
  return `¥${(p.final / 100).toFixed(2)}`
}

/**
 * 轻量相关性：把口味映射到站内代表游戏，再逐款取真实 Steam 条目。
 * 首选该游戏的最新官方新闻（api.steampowered.com）；取不到就退回它的 Steam 商店页（含现价）。
 * 无论走哪条路，标题 / 链接 / 来源都来自接口原文，模型不参与生成。
 */
export async function getRelatedGameSources(games: CatalogGame[]): Promise<WebSourceItem[]> {
  const results = await Promise.all(
    games.map(async (g): Promise<WebSourceItem | null> => {
      const en = STEAM_EN_NAME[g.id]
      const hit = (en ? await searchSteamApp(en) : null) ?? (await searchSteamApp(g.name))
      if (!hit) return null
      const name = hit.name || g.name
      // 先试真实新闻（本地可达；线上 api.steampowered.com 多半不通 → 自动退回商店页）
      try {
        const news = await getAppNews(hit.appid, 1)
        if (news.length) return { ...news[0], kind: 'related', gameName: name }
      } catch {
        /* 新闻接口不可用，退回商店页 */
      }
      return {
        id: `related_${hit.appid}`,
        title: name,
        url: `https://store.steampowered.com/app/${hit.appid}`,
        date: null,
        source: 'Steam 商店 · 相关',
        kind: 'related',
        summary: fmtStorePrice(hit.price) || (hit.metascore ? `Metacritic ${hit.metascore}` : 'Steam 商店在售'),
        appid: hit.appid,
        gameName: name,
      }
    }),
  )
  return results.filter((x): x is WebSourceItem => Boolean(x))
}

/** 多组条目按「链接（缺失则 id）」去重合并，保持前面的优先 */
function mergeDedupe(...groups: WebSourceItem[][]): WebSourceItem[] {
  const seen = new Set<string>()
  const out: WebSourceItem[] = []
  for (const group of groups) {
    for (const it of group) {
      const key = it.url || it.id
      if (seen.has(key)) continue
      seen.add(key)
      out.push(it)
    }
  }
  return out
}

/** 稳定字符串哈希（仅用于生成条目的稳定 id，避免数组下标变化导致前端 key 漂移） */
function hashStr(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h | 0
}

// ───────────────────────── 意图识别 ─────────────────────────

/** 全局动态类词（不需要指定游戏） */
const GLOBAL_WORDS = /(新游戏|新游|新作|上新|发售|发布|即将上线|即将|预售|特价|打折|促销|优惠|折扣|热销|排行|销量|口碑榜)/
/** 指定游戏资讯类词 */
const GAME_NEWS_WORDS = /(新闻|资讯|消息|动态|公告|更新|补丁|版本|活动|联动|赛季|dlc)/i
/** 泛「最新」诉求 */
const FRESH_WORDS = /(最新|最近|近期|有什么新)/

const STOPWORDS = [
  '我想要', '我想', '帮我', '请问', '给我', '麻烦', '看看', '查一下', '搜一下', '有没有', '推荐',
  '一下', '怎么样', '如何', '什么', '哪些', '这周', '本周', '今天', '昨天', '最近', '最新', '近期',
  '的', '了', '吗', '呢', '啊', '和', '与', '跟', '我', '你', '他', '她', '在', '有', '是', '都',
  '游戏', '新闻', '资讯', '消息', '动态', '更新', '公告', '特价', '打折', '促销', '优惠', '攻略',
]

const INTENT_WORDS = [
  '新闻', '资讯', '消息', '动态', '公告', '更新', '补丁', '版本', '活动', '联动', '赛季', 'dlc',
  '最新', '最近', '近期', '新游戏', '新游', '新作', '发售', '即将', '预售', '特价', '打折', '促销',
  '优惠', '折扣', '热销', '排行',
]

export interface WebIntent {
  /** 是否需要联网检索 */
  want: boolean
  /** game = 针对某款游戏；global = 全局新游动态 */
  scope: 'game' | 'global' | 'none'
  /** 从话里抽出的检索词（游戏名候选） */
  term: string | null
}

/** 从用户话里剥离意图词与虚词，得到「游戏名」候选检索词 */
export function extractTerm(message: string): string | null {
  let s = ` ${message} `
  s = s.replace(/[，。！？、,.!?;；:：""''（）()《》【】\s]+/g, ' ')
  for (const w of INTENT_WORDS) s = s.split(w).join(' ')
  for (const w of STOPWORDS) s = s.split(w).join(' ')
  const t = s.replace(/\s+/g, ' ').trim()
  // 太短的当作没抽到（避免「什么」「好玩」这类噪声去搜商店）
  if (t.length < 2) return null
  if (!/[\u4e00-\u9fa5a-zA-Z0-9]/.test(t)) return null
  return t.length > 40 ? t.slice(0, 40) : t
}

/**
 * 判断一条用户消息是否需要联网检索。
 * 规则优先（确定性），front-end 的强制开关会绕过本函数。
 */
export function detectWebIntent(message: string): WebIntent {
  const msg = (message || '').trim()
  if (!msg) return { want: false, scope: 'none', term: null }

  const hasGlobal = GLOBAL_WORDS.test(msg)
  const hasGameNews = GAME_NEWS_WORDS.test(msg)
  const hasFresh = FRESH_WORDS.test(msg)
  const term = extractTerm(msg)

  if (!hasGlobal && !hasGameNews && !hasFresh) return { want: false, scope: 'none', term: null }

  // 有明确游戏名候选 → 走「指定游戏资讯」
  if (term && (hasGameNews || hasFresh) && !/^(新游戏|新游|新作)$/.test(term)) {
    return { want: true, scope: 'game', term }
  }
  return { want: true, scope: 'global', term: null }
}

// ───────────────────────── 主入口 ─────────────────────────

export interface RunWebSearchInput {
  message: string
  /** 强制模式：'on' 时即使意图不明显也联网；'off' 时完全不联网 */
  force?: 'on' | 'off' | 'auto'
}

/**
 * 执行一次联网检索。永不抛异常；取不到就返回 reachable=false 与空 items。
 */
export async function runWebSearch(input: RunWebSearchInput): Promise<WebSearchResult> {
  const force = input.force ?? 'auto'
  const notes: string[] = []
  const intent = detectWebIntent(input.message)

  if (force === 'off') {
    return { reachable: false, scope: 'none', term: null, game: null, items: [], notes: ['联网检索已关闭'] }
  }

  const wantWeb = force === 'on' || intent.want
  if (!wantWeb) {
    return { reachable: false, scope: 'none', term: null, game: null, items: [], notes: [] }
  }

  // 口味 / 类型词（如「像素风」「独立」）→ 用于补「相关游戏」条目
  const tasteLabels = detectTasteLabels(input.message)

  // 判定检索范围：
  //   1) 意图识别到指定游戏 → game
  //   2) 命中口味词 → global（给「相关游戏 + 全局动态」，不再拿噪声词去空搜游戏）
  //   3) 强制联网且既无意图也无口味（如只打了一个游戏名）→ game，按名字解析
  const scope: 'game' | 'global' =
    intent.scope !== 'none'
      ? intent.scope
      : force === 'on' && !tasteLabels.length
        ? 'game'
        : 'global'

  let game: { appid: number; name: string } | null = null
  let items: WebSourceItem[] = []
  let term = intent.term
  let relatedIds: string[] = []
  let providerName: string | null = null

  // 强制联网但没抽到词 → 兜底用整句去搜商店
  if (scope === 'game' && !term && force === 'on') term = extractTerm(input.message) || input.message.trim().slice(0, 30)

  if (scope === 'game' && term) {
    const resolved = await resolveApp(term)
    if (resolved) {
      const hit = resolved.hit
      if (resolved.via === 'english-name') {
        notes.push(`中文名未能直接检索，已改用官方英文名「${resolved.englishTerm}」检索`)
      }
      game = { appid: hit.appid, name: hit.name }
      try {
        const news = await getAppNews(hit.appid, 6)
        if (news.length) {
          items = news.map((n) => ({ ...n, gameName: hit.name }))
        } else {
          notes.push(`《${hit.name}》暂无官方新闻条目`)
        }
      } catch (e) {
        notes.push(`Steam 新闻接口失败：${e instanceof Error ? e.message : String(e)}`)
      }
    } else {
      notes.push(`商店没搜到「${term}」对应的游戏，已改为展示商店全局动态`)
    }
  }

  // 全网实时资讯（第三方 provider：Serper 优先 → Tavily）：
  // 真实标题 / 链接 / 日期 / 来源全部取接口原文，模型不参与；失败则回退 Steam 商店动态。
  // 纯口味提问（如「我喜欢像素风」）不搜全网，避免拿噪声句去搜出无关结果。
  const skipProvider = tasteLabels.length > 0 && intent.scope === 'none'
  if (hasSearchProvider() && !skipProvider) {
    const query = scope === 'game' && game ? `${game.name} 最新消息` : input.message.trim() || '最新游戏资讯'
    const pr = await searchWeb(query, { max: 10 })
    if (pr) {
      if (pr.items.length) {
        providerName = pr.provider
        const webItems: WebSourceItem[] = pr.items.map((it, i) => ({
          id: `web_${pr.provider}_${i}_${Math.abs(hashStr(it.url))}`,
          title: it.title,
          url: it.url,
          date: it.date,
          source: it.source,
          kind: 'web' as const,
          summary: it.summary,
        }))
        items = mergeDedupe(webItems, items)
        notes.push(`全网搜索（${pr.provider}）取回 ${webItems.length} 条实时资讯`)
      } else if (pr.note) {
        notes.push(`全网搜索不可用（${pr.note}）`)
      }
    }
  }

  // 全局商店动态：走了 global 分支，或指定游戏资讯太薄（<3 条）时补齐，保证四类齐全
  if (scope === 'global' || items.length < 3) {
    try {
      const feat = await getFeatured(GLOBAL_PER_CATEGORY)
      if (feat.length) {
        items = mergeDedupe(items, feat)
        notes.push(scope === 'global' ? `已取回 ${feat.length} 条商店动态` : '已追加全局商店动态作为补充')
      }
    } catch (e) {
      notes.push(`Steam 商店动态失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // 口味相关性：把口味映射到站内代表游戏，取其真实动态放到最前
  if (tasteLabels.length) {
    const games = findRelatedCatalogGames(tasteLabels)
    if (games.length) {
      try {
        const related = await getRelatedGameSources(games)
        if (related.length) {
          items = mergeDedupe(related, items)
          relatedIds = games.map((g) => g.id)
          notes.push(`按口味「${tasteLabels.join('、')}」匹配到 ${related.length} 条相关游戏动态`)
        }
      } catch (e) {
        notes.push(`相关游戏检索失败：${e instanceof Error ? e.message : String(e)}`)
      }
    } else {
      notes.push(`口味「${tasteLabels.join('、')}」在站内目录暂无对应游戏`)
    }
  }

  return {
    reachable: items.length > 0,
    scope,
    term: term ?? null,
    game,
    items,
    relatedIds,
    provider: providerName,
    notes,
  }
}

/** 供诊断端点复用：直接探测 Steam 三个接口的可达性 */
export async function probeSteam(): Promise<{ ok: boolean; ms: number; detail: string }> {
  const t0 = Date.now()
  try {
    const data = await fetchJson<FeaturedResponse>(FEATURED_URL, { timeoutMs: 8000 })
    const n = (data.specials?.items?.length || 0) + (data.new_releases?.items?.length || 0)
    return { ok: n > 0, ms: Date.now() - t0, detail: `featuredcategories 返回 ${n} 条` }
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, detail: e instanceof Error ? e.message : String(e) }
  }
}
