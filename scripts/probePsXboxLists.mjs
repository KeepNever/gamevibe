// 确认：① PS 的排序/容器是否能给出「最新」列表 ② Xbox 图片 CDN 是否支持按尺寸取
const UA = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
}
const BASE = 'https://store.playstation.com/store/api/chihiro/00_09_000/container/US/en/19/'

async function psList(label, path) {
  try {
    const r = await fetch(BASE + path, { headers: UA, signal: AbortSignal.timeout(20000) })
    if (!r.ok) return console.log(`⚠️  ${label.padEnd(28)} ${r.status}`)
    const j = await r.json()
    const full = (j.links || []).filter((l) => l.game_contentType === 'Full Game')
    console.log(`✅ ${label.padEnd(28)} total=${j.total_results} links=${(j.links || []).length} fullGame=${full.length}`)
    for (const l of full.slice(0, 4)) {
      console.log(`      ${(l.name || '').slice(0, 42).padEnd(44)} ${l.release_date || '?'}  ${(l.playable_platform || []).join('/')}`)
    }
    return j
  } catch (e) {
    console.log(`❌ ${label.padEnd(28)} ${(e?.cause?.code || e.message)}`)
  }
}

console.log('===== PS 容器与排序 =====')
await psList('ALLGAMES 默认', 'STORE-MSF77008-ALLGAMES/0?size=20')
await psList('ALLGAMES release desc', 'STORE-MSF77008-ALLGAMES/0?size=20&sort=release_date&direction=desc')
await psList('ALLGAMES release asc', 'STORE-MSF77008-ALLGAMES/0?size=20&sort=release_date&direction=asc')
await psList('PS5 全部', 'STORE-MSF77008-PS5ALLGAMES/0?size=20')
await psList('PS4 全部', 'STORE-MSF77008-PS4ALLGAMES/0?size=20')
await psList('NEW RELEASES', 'STORE-MSF77008-NEWRELEASES/0?size=20')
await psList('PS PLUS', 'STORE-MSF77008-PSPLUSFREEGAMES/0?size=20')
await psList('TOP SELLERS', 'STORE-MSF77008-TOPSELLERSGAMES/0?size=20')

console.log('\n===== Xbox 图片 CDN 尺寸参数 =====')
const xb = await fetch(
  'https://displaycatalog.mp.microsoft.com/v7.0/productFamilies/Games/products?market=US&languages=en-US&fieldsTemplate=details&$top=3',
  { headers: UA, signal: AbortSignal.timeout(20000) },
).then((r) => r.json())
const lp = xb.Products?.[0]?.LocalizedProperties?.[0] || {}
console.log('  title:', lp.ProductTitle)
const img = (lp.Images || []).find((i) => i.ImagePurpose === 'BrandedKeyArt') || (lp.Images || []).find((i) => i.ImagePurpose === 'BoxArt')
console.log('  purposes:', (lp.Images || []).map((i) => `${i.ImagePurpose}(${i.Width}x${i.Height})`).join(' '))
if (img) {
  const base = 'https:' + img.Uri
  for (const q of ['', '?w=600', '?w=600&h=800', '?q=90&w=600']) {
    try {
      const r = await fetch(base + q, { headers: UA, signal: AbortSignal.timeout(20000) })
      const ct = r.headers.get('content-type') || ''
      const len = Number(r.headers.get('content-length') || 0)
      await r.body?.cancel().catch(() => {})
      console.log(`  ${String(r.status).padEnd(4)} ${ct.split(';')[0].padEnd(12)} ${String(Math.round(len / 1024) + 'KB').padEnd(7)} ${base.slice(0, 70)}${q}`)
    } catch (e) {
      console.log(`  ❌ ${q} ${(e?.cause?.code || e.message)}`)
    }
  }
}
