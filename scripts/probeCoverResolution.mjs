// 全量检查 132 条目录封面：现状尺寸 + 可升级的高清变体是否可用
import fs from 'node:fs'

const CAT = JSON.parse(fs.readFileSync('src/data/discoverFallback.json', 'utf8'))
const ARR = Array.isArray(CAT) ? CAT : CAT.games || CAT.items || []

async function dim(url) {
  if (!url) return { status: 'empty' }
  try {
    const r = await fetch(url, { headers: { Range: 'bytes=0-131071' }, signal: AbortSignal.timeout(15000) })
    if (!r.ok) return { status: r.status }
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf[0] === 0x89 && buf[1] === 0x50) return { status: r.status, w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
    // webp
    if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') {
      const s = buf.slice(12, 40).toString('latin1')
      const mi = s.indexOf('VP8')
      if (mi === 0) return { status: r.status, raw: 'webp' }
      return { status: r.status, raw: 'webp' }
    }
    let i = 2
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i++; continue }
      const m = buf[i + 1]
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { status: r.status, w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) }
      i += 2 + buf.readUInt16BE(i + 2)
    }
    return { status: r.status, raw: '?' }
  } catch (e) { return { status: 'ERR ' + (e.cause?.code || e.message) } }
}

function variants(url, name) {
  const out = []
  if (/\/library_600x900\.jpg/.test(url) && !url.includes('_2x')) {
    out.push(['L600x900_2x', url.replace('library_600x900.jpg', 'library_600x900_2x.jpg')])
  }
  if (/512x512bb\.jpg/.test(url)) out.push(['iTunes1024', url.replace('512x512bb.jpg', '1024x1024bb.jpg')])
  if (/[?&]w=600/.test(url)) out.push(['Xbox w=1200', url.replace(/w=600/, 'w=1200')])
  if (/image500w\.jpg/.test(url)) out.push(['Nint 760w', url.replace('image500w.jpg', 'image760w.jpg')], ['Nint 1024w', url.replace('image500w.jpg', 'image1024w.jpg')])
  return out
}

const byKind = {}
for (const g of ARR) {
  const u = g.coverUrl || g.cover || ''
  const kind = /library_600x900/.test(u) ? 'steam-600x900'
    : /512x512bb/.test(u) ? 'itunes-512'
      : /store-images\.microsoft/.test(u) ? 'xbox'
        : /nintendo/.test(u) ? 'nintendo'
          : /image\.api\.playstation/.test(u) ? 'ps'
            : /googleusercontent/.test(u) ? 'playstore'
              : /^\/covers\//.test(u) ? 'local'
                : 'other'
  byKind[kind] = byKind[kind] || []
  byKind[kind].push({ g, u, kind })
}
console.log('=== 分类计数 ===')
for (const [k, v] of Object.entries(byKind)) console.log(String(v.length).padStart(4), k)

console.log('\n=== 抽样验证高清变体 ===')
for (const [kind, list] of Object.entries(byKind)) {
  const sample = list.slice(0, 3)
  for (const { g, u } of sample) {
    const cur = await dim(u.startsWith('/') ? 'http://127.0.0.1:8792' + u : u)
    const line = [`${kind}`.padEnd(16), String(g.name).slice(0, 18).padEnd(20), `现 ${cur.w ? cur.w + 'x' + cur.h : cur.status}`]
    for (const [lbl, vu] of variants(u, g.name)) {
      const d = await dim(vu)
      line.push(`${lbl}=${d.w ? d.w + 'x' + d.h : d.status}`)
    }
    console.log(line.join(' | '))
  }
}
process.exitCode = 0
