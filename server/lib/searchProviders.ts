/**
 * 第三方全网搜索 provider 层（Serper / Tavily，可插拔）
 *
 * 目的：让 AI 助手能检索 Steam 之外的全网实时资讯（媒体评测、行业新闻、厂商公告等）。
 *
 * 设计原则（沿用本项目防幻觉哲学）：
 *   - 本地只负责「取回真实条目」：标题 / 链接 / 日期 / 来源 / 摘要全部来自接口原文；
 *     交给 LLM 的只有这些真实条目，模型不接触链接，因此结构上不可能编造出处。
 *   - Serper 优先（免费额度更大、返回 Google 原始结果、有专门 news 频道）；
 *     Tavily 备选（AI 专用搜索，返回已提炼文本）。两家任一可用即可；都不可用则返回 null，
 *     由调用方回退到 Steam 商店动态，绝不硬装成功。
 *
 * ⚠️ 环境约束：线上沙箱为白名单出网（仅 store.steampowered.com / baidu 可达），
 *   这两个境外域名线上大概率不可达 → 自动回退 Steam，并如实回报 note。
 */

import { env } from '../env.ts'
import { stripHtml, clip } from './textUtil.ts'

export type SearchProviderName = 'serper' | 'tavily'

export interface ProviderItem {
  title: string
  url: string
  /** 发布时间（毫秒时间戳；拿不到为 null） */
  date: number | null
  /** 来源媒体名，如「游民星空」 */
  source: string
  /** 纯文本摘要（已去 HTML，截断） */
  summary: string
}

export interface ProviderResult {
  provider: SearchProviderName
  items: ProviderItem[]
  /** 失败/降级说明，供诊断 */
  note?: string
}

const REQUEST_TIMEOUT = 12000

/** 是否有任一 provider 可用（仅判断是否配置了 key） */
export function hasSearchProvider(): boolean {
  return Boolean(env.SERPER_API_KEY || env.TAVILY_API_KEY)
}

/** 从 URL 取主机名作为来源标签 */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return '全网搜索'
  }
}

/**
 * 把相对时间文案转成时间戳。
 * Serper 的 news 返回形如 "5 days ago" / "2 hours ago"，Google 有时也给 ISO 日期。
 * 解析不出就返回 null —— 宁可没有日期，也不编一个。
 */
export function parsePublishDate(raw?: string): number | null {
  if (!raw) return null
  const s = raw.trim()
  if (/\d{4}-\d{2}-\d{2}/.test(s)) {
    const t = Date.parse(s)
    if (!Number.isNaN(t)) return t
  }
  const m = s.match(/(\d+)\s*(minute|hour|day|week|month|year)/i)
  if (m) {
    const n = Number(m[1])
    const unit = m[2].toLowerCase()
    const factor: Record<string, number> = {
      minute: 60_000,
      hour: 3_600_000,
      day: 86_400_000,
      week: 604_800_000,
      month: 2_592_000_000,
      year: 31_536_000_000,
    }
    const ms = factor[unit]
    if (ms) return Date.now() - n * ms
  }
  return null
}

interface SerperNewsItem {
  title?: string
  link?: string
  snippet?: string
  date?: string
  source?: string
}

async function searchSerper(query: string, max: number): Promise<ProviderItem[]> {
  const res = await fetch('https://google.serper.dev/news', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-KEY': env.SERPER_API_KEY },
    body: JSON.stringify({ q: query, num: max, gl: 'cn', hl: 'zh-cn' }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = (await res.json()) as { news?: SerperNewsItem[] }
  return (data.news || [])
    .filter((n) => n.title && n.link)
    .slice(0, max)
    .map((n) => ({
      title: stripHtml(n.title as string),
      url: n.link as string,
      date: parsePublishDate(n.date),
      source: n.source || hostOf(n.link as string),
      summary: clip(stripHtml(n.snippet || '')),
    }))
}

interface TavilyResultItem {
  title?: string
  url?: string
  content?: string
  published_date?: string
}

async function searchTavily(query: string, max: number): Promise<ProviderItem[]> {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.TAVILY_API_KEY}` },
    body: JSON.stringify({ query, max_results: max, search_depth: 'basic', topic: 'news' }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT + 4000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = (await res.json()) as { results?: TavilyResultItem[] }
  return (data.results || [])
    .filter((r) => r.url)
    .slice(0, max)
    .map((r) => ({
      title: stripHtml(r.title || (r.url as string)),
      url: r.url as string,
      date: parsePublishDate(r.published_date),
      source: hostOf(r.url as string),
      summary: clip(stripHtml(r.content || '')),
    }))
}

/**
 * 全网搜索：按 Serper → Tavily 顺序尝试，返回首个有结果的 provider。
 * 永不抛异常；两个都不可用时返回 items=[] 并带 note（由调用方决定回退）。
 */
export async function searchWeb(query: string, opts: { max?: number } = {}): Promise<ProviderResult | null> {
  const max = opts.max ?? 10
  const q = (query || '').trim()
  if (!q) return null

  const order: SearchProviderName[] = []
  if (env.SERPER_API_KEY) order.push('serper')
  if (env.TAVILY_API_KEY) order.push('tavily')
  if (!order.length) return null

  const notes: string[] = []
  for (const provider of order) {
    try {
      const items = provider === 'serper' ? await searchSerper(q, max) : await searchTavily(q, max)
      if (items.length) return { provider, items, note: notes.join('; ') || undefined }
      notes.push(`${provider} 返回 0 条`)
    } catch (e) {
      notes.push(`${provider} 失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return { provider: order[0], items: [], note: notes.join('; ') }
}

/** 供诊断端点复用：逐个探测 provider 可达性（不抛异常） */
export async function probeProviders(): Promise<{ name: string; ok: boolean; ms: number; detail: string }[]> {
  const out: { name: string; ok: boolean; ms: number; detail: string }[] = []
  if (env.SERPER_API_KEY) {
    const t0 = Date.now()
    try {
      const items = await searchSerper('游戏', 1)
      out.push({ name: 'serper', ok: items.length > 0, ms: Date.now() - t0, detail: `返回 ${items.length} 条` })
    } catch (e) {
      out.push({ name: 'serper', ok: false, ms: Date.now() - t0, detail: e instanceof Error ? e.message : String(e) })
    }
  } else {
    out.push({ name: 'serper', ok: false, ms: 0, detail: '未配置 SERPER_API_KEY' })
  }
  if (env.TAVILY_API_KEY) {
    const t0 = Date.now()
    try {
      const items = await searchTavily('游戏', 1)
      out.push({ name: 'tavily', ok: items.length > 0, ms: Date.now() - t0, detail: `返回 ${items.length} 条` })
    } catch (e) {
      out.push({ name: 'tavily', ok: false, ms: Date.now() - t0, detail: e instanceof Error ? e.message : String(e) })
    }
  } else {
    out.push({ name: 'tavily', ok: false, ms: 0, detail: '未配置 TAVILY_API_KEY' })
  }
  return out
}
