/**
 * 线上「联网检索」契约验证（针对部署沙箱的出网现状）
 *
 * 线上事实：沙箱到 Steam 是「时通时不通」——
 *   store.steampowered.com 偶尔可达（378ms），api.steampowered.com 基本不可达（超时）。
 * 因此线上只验证「契约」而非「必有数据」：
 *   - 资讯意图必须走联网分支（web.used=true，engine 以 web 开头）
 *   - 可达 ↔ 来源非空，不可达 ↔ 来源必须为空（绝不编造）
 *   - 正文永不出现 URL（链接只由系统注入）
 *
 * 用法：GV_BASE=https://gamevibe.app.workbuddy.host node --experimental-strip-types scripts/verifyWebProd.ts
 */

const BASE = process.env.GV_BASE || 'https://gamevibe.app.workbuddy.host'
const EMAIL = process.env.GV_EMAIL || '糖糖不吃糖@seed.local'
const PASSWORD = process.env.GV_PASSWORD || 'seedpass1234'

let pass = 0
let fail = 0
const failures: string[] = []

function ok(name: string, cond: boolean, extra = ''): void {
  if (cond) {
    pass++
    console.log(`  ✅ ${name}${extra ? ' — ' + extra : ''}`)
  } else {
    fail++
    failures.push(name + (extra ? ` — ${extra}` : ''))
    console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`)
  }
}

async function chat(token: string, message: string, web: string, attempt = 0): Promise<any> {
  const res = await fetch(`${BASE}/api/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Auth-Token': token },
    body: JSON.stringify({ message, web }),
  })
  if (res.status === 429 && attempt < 6) {
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
    return chat(token, message, web, attempt + 1)
  }
  const text = await res.text()
  let full = ''
  let done: any = null
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t.startsWith('data:')) continue
    const p = t.slice(5).trim()
    if (!p) continue
    try {
      const e = JSON.parse(p)
      if (e.type === 'token') full += e.content
      else if (e.type === 'done') done = e
    } catch {
      /* ignore */
    }
  }
  return { full, done, status: res.status }
}

async function main(): Promise<void> {
  const health = await fetch(`${BASE}/api/health`).then((r) => r.json() as any)
  ok('线上 health 正常', health?.ok === true, `v=${health?.version}`)

  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  }).then((r) => r.json() as any)
  const token = login?.token
  ok('线上演示账号登录成功', Boolean(token))
  if (!token) return

  for (const [label, msg] of [
    ['全局新游动态', '最近有什么新游戏'],
    ['指定游戏资讯', '艾尔登法环最近有什么更新'],
  ] as const) {
    console.log(`\n── 线上：${label} ──`)
    const r = await chat(token, msg, 'auto')
    const web = r.done?.web
    const sources = Array.isArray(r.done?.sources) ? r.done.sources : []
    console.log(`  engine=${r.done?.engine} web=${JSON.stringify(web)} sources=${sources.length}`)
    if (web?.notes?.length) console.log(`  notes: ${web.notes.join(' | ')}`)
    if (sources.length) {
      console.log(`  来源示例：${sources.slice(0, 2).map((s: any) => s.title).join(' | ')}`)
      console.log(`  链接示例：${sources[0]?.url}`)
    }
    ok(`${label}：走联网分支`, web?.used === true && String(r.done?.engine || '').startsWith('web'))
    ok(
      `${label}：可达↔有来源，不可达↔无来源（诚实）`,
      web?.reachable ? sources.length > 0 : sources.length === 0,
      `reachable=${web?.reachable} sources=${sources.length}`,
    )
    ok(
      `${label}：来源链接均为 http(s)`,
      sources.every((s: any) => /^https?:\/\//.test(s.url)),
    )
    ok(`${label}：正文不含 URL（链接由系统注入）`, !/https?:\/\//.test(r.full))
  }

  // 普通推荐不应联网
  console.log(`\n── 线上：普通推荐 ──`)
  const r3 = await chat(token, '推荐几款免费游戏', 'auto')
  console.log(`  engine=${r3.done?.engine} web=${JSON.stringify(r3.done?.web)}`)
  ok('普通推荐未触发联网', !r3.done?.web?.used)

  console.log(`\n════════════════════════════════`)
  console.log(`  通过 ${pass} / 失败 ${fail}`)
  if (failures.length) for (const f of failures) console.log(`   - ${f}`)
  console.log(`════════════════════════════════`)
  process.exitCode = fail === 0 ? 0 : 1
}

main().catch((e) => {
  console.error('脚本异常：', e)
  process.exitCode = 2
})
