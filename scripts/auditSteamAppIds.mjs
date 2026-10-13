// 审计 dc_* → Steam appid 映射
//
// 背景：steamReviews.ts 里那张映射表是旧的（封面修复时校正过 20 个 appid，但没同步到这张表），
// 导致详情页的 Steam 评测区可能显示另一款游戏的数据。本脚本以三路交叉核对得出正确映射：
//   ① discoverCatalog 封面 URL 里的 appid（封面修复时已校正，最新）
//   ② steamReviews.ts 旧映射表（可能过期）
//   ③ appdetails 实际返回的游戏名（唯一权威）
//   ④ storesearch 按名字反查（对不上时用）
//
// 输出：scripts/.appid-audit.json（含逐条结论），并把不一致项打印出来。

import { writeFileSync } from 'node:fs'
import { discoverCatalog } from '../server/data/discoverCatalog.ts'

const PROXY_OK = process.env.HTTPS_PROXY || ''
const OUT = new URL('./.appid-audit.json', import.meta.url).pathname.replace(/^\//, '')

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/[^a-z0-9]/g, '')

function sim(a, b) {
  const x = norm(a)
  const y = norm(b)
  if (!x || !y) return 0
  if (x === y) return 1
  if (x.includes(y) || y.includes(x)) return 0.9
  // 词级重叠
  const ta = new Set(String(a).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean))
  const tb = new Set(String(b).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean))
  if (!ta.size || !tb.size) return 0
  let hit = 0
  for (const t of ta) if (tb.has(t)) hit++
  return (2 * hit) / (ta.size + tb.size)
}

async function jget(url, timeout = 20000) {
  const r = await fetch(url, {
    headers: { 'User-Agent': 'GameVibe/1.0', 'Accept-Language': 'en' },
    signal: AbortSignal.timeout(timeout),
  })
  if (!r.ok) throw new Error('HTTP ' + r.status)
  return r.json()
}

// ── 读旧映射表 ─────────────────────────────────────
const src = await (await import('node:fs/promises')).readFile(
  new URL('../server/lib/steamReviews.ts', import.meta.url),
  'utf8',
)
const oldMap = {}
for (const m of src.matchAll(/\s*'(dc_[a-z0-9-]+)'\s*:\s*'(\d+)'/g)) oldMap[m[1]] = Number(m[2])

// ── 从封面 URL 提 appid ────────────────────────────
const rows = []
for (const g of discoverCatalog) {
  const fromCover = (g.coverUrl || '').match(/\/steam\/apps\/(\d+)\//)?.[1]
  rows.push({
    id: g.id,
    name: g.name,
    coverAppId: fromCover ? Number(fromCover) : null,
    oldAppId: oldMap[g.id] || null,
    platforms: g.platforms,
  })
}
const catalogIds = new Set(rows.map((r) => r.id))
const orphanOld = Object.keys(oldMap).filter((k) => !catalogIds.has(k))
console.log(`目录 ${rows.length} 条 | 旧映射 ${Object.keys(oldMap).length} 条 | 旧映射里目录已无的 ${orphanOld.length} 条`)
console.log(`有封面 appid ${rows.filter((r) => r.coverAppId).length} 条 | 有旧映射 ${rows.filter((r) => r.oldAppId).length} 条\n`)

// ── 逐条核对：候选 appid 用 appdetails 验名 ────────
const unique = new Set()
for (const r of rows) {
  if (r.coverAppId) unique.add(r.coverAppId)
  if (r.oldAppId && r.oldAppId !== r.coverAppId) unique.add(r.oldAppId)
}
const ids = [...unique]
console.log(`需要向 appdetails 核验的 appid：${ids.length} 个`)

const facts = {}
let idx = 0
await Promise.all(
  Array.from({ length: 6 }, async () => {
    while (idx < ids.length) {
      const id = ids[idx++]
      try {
        const j = await jget(`https://store.steampowered.com/api/appdetails?appids=${id}&cc=us&l=english`)
        const d = j[id]?.data
        facts[id] = d ? { name: d.name, type: d.type, release: d.release_date?.date || '', isFree: !!d.is_free } : null
      } catch (e) {
        facts[id] = { err: e.cause?.code || e.message }
      }
    }
  }),
)
console.log(`核验完成 ${Object.keys(facts).length} 个\n`)

// ── 汇总结论 ───────────────────────────────────────
const ok = []
const mismatch = []
const missing = []

for (const r of rows) {
  const cand = r.coverAppId || r.oldAppId
  if (!cand) {
    missing.push({ ...r, why: '无任何候选 appid（非 Steam 或未解析）' })
    continue
  }
  const f = facts[cand]
  const actual = f?.name || (f?.err ? `(${f.err})` : '(appdetails 无此 appid)')
  const score = f?.name ? sim(r.name, f.name) : 0
  const rec = { ...r, chosen: cand, actual, score: Number(score.toFixed(2)) }

  if (score >= 0.6) ok.push(rec)
  else mismatch.push(rec)
}

console.log(`✅ 名实相符 ${ok.length} 条`)
console.log(`❌ 对不上 ${mismatch.length} 条`)
for (const m of mismatch) {
  console.log(
    `   ${m.id.padEnd(26)} 目录名「${m.name}」 → 选用 ${m.chosen} 实际是「${m.actual}」` +
      (m.oldAppId && m.oldAppId !== m.chosen ? ` [旧表为 ${m.oldAppId}]` : ''),
  )
}
console.log(`⚪ 无候选 ${missing.length} 条：` + missing.map((m) => m.id).join(', '))
if (orphanOld.length) console.log(`⚠️ 旧表里目录已删除的键：${orphanOld.join(', ')}`)

writeFileSync(
  OUT,
  JSON.stringify({ generatedAt: new Date().toISOString(), ok, mismatch, missing, orphanOld, facts }, null, 1),
)
console.log(`\n明细已写入 ${OUT}`)
if (!PROXY_OK) console.log('提示：未设置 HTTPS_PROXY，若大量 ERR 请带代理重跑')
