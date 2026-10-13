// 实时数据与全网搜索验证（本地/线上通用）
//
// 覆盖：
//   1) /api/diag/realtime  —— Steam 官方实时在线接口可用性
//   2) /api/live           —— 逐指标 real 标记 + 与 diag 数据一致（真实值必须是真值）
//   3) /api/diag/providers —— Serper / Tavily 可用性
//   4) /api/ai/chat        —— 全网搜索来源（kind=web）+ 链接零编造 + 正文不含 http
//
// 用法：
//   node --experimental-strip-types --no-warnings scripts/verifyRealtime.ts
//   环境变量：API_BASE（默认 http://localhost:8792）
//             EXPECT_REALTIME=0 时允许实时在线不可达（线上沙箱场景）

const BASE = process.env.API_BASE || 'http://localhost:8792'
const EXPECT_REALTIME = process.env.EXPECT_REALTIME !== '0'

let pass = 0
let fail = 0
function ok(name: string, cond: boolean, extra = ''): void {
  if (cond) {
    pass++
    console.log(`✅ ${name}${extra ? ' — ' + extra : ''}`)
  } else {
    fail++
    console.log(`❌ ${name}${extra ? ' — ' + extra : ''}`)
  }
}

interface SourceItem {
  id: string
  title: string
  url: string
  date: number | null
  source: string
  kind: string
  summary: string
  gameName?: string
}
interface DoneEvent {
  sources?: SourceItem[]
  web?: { used: boolean; reachable: boolean; provider?: string | null; count: number; notes: string[] } | null
}

/** 带 429 退避的 chat 调用（/api/ai/chat 限流 20/分） */
async function chat(token: string, message: string, web: 'auto' | 'on' | 'off'): Promise<{ full: string; done: DoneEvent | null; status: number }> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(`${BASE}/api/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Auth-Token': token },
      body: JSON.stringify({ message, web }),
    })
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 8000))
      continue
    }
    const text = await res.text()
    let full = ''
    let done: DoneEvent | null = null
    for (const line of text.split('\n')) {
      const t = line.trim()
      if (!t.startsWith('data:')) continue
      try {
        const evt = JSON.parse(t.slice(5).trim())
        if (evt.type === 'token') full += evt.content
        else if (evt.type === 'done') done = evt
      } catch {
        /* 忽略 */
      }
    }
    return { full, done, status: res.status }
  }
  return { full: '', done: null, status: 429 }
}

console.log(`\n基准地址：${BASE}\n════════════════════════════════`)

// ───────── 1. 实时在线接口 ─────────
const rtRes = await fetch(`${BASE}/api/diag/realtime`)
const rt = (await rtRes.json()) as {
  reachable: boolean
  covered: number
  total: number
  sum: number
  byGame: Record<string, number>
  note: string | null
}
console.log('\n【1】Steam 官方实时在线接口')
console.log(`    reachable=${rt.reachable} covered=${rt.covered}/${rt.total} sum=${rt.sum} note=${rt.note ?? '-'}`)
if (EXPECT_REALTIME) {
  ok('实时在线接口可达', rt.reachable === true, rt.note ?? '')
  ok(`覆盖多款游戏（${rt.covered}/${rt.total}）`, rt.covered >= 10)
  ok('合计在线人数为正', rt.sum > 0, `sum=${rt.sum}`)
  ok('单款取到真实值（CS2）', typeof rt.byGame['cs2'] === 'number' && rt.byGame['cs2'] > 1000, `cs2=${rt.byGame['cs2']}`)
} else {
  ok('不可达时如实标注 note', rt.reachable === false ? Boolean(rt.note) : true)
}

// ───────── 2. /api/live 真实标记 ─────────
console.log('\n【2】/api/live 逐指标真实标记')
const lv = (await (await fetch(`${BASE}/api/live`)).json()) as {
  simulated: boolean
  source: string
  real: Record<string, boolean>
  realtime: { covered: number; total: number; note?: string }
  global: { onlinePlayers: number; deals: number; newToday: number }
}
console.log(`    simulated=${lv.simulated} real=${JSON.stringify(lv.real)}`)
console.log(`    source=${lv.source}`)
ok('real 标记齐全（5 项）', Object.keys(lv.real).length === 5)
ok('「收录游戏」标记为真实', lv.real.totalGames === true)
ok('「直播观众」如实标记为演示（未接 Twitch）', lv.real.streamingViewers === false)
if (EXPECT_REALTIME) {
  ok('「在线玩家」标记为真实', lv.real.onlinePlayers === true)
  ok('在线玩家数 = 实时接口合计（真实值一致）', lv.global.onlinePlayers === rt.sum, `${lv.global.onlinePlayers} vs ${rt.sum}`)
} else {
  ok('实时不可达时「在线玩家」标记为演示', lv.real.onlinePlayers === false)
}
ok('商店计数类标记与 /api/diag 一致（特价>0 视为真实）', lv.real.deals === (lv.global.deals > 0))

// ───────── 3. provider 可用性 ─────────
console.log('\n【3】全网搜索 provider（Serper / Tavily）')
const pv = (await (await fetch(`${BASE}/api/diag/providers`)).json()) as {
  anyUsable: boolean
  results: { name: string; ok: boolean; ms: number; detail: string }[]
}
for (const r of pv.results) console.log(`    ${r.name.padEnd(8)} ok=${r.ok} ms=${r.ms} ${r.detail}`)

// ───────── 4. chat 全网搜索来源 ─────────
console.log('\n【4】AI 助手联网检索（含全网来源）')
const loginRes = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: '糖糖不吃糖@seed.local', password: 'seedpass1234' }),
})
const token = ((await loginRes.json()) as { token?: string }).token || ''
ok('登录取得 token', Boolean(token))

const r1 = await chat(token, '最近有什么新游戏资讯', 'auto')
const s1 = r1.done?.sources ?? []
console.log(`    status=${r1.status} 来源=${s1.length} 条 provider=${r1.done?.web?.provider ?? '-'}`)
ok('HTTP 200', r1.status === 200)
ok('触发联网', r1.done?.web?.used === true)
ok('取到来源条目', s1.length > 0, `${s1.length} 条`)
ok('正文不含 http（模型未输出链接）', !/http/i.test(r1.full))
ok(
  '所有来源链接为真实地址',
  s1.every((s) => /^https?:\/\//.test(s.url)),
)
const kinds = [...new Set(s1.map((s) => s.kind))]
console.log(`    来源类别：${kinds.join(', ')}`)
if (pv.anyUsable) {
  const webItems = s1.filter((s) => s.kind === 'web')
  ok(`含全网搜索来源（${webItems.length} 条）`, webItems.length > 0)
  ok('全网来源带真实标题与来源名', webItems.every((s) => s.title.length > 0 && s.source.length > 0))
  ok('provider 如实回报', typeof r1.done?.web?.provider === 'string', String(r1.done?.web?.provider))
} else {
  console.log('    （provider 本环境不可用，跳过全网来源断言）')
}

// 指定游戏 → 应附实时在线人数（本机可达时）
const r2 = await chat(token, '艾尔登法环最近有什么更新', 'auto')
console.log(`\n    指定游戏：status=${r2.status} 来源=${r2.done?.sources?.length ?? 0} 条`)
ok('指定游戏：HTTP 200', r2.status === 200)
if (EXPECT_REALTIME) {
  ok('指定游戏：正文含实时在线人数（本地注入）', /当前 Steam 在线\s*[\d,，]+\s*人/.test(r2.full))
  ok('实时人数为真实值（与 diag 一致）', r2.full.includes(rt.byGame['elden-ring']?.toLocaleString('zh-CN') ?? '__none__'), `elden-ring=${rt.byGame['elden-ring']}`)
  ok('实时人数行标注来源为 Steam 官方', r2.full.includes('Steam 官方接口实时值'))
} else {
  ok('实时不可达：正文不含编造的在线人数', !/当前 Steam 在线/.test(r2.full))
}

// 关闭联网 → 不应有来源
const r3 = await chat(token, '最近有什么新游戏资讯', 'off')
ok('关闭联网时不出来源', (r3.done?.sources?.length ?? 0) === 0)

console.log(`\n════════════════════════════════`)
console.log(`通过 ${pass} / 失败 ${fail}`)
process.exitCode = fail === 0 ? 0 : 1
