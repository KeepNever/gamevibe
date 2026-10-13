// 全量审计 discoverCatalog 的封面：找出坏图，并验证高清竖版替代图
// 用法：HTTPS_PROXY=http://127.0.0.1:7890 NODE_USE_ENV_PROXY=1 node scripts/auditCovers.mjs

import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../server/data/discoverCatalog.ts', import.meta.url), 'utf8')

// 抽出 (id, name, coverUrl)
const rows = []
const re = /\{ id: '(dc_[^']+)',\s*name: '((?:[^'\\]|\\.)*)',\s*coverUrl: '([^']*)'/g
let m
while ((m = re.exec(src))) rows.push({ id: m[1], name: m[2].replace(/\\'/g, "'"), cover: m[3] })

console.log('目录条目总数:', rows.length)

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) GameVibe/1.0' }

async function check(url) {
  for (const method of ['HEAD', 'GET']) {
    try {
      const res = await fetch(url, { method, headers: UA, signal: AbortSignal.timeout(12000) })
      if (method === 'GET') await res.body?.cancel().catch(() => {})
      const len = res.headers.get('content-length')
      return { status: res.status, kb: len ? Math.round(Number(len) / 1024) : null }
    } catch (e) {
      if (method === 'GET') return { status: null, kb: null, err: e?.cause?.code || e?.message }
    }
  }
}

// 分批并发，避免瞬间打爆
async function mapLimit(items, limit, fn) {
  const out = []
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++
        out[idx] = await fn(items[idx], idx)
      }
    }),
  )
  return out
}

const results = await mapLimit(rows, 8, async (r) => {
  const cur = await check(r.cover)
  let hi = null
  const mm = r.cover.match(/steam\/apps\/(\d+)\//)
  if (mm) {
    const hiUrl = `https://cdn.cloudflare.steamstatic.com/steam/apps/${mm[1]}/library_600x900.jpg`
    hi = await check(hiUrl)
    hi.url = hiUrl
  }
  return { ...r, cur, hi, appid: mm?.[1] ?? null }
})

const broken = results.filter((r) => r.cur.status !== 200)
const okNoHi = results.filter((r) => r.cur.status === 200 && r.appid && r.hi && r.hi.status !== 200)
const hostCount = {}
for (const r of results) {
  let h = '(empty)'
  try { h = new URL(r.cover).host } catch {}
  hostCount[h] = (hostCount[h] || 0) + 1
}

console.log('\n=== 封面主机分布 ===')
for (const [h, c] of Object.entries(hostCount).sort((a, b) => b[1] - a[1])) console.log(`  ${String(c).padStart(3)}  ${h}`)

console.log(`\n=== 坏图（非 200）：${broken.length} / ${results.length} ===`)
for (const r of broken) {
  console.log(`  ${r.cur.status ?? 'ERR:' + r.cur.err}  ${r.id.padEnd(26)} ${r.name.slice(0, 34).padEnd(36)} ${r.cover.replace(/^https?:\/\//, '').slice(0, 70)}`)
  if (r.hi) console.log(`       └ 高清竖版替代: ${r.hi.status} ${r.hi.kb ?? ''}KB`)
}

console.log(`\n=== 有 Steam appid 但无高清竖版（${okNoHi.length}）===`)
for (const r of okNoHi) console.log(`  ${r.appid}  ${r.name.slice(0, 40)}`)

const withHi = results.filter((r) => r.hi && r.hi.status === 200).length
const gap = results.filter((r) => r.hi && r.hi.kb && r.hi.kb - (r.cur.kb || 0) > 15).length
console.log(`\n=== 汇总 ===`)
console.log(`  全部 200 可用      : ${results.length - broken.length}/${results.length}`)
console.log(`  有 Steam appid 条目: ${results.filter((r) => r.appid).length}`)
console.log(`  高清竖版可用       : ${withHi}`)
console.log(`  换图后体积明显提升  : ${gap}（平均能大一倍以上说明是真高清）`)
