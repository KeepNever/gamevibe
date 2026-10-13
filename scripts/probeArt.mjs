// 1) 验证 Steam large_capsule_image 真实尺寸  2) 验证 PS 图片能否降采样
const P = { proxy: true }

async function head(url) {
  try {
    const r = await fetch(url, { headers: { Range: 'bytes=0-65535' }, signal: AbortSignal.timeout(15000) })
    if (!r.ok) return `status ${r.status}`
    const buf = Buffer.from(await r.arrayBuffer())
    let dim = ''
    if (buf[0] === 0x89 && buf[1] === 0x50) dim = buf.readUInt32BE(16) + 'x' + buf.readUInt32BE(20) + ' png'
    else {
      let i = 2
      while (i < buf.length - 9) {
        if (buf[i] !== 0xff) { i++; continue }
        const m = buf[i + 1]
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) { dim = buf.readUInt16BE(i + 7) + 'x' + buf.readUInt16BE(i + 5) + ' jpg'; break }
        i += 2 + buf.readUInt16BE(i + 2)
      }
    }
    return `OK ${dim}`
  } catch (e) { return 'ERR ' + (e.cause?.code || e.message) }
}

console.log('--- Steam large_capsule_image (新式带 hash 路径) ---')
const fc = await (await fetch('https://store.steampowered.com/api/featuredcategories?cc=us&l=en', { signal: AbortSignal.timeout(20000) })).json()
const pool = [...fc.new_releases.items, ...fc.specials.items, ...fc.top_sellers.items]
for (const it of pool.slice(0, 4)) {
  console.log(it.name.slice(0, 24).padEnd(26), await head(it.large_capsule_image))
}
for (const it of pool.slice(0, 4)) {
  console.log('  备用 header'.padEnd(26), await head(it.header_image))
}

console.log('\n--- Steam library_600x900 vs 616x353 同 appid 对比 ---')
const known = [620980, 413150, 1091500]
for (const id of known) {
  console.log(id, '600x900:', await head(`https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/library_600x900.jpg`),
    '| 616x353:', await head(`https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/capsule_616x353.jpg`))
}

console.log('\n--- PlayStation 图片降采样参数 ---')
const cl = await (await fetch('https://store.playstation.com/store/api/chihiro/00_09_000/container/US/en/999/NEWGAMES?size=3', { signal: AbortSignal.timeout(20000) })).json()
const links = (cl.links || []).map((l) => l.id).slice(0, 2)
for (const id of links) {
  const d = await (await fetch(`https://store.playstation.com/store/api/chihiro/00_09_000/container/US/en/999/${id}`, { signal: AbortSignal.timeout(20000) })).json()
  const t10 = (d.images || []).find((im) => im.type === 10) || (d.images || [])[0]
  console.log(d.name, '| types:', [...new Set((d.images || []).map((i) => i.type))].join(','))
  for (const suf of ['', '?w=400', '?w=600&h=600', '?w=300']) {
    console.log('   ', (suf || '(原始)').padEnd(14), await head(t10.url + suf))
  }
  break
}
process.exitCode = 0
