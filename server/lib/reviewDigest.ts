import { env } from '../env.ts'
import { db } from '../db/index.ts'
import { catalog } from '../data/catalog.ts'

/**
 * 口碑归纳（Step D）
 *
 * 设计要点——**防编造引用**：
 * 送给模型的评论一律带序号，模型只允许回传序号（quotes:[0,2]），
 * 归纳文案（theme/summary）与引用原文在本地分别回填：
 *   - 引用原文 **从库里按序号取**，模型碰不到引文内容，结构上不可能编造；
 *   - theme/summary 仅做长度与去空校验，不参与事实性陈述（前端标注「AI 归纳」）。
 * 评论数不足 / 无 key / 调用失败 → 走确定性兜底（评分分布 + 高分与低分原生引用），
 * 依然只展示真实评论原文，且如实标注「暂未生成主题归纳」。
 */

const CATALOG_INDEX = new Map(catalog.map((g) => [g.id, g]))
const MIN_REVIEWS_FOR_THEMES = 3
const TTL = 30 * 60 * 1000

interface RawReview {
  display_name: string | null
  username: string | null
  rating: number | null
  content: string
}

export interface DigestQuote {
  author: string
  rating: number | null
  text: string
}

export interface DigestTheme {
  theme: string
  summary: string
  quotes: DigestQuote[]
}

export interface ReviewDigestResult {
  ok: true
  aiPowered: boolean
  gameId: string
  name: string
  count: number
  average: number
  distribution: { stars: number; count: number }[]
  consensus: DigestTheme[]
  divergence: DigestTheme[]
  note?: string
  updatedAt: number
}

const cache = new Map<string, { until: number; data: ReviewDigestResult }>()

function loadReviews(gameId: string): RawReview[] {
  try {
    return db
      .prepare(
        `SELECT u.display_name, u.username, r.rating, r.content
         FROM reviews r LEFT JOIN users u ON u.id = r.user_id
         WHERE r.game_id = ? AND r.content IS NOT NULL AND length(trim(r.content)) > 0
         ORDER BY r.created_at DESC`,
      )
      .all(gameId) as unknown as RawReview[]
  } catch {
    return []
  }
}

function toQuote(r: RawReview): DigestQuote {
  return { author: r.display_name || r.username || '匿名玩家', rating: r.rating ?? null, text: r.content }
}

function distributionOf(rows: RawReview[]): { stars: number; count: number }[] {
  return [5, 4, 3, 2, 1].map((stars) => ({
    stars,
    count: rows.filter((r) => Math.round(Number(r.rating) || 0) === stars).length,
  }))
}

function averageOf(rows: RawReview[]): number {
  const rated = rows.map((r) => Number(r.rating)).filter((n) => Number.isFinite(n) && n > 0)
  if (!rated.length) return 0
  return Number((rated.reduce((a, b) => a + b, 0) / rated.length).toFixed(2))
}

/** 确定性兜底：只用真实评论原文，不做任何语义归纳 */
function fallbackThemes(rows: RawReview[]): { consensus: DigestTheme[]; divergence: DigestTheme[] } {
  const sorted = [...rows].sort((a, b) => (Number(b.rating) || 0) - (Number(a.rating) || 0))
  const good = sorted.filter((r) => (Number(r.rating) || 0) >= 4)
  const bad = sorted.filter((r) => (Number(r.rating) || 0) <= 3)

  const consensus: DigestTheme[] = []
  if (good.length) {
    consensus.push({
      theme: '玩家普遍认可',
      summary: `${good.length} 条评论给出 4 星及以上，是当前口碑的主流声音。`,
      quotes: good.slice(0, 2).map(toQuote),
    })
  }
  const divergence: DigestTheme[] = []
  if (bad.length) {
    divergence.push({
      theme: '也存在的不同声音',
      summary: `${bad.length} 条评论评分在 3 星及以下，指出了另一些顾虑。`,
      quotes: bad.slice(0, 2).map(toQuote),
    })
  }
  return { consensus, divergence }
}

interface LlmThemes {
  consensus: DigestTheme[]
  divergence: DigestTheme[]
}

/** LLM 只回传评论序号，引文由本地回填 → 结构上不可能编造引用 */
async function llmThemes(rows: RawReview[]): Promise<LlmThemes | null> {
  const useDeepSeek = Boolean(env.DEEPSEEK_API_KEY)
  const baseUrl = useDeepSeek ? env.DEEPSEEK_BASE_URL : env.AI_BASE_URL
  const apiKey = useDeepSeek ? env.DEEPSEEK_API_KEY : env.AI_API_KEY
  const model = useDeepSeek ? env.DEEPSEEK_MODEL : env.AI_MODEL

  // 只给序号，不给作者名，避免模型复述作者造成事实错配
  const list = rows.map((r, i) => `${i}|${r.rating ?? '未评分'}星|${r.content}`).join('\n')

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: `你是游戏评论的口碑归纳助手。下面是一批玩家评论，每行格式为「序号|星级|正文」。
请归纳出玩家【共识】与【分歧】，输出 JSON：
{"consensus":[{"theme":"不超过 8 字","summary":"一句话，不超过 40 字","quotes":[0,2]}],
 "divergence":[{"theme":"不超过 8 字","summary":"一句话，不超过 40 字","quotes":[1]}]}
规则：
1. quotes 里只能填**上面出现过的序号**，不能填评论原文，也不能编造序号；
2. consensus 最多 3 条、divergence 最多 2 条；每条至少 1 个、最多 2 个序号；
3. 若这批评论没有明显分歧，divergence 返回空数组 [];
4. 只依据评论内容归纳，不得引入评论之外的信息（不要提价格、平台、发售日期等）。只输出 JSON。`,
        },
        { role: 'user', content: list },
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    }),
  })
  if (!res.ok) throw new Error(`LLM API ${res.status}: ${(await res.text().catch(() => '')).slice(0, 160)}`)
  const data = await res.json()
  const content: string = data?.choices?.[0]?.message?.content ?? ''
  const start = content.indexOf('{')
  const end = content.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('no JSON in response')
  const parsed = JSON.parse(content.slice(start, end + 1)) as { consensus?: unknown; divergence?: unknown }

  const normalize = (arr: unknown, max: number): DigestTheme[] => {
    if (!Array.isArray(arr)) return []
    const out: DigestTheme[] = []
    for (const raw of arr) {
      const item = raw as { theme?: unknown; summary?: unknown; quotes?: unknown }
      const theme = String(item?.theme ?? '').trim().slice(0, 16)
      const summary = String(item?.summary ?? '').trim().slice(0, 60)
      if (!theme || !summary) continue
      const idxs = Array.isArray(item?.quotes)
        ? (item.quotes as unknown[])
            .map((x) => Number(x))
            .filter((n) => Number.isInteger(n) && n >= 0 && n < rows.length)
        : []
      const uniq = [...new Set(idxs)].slice(0, 2)
      if (!uniq.length) continue // 没有有效引用就丢弃该主题，宁缺毋滥
      out.push({ theme, summary, quotes: uniq.map((i) => toQuote(rows[i])) })
      if (out.length >= max) break
    }
    return out
  }

  const consensus = normalize(parsed.consensus, 3)
  const divergence = normalize(parsed.divergence, 2)
  if (!consensus.length && !divergence.length) return null
  return { consensus, divergence }
}

export async function getReviewDigest(gameId: string): Promise<ReviewDigestResult | null> {
  const g = CATALOG_INDEX.get(gameId)
  if (!g) return null

  const cached = cache.get(gameId)
  if (cached && cached.until > Date.now()) return cached.data

  const rows = loadReviews(gameId)
  const base = {
    ok: true as const,
    gameId,
    name: g.name,
    count: rows.length,
    average: averageOf(rows),
    distribution: distributionOf(rows),
    updatedAt: Date.now(),
  }

  let data: ReviewDigestResult

  if (!rows.length) {
    data = {
      ...base,
      aiPowered: false,
      consensus: [],
      divergence: [],
      note: '这款游戏还没有玩家评论，欢迎你来写下第一条。',
    }
  } else if (rows.length < MIN_REVIEWS_FOR_THEMES || !(env.DEEPSEEK_API_KEY || env.AI_API_KEY)) {
    const { consensus, divergence } = fallbackThemes(rows)
    data = {
      ...base,
      aiPowered: false,
      consensus,
      divergence,
      note: `评论数较少（${rows.length} 条），暂未做主题归纳，以下直接为你摘取真实评论。`,
    }
  } else {
    try {
      const themes = await llmThemes(rows)
      data = themes
        ? { ...base, aiPowered: true, consensus: themes.consensus, divergence: themes.divergence }
        : (({ consensus, divergence }) => ({
            ...base,
            aiPowered: false,
            consensus,
            divergence,
            note: 'AI 未能归纳出稳定主题，以下直接为你摘取真实评论。',
          }))(fallbackThemes(rows))
    } catch (e) {
      console.warn('[AI] 口碑归纳失败，使用原生引用兜底：', e instanceof Error ? e.message : e)
      const { consensus, divergence } = fallbackThemes(rows)
      data = { ...base, aiPowered: false, consensus, divergence, note: 'AI 归纳暂不可用，以下直接为你摘取真实评论。' }
    }
  }

  cache.set(gameId, { until: Date.now() + TTL, data })
  return data
}
