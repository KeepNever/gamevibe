/**
 * AI 助手「联网检索」端到端验证
 *
 * 走真实 HTTP（需先启动后端 8792）。覆盖：
 *   - 资讯意图 → 联网分支（sources 非空、链接为真实接口原文、零编造）
 *   - 非资讯意图 → 不联网，走站内目录推荐（不回归）
 *   - 关闭开关 → 完全不联网
 *   - 来源条目的链接必须出现在直连 Steam 接口的原始返回里（零编造）
 *
 * 运行（需带可用代理）：HTTPS_PROXY=... NODE_USE_ENV_PROXY=1 node --experimental-strip-types scripts/verifyChatWeb.ts
 */

const BASE = process.env.GV_BASE || 'http://localhost:8792'
const DEMO_EMAIL = '糖糖不吃糖@seed.local'
const DEMO_PASSWORD = 'seedpass1234'

let pass = 0
let fail = 0
const failures: string[] = []

function ok(name: string, cond: boolean, extra = ''): void {
  if (cond) {
    pass++
    console.log(`  ✅ ${name}`)
  } else {
    fail++
    failures.push(name + (extra ? ` — ${extra}` : ''))
    console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`)
  }
}

function section(t: string): void {
  console.log(`\n── ${t} ──`)
}

interface DoneEvent {
  gameIds?: string[]
  constraints?: string[]
  relaxed?: string[]
  engine?: string | null
  sources?: { id: string; title: string; url: string; date: number | null; source: string; kind: string }[]
  web?: {
    used: boolean
    reachable: boolean
    scope: string
    term: string | null
    game: { appid: number; name: string } | null
    count: number
    notes: string[]
  } | null
}

async function login(): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: DEMO_EMAIL, password: DEMO_PASSWORD }),
  })
  if (!res.ok) throw new Error(`登录失败 ${res.status}`)
  const data = (await res.json()) as { token: string }
  return data.token
}

async function chat(
  token: string,
  message: string,
  web: 'auto' | 'on' | 'off',
  attempt = 0,
): Promise<{ full: string; done: DoneEvent | null; status: number }> {
  const res = await fetch(`${BASE}/api/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Auth-Token': token },
    body: JSON.stringify({ message, web }),
  })
  // 限流退避：/api/ai/chat 为 20 次/分钟，连续跑多轮时可能触顶
  if (res.status === 429 && attempt < 6) {
    await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)))
    return chat(token, message, web, attempt + 1)
  }
  const text = await res.text()
  let full = ''
  let done: DoneEvent | null = null
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t.startsWith('data:')) continue
    const payload = t.slice(5).trim()
    if (!payload) continue
    try {
      const e = JSON.parse(payload)
      if (e.type === 'token') full += e.content
      else if (e.type === 'done') done = e as DoneEvent
    } catch {
      /* ignore */
    }
  }
  return { full, done, status: res.status }
}

/** 直连 Steam 新闻接口，拿到「原始链接集合」，用于零编造校验 */
async function directNewsUrls(appid: number): Promise<Set<string>> {
  const url = `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${appid}&count=6&maxlength=400&format=json`
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
  const data = (await res.json()) as { appnews?: { newsitems?: { url: string }[] } }
  return new Set((data.appnews?.newsitems || []).map((n) => n.url))
}

async function main(): Promise<void> {
  const token = await login()
  ok('演示账号登录成功', Boolean(token))

  // ── 1. 指定游戏资讯（应联网） ──
  section('指定游戏资讯（应联网）')
  const r1 = await chat(token, '艾尔登法环最近有什么新闻', 'auto')
  console.log(`  status=${r1.status} engine=${r1.done?.engine} web=${JSON.stringify(r1.done?.web)} sources=${r1.done?.sources?.length ?? 0}`)
  if (r1.done?.web?.notes?.length) console.log(`  notes: ${r1.done.web.notes.join(' | ')}`)
  const s1 = r1.done?.sources ?? []
  ok('触发了联网分支', r1.done?.web?.used === true)
  ok('联网取到数据（reachable）', r1.done?.web?.reachable === true)
  ok('来源条目非空', s1.length > 0)
  ok('解析出了目标游戏', Boolean(r1.done?.web?.game))
  ok('来源链接均为 http(s)', s1.every((s) => /^https?:\/\//.test(s.url)))
  ok('来源标题非空', s1.every((s) => (s.title || '').trim().length > 0))
  ok('正文不含 URL（链接由系统展示，模型不输出）', !/https?:\/\//.test(r1.full))
  ok('engine 标记为联网链路', String(r1.done?.engine || '').startsWith('web'))

  // 零编造：来源链接必须出现在直连接口返回里
  const appid = r1.done?.web?.game?.appid
  if (appid) {
    const urls = await directNewsUrls(appid)
    const newsSrc = s1.filter((s) => s.kind === 'news')
    ok(`来源链接零编造（${newsSrc.length} 条全部来自接口原文）`, newsSrc.every((s) => urls.has(s.url)))
    ok('资讯条目带发布时间', newsSrc.some((s) => s.date !== null))
  }

  // ── 2. 全局新游动态（应联网） ──
  section('全局新游动态（应联网）')
  const r2 = await chat(token, '最近有什么新游戏', 'auto')
  console.log(`  engine=${r2.done?.engine} scope=${r2.done?.web?.scope} sources=${r2.done?.sources?.length ?? 0}`)
  ok('触发联网且取到数据', r2.done?.web?.used === true && r2.done?.web?.reachable === true)
  ok('全局来源非空', (r2.done?.sources?.length ?? 0) > 0)
  const s2 = r2.done?.sources ?? []
  const kinds2 = new Set(s2.map((s) => s.kind))
  ok(`全局来源条数充足（${s2.length} 条 ≥ 15）`, s2.length >= 15)
  ok(`覆盖多个类别（${[...kinds2].join('/') || '-'}）`, kinds2.size >= 3)

  // ── 3. 普通推荐（不应联网，回归检查） ──
  section('普通推荐（不应联网）')
  const r3 = await chat(token, '推荐几款免费游戏', 'auto')
  console.log(`  engine=${r3.done?.engine} web=${JSON.stringify(r3.done?.web)} gameIds=${r3.done?.gameIds?.join(',')}`)
  ok('未触发联网分支', !r3.done?.web?.used)
  ok('仍返回站内推荐', (r3.done?.gameIds?.length ?? 0) > 0)
  ok('engine 不是联网链路', !String(r3.done?.engine || '').startsWith('web'))

  // ── 4. 关闭开关（强制不联网） ──
  section('关闭开关')
  const r4 = await chat(token, '艾尔登法环最近有什么新闻', 'off')
  console.log(`  web=${JSON.stringify(r4.done?.web)} engine=${r4.done?.engine}`)
  ok('force=off 时不联网', !r4.done?.web?.used)

  // ── 5. 强制联网（无明显意图词也应联网） ──
  section('强制联网开关')
  const r5 = await chat(token, '赛博朋克2077', 'on')
  console.log(`  engine=${r5.done?.engine} scope=${r5.done?.web?.scope} game=${r5.done?.web?.game?.name ?? '-'} sources=${r5.done?.sources?.length ?? 0}`)
  ok('force=on 时强制联网并取到数据', r5.done?.web?.used === true && (r5.done?.sources?.length ?? 0) > 0)

  // ── 6. 口味类（强制联网）→ 相关游戏 + 全局动态 ──
  section('口味类（强制联网）')
  const r6 = await chat(token, '我喜欢像素风和独立游戏', 'on')
  const s6 = r6.done?.sources ?? []
  const kinds6 = new Set(s6.map((s) => s.kind))
  console.log(`  engine=${r6.done?.engine} scope=${r6.done?.web?.scope} sources=${s6.length} kinds=${[...kinds6].join(',')}`)
  const related6 = s6.filter((s) => s.kind === 'related')
  console.log('  related:')
  for (const s of related6) console.log(`    [${s.source}] ${s.title} -> ${s.url}`)
  ok('口味类触发联网且取到数据', r6.done?.web?.used === true && s6.length > 0)
  ok(`来源条数充足（${s6.length} 条 ≥ 15）`, s6.length >= 15)
  ok(`包含「相关游戏」条目（${related6.length} 条）`, related6.length > 0)
  ok('相关条目链接为绝对地址', related6.every((s) => /^https?:\/\//.test(s.url)))
  ok(
    '相关条目均锚定真实 Steam appid',
    related6.every((s) => typeof (s as { appid?: number }).appid === 'number'),
  )
  ok('相关条目带游戏名标注', related6.every((s) => Boolean((s as { gameName?: string }).gameName)))
  ok('相关游戏卡片随附', (r6.done?.gameIds?.length ?? 0) > 0)

  console.log(`\n════════════════════════════════`)
  console.log(`  通过 ${pass} / 失败 ${fail}`)
  if (failures.length) {
    console.log('  失败项：')
    for (const f of failures) console.log(`   - ${f}`)
  }
  console.log(`════════════════════════════════`)
  process.exitCode = fail === 0 ? 0 : 1
}

main().catch((e) => {
  console.error('脚本异常：', e)
  process.exitCode = 2
})
