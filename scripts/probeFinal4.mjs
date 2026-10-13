// 补齐最后几条：Agar.io / GeoGuessr 走 Google Play og:image；和平精英试腾讯应用宝
const UA = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
}

async function playOg(label, pkg) {
  const url = `https://play.google.com/store/apps/details?id=${pkg}&hl=en&gl=US`
  try {
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) })
    const t = await r.text()
    const m = t.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i)
    if (!m) return console.log(`⚠️  ${label}  ${r.status}  无 og:image`)
    const u = m[1].replace(/&amp;/g, '&')
    // 校验：拿到完整 URL 后再验一次
    const r2 = await fetch(u, { headers: UA, signal: AbortSignal.timeout(20000) })
    const ct = r2.headers.get('content-type') || ''
    const len = Number(r2.headers.get('content-length') || 0)
    await r2.body?.cancel().catch(() => {})
    console.log(`${r2.status === 200 ? '✅' : '⚠️ '} ${label}  ${r2.status} ${ct.split(';')[0]} ${Math.round(len / 1024)}KB`)
    console.log(`     ${u}`)
  } catch (e) {
    console.log(`❌ ${label}  ${(e?.cause?.code || e.message)}`)
  }
}

async function scan(label, page) {
  console.log(`\n===== ${label}  ${page} =====`)
  try {
    const r = await fetch(page, { headers: UA, signal: AbortSignal.timeout(20000) })
    const html = await r.text()
    console.log(`  status ${r.status}, ${html.length}B`)
    const urls = new Set()
    for (const m of html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) urls.add(m[1])
    for (const m of html.matchAll(/url\((["']?)([^"')]+)\1\)/gi)) urls.add(m[2])
    for (const m of html.matchAll(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/gi)) urls.add(m[1])
    // 应用宝把图放在 JSON 里，补一条通用抓取
    for (const m of html.matchAll(/"(?:imageUrl|icon|cover|picUrl|logo)":"([^"]+\.(?:png|jpe?g|webp)[^"]*)"/gi)) urls.add(m[1])
    const l = [...urls].filter((u) => /\.(png|jpe?g|webp)/i.test(u))
    for (const u of l.slice(0, 20)) {
      const abs = u.startsWith('//') ? 'https:' + u : u.startsWith('/') ? new URL(page).origin + u : u
      console.log('   ', abs.slice(0, 160))
    }
  } catch (e) {
    console.log(`  ❌ ${(e?.cause?.code || e.message)}`)
  }
}

console.log('===== Google Play og:image =====')
await playOg('Agar.io', 'com.miniclip.agar.io')
await playOg('GeoGuessr', 'com.geoguessr.app')

console.log('\n===== 腾讯应用宝（和平精英官方渠道）=====')
await scan('应用宝 和平精英', 'https://sj.qq.com/appdetail/com.tencent.tmgp.pubgmhd')
await scan('应用宝搜索', 'https://sj.qq.com/search?q=%E5%92%8C%E5%B9%B3%E7%B2%BE%E8%8B%B1')

console.log('\n===== LoL 官方 CDN 候选（量尺寸）=====')
for (const u of [
  'https://ossweb-img.qq.com/images/lol/v3/href-bg-2.jpg',
  'https://game.gtimg.cn/images/lol/v3/logo-public.png',
  'https://game.gtimg.cn/images/gp/public/logo.png',
  'https://game.gtimg.cn/images/gp/web202411/sec2-banner1.jpg',
]) {
  try {
    const r = await fetch(u, { headers: UA, signal: AbortSignal.timeout(20000) })
    const len = Number(r.headers.get('content-length') || 0)
    await r.body?.cancel().catch(() => {})
    console.log(`  ${r.status} ${Math.round(len / 1024)}KB  ${u}`)
  } catch (e) {
    console.log(`  ❌ ${(e?.cause?.code || e.message)}  ${u}`)
  }
}
