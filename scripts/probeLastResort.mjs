// 最后一轮兜底探测：iTunes 是否恢复、GeoGuessr/和平精英/LoL 的候选源
const UA = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
}

async function img(label, url, checkContent = true) {
  if (!url) return console.log(`   · ${label}  (跳过：无 URL)`)
  try {
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) })
    const ct = r.headers.get('content-type') || ''
    const len = Number(r.headers.get('content-length') || 0)
    if (r.body) await r.body.cancel().catch(() => {})
    const ok = r.status === 200 && /image\//.test(ct) && (!checkContent || len > 12 * 1024)
    console.log(`${ok ? '✅' : '⚠️ '} ${label.padEnd(38)} ${r.status} ${ct.split(';')[0]} ${Math.round(len / 1024)}KB`)
  } catch (e) {
    console.log(`❌ ${label.padEnd(38)} ${(e?.cause?.code || e.message)}`)
  }
}

async function og(label, page) {
  try {
    const r = await fetch(page, { headers: UA, signal: AbortSignal.timeout(20000) })
    const t = await r.text()
    const m = t.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i)
    console.log(`  ${r.status} ${label.padEnd(34)} og: ${m ? m[1].slice(0, 100) : '(无)'}`)
  } catch (e) {
    console.log(`  ❌ ${label.padEnd(34)} ${(e?.cause?.code || e.message)}`)
  }
}

console.log('===== ① iTunes 搜索是否恢复（之前 403）=====')
for (const [c, term] of [['cn', '和平精英'], ['us', 'GeoGuessr'], ['cn', '王者荣耀']]) {
  try {
    const r = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=software&limit=3&country=${c}`, {
      headers: UA, signal: AbortSignal.timeout(15000),
    })
    const j = await r.json().catch(() => ({}))
    console.log(`  ${r.status} itunes ${c} "${term}" -> resultCount=${j.resultCount ?? 'n/a'} ${j.results?.[0]?.trackName || ''}`)
  } catch (e) {
    console.log(`  ❌ itunes ${c} "${term}" ${(e?.cause?.code || e.message)}`)
  }
}

console.log('\n===== ② GeoGuessr 候选安卓包名 =====')
for (const pkg of ['com.geoguessr.geoguessr', 'com.geoguessr.app', 'com.geoguessr.geoguessrgame', 'com.geoguessr.geoguessr.android']) {
  try {
    const r = await fetch(`https://play.google.com/store/apps/details?id=${pkg}&hl=en&gl=US`, { headers: UA, signal: AbortSignal.timeout(15000) })
    console.log(`  ${r.status} ${pkg}`)
  } catch (e) {
    console.log(`  ❌ ${pkg} ${(e?.cause?.code || e.message)}`)
  }
}

console.log('\n===== ③ 和平精英 / LoL 候选官方资源 =====')
await og('gp.qq.com 和平精英首页', 'https://gp.qq.com/')
await og('gp.qq.com main.shtml', 'https://gp.qq.com/main.shtml')
await og('和平精英 官网 web', 'https://gp.qq.com/web201908/index.shtml')
await img('和平精英 官网海报(常见路径)', 'https://gp.qq.com/web201908/images/index/kv.jpg')
await img('LoL ddragon 版本 logo', 'https://ddragon.leagueoflegends.com/cdn/14.24.1/img/logo/logo.png')
await img('CommunityDragon 客户端图标', 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/assets/navigation/league_client_navigation_icon.png')
await og('lol.qq.com', 'https://lol.qq.com/')
await img('PlayStore Agar.io 封面校验', 'https://play-lh.googleusercontent.com/3bTpJObZrCS-xzdXY7DcfmxK4nrF-FW5h4h7BAcmp0m0WZUG9488VfcNXwOevDf4cougRV9e')
