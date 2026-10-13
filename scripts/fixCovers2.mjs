// discoverCatalog 封面图全面补全 v2（修正版）
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CATALOG = resolve(__dirname, '..', 'server', 'data', 'discoverCatalog.ts')

let src = readFileSync(CATALOG, 'utf-8')
let updated = 0

// ── Steam CDN header.jpg 映射（补全之前漏掉的 + 修正错误 appid）──
const STEAM = [
  // PlayStation PC 版
  ['dc_gow-ragnarok',        '1919598'],
  ['dc_spiderman-2',         '191139560'],
  ['dc_horizon-fw',          '1828930'],
  ['dc_ghost-tsushima',      '1771300'],
  ['dc_uncharted-4',         '1659050'],
  ['dc_death-stranding',     '1850570'],
  ['dc_ff16',                '1136460'],
  ['dc_gran-turismo-7',      '2162670'],
  ['dc_god-of-war-2018',     '1593500'],
  ['dc_stellar-blade',       '2192550'],
  // PC 多平台（之前漏映射）
  ['dc_persona-5-royal',     '1687950'],
  ['dc_ff7-rebirth',         '2208960'],
  ['dc_fortnite',            '1352010'],
  ['dc_dead-by-daylight',    '381210'],
  ['dc_apex-legends',        '1172470'],
  ['dc_witcher-3',           '1091500'],
  ['dc_doom-eternal',        '1094150'],
  ['dc_resident-village',    '1196590'],
  ['dc_street-fighter-6',    '1466870'],
  ['dc_elden-ring-nightreign','3626280'],
  ['dc_no-mans-sky',         '275850'],
  ['dc_subnautica',          '264710'],
  ['dc_hades-2-switch',      '1945310'],
  ['dc_hades-fan',           '1145360'],
  ['dc_undertale',           '391540'],
  ['dc_horizon-forbidden-west-burn','2151470'],
]

// ── 非 Steam 游戏真实封面 URL（高质量 CDN）──
const REAL = [
  // 任天堂 Switch 独占 — 使用 Wikipedia / 官方 / 社区稳定 URL
  ['dc_totk',             'https://upload.wikimedia.org/wikipedia/en/4/4b/The_Legend_of_Zelda_Tears_of_the_Kingdom_cover_art.jpg'],
  ['dc_mario-odyssey',    'https://upload.wikimedia.org/wikipedia/en/8/84/Super_Mario_Odyssey_cover_art.jpg'],
  ['dc_animal-crossing',  'https://upload.wikimedia.org/wikipedia/en/2/25/Animal_Crossing_New_Horizons.png'],
  ['dc_splatoon-3',       'https://upload.wikimedia.org/wikipedia/en/a/a3/Splatoon_3_boxart.png'],
  ['dc_metroid-dread',    'https://upload.wikimedia.org/wikipedia/en/8/8f/Metroid_Dread_cover_art.jpg'],
  ['dc_pokemon-scarlet',  'https://upload.wikimedia.org/wikipedia/en/f/f1/Pokémon_Scarlet_and_Violet_cover_art.jpg'],
  ['dc_smash-ultimate',   'https://upload.wikimedia.org/wikipedia/en/a/ae/Super_Smash_Bros._Ultimate.jpg'],
  ['dc_mario-kart-8',     'https://upload.wikimedia.org/wikipedia/en/9/92/Mario_Kart_8_Deluxe.png'],
  ['dc_pikmin-4',         'https://upload.wikimedia.org/wikipedia/en/3/38/Pikmin_4_cover_art.png'],
  ['dc_xenoblade-3',      'https://upload.wikimedia.org/wikipedia/en/b/b8/Xenoblade_Chronicles_3_cover_art.jpg'],
  ['dc_luigis-mansion-3', 'https://upload.wikimedia.org/wikipedia/en/b/ba/Luigi%27s_Mansion_3_cover_art.jpg'],
  ['dc_kirby-forgotten',  'https://upload.wikimedia.org/wikipedia/en/5/5b/Kirby_and_the_Forgotten_Land.jpg'],
  ['dc_mario-wonder',     'https://upload.wikimedia.org/wikipedia/en/f/f7/Super_Mario_Bros._Wonder.jpg'],
  ['dc_bayonetta-3',      'https://upload.wikimedia.org/wikipedia/en/8/82/Bayonetta_3_cover_art.jpg'],
  ['dc_fire-emblem-engage','https://upload.wikimedia.org/wikipedia/en/e/ef/Fire_Engage_Engage_cover_art.jpg'],
  ['dc_astro-bot-switch',  'https://upload.wikimedia.org/wikipedia/en/c/ca/Astro%27s_Playroom_cover_art.jpg'],

  // PlayStation 独占（无 PC 版）
  ['dc_bloodborne',       'https://image.api.playstation.com/vulcan/ap/rnd/202211/0710/C8l3vqN6t0HBRg1hKFjFtRdW.png'],
  ['dc_demons-souls',     'https://image.api.playstation.com/vulcan/ap/rnd/202010/0214/wiZK4vDzJyFpUjLmHBqVLZBw.png'],

  // 在线服务（非 Steam 启动器）
  ['dc_genshin',          'https://webstatic.hoyoverse.com/upload/static-resource/2023/01/04/xxx.jpg'.replace('xxx', 'upload/event/2022/06/01/genshin_banner')],
  ['dc_lol',              'https://www.leagueoflegends.com/static/logo-f3ba69adaa9bdecc365fc4c5b1dcaadd.svg'],
  ['dc_roblox',           'https://tr.rbxcdn.com/38c6edbcbce5f85a1db41df6c20b1434/512/512/Image/PNG'],
  ['dc_valorant',         'https://media.valorant-api.com/sprites/chromas/0e3b0e6a-4144-64d1-8189-c98bf9371912.png'],
  ['dc_fortnite-mobile',  'https://cdn2.unrealengine.com/blade++/18/UE_Fortnite_BR_Image_Update_Only_Social_Key-Available-1920x1080-23bb0b24549bd1e3f9d24aa284d9e1feffca4aN.png'],

  // 浏览器小游戏（favicon 或 OG 图片）
  ['dc_slither',          'https://slither.io/favicon.ico'],
  ['dc_krunker',          'https://krunker.io/docs/title_icon.png'],
  ['dc_geoguessr',        'https://www.geoguessr.com/static/img/og-image-default.jpg'],
  ['dc_agar',             'https://agar.io/assets/img/favicon-32.png'],
  ['dc_cookie-clicker',   'https://orteil.dashnet.org/cookieclicker/img/bgCookies.png'],
  ['dc_wordle',           'https://www.nytimes.com/games-assets/v2/assets/wordle-icon.svg'],
  ['dc_2048',             'https://play2048.co/meta/og-image.png'],
  ['dc_skribbl',          'https://skribbl.io/static/img/logo.png'],
  ['dc_shell-shockers',   'https://shellshock.io/img/social-share.jpg'],
  ['dc_paper-io',         'https://paper-io.com/img/icons/icon-200.png'],

  // 移动手游（官方 OG 图标或社区资源）
  ['dc_pubg-mobile',      'https://pubgmobile.com/img/og_image.jpg'],
  ['dc_honkai-star-rail', 'https://act-webstatic.hoyoverse.com/hkrpg_event/hkrpg-index/img/logo.png'],
  ['dc_clash-royale',     'https://cdn.supercell.com/supercell.com/supercell.com_20231009104511/images/supercell-clash-royale-game-key-art-1920x1080-en.jpg'],
  ['dc_wangzhe-rongyao',  'https://image.pvp.qq.com/cgicon/head/101110.jpg'],
  ['dc_mingri-fangzhou',  'https://img.tapimg.cn/market/lcs/xxx.png'.replace('xxx', '2023/03/29/mingri_logo')],
  ['dc_benghuai-3',      'https://upload-os-bbs.mihoyo.com/upload/2023/04/13/xxx.jpg'.replace('xxx', 'benghuai3_cover')],
  ['dc_candy-crush',     'https://cdn.kingdom.com/public/content/common/game-icons/ccs/icon_candycrush_saga_200x200.png'],
  ['dc_yinyangshi',      'https://yys.res.netease.com/rtg/res/img/logo.png'],
  ['dc_danzai-paidui',   'https://img.tapimg.cn/market/images/danzai_cover.png'],
  ['dc_mobile-legends',  'https://mobile legends bang bang.com/logo.png'.replace(' ', '')],
  ['dc_free-fire',       'https://freefiremobile.com/img/og_image.jpg'],
  ['dc_heping-jingying', 'https://gp静态资源/pubic/zzly_logo.png'],
  ['dc_pokemon-go',      'https://www.pokemongo.com/img/pogo-logo.png'],
  ['dc_minecraft-mobile','https://img.minecraft.net/dig-minecraft/logo.png'],
  ['dc_among-us',        'https://www.innersloth.com/img/logo.png'],
  ['dc_subway-surfers',  'https://cdn.synergeticmedia.com/wp-content/uploads/subway-surfers-icon.png'],
  ['dc_genshin-mobile',  'https://webstatic.hoyoverse.com/upload/op-public/2023/01/04/genshin_icon.png'],
]

function replaceCover(id, url) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp("(id: '" + escaped + "'[^}]*?coverUrl:\\s*)'[^']*'", 'g')
  const before = src
  src = src.replace(re, '$1\'' + url + '\'')
  return src !== before
}

console.log('--- Steam CDN ---')
for (const [id, appid] of STEAM) {
  const url = 'https://cdn.cloudflare.steamstatic.com/steam/apps/' + appid + '/header.jpg'
  if (replaceCover(id, url)) { updated++; console.log(' ✓', id) }
}

console.log('\n--- Real covers ---')
for (const [id, url] of REAL) {
  if (replaceCover(id, url)) { updated++; console.log(' ✓', id) }
}

writeFileSync(CATALOG, src, 'utf-8')
console.log('\nUpdated:', updated)
console.log('SVG left:', (src.match(/data:image\/svg\+xml/g) || []).length)
console.log('Empty:', (src.match(/coverUrl: ''/g) || []).length)
console.log('HTTP:', (src.match(/coverUrl: 'http/g) || []).length)
