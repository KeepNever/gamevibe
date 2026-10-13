// 探测各平台封面真实像素尺寸，用于决定卡片画幅
const PROXY = { env: true }
async function dim(url) {
  try {
    const r = await fetch(url, { headers: { Range: 'bytes=0-65535' }, signal: AbortSignal.timeout(12000) })
    if (!r.ok) return { status: r.status }
    const buf = Buffer.from(await r.arrayBuffer())
    // PNG
    if (buf[0] === 0x89 && buf[1] === 0x50) return { status: r.status, w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), fmt: 'png', kb: Math.round(buf.length / 1024) }
    // JPEG 扫描 SOF
    let i = 2
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i++; continue }
      const m = buf[i + 1]
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { status: r.status, h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7), fmt: 'jpg', kb: Math.round(buf.length / 1024) }
      }
      const len = buf.readUInt16BE(i + 2)
      i += 2 + len
    }
    return { status: r.status, fmt: '?', kb: Math.round(buf.length / 1024) }
  } catch (e) { return { status: 'ERR ' + (e.cause?.code || e.message) } }
}

const base = process.argv[2] || 'http://127.0.0.1:8792'
const r = await fetch(base + '/api/games/platforms')
const j = await r.json()
for (const f of j.feeds) {
  console.log('\n=== ' + f.label + ' (' + f.items.length + ') ===')
  for (const it of f.items.slice(0, 3)) {
    const a = await dim(it.coverUrl)
    const b = it.coverFallbackUrl ? await dim(it.coverFallbackUrl) : null
    console.log(
      it.name.slice(0, 26).padEnd(28),
      'portrait=' + String(it.portrait).padEnd(6),
      '主:' + (a.w ? a.w + 'x' + a.h : a.status) + (a.kb ? ' ' + a.kb + 'KB' : ''),
      b ? '备:' + (b.w ? b.w + 'x' + b.h : b.status) : '',
    )
  }
}
