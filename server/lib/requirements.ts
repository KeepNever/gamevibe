// 需求结构化 + 硬约束过滤（Step C1'）
//
// 为什么要这一层：
//   原链路让 LLM 直接「凭感觉」从目录里挑游戏，于是预算 / 评分 / 时长 / 类型这类
//   可机检的硬约束经常被漏判（基线硬条件遵守率仅 62.1%）。
//   这里把「读懂需求」从 LLM 手里拿走，交给确定性规则；LLM 只在候选集内挑选与润色。
//
// 四条原则：
//   1) 规则优先：能用词典 / 正则判定的，绝不交给 LLM —— 确定性最高、零成本、可评测
//   2) LLM 只补漏：规则一条都没抽到时才补一次结构化抽取，结果经白名单校验
//   3) 硬约束先于 LLM：候选集先被过滤，LLM 无法「推荐目录外或不满足约束」的游戏
//   4) 空结果逐级放宽，而不是回答「没找到」；放宽了哪一条如实说明
//
// 事实来源：catalog.ts（价格 / 评分 / 类型 / 标签）+ 冻结画像（难度 / 时长 / 剧情 / 联机）

import { env } from '../env.ts'
import { catalog } from '../data/catalog.ts'
import type { CatalogGame } from '../types.ts'
import { loadGameProfiles, type GameProfile } from './gameProfile.ts'

export type ReqKind =
  | 'free'
  | 'price_lte'
  | 'rating_gte'
  | 'genre'
  | 'tag'
  | 'difficulty_gte'
  | 'difficulty_lte'
  | 'story_gte'
  | 'multiplayer'
  | 'length'
  | 'similar_to'
  | 'any'

export interface Requirement {
  kind: ReqKind
  /** 数值阈值（价格 / 评分 / 难度 / 剧情） */
  value?: number
  /** 枚举全集（类型 / 标签 / 联机 / 时长），语义为「满足其一」 */
  values?: string[]
  /** similar_to 的目标游戏 */
  gameId?: string
  /** any 组的子条件（满足其一） */
  of?: Requirement[]
  /** 人类可读标签（供 UI 与放宽说明；禁止包含 ¥ 符号，避免污染事实核对） */
  label: string
  source: 'rule' | 'llm'
}

const CATALOG_INDEX = new Map(catalog.map((g) => [g.id, g]))

// ═══════════════════════════════ 词典 ═══════════════════════════════

const GENRE_RULES: Array<{ re: RegExp; values: string[]; label: string }> = [
  { re: /(roguelike|rogue|肉鸽)/i, values: ['Roguelike'], label: '类型 Roguelike' },
  { re: /(魂类|魂like|soulslike|魂系|类魂)/i, values: ['魂类'], label: '类型 魂类' },
  { re: /(银河城|恶魔城|metroidvania)/i, values: ['银河城'], label: '类型 银河城' },
  { re: /(开放世界|open\s*world)/i, values: ['开放世界'], label: '类型 开放世界' },
  { re: /(第一人称射击|射击|fps|枪战|打枪)/i, values: ['射击', 'FPS'], label: '类型 射击/FPS' },
  { re: /(模拟经营|经营模拟|模拟类|模拟)/, values: ['模拟'], label: '类型 模拟' },
  { re: /(生存建造|生存类|生存)/, values: ['生存'], label: '类型 生存' },
  { re: /(策略|战棋)/, values: ['策略'], label: '类型 策略' },
  { re: /(角色扮演|rpg)/i, values: ['RPG'], label: '类型 RPG' },
  { re: /(动作游戏|动作类|硬核动作|动作)/, values: ['动作'], label: '类型 动作' },
  { re: /(休闲类|休闲)/, values: ['休闲'], label: '类型 休闲' },
  { re: /(独立游戏|独立)/, values: ['独立'], label: '类型 独立' },
  { re: /(冒险类|冒险)/, values: ['冒险'], label: '类型 冒险' },
]

const TAG_RULES: Array<{ re: RegExp; values: string[]; label: string }> = [
  { re: /像素/, values: ['像素风'], label: '标签 像素风' },
  { re: /(种田|农场|农作|耕作)/, values: ['农场'], label: '标签 农场' },
  { re: /钓鱼/, values: ['钓鱼'], label: '标签 钓鱼' },
  { re: /经营/, values: ['经营'], label: '标签 经营' },
  { re: /(治愈|暖心)/, values: ['治愈'], label: '标签 治愈' },
  { re: /弹幕/, values: ['弹幕'], label: '标签 弹幕' },
  { re: /沙盒/, values: ['沙盒'], label: '标签 沙盒' },
  { re: /建造/, values: ['生存建造'], label: '标签 生存建造' },
  { re: /(推理|侦探|解谜)/, values: ['推理'], label: '标签 推理' },
  { re: /(文学|诗意)/, values: ['文学'], label: '标签 文学' },
  { re: /哲学/, values: ['哲学'], label: '标签 哲学' },
  { re: /(竞技|电竞)/, values: ['竞技'], label: '标签 竞技' },
  { re: /手绘/, values: ['手绘'], label: '标签 手绘' },
  { re: /回合制/, values: ['回合制'], label: '标签 回合制' },
]

/** 游戏名 / 简称 → catalog id（「类似 XX」用的目标识别） */
const NAME_ALIASES: Array<[string, string]> = [
  ['星露谷物语', 'stardew-valley'],
  ['星露谷', 'stardew-valley'],
  ['空洞骑士', 'hollow-knight'],
  ['极乐迪斯科', 'disco-elysium'],
  ['迪斯科', 'disco-elysium'],
  ['艾尔登法环', 'elden-ring'],
  ['老头环', 'elden-ring'],
  ['法环', 'elden-ring'],
  ['博德之门', 'baldurs-gate-3'],
  ['哈迪斯', 'hades-2'],
  ['幻兽帕鲁', 'palworld'],
  ['帕鲁', 'palworld'],
  ['赛博朋克', 'cyberpunk-2077'],
  ['死亡细胞', 'dead-cells'],
  ['潜水员戴夫', 'dave-the-diver'],
  ['戴夫', 'dave-the-diver'],
  ['怪物猎人', 'monster-hunter-wilds'],
  ['吸血鬼幸存者', 'vampire-survivors'],
  ['匹诺曹', 'lies-of-p'],
  ['无畏契约', 'valorant'],
  ['战神', 'god-of-war'],
]

// ═══════════════════════════════ 抽取（规则） ═══════════════════════════════

function pushUnique(list: Requirement[], req: Requirement): void {
  const key = `${req.kind}:${req.value ?? ''}:${(req.values ?? []).join('/')}:${req.gameId ?? ''}`
  const hit = list.find(
    (r) => `${r.kind}:${r.value ?? ''}:${(r.values ?? []).join('/')}:${r.gameId ?? ''}` === key,
  )
  if (!hit) list.push(req)
}

/** 规则抽取：确定性最强的一路，覆盖绝大多数自然语言表达 */
export function extractByRules(message: string): Requirement[] {
  const msg = message.toLowerCase()
  const reqs: Requirement[] = []
  const raw = message

  // ── 价格 ──
  const wantsFree = /(免费|白嫖|不花钱|不要钱|不用花钱|零元|白送|白给|\bfree\b)/i.test(msg) || /\b0\s*元/.test(raw)
  if (wantsFree) {
    pushUnique(reqs, { kind: 'free', label: '免费', source: 'rule' })
  } else {
    let budget: number | null = null
    const mBudget = raw.match(/预算\s*(\d+)/)
    if (mBudget) budget = Number(mBudget[1])
    if (budget === null) {
      const mYuan = raw.match(/(\d+(?:\.\d+)?)\s*(?:元|块钱|块)(?:以内|以下|之内|左右|内)?/)
      if (mYuan) budget = Number(mYuan[1])
    }
    if (budget === null) {
      const mCap = raw.match(/(?:不超过|最多)\s*(\d+)/)
      if (mCap) budget = Number(mCap[1])
    }
    if (budget !== null && Number.isFinite(budget)) {
      pushUnique(reqs, { kind: 'price_lte', value: budget, label: `预算 ${budget} 元以内`, source: 'rule' })
    }
  }

  // ── 评分 ──
  let rating: number | null = null
  const mRating =
    raw.match(/(\d+(?:\.\d+)?)\s*分\s*(?:以上|及以上|往上|起)/) || raw.match(/(?:超过|高于|大于)\s*(\d+(?:\.\d+)?)\s*分/)
  if (mRating) rating = Number(mRating[1])
  if (rating === null && /(神作|高分|评分最高|口碑最好|顶级|顶尖)/.test(raw)) rating = 9
  if (rating !== null && Number.isFinite(rating)) {
    pushUnique(reqs, { kind: 'rating_gte', value: rating, label: `评分 ≥${rating}`, source: 'rule' })
  }

  // ── 难度 ──
  const wantsEasy = /(难度(?:不要|别)?(?:太高|过高)|不要太难|别太难|不想太难|难度(?:低|别高)|轻松一点|简单点|休闲一点)/.test(raw) || /轻松/.test(raw)
  const wantsHard = /(高难度|硬核|受苦|有挑战|挑战性|难一点|很难|难度高|魂like|soulslike)/i.test(raw)
  if (wantsEasy) {
    pushUnique(reqs, { kind: 'difficulty_lte', value: 3, label: '难度温和', source: 'rule' })
  } else if (wantsHard) {
    pushUnique(reqs, {
      kind: 'any',
      label: '高难度',
      source: 'rule',
      of: [
        { kind: 'difficulty_gte', value: 4, label: '难度 ≥4', source: 'rule' },
        { kind: 'tag', values: ['高难度', '困难', '魂like'], label: '标签 高难度', source: 'rule' },
        { kind: 'genre', values: ['魂类'], label: '类型 魂类', source: 'rule' },
      ],
    })
  }

  // ── 剧情强度 ──
  // 覆盖「剧情向 / 剧情很强 / 剧情丰富 / 重剧情 / 叙事 / 故事好」等多种说法
  if (/(剧情向|剧情(很|超|非常|极|比较|特别)?(强|好|丰富|深)|重剧情|剧情为主|叙事|故事好|沉浸剧情|剧情感人)/.test(raw)) {
    pushUnique(reqs, { kind: 'story_gte', value: 4, label: '剧情强度 ≥4', source: 'rule' })
  }

  // ── 时长 ──
  if (/(短游戏|短篇|流程短|一小时|半小时|几小时|快速通关|不占时间|短小精悍)/.test(raw)) {
    pushUnique(reqs, { kind: 'length', values: ['<5h', '5-15h'], label: '时长偏短', source: 'rule' })
  } else if (/(长线|长期|玩不腻|耐玩|一直玩|能玩很久|持久|长寿命|持续更新|长期投入)/.test(raw)) {
    pushUnique(reqs, { kind: 'length', values: ['ongoing', '>60h'], label: '长线耐玩', source: 'rule' })
  }

  // ── 联机形态 ──
  const wantsCoop = /(双人|合作|一起玩|联机|共斗|组队|和朋友|跟朋友|好友)/.test(raw)
  const wantsPvp = /(对战|竞技对抗|pvp|排位)/i.test(msg)
  const wantsSolo = /(单人|一个人|独自)/.test(raw)
  if (wantsCoop) {
    pushUnique(reqs, { kind: 'multiplayer', values: ['co-op', 'both'], label: '可合作/联机', source: 'rule' })
  } else if (wantsSolo) {
    // 注意：单人剧情向不等于排除合作（如博德之门3 支持单人）——保持宽松，避免误杀
    pushUnique(reqs, { kind: 'multiplayer', values: ['none', 'single', 'co-op'], label: '支持单人', source: 'rule' })
  } else if (wantsPvp) {
    pushUnique(reqs, { kind: 'multiplayer', values: ['pvp', 'both'], label: '对抗/PvP', source: 'rule' })
  } else if (/多人/.test(raw)) {
    pushUnique(reqs, { kind: 'multiplayer', values: ['pvp', 'co-op', 'both'], label: '多人', source: 'rule' })
  }

  // ── 类型 ──
  for (const rule of GENRE_RULES) {
    if (rule.re.test(raw)) pushUnique(reqs, { kind: 'genre', values: rule.values, label: rule.label, source: 'rule' })
  }

  // ── 标签 ──
  // 「模拟经营」已由 genre 模拟 覆盖，不再叠加 经营 标签，避免过度收窄
  const hasSimGenre = /(模拟经营|经营模拟|模拟类|模拟)/.test(raw)
  for (const rule of TAG_RULES) {
    if (rule.values[0] === '经营' && hasSimGenre) continue
    if (rule.re.test(raw)) pushUnique(reqs, { kind: 'tag', values: rule.values, label: rule.label, source: 'rule' })
  }

  // ── 类似 X ──
  if (/(类似|相似|像|同款|差不多|这类)/.test(raw)) {
    const sorted = [...NAME_ALIASES].sort((a, b) => b[0].length - a[0].length)
    const hit = sorted.find(([alias]) => raw.includes(alias))
    if (hit && CATALOG_INDEX.has(hit[1])) {
      pushUnique(reqs, { kind: 'similar_to', gameId: hit[1], label: `类似《${CATALOG_INDEX.get(hit[1])!.name}》`, source: 'rule' })
    }
  }

  return normalize(reqs)
}

/** 去重与优先级处理：更强的条件吸收更弱的同类条件 */
export function normalize(reqs: Requirement[]): Requirement[] {
  const out: Requirement[] = []
  const byKind = (k: ReqKind) => out.filter((r) => r.kind === k)

  // 免费 吸收 价格上限
  const hasFree = reqs.some((r) => r.kind === 'free')
  // 评分取最严
  let ratingMax: number | null = null
  for (const r of reqs) {
    if (r.kind === 'rating_gte' && (r.value ?? 0) > (ratingMax ?? 0)) ratingMax = r.value ?? 0
  }

  for (const r of reqs) {
    if (r.kind === 'price_lte' && hasFree) continue
    if (r.kind === 'rating_gte' && (r.value ?? 0) < (ratingMax ?? 0)) continue
    if (r.kind === 'genre' || r.kind === 'tag') {
      const dup = byKind(r.kind).some((x) => (x.values ?? []).join('/') === (r.values ?? []).join('/'))
      if (dup) continue
    }
    if (r.kind === 'multiplayer' && byKind('multiplayer').length) continue
    if (r.kind === 'length' && byKind('length').length) continue
    if (r.kind === 'difficulty_gte' && byKind('difficulty_gte').length) continue
    if (r.kind === 'difficulty_lte' && byKind('difficulty_lte').length) continue
    if (r.kind === 'story_gte' && byKind('story_gte').length) continue
    if (r.kind === 'price_lte' && byKind('price_lte').length) continue
    out.push(r)
  }
  return out
}

// ═══════════════════════════════ 抽取（LLM 补漏） ═══════════════════════════════

const GENRE_WHITELIST = ['动作', 'RPG', '开放世界', '魂类', '策略', '冒险', 'Roguelike', '独立', '生存', '多人', '射击', 'FPS', '模拟', '休闲', '银河城']
const LENGTH_WHITELIST = ['<5h', '5-15h', '15-30h', '30-60h', '>60h', 'ongoing']
const MP_WHITELIST = ['none', 'single', 'co-op', 'pvp', 'both']

/**
 * LLM 补漏：只在规则一条都没抽到、且句子够长、且确实有点评意义时调用一次。
 * 输出白名单校验，任何非法枚举直接丢弃；解析失败一律返回空数组（不阻塞主链路）。
 */
async function extractByLLM(message: string): Promise<Requirement[]> {
  if (!(env.DEEPSEEK_API_KEY || env.AI_API_KEY)) return []
  try {
    const useDeepSeek = Boolean(env.DEEPSEEK_API_KEY)
    const baseUrl = useDeepSeek ? env.DEEPSEEK_BASE_URL : env.AI_BASE_URL
    const apiKey = useDeepSeek ? env.DEEPSEEK_API_KEY : env.AI_API_KEY
    const model = useDeepSeek ? env.DEEPSEEK_MODEL : env.AI_MODEL

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: `把用户对游戏的需求抽成结构化条件，只输出 JSON，不要解释。
可用字段（全部可选，没有就省略）：
{"price_lte":数字,"free":true,"rating_gte":数字,"difficulty_gte":1-5,"difficulty_lte":1-5,"story_gte":1-5,
"genres":[${GENRE_WHITELIST.map((g) => `"${g}"`).join(',')}],"length":["<5h"|"5-15h"|"15-30h"|"30-60h"|">60h"|"ongoing"],
"multiplayer":["none"|"single"|"co-op"|"pvp"|"both"]}
用户只是在打招呼、道谢或闲聊 → 输出 {}。宁缺勿滥，推断不出的字段不要填。`,
          },
          { role: 'user', content: message },
        ],
        temperature: 0.1,
        response_format: { type: 'json_object' },
      }),
    })
    if (!res.ok) return []
    const data = await res.json()
    const content: string = data?.choices?.[0]?.message?.content ?? ''
    const start = content.indexOf('{')
    const end = content.lastIndexOf('}')
    if (start === -1 || end === -1) return []
    const p = JSON.parse(content.slice(start, end + 1)) as any
    const out: Requirement[] = []
    const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

    if (p.free === true) out.push({ kind: 'free', label: '免费', source: 'llm' })
    const priceLte = num(p.price_lte)
    if (priceLte !== null && priceLte >= 0) out.push({ kind: 'price_lte', value: priceLte, label: `预算 ${priceLte} 元以内`, source: 'llm' })
    const ratingGte = num(p.rating_gte)
    if (ratingGte !== null) out.push({ kind: 'rating_gte', value: ratingGte, label: `评分 ≥${ratingGte}`, source: 'llm' })
    const dGte = num(p.difficulty_gte)
    if (dGte !== null) out.push({ kind: 'difficulty_gte', value: dGte, label: `难度 ≥${dGte}`, source: 'llm' })
    const dLte = num(p.difficulty_lte)
    if (dLte !== null) out.push({ kind: 'difficulty_lte', value: dLte, label: `难度 ≤${dLte}`, source: 'llm' })
    const sGte = num(p.story_gte)
    if (sGte !== null) out.push({ kind: 'story_gte', value: sGte, label: `剧情强度 ≥${sGte}`, source: 'llm' })
    if (Array.isArray(p.genres)) {
      const gs = (p.genres as unknown[]).filter((x): x is string => typeof x === 'string' && GENRE_WHITELIST.includes(x))
      if (gs.length) out.push({ kind: 'genre', values: gs, label: `类型 ${gs.join('/')}`, source: 'llm' })
    }
    if (Array.isArray(p.length)) {
      const ls = (p.length as unknown[]).filter((x): x is string => typeof x === 'string' && LENGTH_WHITELIST.includes(x))
      if (ls.length) out.push({ kind: 'length', values: ls, label: '时长', source: 'llm' })
    }
    if (Array.isArray(p.multiplayer)) {
      const ms = (p.multiplayer as unknown[]).filter((x): x is string => typeof x === 'string' && MP_WHITELIST.includes(x))
      if (ms.length) out.push({ kind: 'multiplayer', values: ms, label: '联机形态', source: 'llm' })
    }
    return normalize(out)
  } catch (e) {
    console.warn('[req] LLM 结构化补漏失败：', e instanceof Error ? e.message : e)
    return []
  }
}

/** 对外入口：规则优先，规则全空时才让 LLM 补漏 */
export async function extractRequirements(message: string): Promise<Requirement[]> {
  const ruled = extractByRules(message)
  if (ruled.length) return ruled
  if (message.trim().length < 6) return []
  return extractByLLM(message)
}

// ═══════════════════════════════ 过滤 ═══════════════════════════════

function testOne(req: Requirement, g: CatalogGame, p?: GameProfile): boolean {
  const pool = [...g.genres, ...g.tags]
  switch (req.kind) {
    case 'free':
      return g.price === 0
    case 'price_lte':
      return g.price <= (req.value ?? 0)
    case 'rating_gte':
      return g.rating >= (req.value ?? 0)
    case 'genre':
    case 'tag':
      return (req.values ?? []).length === 0 || (req.values ?? []).some((v) => pool.some((x) => x === v || x.includes(v)))
    // 画像类条件：画像缺失时不做判断（返回 true），避免无谓收窄
    case 'difficulty_gte':
      return p ? p.difficulty >= (req.value ?? 0) : true
    case 'difficulty_lte':
      return p ? p.difficulty <= (req.value ?? 0) : true
    case 'story_gte':
      return p ? p.storyIntensity >= (req.value ?? 0) : true
    case 'multiplayer':
      return p ? (req.values ?? []).includes(p.multiplayer) : true
    case 'length':
      return p ? (req.values ?? []).includes(p.estimatedLength) : true
    case 'similar_to':
      return true // 候选集已在 similarCandidates 阶段收缩
    case 'any':
      return (req.of ?? []).some((c) => testOne(c, g, p))
    default:
      return true
  }
}

/**
 * 「类似 X」的候选集生成。
 *
 * 关键设计：优先用目标的**独有特征**（在目录里只有它有）判定同类。
 *   - 若存在别的游戏共享独有特征 → 那些就是同类
 *   - 若目标的独有特征无人共享（它在目录里是独一份）→ 只返回目标本身
 *     （例如「类似空洞骑士」：目录里银河城只有它，硬塞别的游戏反而是错的）
 */
function similarCandidates(targetId: string): Set<string> {
  const target = CATALOG_INDEX.get(targetId)
  if (!target) return new Set()
  const feats = [...new Set([...target.genres, ...target.tags])]
  const others = catalog.filter((g) => g.id !== targetId)
  const countOf = (f: string) => catalog.filter((g) => g.genres.includes(f) || g.tags.includes(f)).length
  const rare = feats.filter((f) => countOf(f) === 1)

  let sameKind = others.filter((g) => rare.some((f) => g.genres.includes(f) || g.tags.includes(f)))
  if (!rare.length) {
    // 没有独有特征 → 退化为「共享至少 2 个特征」，按共享数排序取前 3
    sameKind = others
      .map((g) => ({ g, shared: feats.filter((f) => g.genres.includes(f) || g.tags.includes(f)).length }))
      .filter((x) => x.shared >= 2)
      .sort((a, b) => b.shared - a.shared || b.g.rating - a.g.rating)
      .slice(0, 3)
      .map((x) => x.g)
  }
  const pool = sameKind.length ? sameKind : []
  return new Set([targetId, ...pool.map((g) => g.id)])
}

/** 放宽顺序：从「最边缘」的条件开始丢，价格/免费留到最后 */
const RELAX_ORDER: ReqKind[] = ['tag', 'similar_to', 'genre', 'story_gte', 'length', 'multiplayer', 'difficulty_lte', 'difficulty_gte', 'rating_gte', 'price_lte']

export interface FilterResult {
  ids: string[]
  /** 被放宽掉的条件（按放宽顺序） */
  relaxed: Requirement[]
}

/** 在 catalog × 冻结画像上执行硬约束过滤，空结果时逐级放宽 */
export function filterCatalog(reqs: Requirement[], limit = 6): FilterResult {
  if (!reqs.length) return { ids: [], relaxed: [] }
  const profiles = loadGameProfiles()
  const relaxed: Requirement[] = []
  let active = [...reqs]

  // 先收缩「类似 X」的候选域
  const simReq = reqs.find((r) => r.kind === 'similar_to')
  const simSet = simReq?.gameId ? similarCandidates(simReq.gameId) : null

  const run = (): CatalogGame[] => {
    const base = simSet ? catalog.filter((g) => simSet.has(g.id)) : catalog
    return base
      .filter((g) => active.every((r) => testOne(r, g, profiles.get(g.id))))
      .sort((a, b) => b.rating - a.rating)
  }

  let hits = run()
  if (!hits.length) {
    // 第一轮：每次只丢一类，取「最小放宽」的解
    for (const kind of RELAX_ORDER) {
      const dropping = active.filter((r) => r.kind === kind)
      if (!dropping.length) continue
      const trial = active.filter((r) => r.kind !== kind)
      const trialHits = (() => {
        const base = simSet ? catalog.filter((g) => simSet.has(g.id)) : catalog
        return base
          .filter((g) => trial.every((r) => testOne(r, g, profiles.get(g.id))))
          .sort((a, b) => b.rating - a.rating)
      })()
      if (trialHits.length) {
        active = trial
        hits = trialHits
        relaxed.push(...dropping)
        break
      }
    }
  }
  if (!hits.length) {
    // 第二轮：单类放宽都救不回来 → 按顺序累积放宽，直到有结果
    let cum: Requirement[] = [...active]
    for (const kind of RELAX_ORDER) {
      const dropping = cum.filter((r) => r.kind === kind)
      if (!dropping.length) continue
      cum = cum.filter((r) => r.kind !== kind)
      const base = simSet ? catalog.filter((g) => simSet.has(g.id)) : catalog
      const found = base
        .filter((g) => cum.every((r) => testOne(r, g, profiles.get(g.id))))
        .sort((a, b) => b.rating - a.rating)
      relaxed.push(...dropping)
      if (found.length) {
        active = cum
        hits = found
        break
      }
    }
  }

  return { ids: hits.slice(0, limit).map((g) => g.id), relaxed }
}

/** 约束标签（供 SSE 下发 / UI 展示） */
export function constraintLabels(reqs: Requirement[]): string[] {
  return reqs.map((r) => r.label)
}
