// AI 今日趋势解读
//
// 设计原则（与 reviewDigest 的「引用本地回填」一脉相承）：
//   模型只负责「定性判断」，所有具体数字由本地从 /api/live 实时快照注入。
//   送给模型的快照带真实数字供其判断走向，但输出被要求「不得写热度数字」——
//   检测时先豁免目录内游戏名（游戏名可能自带数字，如「赛博朋克2077」「CS2」），
//   只对游戏名之外的阿拉伯数字报警，命中即重试，仍违规则回退确定性模板。
//   => 模型在结构上碰不到热度数字，不可能自算或编造，界面数字与快照必然一致。

import { env } from '../env.ts'
import { getLiveStats } from './live.ts'
import type { LiveStats, LiveRealFlags } from './live.ts'
import { catalog } from '../data/catalog.ts'

export interface TrendHotGame {
  id: string
  name: string
  onlinePlayers: number
  delta: number
}

export interface TrendSnapshot {
  onlinePlayers: number
  streamingViewers: number
  newToday: number
  deals: number
  snapshotAt: number
  /** 各指标是否真实（false = 演示数据，UI 需如实标注） */
  real: LiveRealFlags
  /** 升温榜（按趋势降序，末尾可能附一条降温最明显的作对照） */
  hot: TrendHotGame[]
}

export interface AiTrendResult {
  ok: true
  aiPowered: boolean
  source: 'live-snapshot'
  updatedAt: number
  /** 定性解读，保证不含「游戏名之外」的阿拉伯数字 */
  text: string
  snapshot: TrendSnapshot
}

const TTL = 60 * 1000
let cache: { until: number; data: AiTrendResult } | null = null

// 游戏名可能自带数字（赛博朋克2077 / CS2 / 哈迪斯2…）：
// 检测前先豁免目录内全部游戏名（长名优先，避免子串先替换误伤），
// 只对「游戏名之外」的阿拉伯数字报警 —— 那才是模型自算/编造的热度数字。
const NAME_BY_LENGTH = [...catalog].map((g) => g.name).sort((a, b) => b.length - a.length)
function hasRiskyDigits(text: string): boolean {
  let t = text
  for (const n of NAME_BY_LENGTH) t = t.split(n).join('')
  return /[0-9]/.test(t)
}

/** 从实时快照派生「升温榜」：升温前 3 + 降温最明显 1（不足则省略） */
function rankHot(stats: LiveStats): TrendHotGame[] {
  const sorted = [...stats.trending].sort((a, b) => b.delta - a.delta)
  const rising = sorted.slice(0, 3)
  const last = sorted[sorted.length - 1]
  const list =
    last && !rising.some((g) => g.id === last.id) && last.delta < 0 ? [...rising, last] : rising
  return list.map((g) => ({ id: g.id, name: g.name, onlinePlayers: g.onlinePlayers, delta: g.delta }))
}

function buildSnapshot(stats: LiveStats): TrendSnapshot {
  return {
    onlinePlayers: stats.global.onlinePlayers,
    streamingViewers: stats.global.streamingViewers,
    newToday: stats.global.newToday,
    deals: stats.global.deals,
    snapshotAt: stats.updatedAt,
    real: stats.real,
    hot: rankHot(stats),
  }
}

/** 定性模板兜底（无 key / LLM 失败 / 违规重试仍失败）：游戏名可含数字，但不写任何热度数值 */
function templateText(snap: TrendSnapshot): string {
  const names = snap.hot.map((g) => g.name)
  const rising = names.slice(0, 3).join('、') || '高分作品'
  const cooling = snap.hot.find((g) => g.delta < 0)
  const tail = cooling ? `，而 ${cooling.name} 的热度较上一时段略有回落。` : '。'
  return `今天的在线热度整体保持活跃，${rising} 是当前最受关注的升温焦点${tail}竞技对抗与开放世界类依旧是玩家停留时间最长的板块，建议顺着榜单挑一款上手。`
}

async function llmTrend(snap: TrendSnapshot): Promise<string> {
  const useDeepSeek = Boolean(env.DEEPSEEK_API_KEY)
  const baseUrl = useDeepSeek ? env.DEEPSEEK_BASE_URL : env.AI_BASE_URL
  const apiKey = useDeepSeek ? env.DEEPSEEK_API_KEY : env.AI_API_KEY
  const model = useDeepSeek ? env.DEEPSEEK_MODEL : env.AI_MODEL

  const rising = snap.hot
    .filter((g) => g.delta >= 0)
    .map((g) => `${g.name}（在线 ${g.onlinePlayers}，趋势 +${g.delta}%）`)
    .join('；')
  const cooling = snap.hot
    .filter((g) => g.delta < 0)
    .map((g) => `${g.name}（在线 ${g.onlinePlayers}，趋势 ${g.delta}%）`)
    .join('；')
  const facts = [
    `平台实时热度快照：`,
    `- 全网在线玩家总计：${snap.onlinePlayers}${snap.real.onlinePlayers ? '' : '（演示数据）'}`,
    `- 直播观众总计：${snap.streamingViewers}${snap.real.streamingViewers ? '' : '（演示数据，仅供参考，勿当作事实结论）'}`,
    `- 今日上新数量：${snap.newToday}${snap.real.newToday ? '' : '（演示数据）'}`,
    `- 今日特价数量：${snap.deals}${snap.real.deals ? '' : '（演示数据）'}`,
    rising ? `- 热度上升：${rising}` : '',
    cooling ? `- 热度回落：${cooling}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: `你是 GameVibe 的实时趋势分析助手。下面给你一份平台当前的实时热度快照，请用 2-3 句中文概括今天的热度走向，语气专业、有洞察。
【硬性要求】正文中不要写任何具体数值——在线人数、涨幅百分比、日期、款数等都不要写，因为这些数字会由界面另行展示。请改用「持续升温」「稳居榜首」「略有回落」「热度领先」这类定性表达。可以正常写游戏名（游戏名自带数字不受限制）。
只输出这段文字本身，不要标题、不要 JSON、不要 markdown、不要项目符号。`,
        },
        { role: 'user', content: facts },
      ],
      temperature: 0.5,
    }),
  })
  if (!res.ok) throw new Error(`LLM API ${res.status}: ${(await res.text().catch(() => '')).slice(0, 160)}`)
  const data = await res.json()
  const text: string = (data?.choices?.[0]?.message?.content ?? '').trim()
  if (!text) throw new Error('empty text')
  return text
}

export async function getAITrend(): Promise<AiTrendResult> {
  if (cache && cache.until > Date.now()) return cache.data

  const snap = buildSnapshot(await getLiveStats())
  let text = templateText(snap)
  let aiPowered = false

  if (env.DEEPSEEK_API_KEY || env.AI_API_KEY) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const candidate = await llmTrend(snap)
        if (!hasRiskyDigits(candidate)) {
          text = candidate
          aiPowered = true
          break
        }
        console.warn(`[AI] trend 第 ${attempt + 1} 次输出含热度数字，丢弃重试`)
      } catch (e) {
        console.warn('[AI] trend 生成失败，用模板：', e instanceof Error ? e.message : e)
        break
      }
    }
  }

  const data: AiTrendResult = {
    ok: true,
    aiPowered,
    source: 'live-snapshot',
    updatedAt: Date.now(),
    text,
    snapshot: snap,
  }
  cache = { until: Date.now() + TTL, data }
  return data
}
