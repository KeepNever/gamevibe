// 移动端 / 网页游戏的真实封面来源排查
// 目标：给「移动端」「网页」那批（现在拿 favicon / logo 冒充）找到可用图源
// 用法：HTTPS_PROXY=http://127.0.0.1:7890 NODE_USE_ENV_PROXY=1 node scripts/probeMobileCovers.mjs

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) GameVibe/1.0' }

async function tryFetch(label, url, kind = 'json') {
  const t0 = Date.now()
  try {
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15000) })
    const ct = res.headers.get('content-type') || ''
    let note = ''
    if (kind === 'json' && ct.includes('json')) {
      const j = await res.json()
      note = JSON.stringify(j).slice(0, 160)
    } else {
      const len = res.headers.get('content-length')
      note = `${ct} ${len ? Math.round(+len / 1024) + 'KB' : '(len?)'}`
      await res.body?.cancel().catch(() => {})
    }
    console.log(`  ${label.padEnd(22)} ${String(res.status).padEnd(5)} ${String(Date.now() - t0) + 'ms'.padEnd(7)} ${note}`)
    return { status: res.status, ct }
  } catch (e) {
    console.log(`  ${label.padEnd(22)} ERR   ${Date.now() - t0}ms     ${e?.cause?.code || e?.message}`)
    return { status: null }
  }
}

async function imgOk(url) {
  try {
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15000) })
    const len = res.headers.get('content-length')
    const ct = res.headers.get('content-type')
    await res.body?.cancel().catch(() => {})
    return `${res.status} ${ct} ${len ? Math.round(+len / 1024) + 'KB' : ''}`
  } catch (e) {
    return 'ERR ' + (e?.cause?.code || e?.message)
  }
}

console.log('=== 1. iTunes Search API（免密钥，返回 artworkUrl512）===')
for (const term of ['genshin impact', 'clash royale', 'among us', 'subway surfers', 'pokemon go', 'candy crush saga']) {
  const r = await tryFetch(term, `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=software&limit=1&country=us`)
  if (r.status === 200) {
    const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=software&limit=1&country=us`, { headers: UA })
    const j = await res.json()
    const a = j.results?.[0]
    if (a) {
      console.log(`     → ${a.trackName} | ${a.artistName}`)
      console.log(`       artwork: ${await imgOk(a.artworkUrl512)}  ${(a.artworkUrl512 || '').slice(0, 100)}`)
    }
  }
}

console.log('\n=== 2. Google Play 详情页（HTML，找 og:image / 图标）===')
for (const pkg of ['com.miHoYo.GenshinImpact', 'com.supercell.clashroyale']) {
  const res = await fetch(`https://play.google.com/store/apps/details?id=${pkg}&hl=en&gl=US`, { headers: UA, signal: AbortSignal.timeout(15000) }).catch((e) => ({ err: e }))
  if (res.err) { console.log(`  ${pkg} -> ERR ${res.err?.cause?.code || res.err.message}`); continue }
  const html = await res.text()
  const og = html.match(/property="og:image"\s+content="([^"]+)"/)?.[1]
  console.log(`  ${pkg} -> ${res.status}  len=${html.length}  og:image=${og || '(未找到)'}`)
  if (og) console.log(`     ${await imgOk(og)}`)
}

console.log('\n=== 3. 网页游戏的站点图（og:image）===')
const webGames = [
  ['slither.io', 'https://slither.io/'],
  ['krunker.io', 'https://krunker.io/'],
  ['geoguessr', 'https://www.geoguessr.com/'],
  ['agar.io', 'https://agar.io/'],
  ['wordle', 'https://www.nytimes.com/games/wordle/index.html'],
  ['2048', 'https://play2048.co/'],
  ['skribbl.io', 'https://skribbl.io/'],
  ['shellshock.io', 'https://shellshock.io/'],
  ['paper-io', 'https://paper-io.com/'],
  ['cookieclicker', 'https://orteil.dashnet.org/cookieclicker/'],
]
for (const [name, url] of webGames) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(12000) }).catch((e) => ({ err: e }))
  if (res.err) { console.log(`  ${name.padEnd(16)} ERR ${res.err?.cause?.code || res.err.message}`); continue }
  const html = await res.text().catch(() => '')
  const og = html.match(/property=["']og:image["']\s+content=["']([^"']+)["']/i)?.[1]
    || html.match(/content=["']([^"']+)["']\s+property=["']og:image["']/i)?.[1]
  console.log(`  ${name.padEnd(16)} ${res.status}  len=${html.length}  ${og || '(无 og:image)'}`)
}
