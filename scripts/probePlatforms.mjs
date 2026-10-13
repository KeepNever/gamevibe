// 非 Steam 平台数据源 + 高清封面 CDN 可达性/可用性探测
// 用法：HTTPS_PROXY=http://127.0.0.1:7890 NODE_USE_ENV_PROXY=1 node scripts/probePlatforms.mjs

const targets = [
  // ── 多平台游戏数据库 ──
  { name: 'rawg', url: 'https://api.rawg.io/api/games?page_size=1', note: '多平台库(需key)' },
  { name: 'igdb', url: 'https://api.igdb.com/v4/games', note: '多平台库(需key,走twitch oauth)' },

  // ── 主机平台商店（免密钥，非官方接口）──
  {
    name: 'xbox-displaycatalog',
    url: 'https://displaycatalog.mp.microsoft.com/v7.0/productFamilies/Games/products?bigIds=9NKX70BBCDRN&market=US&languages=en-us&fieldsTemplate=Details',
    note: 'Xbox 商店目录',
  },
  {
    name: 'ps-store-graphql',
    url: 'https://web.np.playstation.com/api/graphql/v1/op?operationName=categoryGridRetrieve&variables=%7B%22id%22%3A%22d074f0ac-2f0b-4a4f-8d3f-1a5e5b1e0e2a%22%2C%22page%22%3A1%2C%22pageSize%22%3A24%2C%22sortBy%22%3A%22productReleaseDate%22%7D&extensions=%7B%22persistedQuery%22%3A%7B%22version%22%3A1%2C%22sha256Hash%22%3A%228d3f4e4f4f8b0e1a4a4b0e0e1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d%22%7D%7D',
    note: 'PS Store GraphQL(需正确hash)',
  },
  { name: 'nintendo-eshop-algolia', url: 'https://u3b6gr4ua3-dsn.algolia.net/1/indexes/*/queries', note: 'Switch eShop(需algolia头)' },
  { name: 'nintendo-price-api', url: 'https://api.ec.nintendo.com/v1/price?country=US&lang=en&ids=70010000000025', note: '任天堂价格接口' },
  { name: 'nintendo-store', url: 'https://www.nintendo.com/us/store/', note: '任天堂商店页' },

  // ── 高清美术素材 CDN（覆盖全平台）──
  { name: 'steamgriddb-api', url: 'https://www.steamgriddb.com/api/v2/search/autocomplete/fire%20emblem', note: 'SteamGridDB 全平台美术库' },
  { name: 'steamgriddb-cdn', url: 'https://cdn2.steamgriddb.com/grid/1a2b3c4d5e6f.png', note: 'SteamGridDB 图片CDN' },

  // ── Steam 图片 CDN ──
  { name: 'steam-cdn-cf', url: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1240440/library_600x900.jpg', note: 'Steam 竖版封面 600x900' },
  { name: 'steam-cdn-akamai', url: 'https://cdn.akamai.steamstatic.com/steam/apps/1240440/library_600x900.jpg', note: 'Steam CDN 备用' },
  { name: 'steam-cdn-shared', url: 'https://shared.steamstatic.com/store_item_assets/steam/apps/1240440/library_600x900.jpg', note: 'Steam 新版资源域' },
  { name: 'steam-header-old', url: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1240440/header.jpg', note: '当前在用的低清横图' },

  // ── 通用图床/元数据 ──
  { name: 'wikipedia', url: 'https://en.wikipedia.org/api/rest_v1/page/summary/Halo_Infinite', note: '维基摘要(含封面)' },
  { name: 'wikipedia-commons', url: 'https://commons.wikimedia.org/w/api.php?action=query&format=json&titles=File:Halo_Infinite_cover.jpg&prop=imageinfo&iiprop=url', note: '维基共享图片' },
]

async function probe(t) {
  const t0 = Date.now()
  try {
    const res = await fetch(t.url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) GameVibe/1.0' },
      signal: AbortSignal.timeout(12000),
    })
    const buf = await res.arrayBuffer()
    const bytes = buf.byteLength
    let snip = ''
    const ct = res.headers.get('content-type') || ''
    if (ct.includes('json')) {
      const txt = new TextDecoder().decode(buf.slice(0, 600))
      snip = txt.replace(/\s+/g, ' ').slice(0, 220)
    } else {
      snip = `${ct} ${bytes}B`
    }
    return { ...t, status: res.status, ms: Date.now() - t0, ctype: ct, bytes, snip }
  } catch (e) {
    const cause = e?.cause
    return {
      ...t,
      status: null,
      ms: Date.now() - t0,
      ctype: '',
      bytes: 0,
      snip: '',
      error: cause?.code || cause?.message || e?.message || String(e),
    }
  }
}

const results = await Promise.all(targets.map(probe))
const pad = (s, n) => String(s ?? '').padEnd(n)

console.log('name                     status  ms      bytes     detail')
console.log('-'.repeat(120))
for (const r of results) {
  const detail = r.error ? `ERR ${r.error}` : r.snip
  console.log(
    `${pad(r.name, 24)} ${pad(r.status, 7)} ${pad(r.ms, 7)} ${pad(r.bytes, 9)} ${detail}`,
  )
}

console.log('\n--- 按域名汇总 ---')
const byHost = {}
for (const r of results) {
  let h = ''
  try { h = new URL(r.url).host } catch {}
  if (!byHost[h]) byHost[h] = []
  byHost[h].push(`${r.name}=${r.error ? 'ERR:' + r.error : r.status}`)
}
for (const [h, v] of Object.entries(byHost)) console.log(`  ${pad(h, 30)} ${v.join(', ')}`)
