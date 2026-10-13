// 探测平台列表接口的完整字段（用于 platformCatalog.ts 的字段映射）
const UA = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
}

async function get(label, url) {
  try {
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) })
    const j = await r.json()
    console.log(`\n===== ${label} (${r.status}) =====`)
    return j
  } catch (e) {
    console.log(`❌ ${label} ${(e?.cause?.code || e.message)}`)
    return null
  }
}

// ── PS：单条 link 的完整结构 ──
const ps = await get('ps ALLGAMES', 'https://store.playstation.com/store/api/chihiro/00_09_000/container/US/en/19/STORE-MSF77008-ALLGAMES/0?size=5')
if (ps?.links?.[0]) {
  const L = ps.links[0]
  console.log('  total_results:', ps.total_results, ' start:', ps.start, ' size:', ps.size)
  console.log('  link keys:', Object.keys(L).join(','))
  console.log('  sample link:', JSON.stringify({ ...L, images: (L.images || []).map((i) => ({ type: i.type, url: i.url?.slice(0, 80) })) }, null, 1).slice(0, 1800))
}

// ── PS：按发售日排序是否可用 ──
await get('ps sort release_date', 'https://store.playstation.com/store/api/chihiro/00_09_000/container/US/en/19/STORE-MSF77008-ALLGAMES/0?size=5&sort=release_date&direction=desc')
await get('ps sort_default', 'https://store.playstation.com/store/api/chihiro/00_09_000/container/US/en/19/STORE-MSF77008-ALLGAMES/0?size=5&sort=sort_default&direction=desc')

// ── Xbox：无 query 是否可列表 ──
const xb1 = await get('xbox 无 query', 'https://displaycatalog.mp.microsoft.com/v7.0/productFamilies/Games/products?market=US&languages=en-US&fieldsTemplate=details&$top=5')
if (xb1) {
  console.log('  TotalResultCount:', xb1.TotalResultCount, ' Products:', xb1.Products?.length)
  const p = xb1.Products?.[0]
  if (p) {
    console.log('  product keys:', Object.keys(p).join(','))
    console.log('  ProductId:', p.ProductId)
    console.log('  LocalizedProperties[0] keys:', Object.keys(p.LocalizedProperties?.[0] || {}).join(','))
    const lp = p.LocalizedProperties?.[0] || {}
    console.log('  ProductTitle:', lp.ProductTitle, '| Publisher:', lp.PublisherName)
    console.log('  Images:', JSON.stringify((lp.Images || []).map((i) => ({ purpose: i.ImagePurpose, w: i.Width, h: i.Height, uri: i.Uri }))).slice(0, 600))
    console.log('  MarketProperties:', JSON.stringify(p.MarketProperties?.[0] || {}).slice(0, 500))
  }
}

// ── Xbox：search 命中时的 Images 细节 ──
const xb2 = await get('xbox search "forza"', 'https://displaycatalog.mp.microsoft.com/v7.0/productFamilies/Games/products?market=US&languages=en-US&query=forza&fieldsTemplate=details&$top=3')
if (xb2?.Products?.[0]) {
  const lp = xb2.Products[0].LocalizedProperties?.[0] || {}
  console.log('\n  forza title:', lp.ProductTitle)
  console.log('  images:', JSON.stringify((lp.Images || []).map((i) => ({ p: i.ImagePurpose, w: i.Width, h: i.Height, u: 'https://store-images.s-microsoft.com' + (i.Uri || '').replace('//store-images.s-microsoft.com/image', '') }))).slice(0, 700))
  console.log('  marketProps:', JSON.stringify(xb2.Products[0].MarketProperties?.[0] || {}).slice(0, 600))
}
