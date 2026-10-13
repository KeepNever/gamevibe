// 探测 Google Play 页面 og:image —— 用于补齐移动端独占游戏的官方封面
const UA = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
}
const PKGS = {
  '和平精英 Game for Peace': 'com.tencent.tmgp.pubgmhd',
  'GeoGuessr': 'com.geoguessr.geoguessr',
  'Agar.io': 'com.miniclip.agar.io',
  'PUBG Mobile': 'com.tencent.ig',
  'Genshin Impact': 'com.miHoYo.GenshinImpact',
  'Honkai Star Rail': 'com.HoYoverse.hkrpgoversea',
  "Honkai Impact 3rd": 'com.miHoYo.enterprise.NGHSoD',
  'Candy Crush Saga': 'com.king.candycrushsaga',
  'Clash Royale': 'com.supercell.clashroyale',
  'Subway Surfers': 'com.kiloo.subwaysurf',
  'Among Us': 'com.innersloth.spacemafia',
  'Pokémon GO': 'com.nianticlabs.pokemongo',
  'Mobile Legends': 'com.mobile.legends',
  'Free Fire': 'com.dts.freefireth',
  'Arknight 明日方舟': 'com.hypergryph.arknights',
  'Onmyoji 阴阳师': 'com.netease.onmyoji',
  'Party Animals': 'com.recreate.pa',
  'Cookie Clicker': '',
  'Wordle': '',
}
;(async () => {
  for (const [label, pkg] of Object.entries(PKGS)) {
    if (!pkg) continue
    const url = `https://play.google.com/store/apps/details?id=${pkg}&hl=en&gl=US`
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) })
      const t = await r.text()
      const m = t.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i)
      console.log(`${r.ok ? '✅' : '⚠️ '} ${label.padEnd(26)} ${r.status}  ${m ? m[1].slice(0, 110) : '(无 og:image)'}`)
    } catch (e) {
      console.log(`❌ ${label.padEnd(26)} ${(e?.cause?.code || e.message)}`)
    }
  }
})()
