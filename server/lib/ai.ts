import { env } from '../env.ts'
import { catalog } from '../data/catalog.ts'
import type { CatalogGame } from '../types.ts'
import { extractRequirements, filterCatalog, type Requirement } from './requirements.ts'
import { runWebSearch, type WebSearchResult, type WebSourceItem } from './webSearch.ts'
import { fetchPlayerCount } from './steamRealtime.ts'

/** 联网检索状态（供前端如实标注「已联网 / 当前离线」） */
export interface WebMeta {
  used: boolean
  reachable: boolean
  scope: 'game' | 'global' | 'none'
  term: string | null
  game: { appid: number; name: string } | null
  count: number
  /** 本轮全网搜索使用的 provider（serper / tavily）；未使用为 null */
  provider?: string | null
  notes: string[]
}

export interface AIResult {
  text: string
  gameIds: string[]
  /** 从用户话里抽出的硬约束（供 UI 展示「已按…筛选」） */
  constraints?: string[]
  /** 因为目录内无匹配而被放宽掉的条件 */
  relaxed?: string[]
  /** 本次走的是哪条链路 */
  engine?: 'constraint+llm' | 'llm' | 'rule' | 'web+llm' | 'web-rule'
  /** 联网检索到的真实来源条目：标题 / 日期 / 链接 / 来源均来自接口原文，模型不参与生成 */
  sources?: WebSourceItem[]
  /** 本轮联网检索的状态 */
  web?: WebMeta
}

const CATALOG_INDEX = new Map(catalog.map((g) => [g.id, g]))

function fmtPrice(p: number): string {
  return p === 0 ? '免费' : `¥${p}`
}

/** 用真实目录数据描述一款游戏（锚定事实，绝不编造） */
function describe(g: CatalogGame): string {
  return `《${g.name}》(id:${g.id})：类型=${g.genres.join('/')}；标签=${g.tags.join('/')}；评分=${g.rating}；价格=${fmtPrice(g.price)}`
}

/** 对外暴露的接地事实描述（供画像解说等复用，保证口径一致） */
export const describeGame = describe

/**
 * 主入口：三段式
 * 第 0 段：需求结构化 → 硬约束过滤出候选集（确定性规则，不依赖 LLM）
 * 第 1 段：LLM 只在候选集内选 1-4 款（选不出就按评分取 top）
 * 第 2 段：只用「选中游戏的真实目录数据」生成推荐语，杜绝幻觉
 */
export async function getAIRecommendation(
  userMessage: string,
  opts: { web?: 'auto' | 'on' | 'off' } = {},
): Promise<AIResult> {
  // ── 联网分支优先 ──
  // 命中「资讯 / 最新 / 发售 / 特价」类意图，或用户强制开启联网时，
  // 先走真实外部数据（Steam 公开接口），再让模型只基于取回条目写简报。
  const webRes = await runWebSearch({ message: userMessage, force: opts.web ?? 'auto' })
  if (webRes.scope !== 'none') {
    const webAnswer = await composeWebAnswer(userMessage, webRes)
    if (webAnswer) return webAnswer
    // 全局类意图但联网取不到数据 → 退回站内目录推荐，并如实标注「联网不可用」
    const base = await recommendFromCatalog(userMessage)
    return {
      ...base,
      engine: 'web-rule',
      text: `（联网检索当前不可用，以下为站内目录推荐）\n\n${base.text}`,
      sources: [],
      web: {
        used: true,
        reachable: false,
        scope: webRes.scope,
        term: webRes.term,
        game: webRes.game,
        count: 0,
        provider: null,
        notes: webRes.notes,
      },
    }
  }
  return recommendFromCatalog(userMessage)
}

/** 站内目录推荐（原有链路：需求结构化 → 候选集 → 选品 → 接地推荐语） */
async function recommendFromCatalog(userMessage: string): Promise<AIResult> {
  const reqs: Requirement[] = await extractRequirements(userMessage)
  const { ids: filteredIds, relaxed } = filterCatalog(reqs, 8)

  // 有约束 → 严格限定在候选集；无约束（闲聊 / 正则与 LLM 都没抽到）→ 保持原有自由选品行为
  const hasConstraints = reqs.length > 0 && filteredIds.length > 0
  const candidateIds = hasConstraints ? filteredIds : catalog.map((g) => g.id)

  const { ids: gameIds, engine } = await selectGames(userMessage, candidateIds, hasConstraints, relaxed)
  const games = gameIds.map((id) => CATALOG_INDEX.get(id)).filter((g): g is CatalogGame => Boolean(g))
  let text = await composeText(userMessage, games)

  // 放宽了条件就如实告诉用户，不假装完全匹配
  if (relaxed.length) {
    const labels = [...new Set(relaxed.map((r) => r.label))].join('、')
    text += `\n\n（说明：目录里没有完全满足「${labels}」的游戏，以上是按其余条件筛选的结果。）`
  }

  return {
    text,
    gameIds,
    constraints: reqs.map((r) => r.label),
    relaxed: [...new Set(relaxed.map((r) => r.label))],
    engine,
  }
}

// ───────────────────────── 联网资讯分支 ─────────────────────────
// 模型只负责把「真实取回的条目」写成中文简报；标题 / 日期 / 链接 / 来源全部来自接口原文，
// 且链接不进入提示词——模型结构上碰不到出处，不可能编造。

// 来源上限：全网资讯最多 10 + 全局动态四类各 5（20 条）+ 口味相关游戏最多 5 条 = 35
const MAX_SOURCES = 32

function fmtDate(ms: number | null): string {
  if (!ms) return '日期未知'
  try {
    return new Date(ms).toISOString().slice(0, 10)
  } catch {
    return '日期未知'
  }
}

/** 检索词命中站内目录时，顺带给出游戏卡片 */
function matchCatalogByTerm(term: string | null, gameName: string | null): string[] {
  const probes = [term, gameName]
    .filter((s): s is string => Boolean(s && s.trim()))
    .map((s) => s.toLowerCase())
  if (!probes.length) return []
  const hit = catalog.find((g) => {
    const n = g.name.toLowerCase()
    return probes.some((p) => p.includes(n) || n.includes(p))
  })
  return hit ? [hit.id] : []
}

async function composeWebAnswer(userMessage: string, webRes: WebSearchResult): Promise<AIResult | null> {
  const items = webRes.items.slice(0, MAX_SOURCES)
  const relatedIds = webRes.relatedIds ?? []
  const web: WebMeta = {
    used: true,
    reachable: webRes.reachable,
    scope: webRes.scope,
    term: webRes.term,
    game: webRes.game,
    count: items.length,
    provider: webRes.provider ?? null,
    notes: webRes.notes,
  }

  // 命中了口味相关性 → 直接把相关游戏作为推荐卡片；否则按检索词匹配目录
  const gameIds = relatedIds.length
    ? relatedIds.slice(0, 4)
    : matchCatalogByTerm(webRes.term, webRes.game?.name ?? null)

  if (!items.length) {
    // 全局类意图取不到数据 → 返回 null，交给调用方退回站内目录推荐（比直接道歉更有用）
    if (webRes.scope === 'global') return null
    // 指定某款游戏的资讯取不到 → 如实说明，不硬塞无关游戏
    return {
      text: '我试着联网检索了一下，但当前运行环境访问不到外部数据源（Steam），所以这次没能取到最新资讯。\n\n你可以换个问法让我基于站内目录推荐游戏，或者在网络可达的环境下再试一次。',
      gameIds,
      engine: 'web-rule',
      sources: [],
      web,
    }
  }

  const { text, aiPowered } = await composeNewsText(userMessage, items, webRes.game?.name ?? null)

  // 真·实时数据：解析到具体游戏时，附上 Steam 官方当前在线人数。
  // 数字由本地从官方接口注入、模型完全不参与，因此不可能是编的；取不到就不加。
  let realtimeSuffix = ''
  if (webRes.game?.appid) {
    try {
      const n = await fetchPlayerCount(webRes.game.appid)
      if (typeof n === 'number') {
        realtimeSuffix = `\n\n📊 实时数据：《${webRes.game.name}》当前 Steam 在线 ${n.toLocaleString('zh-CN')} 人（Steam 官方接口实时值）`
      }
    } catch {
      /* 接口不可达 → 不加，绝不编数字 */
    }
  }

  return {
    text: text + realtimeSuffix,
    gameIds,
    engine: aiPowered ? 'web+llm' : 'web-rule',
    sources: items,
    web,
  }
}

async function composeNewsText(
  userMessage: string,
  items: WebSourceItem[],
  gameName: string | null,
): Promise<{ text: string; aiPowered: boolean }> {
  const facts = items
    .map(
      (it, i) =>
        `${i + 1}. [${it.source}｜${fmtDate(it.date)}]${it.gameName ? `【${it.gameName}】` : ''} ${it.title}${it.summary ? ` —— ${it.summary}` : ''}`,
    )
    .join('\n')

  if (env.DEEPSEEK_API_KEY || env.AI_API_KEY) {
    try {
      const text = await llmComposeNews(userMessage, facts, gameName)
      return { text, aiPowered: true }
    } catch (e) {
      console.warn('[AI] 资讯简报生成失败，使用模板：', e instanceof Error ? e.message : e)
    }
  }
  return { text: templateNews(items, gameName), aiPowered: false }
}

async function llmComposeNews(userMessage: string, facts: string, gameName: string | null): Promise<string> {
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
          content: `你是 GameVibe 的游戏资讯简报助手。下面是从 Steam 公开接口实时取回的【唯一真实条目】，你只能基于这些条目写简报。
要求：
- 用 3-6 句中文，先给结论再补充细节，语气自然、像朋友转述，不要逐条罗列干巴巴的标题（完整来源列表由系统另行展示，你不必列全）。
- 若条目带【游戏名】前缀，说明那是用户口味相关的游戏的动态，优先围绕它们回答；其余为商店全局动态，用来补充。
- 条目多为英文，请翻译并概括成中文。
- 绝对禁止编造条目之外的新闻、日期、数字或任何信息。
- 不要输出网址或链接（出处由系统另行展示）；也不要提价格与评分，除非条目里明确写了。
${gameName ? `- 本轮聚焦游戏：《${gameName}》。` : ''}`,
        },
        {
          role: 'user',
          content: `用户问题：${userMessage}\n\n真实资讯条目：\n${facts}\n\n请直接输出中文简报，不要使用 JSON。`,
        },
      ],
      temperature: 0.5,
    }),
  })
  if (!res.ok) throw new Error(`LLM API ${res.status}: ${await res.text().catch(() => '')}`)
  const data = await res.json()
  const text: string = (data?.choices?.[0]?.message?.content ?? '').trim()
  if (!text) throw new Error('empty text')
  return text
}

function templateNews(items: WebSourceItem[], gameName: string | null): string {
  const head = gameName
    ? `关于《${gameName}》，联网检索到 ${items.length} 条最新资讯：`
    : `联网检索到 ${items.length} 条最新游戏动态：`
  const lines = items.map(
    (it, i) => `${i + 1}. ${it.title}（${it.source}${it.date ? ` · ${fmtDate(it.date)}` : ''}）`,
  )
  return `${head}\n` + lines.join('\n') + `\n\n以上均来自 Steam 公开接口，点击下方来源可查看原文。`
}

// ───────────────────────── 第 1 遍：选游戏（限定在候选集内） ─────────────────────────
async function selectGames(
  userMessage: string,
  candidateIds: string[],
  strict: boolean,
  relaxed: Requirement[],
): Promise<{ ids: string[]; engine: AIResult['engine'] }> {
  if (!candidateIds.length) return { ids: [], engine: 'rule' }

  // 候选集足够小 → 直接全给，省一次 LLM 调用且更确定
  if (strict && candidateIds.length <= 4) return { ids: candidateIds, engine: 'constraint+llm' }

  const relaxNote = relaxed.length
    ? `\n注意：用户的部分条件（${[...new Set(relaxed.map((r) => r.label))].join('、')}）在目录内无匹配，已放宽，不必再纠结这些条件。`
    : ''

  if (env.DEEPSEEK_API_KEY || env.AI_API_KEY) {
    try {
      const ids = await llmSelect(userMessage, candidateIds, relaxNote)
      if (ids.length) return { ids, engine: strict ? 'constraint+llm' : 'llm' }
    } catch (e) {
      console.warn('[AI] LLM 选品失败，降级规则引擎：', e instanceof Error ? e.message : e)
    }
  }

  const ruled = ruleSelect(userMessage).filter((id) => candidateIds.includes(id))
  if (ruled.length) return { ids: ruled.slice(0, 4), engine: 'rule' }
  return { ids: candidateIds.slice(0, 4), engine: 'rule' }
}

async function llmSelect(userMessage: string, candidateIds: string[], relaxNote = ''): Promise<string[]> {
  const useDeepSeek = Boolean(env.DEEPSEEK_API_KEY)
  const baseUrl = useDeepSeek ? env.DEEPSEEK_BASE_URL : env.AI_BASE_URL
  const apiKey = useDeepSeek ? env.DEEPSEEK_API_KEY : env.AI_API_KEY
  const model = useDeepSeek ? env.DEEPSEEK_MODEL : env.AI_MODEL

  // 候选集已由确定性规则收窄，这里只给候选，LLM 无从「跑出」约束之外
  const pool = candidateIds.map((id) => CATALOG_INDEX.get(id)).filter((g): g is CatalogGame => Boolean(g))
  const list = pool.map((g) => `id:${g.id}|${g.name}|类型:${g.genres.join('/')}|标签:${g.tags.join('/')}|评分:${g.rating}|价格:${fmtPrice(g.price)}`).join('\n')
  const strict = candidateIds.length < catalog.length

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: `${strict ? '这是经过硬性条件筛选后的候选游戏（已满足用户的全部明确要求）：' : '平台目录如下（共 ' + catalog.length + ' 款）：'}\n${list}\n只根据候选返回最匹配用户需求的 1-4 个游戏 id，JSON 格式：{"gameIds":["id1","id2"]}。只能返回候选列表里存在的 id，不得编造，不得新增。只输出 JSON。${relaxNote}`,
        },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' },
    }),
  })
  if (!res.ok) throw new Error(`LLM API ${res.status}: ${await res.text().catch(() => '')}`)
  const data = await res.json()
  const content: string = data?.choices?.[0]?.message?.content ?? ''
  const parsed = JSON.parse(content) as { gameIds?: unknown }
  const ids = Array.isArray(parsed.gameIds)
    ? (parsed.gameIds as unknown[]).filter((x): x is string => typeof x === 'string')
    : []
  const allowed = new Set(candidateIds)
  return ids.filter((id) => allowed.has(id))
}

// ───────────────────────── 第 2 遍：生成锚定推荐语 ─────────────────────────
async function composeText(userMessage: string, games: CatalogGame[]): Promise<string> {
  if (!games.length) {
    return '抱歉，我没在目录里找到完全匹配的游戏。你可以换个说法，比如告诉我喜欢的类型（Roguelike / 像素风 / 魂类…）或具体游戏名，我来帮你精准筛选～'
  }
  const facts = games.map(describe).join('\n')
  if (env.DEEPSEEK_API_KEY || env.AI_API_KEY) {
    try {
      return await llmCompose(userMessage, facts)
    } catch (e) {
      console.warn('[AI] LLM 润色失败，使用模板：', e instanceof Error ? e.message : e)
    }
  }
  return templateText(games)
}

async function llmCompose(userMessage: string, facts: string): Promise<string> {
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
          content: `你是 GameVibe 的推荐语撰写助手。下面是关于已选游戏的【唯一真实事实】，你只能基于这些事实写推荐语，绝对禁止编造价格、评分、类型或任何目录外信息。用 2-4 句中文，友好、专业、有说服力。\n\n真实事实：\n${facts}`,
        },
        { role: 'user', content: `用户需求：${userMessage}\n请基于上面的真实事实写一段推荐语，直接输出文字，不要使用 JSON 格式。` },
      ],
      temperature: 0.5,
    }),
  })
  if (!res.ok) throw new Error(`LLM API ${res.status}: ${await res.text().catch(() => '')}`)
  const data = await res.json()
  const text: string = (data?.choices?.[0]?.message?.content ?? '').trim()
  if (!text) throw new Error('empty text')
  return text
}

/** 无 LLM 时的兜底模板：所有事实均来自真实目录 */
function templateText(games: CatalogGame[]): string {
  const lines = games.map((g) => {
    const price = fmtPrice(g.price)
    return `《${g.name}》——${g.genres.join('/')}，评分 ${g.rating}，价格 ${price}。关键词：${g.tags.slice(0, 3).join('、')}。`
  })
  return `为你精选了 ${games.length} 款：\n` + lines.join('\n')
}

// ───────────────────────── 规则引擎（无 Key / LLM 失败兜底） ─────────────────────────
function ruleSelect(userMessage: string): string[] {
  const msg = userMessage.toLowerCase().trim()
  const pick = (pred: (g: CatalogGame) => boolean) => catalog.filter(pred)
  const shuffle = <T>(arr: T[]): T[] => [...arr].sort(() => Math.random() - 0.5)
  const take = (arr: CatalogGame[], n: number) => shuffle(arr).slice(0, Math.min(n, arr.length))

  if (/^(你好|hi|hello|嗨|hey|您好|哈喽|早上好|晚上好|在吗|在不在|有人吗|测试)/i.test(msg)) {
    return take(catalog.filter((g) => g.rating >= 9), 3).map((g) => g.id)
  }
  if (/^(谢谢|感谢|bye|再见|拜拜|好的|ok|嗯|不错|厉害|牛)/i.test(msg)) {
    return []
  }
  if (msg.includes('免费')) {
    return take(pick((g) => g.price === 0), 4).map((g) => g.id)
  }
  if (msg.includes('像素') || msg.includes('独立游戏') || msg.includes('indie')) {
    return take(pick((g) => g.tags.some((t) => t.includes('像素')) || g.genres.includes('独立')), 4).map((g) => g.id)
  }
  if (msg.includes('roguelike') || msg.includes('肉鸽')) {
    return take(pick((g) => g.genres.includes('Roguelike') || g.tags.some((t) => t.includes('肉鸽'))), 4).map((g) => g.id)
  }
  if (msg.includes('魂') || msg.includes('高难度') || msg.includes('受苦')) {
    return take(pick((g) => g.genres.includes('魂类') || g.tags.some((t) => t.includes('魂') || t.includes('高难度') || t.includes('动作'))), 4).map((g) => g.id)
  }
  if (msg.includes('类似') || msg.includes('相似') || msg.includes('像')) {
    const target = catalog.find((g) => msg.includes(g.name.toLowerCase()))
    if (target) {
      const sim = catalog.filter((g) => g.tags.some((t) => target.tags.includes(t)) && g.id !== target.id)
      return take(sim, 4).map((g) => g.id)
    }
  }
  if (msg.includes('高分') || msg.includes('评分') || msg.includes('神作') || msg.includes('最好的')) {
    return take([...catalog].filter((g) => g.rating >= 9.5).sort((a, b) => b.rating - a.rating), 4).map((g) => g.id)
  }
  if (msg.includes('新') || msg.includes('最近') || msg.includes('新出') || msg.includes('新作')) {
    return take(catalog, 4).map((g) => g.id)
  }
  if (msg.includes('开放世界') || msg.includes('rpg') || msg.includes('角色扮演')) {
    return take(pick((g) => g.genres.includes('RPG') || g.genres.includes('开放世界')), 4).map((g) => g.id)
  }
  if (msg.includes('射击') || msg.includes('fps') || msg.includes('枪')) {
    return take(pick((g) => g.genres.includes('FPS') || g.genres.includes('射击') || g.tags.some((t) => t.includes('射击'))), 4).map((g) => g.id)
  }
  if (msg.includes('休闲') || msg.includes('放松') || msg.includes('轻松') || msg.includes('治愈')) {
    return take(pick((g) => g.tags.some((t) => t.includes('休闲') || t.includes('治愈') || t.includes('轻松'))), 4).map((g) => g.id)
  }
  const topRated = [...catalog].sort((a, b) => b.rating - a.rating).slice(0, 8)
  if (msg.length <= 4) {
    return take(topRated, 4).map((g) => g.id)
  }
  const fuzzy = catalog.filter(
    (g) => g.tags.some((t) => msg.includes(t)) || g.genres.some((genre) => msg.includes(genre)) || msg.includes(g.name.toLowerCase()),
  )
  if (fuzzy.length) return take(fuzzy, 4).map((g) => g.id)
  return take(topRated, 4).map((g) => g.id)
}

// ───────────────────────── AI 精选（主页） ─────────────────────────
// 每日从高分库中轮选 3 款，AI 撰写开场白 + 规则生成每款理由；无 key 时整体规则兜底。
const SPOTLIGHT_TTL = 30 * 60 * 1000
let spotlightCache: { until: number; data: SpotlightResult } | null = null

export interface SpotlightGame {
  id: string
  name: string
  reason: string
}
export interface SpotlightResult {
  ok: true
  aiPowered: boolean
  updatedAt: number
  text: string
  games: SpotlightGame[]
}

function pickSpotlightGames(): CatalogGame[] {
  const top = [...catalog].sort((a, b) => b.rating - a.rating).slice(0, 12)
  const dayIdx = Math.floor(Date.now() / 86400000)
  const start = dayIdx % Math.max(1, top.length - 2)
  return [top[start], top[start + 1], top[start + 2]].filter(Boolean)
}

async function composeSpotlight(games: CatalogGame[]): Promise<{ text: string; aiPowered: boolean }> {
  const facts = games.map(describe).join('\n')
  if (env.DEEPSEEK_API_KEY || env.AI_API_KEY) {
    try {
      const text = await llmCompose('为 GameVibe「今日 AI 精选」写一段 2-3 句开场白，自然推荐这三款游戏，不要逐一点名罗列', facts)
      return { text, aiPowered: true }
    } catch (e) {
      console.warn('[AI] spotlight 润色失败，用模板：', e instanceof Error ? e.message : e)
    }
  }
  const names = games.map((g) => `《${g.name}》`).join('、')
  return {
    text: `今日 AI 精选为你带来 ${names}。都是口碑与热度兼具的佳作，看看哪款对你的胃口。`,
    aiPowered: false,
  }
}

export async function getAISpotlight(): Promise<SpotlightResult> {
  if (spotlightCache && spotlightCache.until > Date.now()) return spotlightCache.data
  const games = pickSpotlightGames()
  const { text, aiPowered } = await composeSpotlight(games)
  const data: SpotlightResult = {
    ok: true,
    aiPowered,
    updatedAt: Date.now(),
    text,
    games: games.map((g) => ({
      id: g.id,
      name: g.name,
      reason: `${g.genres.join('/')} · 评分 ${g.rating}${g.price === 0 ? ' · 免费' : ` · ¥${g.price}`}`,
    })),
  }
  spotlightCache = { until: Date.now() + SPOTLIGHT_TTL, data }
  return data
}

// ───────────────────────── AI 个性化解说（画像驱动推荐） ─────────────────────────
// 输入是已经算好的画像事实块 + 候选游戏真实事实；模型只能引用这些事实，
// 返回的 id 会被硬过滤到候选集内，杜绝「推荐目录外的游戏」。
export interface PersonalizedPick {
  id: string
  reason: string
}
export interface PersonalizedNarrative {
  aiPowered: boolean
  headline: string
  picks: PersonalizedPick[]
}

export async function composePersonalizedNarrative(
  facts: string,
  candidateIds: string[],
  fallback: PersonalizedNarrative,
): Promise<PersonalizedNarrative> {
  if (!(env.DEEPSEEK_API_KEY || env.AI_API_KEY) || !candidateIds.length) return fallback

  const allowed = new Set(candidateIds)
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
            content: `你是 GameVibe 的个性化推荐解说助手。下面给出【玩家画像】与【候选游戏真实事实】。
你只能引用这些事实，绝对禁止编造价格、评分、类型或其他目录外信息。
输出 JSON：{"headline":"1-2 句，概括这位玩家的口味并自然引出推荐","picks":[{"id":"候选游戏 id","reason":"不超过 40 字，说明它为何契合这位玩家"}]}
picks 至少 1 条、最多 4 条，id 必须来自候选列表，不得新增或改写。只输出 JSON。`,
          },
          { role: 'user', content: `${facts}\n\n候选游戏 id 列表：${candidateIds.join(', ')}` },
        ],
        temperature: 0.4,
        response_format: { type: 'json_object' },
      }),
    })
    if (!res.ok) throw new Error(`LLM API ${res.status}: ${(await res.text().catch(() => '')).slice(0, 160)}`)
    const data = await res.json()
    const content: string = data?.choices?.[0]?.message?.content ?? ''
    const start = content.indexOf('{')
    const end = content.lastIndexOf('}')
    if (start === -1 || end === -1) throw new Error('no JSON in response')
    const parsed = JSON.parse(content.slice(start, end + 1)) as { headline?: unknown; picks?: unknown }

    const picks: PersonalizedPick[] = Array.isArray(parsed.picks)
      ? (parsed.picks as any[])
          .filter((p) => p && typeof p.id === 'string' && allowed.has(p.id))
          .map((p) => ({ id: p.id as string, reason: String(p.reason ?? '').trim().slice(0, 60) }))
          .filter((p) => p.reason)
          .slice(0, 4)
      : []
    const headline = String(parsed.headline ?? '').trim()
    if (!headline || !picks.length) throw new Error('incomplete narrative')

    return { aiPowered: true, headline, picks }
  } catch (e) {
    console.warn('[AI] 个性化解说失败，使用规则兜底：', e instanceof Error ? e.message : e)
    return fallback
  }
}

// ───────────────────────── AI 一句话点评（详情页） ─────────────────────────
const reviewCache = new Map<string, { until: number; data: ReviewResult }>()

export interface ReviewResult {
  ok: true
  aiPowered: boolean
  id: string
  name: string
  review: string
}

export async function getAIReview(id: string): Promise<ReviewResult | null> {
  const g = CATALOG_INDEX.get(id)
  if (!g) return null
  const cached = reviewCache.get(id)
  if (cached && cached.until > Date.now()) return cached.data

  let review = ''
  let aiPowered = false
  if (env.DEEPSEEK_API_KEY || env.AI_API_KEY) {
    try {
      review = await llmCompose(`为《${g.name}》写一句 30 字以内的中文点评，吸引人、只基于真实事实`, describe(g))
      aiPowered = true
    } catch {
      review = ''
    }
  }
  if (!review) {
    review = `《${g.name}》是一款${g.genres.join('/')}作品，评分高达 ${g.rating}${
      g.price === 0 ? '，且完全免费' : `，售价 ¥${g.price}`
    }，适合喜欢${g.tags.slice(0, 2).join('、')}的玩家。`
  }
  const data: ReviewResult = { ok: true, aiPowered, id: g.id, name: g.name, review }
  reviewCache.set(id, { until: Date.now() + 60 * 60 * 1000, data })
  return data
}
