// Step D 校验：口碑归纳接口 vs 数据库真实评论
// 关键断言：接口返回的每一条引用，必须是库里某条评论的**逐字原文**（防编造）
// 用法：node --experimental-strip-types --experimental-sqlite --no-warnings scripts/verifyDigest.ts
import { DatabaseSync } from 'node:sqlite'

const BASE = process.env.BASE || 'http://localhost:8792'
const DB_PATH = 'D:/GameVibe/gamevibe/server/db/data/gamevibe.db'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const IDS = [
  'elden-ring', 'baldurs-gate-3', 'hades-2', 'palworld', 'cyberpunk-2077',
  'stardew-valley', 'lies-of-p', 'valorant', 'dead-cells', 'hollow-knight',
  'cs2', 'dave-the-diver', 'disco-elysium', 'monster-hunter-wilds',
  'vampire-survivors', 'god-of-war',
]

// 后端有限流（约 10 次/窗口），校验脚本用尽时退避重试
async function get(url: string): Promise<Response> {
  for (let i = 0; i < 6; i++) {
    const res = await fetch(url)
    if (res.status !== 429) return res
    await sleep(1500 * (i + 1))
  }
  return fetch(url)
}

const db = new DatabaseSync(DB_PATH)
const rows = db.prepare('SELECT game_id, content FROM reviews WHERE content IS NOT NULL').all() as any[]
const byGame = new Map<string, string[]>()
for (const r of rows) {
  if (!byGame.has(r.game_id)) byGame.set(r.game_id, [])
  byGame.get(r.game_id)!.push(r.content)
}

const out: string[] = []
let pass = 0
let fail = 0
const ok = (n: string, c: boolean, d = '') => {
  if (c) { pass++ } else { fail++; out.push(`  FAIL ${n}${d ? ' — ' + d : ''}`) }
}

for (const id of IDS) {
  const res = await get(`${BASE}/api/ai/reviewDigest?gameId=${id}`)
  if (!res.ok) { ok(id, false, `HTTP ${res.status}`); continue }
  const d: any = await res.json()
  const real = byGame.get(id) || []

  ok(`${id} count 与库一致`, d.count === real.length, `api=${d.count} db=${real.length}`)

  const themes = [...(d.consensus || []), ...(d.divergence || [])]
  let quotes = 0
  let fake = 0
  let badIdx = 0
  for (const t of themes) {
    if (!t.theme || !t.summary) badIdx++
    for (const q of t.quotes || []) {
      quotes++
      if (!real.includes(q.text)) fake++ // 逐字相等才算真
    }
  }
  ok(`${id} 引用零编造`, fake === 0, `quotes=${quotes} fake=${fake}`)
  ok(`${id} 主题字段完整`, badIdx === 0, `bad=${badIdx}`)
  if (d.count >= 3) ok(`${id} 有主题归纳`, themes.length >= 1, `themes=${themes.length}`)

  const distSum = (d.distribution || []).reduce((a: number, x: any) => a + x.count, 0)
  ok(`${id} 评分分布自洽`, distSum === d.count, `dist=${distSum} count=${d.count}`)

  out.push(
    `  ${id.padEnd(20)} count=${String(d.count).padStart(2)} avg=${d.average} themes=${themes.length} quotes=${quotes} ai=${d.aiPowered}`,
  )
  await sleep(500)
}

const nf = await get(`${BASE}/api/ai/reviewDigest?gameId=not-a-real-game`)
ok('未收录游戏 → 404', nf.status === 404, `status=${nf.status}`)
const np = await get(`${BASE}/api/ai/reviewDigest`)
ok('缺 gameId → 400', np.status === 400, `status=${np.status}`)

out.unshift('──── 各游戏口碑归纳 ────')
out.push('')
out.push(`──── 汇总：通过 ${pass} / 失败 ${fail} ────`)
console.log(out.join('\n'))
process.exit(fail === 0 ? 0 : 1)
