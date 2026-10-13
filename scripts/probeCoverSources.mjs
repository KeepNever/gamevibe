// 从 PS Store / Switch eShop 取真实条目，含真实封面 URL，并实测图片可下载
// 用法：HTTPS_PROXY=http://127.0.0.1:7890 NODE_USE_ENV_PROXY=1 node scripts/probeCoverSources.mjs

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) GameVibe/1.0' }

async function j(url, headers = {}) {
  const res = await fetch(url, { headers: { ...UA, ...headers }, signal: AbortSignal.timeout(15000) })
  const t = await res.text()
  try { return { status: res.status, data: JSON.parse(t) } } catch { return { status: res.status, data: null, raw: t.slice(0, 200) } }
}

async function imgOk(url) {
  if (!url) return 'no-url'
  try {
    const res = await fetch(url, { method: 'GET', headers: UA, signal: AbortSignal.timeout(15000) })
    const len = res.headers.get('content-length')
    const ct = res.headers.get('content-type')
    await res.body?.cancel().catch(() => {})
    return `${res.status} ${ct} ${len ? Math.round(+len / 1024) + 'KB' : ''}`
  } catch (e) {
    return 'ERR ' + (e?.cause?.code || e?.message)
  }
}

// ── PS Store：多取几个容器，看图片域与图规格 ──
console.log('=== PS Store chihiro：真实条目 + 封面实测 ===')
const psContainers = [
  ['ALLGAMES', 'STORE-MSF77008-ALLGAMES'],
  ['PS5GAMES', 'STORE-MSF77008-PS5GAMESCATEGORY'],
]
for (const [label, cid] of psContainers) {
  const r = await j(`https://store.playstation.com/store/api/chihiro/00_09_000/container/US/en/999/${cid}/0?size=4`)
  console.log(`\n-- ${label} status=${r.status} total=${r.data?.totalResults ?? 'n/a'}`)
  for (const g of (r.data?.links || []).slice(0, 3)) {
    const imgs = (g.images || []).map((i) => i.url)
    console.log(`   ${String(g.name).slice(0, 44).padEnd(46)} ${g.id}`)
    for (const u of imgs.slice(0, 3)) {
      const host = (() => { try { return new URL(u).host } catch { return '?' } })()
      console.log(`     [${host}] ${await imgOk(u)}  ${u.slice(0, 90)}`)
    }
    // 试封面猜测路径
    if (g.id) {
      const guess = `https://image.api.playstation.com/vulcan/ap/rnd/202211/0710/${g.id}.png`
      void guess
    }
  }
}

// ── Switch eShop：搜索多个游戏，取封面 ──
console.log('\n=== 任天堂欧洲搜索：真实条目 + 封面实测 ===')
for (const q of ['zelda tears of the kingdom', 'mario kart 8', 'metroid dread']) {
  const r = await j(`https://search.nintendo-europe.com/en/select?q=${encodeURIComponent(q)}&fq=type%3AGAME&rows=2&wt=json&sort=score%20desc`)
  const doc = r.data?.response?.docs?.[0]
  if (!doc) { console.log(`  ${q} -> 0 命中 (status ${r.status})`); continue }
  const best = doc.image_url_sq_s || doc.image_url || doc.image_url_h2x1_s
  console.log(`  ${q}`)
  console.log(`    title      : ${doc.title}`)
  console.log(`    product    : ${doc.product_code_txt || doc.nsuid_txt}`)
  console.log(`    players    : ${doc.players}  platform: ${doc.platform}`)
  for (const [k, v] of Object.entries({ image_url: doc.image_url, image_url_sq_s: doc.image_url_sq_s, image_url_h2x1_s: doc.image_url_h2x1_s })) {
    if (!v) continue
    console.log(`    ${k.padEnd(16)} ${await imgOk(v)}  ${v.slice(0, 95)}`)
  }
}
