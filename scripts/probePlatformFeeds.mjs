// 探测「能用于真实上新/热门榜单」的各平台免密钥接口
// 目的：确定哪些平台能提供**列表级**（而非仅按名搜索）真实数据
//
// 用法（本机需代理）：
//   HTTPS_PROXY=http://127.0.0.1:7890 NODE_USE_ENV_PROXY=1 NO_PROXY=localhost,127.0.0.1 \
//   node --experimental-strip-types scripts/probePlatformFeeds.mjs
const UA = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
}
const T = 15000

async function probe(label, url, opts = {}) {
  const t0 = Date.now()
  try {
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(T) })
    const ct = res.headers.get('content-type') || ''
    let shape = ''
    if (/json/.test(ct)) {
      const j = await res.json()
      shape = describe(j)
    } else {
      const t = await res.text()
      shape = `${t.length}B`
    }
    console.log(`✅ ${label}  ${res.status}  ${Date.now() - t0}ms  ${ct.split(';')[0]}  ${shape}`)
    return true
  } catch (e) {
    console.log(`❌ ${label}  ${Date.now() - t0}ms  ${(e?.cause?.code || e?.message || 'ERR').toString().slice(0, 60)}`)
    return false
  }
}

function describe(j) {
  if (Array.isArray(j)) return `array(${j.length})`
  if (j && typeof j === 'object') {
    const keys = Object.keys(j)
    if (j.response?.docs) return `nintendo docs(${j.response.docs.length})`
    if (j.items) return `items(${j.items.length})`
    if (j.specials?.items) return `specials(${j.specials.items.length})`
    return `{${keys.slice(0, 8).join(',')}}`
  }
  return String(j).slice(0, 40)
}

console.log('===== Steam 官方榜单（featuredcategories）=====')
await probe('steam featuredcategories', 'https://store.steampowered.com/api/featuredcategories?cc=us&l=en')

console.log('\n===== 任天堂欧洲（列表级：按发售日倒序）=====')
await probe(
  'nintendo q=* sort release',
  'https://search.nintendo-europe.com/en/select?q=*&fq=type%3AGAME&sort=dates_released_dts%20desc&rows=30&wt=json&fl=title,image_url_sq_s,image_url,nsuid,releaseDate,price,players,core_pricing',
)
await probe(
  'nintendo upcoming',
  'https://search.nintendo-europe.com/en/select?q=*&fq=type%3AGAME&sort=dates_released_dts%20desc&rows=10&wt=json&fl=title,dates_released_dts',
)

console.log('\n===== PlayStation Store（chihiro 列表级）=====')
await probe(
  'ps container ALLGAMES',
  'https://store.playstation.com/store/api/chihiro/00_09_000/container/US/en/19/STORE-MSF77008-ALLGAMES/0?size=30',
)
await probe(
  'ps container ALLGAMES (no /0)',
  'https://store.playstation.com/store/api/chihiro/00_09_000/container/US/en/19/STORE-MSF77008-ALLGAMES?size=30',
)
await probe(
  'ps container NEWGAMES',
  'https://store.playstation.com/store/api/chihiro/00_09_000/container/US/en/19/STORE-MSF77008-NEWGAMESGAMES/0?size=30',
)
await probe('ps chihiro search elden', 'https://store.playstation.com/store/api/chihiro/00_09_000/search/US/en/999/elden')

console.log('\n===== Xbox（元数据）=====')
await probe(
  'xbox displaycatalog search',
  'https://displaycatalog.mp.microsoft.com/v7.0/productFamilies/Games/products?market=US&languages=en-US&query=halo&fieldsTemplate=details&$top=10',
)

console.log('\n===== iTunes（移动端列表级：按上新）=====')
await probe(
  'itunes new games rss',
  'https://itunes.apple.com/us/rss/newapplications/limit=20/genre=6014/json',
)
await probe('itunes search minecraft', 'https://itunes.apple.com/search?term=minecraft&entity=software&limit=3&country=us')
