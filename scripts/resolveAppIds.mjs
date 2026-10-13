// 用 Steam 官方 storesearch（免密钥）解析正确 appid，并验证竖版高清封面存在
// 用法：HTTPS_PROXY=http://127.0.0.1:7890 NODE_USE_ENV_PROXY=1 node scripts/resolveAppIds.mjs

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) GameVibe/1.0' }

// 需要修正的游戏（当前 appid 已确认 404 或指向错误游戏）
const targets = [
  { id: 'dc_gears-5', name: 'Gears 5', old: '1189891' },
  { id: 'dc_hellblade2', name: 'Senua’s Saga: Hellblade II', old: '1946497' },
  { id: 'dc_indiana-jones', name: 'Indiana Jones and the Great Circle', old: '2601760' },
  { id: 'dc_hifi-rush', name: 'Hi-Fi Rush', old: '1806370' },
  { id: 'dc_gow-ragnarok', name: 'God of War Ragnarök', old: '1919598' },
  { id: 'dc_spiderman-2', name: 'Marvel’s Spider-Man 2', old: '191139560' },
  { id: 'dc_horizon-fw', name: 'Horizon Forbidden West', old: '1828930' },
  { id: 'dc_ff16', name: 'Final Fantasy XVI', old: '1136460' },
  { id: 'dc_gran-turismo-7', name: 'Gran Turismo 7', old: '2162670' },
  { id: 'dc_rise-of-the-ronin', name: 'Rise of the Ronin', old: '1813600' },
  { id: 'dc_doom-eternal', name: 'DOOM Eternal', old: '1094150' },
  { id: 'dc_elden-ring-nightreign', name: 'Elden Ring Nightreign', old: '3626280' },
  { id: 'dc_brotato', name: 'Brotato', old: '1944614' },
  { id: 'dc_horizon-forbidden-west-burn', name: 'Horizon Call of the Mountain', old: '2151470' },
  // 有 200 的 header 但无竖版封面，疑似也指向了别的游戏
  { id: 'dc_ori-wotw', name: 'Ori and the Will of the Wisps', old: '1446060' },
  { id: 'dc_stellar-blade', name: 'Stellar Blade', old: '2192550' },
  { id: 'dc_helldivers-2', name: 'Helldivers 2', old: '559850' },
  { id: 'dc_alan-wake-2', name: 'Alan Wake 2', old: '2181680' },
  { id: 'dc_nier-automata', name: 'NieR: Automata', old: '632650' },
  { id: 'dc_ghostwire', name: 'Ghostwire: Tokyo', old: '1316340' },
]

async function search(term) {
  const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&cc=us&l=en`
  try {
    const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(12000) })
    if (!res.ok) return { err: 'HTTP ' + res.status }
    const j = await res.json()
    return { items: (j.items || []).slice(0, 4).map((i) => ({ id: String(i.id), name: i.name })) }
  } catch (e) {
    return { err: e?.cause?.code || e?.message }
  }
}

async function coverOk(appid) {
  for (const [suffix, label] of [['library_600x900.jpg', '竖版600x900'], ['header.jpg', '横版header']]) {
    const url = `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/${suffix}`
    try {
      const res = await fetch(url, { method: 'HEAD', headers: UA, signal: AbortSignal.timeout(10000) })
      if (res.status === 200) {
        const len = res.headers.get('content-length')
        return { suffix: label, url, kb: len ? Math.round(Number(len) / 1024) : null }
      }
    } catch {}
  }
  return null
}

console.log('游 戏'.padEnd(36), '旧appid'.padEnd(11), 'storesearch 首选'.padEnd(30), '封面')
console.log('-'.repeat(118))
for (const t of targets) {
  const s = await search(t.name)
  const first = s.items?.[0]
  let cover = ''
  let newId = ''
  if (first) {
    newId = first.id
    const c = await coverOk(first.id)
    cover = c ? `${c.suffix} ${c.kb}KB` : '无封面'
  }
  const hit = s.items?.length ? s.items.map((i) => `${i.id}:${i.name}`).join(' | ').slice(0, 60) : s.err || '0 命中'
  console.log(
    `${t.name.slice(0, 34).padEnd(36)} ${t.old.padEnd(11)} ${String(newId || '-').padEnd(10)} ${cover.padEnd(18)} ${hit}`,
  )
}
