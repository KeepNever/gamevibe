// ① PS ALLGAMES 不同页的日期分布（找「已发售」条目该翻到哪一页）
// ② Xbox 浏览榜前 25 条到底是什么（判断排序含义）
const UA = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
}
const PS_BASE = 'https://store.playstation.com/store/api/chihiro/00_09_000/container/US/en/19/'
const now = Date.now()

console.log('===== PS ALLGAMES 各页日期分布 =====')
for (const start of [0, 200, 400, 800, 1600, 3200]) {
  try {
    const r = await fetch(`${PS_BASE}STORE-MSF77008-ALLGAMES/${start}?size=40`, {
      headers: UA,
      signal: AbortSignal.timeout(20000),
    })
    const j = await r.json()
    const full = (j.links || []).filter((l) => l.game_contentType === 'Full Game')
    const released = full.filter((l) => Date.parse(l.release_date || '') <= now)
    const dates = full.map((l) => (l.release_date || '').slice(0, 10)).filter(Boolean).sort()
    console.log(
      `  start=${String(start).padEnd(5)} full=${String(full.length).padEnd(3)} released=${String(released.length).padEnd(3)} 日期范围 ${dates[0] || '-'} ~ ${dates[dates.length - 1] || '-'}`,
    )
    for (const l of released.slice(0, 3)) console.log(`        ${(l.name || '').slice(0, 40).padEnd(42)} ${(l.release_date || '').slice(0, 10)}`)
  } catch (e) {
    console.log(`  ❌ start=${start} ${(e?.cause?.code || e.message)}`)
  }
}

console.log('\n===== PS NEWGAMES 全部条目 =====')
try {
  const r = await fetch(`${PS_BASE}STORE-MSF77008-NEWGAMES/0?size=40`, { headers: UA, signal: AbortSignal.timeout(20000) })
  const j = await r.json()
  for (const l of j.links || []) {
    const hasArt = (l.images || []).some((i) => i.type === 10)
    console.log(`  ${(l.name || '').slice(0, 42).padEnd(44)} ${(l.release_date || '').slice(0, 10)}  ${l.game_contentType || '-'}  art=${hasArt ? 'Y' : 'N'}  ${(l.playable_platform || []).join('/')}`)
  }
} catch (e) {
  console.log(`  ❌ ${(e?.cause?.code || e.message)}`)
}

console.log('\n===== Xbox 浏览榜前 25 =====')
try {
  const r = await fetch(
    'https://displaycatalog.mp.microsoft.com/v7.0/productFamilies/Games/products?market=US&languages=en-US&fieldsTemplate=details&$top=25',
    { headers: UA, signal: AbortSignal.timeout(20000) },
  )
  const j = await r.json()
  for (const p of j.Products || []) {
    const lp = p.LocalizedProperties?.[0] || {}
    const art = (lp.Images || []).find((i) => ['Poster', 'BrandedKeyArt', 'BoxArt'].includes(i.ImagePurpose))
    console.log(
      `  ${(lp.ProductTitle || '').slice(0, 42).padEnd(44)} ${(p.MarketProperties?.[0]?.OriginalReleaseDate || '').slice(0, 10).padEnd(12)} art=${art ? `${art.ImagePurpose}(${art.Width}x${art.Height})` : 'NONE'}`,
    )
  }
} catch (e) {
  console.log(`  ❌ ${(e?.cause?.code || e.message)}`)
}
