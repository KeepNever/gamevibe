// 校验 132 条目录封面的可达性（本地 /covers/ 走本机后端）
import fs from 'node:fs'

const BASE = process.env.COVER_BASE || 'http://127.0.0.1:8792'
const j = JSON.parse(fs.readFileSync('src/data/discoverFallback.json', 'utf8'))
const arr = Array.isArray(j) ? j : j.games || j.items || []
const all = arr.map((g) => {
  const u = g.coverUrl || ''
  return { n: g.name, u: u.startsWith('/') ? BASE + u : u }
})

let idx = 0
let ok = 0
const bad = []
const one = async (o) => {
  if (!o.u) { bad.push(o.n + '(无封面)'); return }
  for (let t = 0; t < 3; t++) {
    try {
      const r = await fetch(o.u, { method: 'GET', headers: { Range: 'bytes=0-0' }, signal: AbortSignal.timeout(12000) })
      if (r.status === 200 || r.status === 206) { ok++; return }
      if ([400, 403, 404].includes(r.status)) { bad.push(o.n + '(' + r.status + ')'); return }
    } catch { /* retry */ }
    await new Promise((z) => setTimeout(z, 700))
  }
  bad.push(o.n + '(连接失败)')
}
await Promise.all(Array.from({ length: 10 }, async () => { while (idx < all.length) await one(all[idx++]) }))
console.log('目录封面可达', ok + '/' + all.length, '| 有问题', bad.length)
if (bad.length) console.log(bad.join(' | '))
process.exitCode = 0
