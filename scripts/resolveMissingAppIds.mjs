// 解析 5 条错配游戏的正确 Steam appid，并核验站内 16 款的 appid
import { STEAM_APP_ID } from '../server/data/steamAppIds.ts'

const NEED = [
  'Call of Duty: Modern Warfare III',
  'Uncharted 4: A Thief’s End',
  'Fall Guys',
  'Alan Wake 2',
  'Overwatch 2',
]

async function jget(url) {
  const r = await fetch(url, {
    headers: { 'User-Agent': 'GameVibe/1.0', 'Accept-Language': 'en' },
    signal: AbortSignal.timeout(20000),
  })
  if (!r.ok) throw new Error('HTTP ' + r.status)
  return r.json()
}

console.log('══ 按名字反查（storesearch，免密钥） ══')
for (const name of NEED) {
  try {
    const j = await jget(
      `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(name)}&cc=us&l=en`,
    )
    const items = (j.items || []).slice(0, 4)
    console.log(`\n「${name}」→ ${items.length} 条`)
    for (const it of items) console.log(`   ${String(it.id).padEnd(9)} ${it.name}`)
    if (!items.length) console.log('   （Steam 上搜不到）')
  } catch (e) {
    console.log(`\n「${name}」ERR ${e.cause?.code || e.message}`)
  }
}

console.log('\n══ 站内 16 款 appid 核验（appdetails 实际名） ══')
const entries = Object.entries(STEAM_APP_ID)
let bad = 0
for (const [gid, appid] of entries) {
  try {
    const j = await jget(`https://store.steampowered.com/api/appdetails?appids=${appid}&cc=us&l=english`)
    const d = j[appid]?.data
    const nm = d?.name || '(无此 appid)'
    const okFlag = d ? '' : '  ← 可疑'
    if (!d) bad++
    console.log(`  ${gid.padEnd(20)} ${String(appid).padEnd(9)} ${nm}${okFlag}`)
  } catch (e) {
    console.log(`  ${gid.padEnd(20)} ${String(appid).padEnd(9)} ERR ${e.cause?.code || e.message}`)
    bad++
  }
}
console.log(`\n站内 16 款里可疑 ${bad} 条`)
