import fs from 'node:fs'
import path from 'node:path'

const base = process.argv[2] || 'http://127.0.0.1:8792'
const dir = '.dims'
fs.mkdirSync(dir, { recursive: true })

const r = await fetch(base + '/api/games/platforms')
const j = await r.json()
for (const k of ['steam', 'playstation', 'nintendo', 'xbox']) {
  const f = j.feeds.find((x) => x.key === k)
  if (!f) continue
  const it = f.items[0]
  for (const [tag, u] of [['a', it.coverUrl], ['b', it.coverFallbackUrl]]) {
    if (!u) continue
    try {
      const rr = await fetch(u, { signal: AbortSignal.timeout(20000) })
      if (!rr.ok) { console.log(k, tag, 'status', rr.status); continue }
      const b = Buffer.from(await rr.arrayBuffer())
      const ext = /\.png(\?|$)/.test(u) ? '.png' : '.jpg'
      const p = path.join(dir, `${k}-${tag}${ext}`)
      fs.writeFileSync(p, b)
      console.log(k, tag, it.name, '->', p, Math.round(b.length / 1024) + 'KB')
    } catch (e) { console.log(k, tag, 'ERR', e.cause?.code || e.message) }
  }
}
process.exitCode = 0
