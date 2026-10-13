// 第二轮：修正接口形态，验证能否真正取到「游戏 + 封面图」
// 用法：HTTPS_PROXY=http://127.0.0.1:7890 NODE_USE_ENV_PROXY=1 node scripts/probePlatforms2.mjs

async function get(name, url, headers = {}) {
  const t0 = Date.now()
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) GameVibe/1.0', ...headers },
      signal: AbortSignal.timeout(15000),
    })
    const txt = await res.text()
    return { name, status: res.status, ms: Date.now() - t0, body: txt }
  } catch (e) {
    const c = e?.cause
    return { name, status: null, ms: Date.now() - t0, body: '', error: c?.code || c?.message || e?.message }
  }
}

function j(body) { try { return JSON.parse(body) } catch { return null } }

// ── 1. Xbox displaycatalog：能否取到 BoxArt ──
const xbox = await get(
  'xbox',
  'https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=9NKX70BBCDRN,9NXP44L49SHJ,9PMF91N3LZ3M&market=US&languages=en-us&MS-CV=DGU1mcuYo0WMMp+F.1',
)
const xj = j(xbox.body)
let xboxSample = null
if (xj?.Products?.length) {
  const p = xj.Products[0]
  const local = p.LocalizedProperties?.[0]
  const imgs = (local?.Images || []).map((i) => ({ purpose: i.ImagePurpose, uri: (i.Uri || '').replace(/^\/\//, 'https://') }))
  xboxSample = {
    name: local?.ProductTitle,
    publisher: local?.PublisherName,
    developer: local?.DeveloperName,
    images: imgs.slice(0, 8),
    totalProducts: xj.Products.length,
  }
}
console.log('=== Xbox displaycatalog ===')
console.log('status:', xbox.status, 'ms:', xbox.ms, 'bytes:', xbox.body.length, xbox.error || '')
console.log(JSON.stringify(xboxSample, null, 2)?.slice(0, 1400))

// ── 2. 任天堂欧洲搜索 API（公开，无需 key）──
const ninEu = await get(
  'nintendo-eu-search',
  'https://search.nintendo-europe.com/en/select?q=zelda&fq=type%3AGAME&rows=3&wt=json&sort=score%20desc',
)
const nj = j(ninEu.body)
console.log('\n=== 任天堂欧洲搜索 API ===')
console.log('status:', ninEu.status, 'ms:', ninEu.ms, 'bytes:', ninEu.body.length, ninEu.error || '')
if (nj?.response?.docs?.[0]) {
  const d = nj.response.docs[0]
  console.log(JSON.stringify({
    numFound: nj.response.numFound,
    title: d.title,
    image_url: d.image_url,
    image_url_sq_s: d.image_url_sq_s,
    product_code: d.product_code_txt,
    players: d.players,
    platform: d.platform,
    releaseDate: d.dates_released_dts,
  }, null, 2).slice(0, 900))
}

// ── 3. PS Store 旧版 chihiro 接口（公开）──
const ps = await get(
  'ps-chihiro',
  'https://store.playstation.com/store/api/chihiro/00_09_000/container/US/en/999/STORE-MSF77008-ALLGAMES/0?size=5',
)
const pj = j(ps.body)
console.log('\n=== PS Store chihiro ===')
console.log('status:', ps.status, 'ms:', ps.ms, 'bytes:', ps.body.length, ps.error || '')
if (pj?.links?.length) {
  const g = pj.links[0]
  console.log(JSON.stringify({
    total: pj.totalResults,
    name: g.name,
    id: g.id,
    images: (g.images || []).map((i) => i.url).slice(0, 4),
  }, null, 2).slice(0, 900))
}

// ── 4. 任天堂日本价格接口（列多款 Switch 游戏）──
const ninJp = await get(
  'nintendo-jp',
  'https://api.ec.nintendo.com/v1/price?country=JP&lang=ja&ids=70010000000025,70010000000125',
)
console.log('\n=== 任天堂价格接口 ===')
console.log('status:', ninJp.status, 'ms:', ninJp.ms, ninJp.error || '')
console.log(ninJp.body.slice(0, 300))

// ── 5. Steam 竖版封面：多款游戏批量验证存在性 ──
const appids = [
  ['1240440', 'Halo Infinite'],
  ['1551360', 'Forza Horizon 5'],
  ['1189891', 'Gears 5'],
  ['1172620', 'Sea of Thieves'],
  ['1091500', 'Cyberpunk 2077'],
  ['413150', 'Stardew Valley'],
  ['570', 'Dota 2'],
  ['730', 'CS2'],
  ['2358720', 'Black Myth Wukong'],
]
console.log('\n=== Steam 竖版封面 library_600x900 存在性 ===')
const rows = await Promise.all(
  appids.map(async ([id, name]) => {
    const url = `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/library_600x900.jpg`
    try {
      const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(10000) })
      const len = res.headers.get('content-length')
      return `  ${name.padEnd(22)} ${id.padEnd(9)} ${res.status}  ${len ? Math.round(+len / 1024) + 'KB' : ''}`
    } catch (e) {
      return `  ${name.padEnd(22)} ${id.padEnd(9)} ERR ${e?.cause?.code || e?.message}`
    }
  }),
)
console.log(rows.join('\n'))
