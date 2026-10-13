// Steam 全球成就数据（免密钥）
//
// 数据源：https://steamcommunity.com/stats/{appid}/achievements/?l=schinese
//   这是 Steam 社区的公开成就页，无需 API key，含成就名、描述、图标**与全球解锁率**。
//   注意 GetSchemaForGame 是需要 key 的（实测 400 "Required parameter 'key' is missing"），
//   GetGlobalAchievementPercentagesForApp 虽免密钥但只给内部 API 名（ACH.WAKE_UP），
//   没法直接展示 —— 所以走这个 HTML 页，解析出可读的中文成就名。
//
// 口径说明（前端必须一并展示，避免把派生值说成官方指标）：
//   - percent 是 Valve 公布的**全球解锁率**，本身是官方数据；
//   - avgPercent / 难度分档 / 全成就占比上限 都是**本地按解锁率算出来的派生值**，不是 Steam 指标。

import { resolveSteamAppId } from './steamAppIds.ts'

const ACH_PAGE = (appid: string | number) =>
  `https://steamcommunity.com/stats/${appid}/achievements/?l=schinese`
const CACHE_TTL = 6 * 60 * 60 * 1000 // 成就与全球解锁率变化很慢
const FAIL_TTL = 5 * 60 * 1000
const FETCH_TIMEOUT = 12000
const MAX_ITEMS = 150

const cache = new Map<string, { data: AchievementsResult; until: number }>()

export interface SteamAchievement {
  apiName: string
  name: string
  desc: string
  /** 全球解锁率（%）。Steam 未公布时为 null —— 不用 0 冒充 */
  percent: number | null
  iconUrl: string
  iconFallbackUrl: string
}

export interface AchievementBuckets {
  '0-10': number
  '10-25': number
  '25-50': number
  '50-75': number
  '75-100': number
  unknown: number
}

export interface AchievementDifficulty {
  key: 'easy' | 'medium' | 'hard' | 'brutal' | 'nightmare' | 'unknown'
  label: string
  note: string
}

export interface AchievementsResult {
  ok: boolean
  gameId: string
  appid: string
  /** ok=false 时的中文原因 */
  reason?: string
  /** 该游戏成就总数 */
  total: number
  /** 拿到解锁率的成就数（= total - unknown） */
  rated: number
  /** 平均解锁率（派生值） */
  avgPercent: number
  /** 最稀有成就的解锁率（派生值口径下的「全成就占比上限」） */
  ceilingPercent: number
  /** 解锁率低于 10% 的成就占全部已收录成就的比例（%） */
  rareRatio: number
  difficulty: AchievementDifficulty
  buckets: AchievementBuckets
  /** 最难的若干个（按解锁率升序） */
  rarest: SteamAchievement[]
  /** 全部成就（按解锁率升序，无解锁率的排最后；最多 150 条） */
  items: SteamAchievement[]
  truncated: boolean
  fetchedAt: number
  source: 'steamcommunity'
  note: string
}

const NOTE =
  '解锁率来自 Steam 社区成就页（Valve 公布值）；难度分档、平均解锁率、全成就占比上限均为本站按解锁率折算的派生值，不是 Steam 官方指标。'

// ── 解析 ────────────────────────────────────────────
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
}

function cleanHtml(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, '')).trim()
}

export function parseAchievements(html: string, appid: string | number): SteamAchievement[] {
  const out: SteamAchievement[] = []
  const rowRe = /<div class="achieveRow[^"]*">([\s\S]*?)<div style="clear: both;"><\/div>\s*<\/div>/g
  let m: RegExpExecArray | null
  while ((m = rowRe.exec(html))) {
    const seg = m[1]
    const h3 = seg.match(/<h3>([\s\S]*?)<\/h3>/)
    if (!h3) continue
    const h5 = seg.match(/<h5>([\s\S]*?)<\/h5>/)
    const pct = seg.match(/<div class="achievePercent">\s*([\d.]+)%/)
    const apiRaw = (seg.match(/<img\s+src="([^"]+)"/)?.[1] || '').split('/').pop() || ''
    const apiName = apiRaw.replace(/\.(jpg|png)$/i, '')
    const name = cleanHtml(h3[1])
    if (!name) continue
    out.push({
      apiName,
      name,
      desc: h5 ? cleanHtml(h5[1]) : '',
      percent: pct ? Number(pct[1]) : null,
      // 页面给的是 shared.akamai 域；统一换成项目常用的 cloudflare 域（线上可达性更稳），
      // akamai 那份留作回退
      iconUrl: apiName
        ? `https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/${appid}/${apiName}.jpg`
        : '',
      iconFallbackUrl: apiName
        ? `https://shared.akamai.steamstatic.com/community_assets/images/apps/${appid}/${apiName}.jpg`
        : '',
    })
  }
  return out
}

function deriveDifficulty(ceiling: number, rated: number): AchievementDifficulty {
  if (!rated) {
    return { key: 'unknown', label: '无法评估', note: 'Steam 未公布这款游戏的成就解锁率' }
  }
  // 档位按「最稀有成就的解锁率」切。
  // 注意：几乎每款商业游戏都藏着一两个 1% 左右的成就，所以档位不能定得太宽，
  // 否则全都会落进最高的那一档，分档就失去意义（第一版用 15% 起就是这个问题）。
  if (ceiling >= 30) return { key: 'easy', label: '轻松', note: '最难的成就也有三成以上玩家拿到，全成就门槛低' }
  if (ceiling >= 15) return { key: 'medium', label: '适中', note: '最难的成就约一成多玩家完成，需要专门投入' }
  if (ceiling >= 5) return { key: 'hard', label: '硬核', note: '最难的成就只有百分之几的玩家拿到' }
  if (ceiling >= 1) return { key: 'brutal', label: '极硬核', note: '最难的成就解锁率不足 5%，全成就属于少数人' }
  return { key: 'nightmare', label: '噩梦', note: '存在解锁率低于 1% 的成就，全成就近乎极限挑战' }
}

function computeBuckets(items: SteamAchievement[]): AchievementBuckets {
  const b: AchievementBuckets = { '0-10': 0, '10-25': 0, '25-50': 0, '50-75': 0, '75-100': 0, unknown: 0 }
  for (const it of items) {
    const p = it.percent
    if (p == null) b.unknown++
    else if (p < 10) b['0-10']++
    else if (p < 25) b['10-25']++
    else if (p < 50) b['25-50']++
    else if (p < 75) b['50-75']++
    else b['75-100']++
  }
  return b
}

function unavailable(gameId: string, appid: string, reason: string): AchievementsResult {
  return {
    ok: false,
    gameId,
    appid,
    reason,
    total: 0,
    rated: 0,
    avgPercent: 0,
    ceilingPercent: 0,
    rareRatio: 0,
    difficulty: { key: 'unknown', label: '无法评估', note: reason },
    buckets: { '0-10': 0, '10-25': 0, '25-50': 0, '50-75': 0, '75-100': 0, unknown: 0 },
    rarest: [],
    items: [],
    truncated: false,
    fetchedAt: Date.now(),
    source: 'steamcommunity',
    note: NOTE,
  }
}

function describeError(e: unknown): string {
  const code = (e as any)?.cause?.code || (e as any)?.code
  const msg = (e as Error)?.message || String(e)
  if (code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ETIMEDOUT' || /timeout/i.test(msg)) {
    return '连接 Steam 社区超时（当前网络环境可能无法访问 steamcommunity.com）'
  }
  if (code === 'ECONNRESET' || code === 'ECONNREFUSED') return '连接被重置（steamcommunity.com 在当前网络环境不可达）'
  return `请求失败：${msg}`
}

async function fetchAchievements(appid: string | number, gameId: string): Promise<AchievementsResult> {
  try {
    const res = await fetch(ACH_PAGE(appid), {
      headers: {
        // 该页面对匿名 UA 友好；不带 UA 偶发被拒
        'User-Agent': 'Mozilla/5.0 (compatible; GameVibe/1.0)',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
    })
    if (!res.ok) return unavailable(gameId, String(appid), `Steam 社区返回 HTTP ${res.status}`)
    const html = await res.text()

    const items = parseAchievements(html, appid)
    if (!items.length) {
      return unavailable(
        gameId,
        String(appid),
        'Steam 未公布这款游戏的成就（可能没有成就系统，或该页面不可读）',
      )
    }

    const rated = items.filter((i) => i.percent != null) as (SteamAchievement & { percent: number })[]
    // 按解锁率升序排列，无解锁率的排最后
    items.sort((a, b) => (a.percent ?? 101) - (b.percent ?? 101))

    const avg = rated.length ? rated.reduce((n, i) => n + i.percent, 0) / rated.length : 0
    const ceiling = rated.length ? Math.min(...rated.map((i) => i.percent)) : 0
    const rareCount = rated.filter((i) => i.percent < 10).length
    const rareRatio = items.length ? Number(((rareCount / items.length) * 100).toFixed(1)) : 0

    return {
      ok: true,
      gameId,
      appid: String(appid),
      total: items.length,
      rated: rated.length,
      avgPercent: Number(avg.toFixed(1)),
      ceilingPercent: ceiling,
      rareRatio,
      difficulty: deriveDifficulty(ceiling, rated.length),
      buckets: computeBuckets(items),
      rarest: items.slice(0, 8),
      items: items.slice(0, MAX_ITEMS),
      truncated: items.length > MAX_ITEMS,
      fetchedAt: Date.now(),
      source: 'steamcommunity',
      note: NOTE,
    }
  } catch (e) {
    console.warn('[Steam] fetchAchievements 失败:', (e as Error).message)
    return unavailable(gameId, String(appid), describeError(e))
  }
}

// ══════════ 公开 API ══════════

/** 按站内 gameId 取全球成就数据。本站无 Steam 版本的游戏返回 ok=false + 明确原因。 */
export async function getAchievementsByGameId(gameId: string): Promise<AchievementsResult> {
  const appid = resolveSteamAppId(gameId)
  if (!appid) {
    return unavailable(
      gameId,
      '',
      '本站目录里这款游戏没有对应的 Steam 版本（如主机独占、手游或网页游戏），因此没有 Steam 成就数据',
    )
  }
  const key = `ach_${appid}`
  const hit = cache.get(key)
  if (hit && Date.now() < hit.until) return hit.data

  const data = await fetchAchievements(appid, gameId)
  cache.set(key, { data, until: Date.now() + (data.ok ? CACHE_TTL : FAIL_TTL) })
  return data
}
