// PS 最后候选：更多容器 + 搜索端点能否按发售日排序（拿更大的「近期发售」池）
const UA = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
}
const C = 'https://store.playstation.com/store/api/chihiro/00_09_000/container/US/en/19/'
const S = 'https://store.playstation.com/store/api/chihiro/00_09_000/search/US/en/999/'
const now = Date.now()

async function show(label, url) {
  try {
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) })
    if (!r.ok) return console.log(`⚠️  ${label.padEnd(38)} ${r.status}`)
    const j = await r.json()
    const links = j.links || []
    const full = links.filter((l) => l.game_contentType === 'Full Game')
    const rel = full.filter((l) => Date.parse(l.release_date || '') <= now)
    console.log(`✅ ${label.padEnd(38)} total=${j.total_results} links=${links.length} full=${full.length} released=${rel.length}`)
    for (const l of (rel.length ? rel : full).slice(0, 4))
      console.log(`      ${(l.name || '').slice(0, 40).padEnd(42)} ${(l.release_date || '').slice(0, 10)}`)
  } catch (e) {
    console.log(`❌ ${label.padEnd(38)} ${(e?.cause?.code || e.message)}`)
  }
}

console.log('===== 更多容器 =====')
for (const id of [
  'STORE-MSF77008-PS5NEWRELEASES',
  'STORE-MSF77008-ALLNEWGAMES',
  'STORE-MSF77008-NEWRELEASES',
  'STORE-MSF77008-COMINGSOONGAMES',
  'STORE-MSF77008-FEATURED',
  'STORE-MSF77008-PSPLUS',
  'STORE-MSF77008-PS5ALL',
]) {
  await show(id, `${C}${id}/0?size=40`)
}

console.log('\n===== 搜索端点 + 排序 =====')
await show('search "the" 默认', `${S}the?size=40`)
await show('search "the" release desc', `${S}the?size=40&sort=release_date&direction=desc`)
await show('search "a" release desc', `${S}a?size=40&sort=release_date&direction=desc`)
await show('search "call" release desc', `${S}call?size=40&sort=release_date&direction=desc`)
await show('search "*" ', `${S}*?size=40`)
