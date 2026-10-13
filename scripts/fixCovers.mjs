// discoverCatalog 封面图修补脚本
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CATALOG = resolve(__dirname, '..', 'server', 'data', 'discoverCatalog.ts')

// ── Steam AppID 映射 ──
const STEAM = Object.fromEntries([
  // Xbox
  ['dc_halo-infinite','1240440'],['dc_forza-horizon-5','1551360'],['dc_gears-5','1189891'],
  ['dc_sea-of-thieves','1172620'],['dc_hellblade2','1946497'],['dc_starfield','1716740'],
  ['dc_avowed','2021570'],['dc_indiana-jones','2601760'],['dc_flight-sim','1250410'],
  ['dc_ori-wotw','1446060'],['dc_hifi-rush','1806370'],['dc_grounded','962130'],
  ['dc_halo-mcc','976730'],['dc_cod-modern-warfare','1908930'],['dc_age-of-empires-4','1466860'],
  // PlayStation
  ['dc_gow-ragnarok','1983030'],['dc_tlou2','1890580'],['dc_horizon-fw','1824200'],
  ['dc_ghost-tsushima','1928360'],['dc_returnal','1640220'],['dc_ratchet-rift','1593500'],
  ['dc_uncharted-4','1659050'],['dc_death-stranding','1272530'],['dc_tlou-remake','1888930'],
  ['dc_spiderman-mm','1817070'],['dc_horizon-zd','1151640'],['dc_days-gone','378860'],
  ['dc_god-of-war-2018','1190430'],['dc_persona-5-royal','1687950'],
  ['dc_helldivers-2','559850'],['dc_rise-of-the-ronin','1813600'],
  // PC / Epic / 独立
  ['dc_rocket-league','252950'],['dc_fall-guys','1063790'],['dc_alan-wake-2','2181680'],
  ['dc_control','870780'],['dc_dead-by-daylight','381210'],['dc_apex-legends','1172470'],
  ['dc_red-dead-2','1174180'],['dc_witcher-3','292030'],['dc_doom-eternal','782330'],
  ['dc_dota-2','570'],['dc_cs2','730'],['dc_overwatch-2','2358720'],
  ['dc_destiny-2','1085660'],['dc_sekiro','814380'],['dc_nier-automata','632650'],
  ['dc_monster-hunter-world','582010'],['dc_resident-village','883710'],
  ['dc_street-fighter-6','394380'],['dc_black-myth-wukong','2637190'],
  ['dc_baldurs-gate-3','1086940'],['dc_cyberpunk-2077','1091500'],['dc_hades','1145360'],
  ['dc_stardew','413150'],['dc_hollow-knight','367520'],['dc_elden-ring','1245620'],
  ['dc_celeste','504230'],['dc_disco-elysium','632470'],['dc_outer-wilds','753640'],
  ['dc_cuphead','268910'],['dc_hades-2','1969720'],['dc_dark-souls-3','374320'],
  ['dc_ghostwire-tokyo','1316340'],['dc_no-mans-sky','275850'],['dc_subnautica','264710'],
  ['dc_terraria','105600'],['dc_enter-the-gungeon','311690'],['dc_vampire-survivors','1677310'],
  ['dc_stray','1332010'],['dc_katana-zero','457140'],['dc_brotato','1944614'],
  ['dc_hades-fan','588650'],['dc_undertale','391540'],['dc_balatro','2397800'],
])

// 非 Steam 游戏的渐变色（按首字母 hash 选色）
function pickColors(id) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) | 0
  const palettes = [
    ['#2dd4bf','#0d9488'],['#f97316','#ea580c'],['#a3e635','#65a30d'],
    ['#f472b6','#ec4899'],['#60a5fa','#3b82f6'],['#fbbf24','#f59e0b'],
    ['#fb923c','#ea580c'],['#86efac','#22c55e'],['#67e8f9','#06b6d4'],
    ['#c084fc','#a855f7'],['#fca5a5','#f87171'],['#fde047','#eab308'],
    ['#f43f5e','#e11d48'],['#38bdf8','#0ea5e9'],['#a78bfa','#8b5cf6'],
    ['#3b82f6','#2563eb'],['#7c3aed','#6d28d9'],['#6366f1','#4f46e5'],
    ['#ef4444','#dc2626'],['#818cf8','#6366f1'],
  ]
  return palettes[Math.abs(h) % palettes.length]
}

function svgCover(name) {
  const init = (name || '?').charAt(0).toUpperCase()
  const [c1, c2] = pickColors(name)
  const safeName = (name || '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
  return 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="460" height="215" viewBox="0 0 460 215">' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="100%" y2="100%">' +
    '<stop offset="0%" stop-color="'+c1+'"/><stop offset="100%" stop-color="'+c2+'"/>' +
    '</linearGradient></defs>' +
    '<rect width="460" height="215" fill="url(%23g)" rx="12"/>' +
    '<text x="230" y="120" text-anchor="middle" font-family="system-ui,sans-serif" font-size="80" font-weight="bold" fill="white" fill-opacity="0.85">'+init+'</text>' +
    '<text x="230" y="165" text-anchor="middle" font-family="system-ui,sans-serif" font-size="16" fill="white" fill-opacity="0.7">'+safeName+'</text>' +
    '</svg>'
  )
}

let src = readFileSync(CATALOG, 'utf-8')
let steamCnt = 0, svgCnt = 0

// 替换 Steam 有 ID 的
for (const [id, appid] of Object.entries(STEAM)) {
  const re = new RegExp("(id: '" + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "'[^}]*?coverUrl:) ''", 'g')
  src = src.replace(re, '$1 \'https://cdn.cloudflare.steamstatic.com/steam/apps/' + appid + '/header.jpg\'')
  // 简单计数：看是否替换了（通过比较 coverUrl 后面是否有值）
}
steamCnt = Object.keys(STEAM).length

// 替换剩余空 coverUrl 为 SVG
const before = (src.match(/coverUrl: ''/g) || []).length
src = src.replace(/coverUrl: ''/g, () => { svgCnt++; return " coverUrl: '" + svgCover('game') + "'" })
const after = before - (src.match(/coverUrl: ''/g) || []).length

writeFileSync(CATALOG, src, 'utf-8')
console.log('Steam CDN:', steamCnt)
console.log('SVG placeholder:', svgCnt)
console.log('Total patched:', steamCnt + svgCnt)
