// ① 找 PS Store 质量更高的分类容器 ② 确认 Xbox displaycatalog 的 $top 上限与列表质量
const UA = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
}
const PS_BASE = 'https://store.playstation.com/store/api/chihiro/00_09_000/container/US/en/19/'

async function ps(label, id, extra = '') {
  try {
    const r = await fetch(`${PS_BASE}${id}/0?size=20${extra}`, { headers: UA, signal: AbortSignal.timeout(20000) })
    if (!r.ok) return console.log(`⚠️  ${label.padEnd(30)} ${r.status}`)
    const j = await r.json()
    const full = (j.links || []).filter((l) => l.game_contentType === 'Full Game')
    console.log(`✅ ${label.padEnd(30)} total=${j.total_results} full=${full.length}`)
    for (const l of full.slice(0, 3)) console.log(`      ${(l.name || '').slice(0, 40).padEnd(42)} ${l.release_date || '?'}`)
  } catch (e) {
    console.log(`❌ ${label.padEnd(30)} ${(e?.cause?.code || e.message)}`)
  }
}

console.log('===== PS 分类容器候选 =====')
for (const [label, id] of [
  ['FEATUREDGAMES', 'STORE-MSF77008-FEATUREDGAMES'],
  ['EDITORSCHOICE', 'STORE-MSF77008-EDITORSCHOICE'],
  ['BESTSELLINGGAMES', 'STORE-MSF77008-BESTSELLINGGAMES'],
  ['NEWRELEASESGAMES', 'STORE-MSF77008-NEWRELEASESGAMES'],
  ['PS5NEWGAMES', 'STORE-MSF77008-PS5NEWGAMES'],
  ['NEWGAMES', 'STORE-MSF77008-NEWGAMES'],
  ['GAMES', 'STORE-MSF77008-GAMES'],
  ['PS4GAMES', 'STORE-MSF77008-PS4GAMES'],
  ['PS5GAMES', 'STORE-MSF77008-PS5GAMES'],
  ['INDIES', 'STORE-MSF77008-INDIESGAMES'],
  ['AAA', 'STORE-MSF77008-AAAGAMES'],
  ['PREORDERS', 'STORE-MSF77008-PREORDERGAMES'],
]) {
  await ps(label, id)
}

console.log('\n===== PS ALLGAMES 加过滤参数 =====')
await ps('ALLGAMES bucket=games', 'STORE-MSF77008-ALLGAMES', '&bucket=games')
await ps('ALLGAMES released only', 'STORE-MSF77008-ALLGAMES', '&release_date=2025-01-01,2026-09-22')
await ps('ALLGAMES sort release asc', 'STORE-MSF77008-ALLGAMES', '&sort=release_date&direction=asc')

console.log('\n===== Xbox $top 上限 =====')
for (const top of [10, 25, 30, 50, 100]) {
  try {
    const r = await fetch(
      `https://displaycatalog.mp.microsoft.com/v7.0/productFamilies/Games/products?market=US&languages=en-US&fieldsTemplate=details&$top=${top}`,
      { headers: UA, signal: AbortSignal.timeout(20000) },
    )
    const j = await r.json().catch(() => ({}))
    console.log(`  $top=${String(top).padEnd(4)} ${r.status}  Products=${j.Products?.length ?? '-'}  total=${j.TotalResultCount ?? '-'}`)
    if (r.status === 200 && j.Products) {
      for (const p of j.Products.slice(0, 6)) console.log(`      ${(p.LocalizedProperties?.[0]?.ProductTitle || '').slice(0, 44)}`)
    }
  } catch (e) {
    console.log(`  ❌ $top=${top} ${(e?.cause?.code || e.message)}`)
  }
}
