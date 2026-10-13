// 探测 Steam 社区成就页：中文变体、解析稳定性、图标可达性
const APPS = [
  [620, 'Portal 2'],
  [1245620, 'Elden Ring'],
  [413150, 'Stardew Valley'],
  [1091500, 'Cyberpunk 2077'],
  [268910, 'Cuphead'],
]

const ROW_RE = /<div class="achieveRow[^"]*">([\s\S]*?)<div style="clear: both;"><\/div>\s*<\/div>/g

function parseRows(html) {
  const out = []
  const re = new RegExp(ROW_RE.source, 'g')
  let m
  while ((m = re.exec(html))) {
    const seg = m[1]
    const img = seg.match(/<img\s+src="([^"]+)"/)
    const pct = seg.match(/<div class="achievePercent">\s*([\d.]+)%/)
    const h3 = seg.match(/<h3>([\s\S]*?)<\/h3>/)
    const h5 = seg.match(/<h5>([\s\S]*?)<\/h5>/)
    if (!h3 || !pct) continue
    out.push({
      icon: img ? img[1] : '',
      percent: Number(pct[1]),
      name: h3[1].replace(/<[^>]+>/g, '').trim(),
      desc: h5 ? h5[1].replace(/<[^>]+>/g, '').trim() : '',
      apiName: (img ? img[1] : '').split('/').pop()?.replace(/\.jpg$/, '') || '',
    })
  }
  return out
}

for (const [appid, label] of APPS) {
  for (const lang of ['', '?l=schinese']) {
    const url = `https://steamcommunity.com/stats/${appid}/achievements/${lang}`
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 GameVibe/1.0' },
        signal: AbortSignal.timeout(25000),
      })
      const html = await r.text()
      const rows = parseRows(html)
      const head = rows.length ? `${rows[0].name} ${rows[0].percent}%` : '(解析为空)'
      const rarest = rows.length ? rows.reduce((a, b) => (b.percent < a.percent ? b : a)) : null
      console.log(
        String(appid).padEnd(9),
        (lang || 'en').padEnd(11),
        r.status,
        '行数=' + String(rows.length).padEnd(4),
        '| 首个:', head.padEnd(30),
        '| 最稀有:', rarest ? `${rarest.percent}% ${rarest.name}` : '-',
      )
    } catch (e) {
      console.log(String(appid).padEnd(9), (lang || 'en').padEnd(11), 'ERR', e.cause?.code || e.message)
    }
  }
}

// 图标可达性（抽查 3 个）
const icons = [
  'https://shared.akamai.steamstatic.com/community_assets/images/apps/620/SURVIVE_CONTAINER_RIDE.jpg',
  'https://cdn.akamai.steamstatic.com/steamcommunity/public/images/apps/620/SURVIVE_CONTAINER_RIDE.jpg',
  'https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/620/SURVIVE_CONTAINER_RIDE.jpg',
]
console.log('\n--- 图标托管探测 ---')
for (const u of icons) {
  try {
    const r = await fetch(u, { method: 'GET', headers: { Range: 'bytes=0-0' }, signal: AbortSignal.timeout(15000) })
    console.log(r.status, u.replace('https://', '').slice(0, 70))
  } catch (e) {
    console.log('ERR', e.cause?.code || e.message, u.replace('https://', '').slice(0, 70))
  }
}
