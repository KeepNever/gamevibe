// 站内游戏 ID → Steam appid 映射（2026-09-24 全量核验）
//
// 为什么要有这张表：Steam 的评测、成就、在线人数都按 appid 索引，而站内用的是自己的 id。
// 为什么必须核验：旧表里有 5 条名实不符（例如 dc_overwatch-2 指向 2358720，实际是《黑神话：悟空》），
//   会让详情页把另一款游戏的数据当成本作的数据展示 —— 这类错误比没数据更糟，故全量用
//   store.steampowered.com/api/appdetails 逐个回读游戏名核对（scripts/auditSteamAppIds.mjs）。
//
// 维护：目录新增或改名时重跑 scripts/auditSteamAppIds.mjs，再跑 scripts/genSteamAppIds.mjs --apply。
// 注意：Nintendo / PlayStation / 手游 / 网页游戏多数没有 Steam 版，不在表内；
//   《Alan Wake 2》为 Epic 独占，同样无 Steam appid（如实不提供 Steam 数据，不猜）。

import { STEAM_APP_ID } from '../data/steamAppIds.ts'

/** 多平台发现目录（132 条）里确实有 Steam 版的那些，键为去掉 dc_ 前缀的站内 id */
export const STEAM_APP_ID_DC: Record<string, number> = {
  'age-of-empires-4': 1846820,
  'among-us': 945360,
  'apex-legends': 1172470,
  'avowed': 2457220,
  'balatro': 2379780,
  'baldurs-gate-3': 1086940,
  'benghuai-3': 1671200,
  'black-myth-wukong': 2358720,
  'brotato': 1942280,
  'celeste': 504230,
  'cod-modern-warfare': 3595270,
  'control': 1759150,
  'cookie-clicker': 1454400,
  'cs2': 730,
  'cuphead': 268910,
  'cyberpunk-2077': 1091500,
  'danzai-paidui': 1260320,
  'dark-souls-3': 374320,
  'days-gone': 1259420,
  'dead-by-daylight': 381210,
  'death-stranding': 1850570,
  'destiny-2': 1085660,
  'disco-elysium': 632470,
  'doom-eternal': 782330,
  'dota-2': 570,
  'elden-ring': 1245620,
  'elden-ring-nightreign': 2622380,
  'enter-the-gungeon': 311690,
  'fall-guys': 1097150,
  'ff16': 2515020,
  'ff7-rebirth': 2909400,
  'flight-sim': 2537590,
  'forza-horizon-5': 1551360,
  'gears-5': 1097840,
  'ghost-tsushima': 2215430,
  'ghostwire-tokyo': 1475810,
  'god-of-war-2018': 1593500,
  'gow-ragnarok': 2322010,
  'grounded': 962130,
  'hades': 1145360,
  'hades-2': 1145350,
  'hades-2-switch': 1030300,
  'hades-fan': 588650,
  'halo-infinite': 1240440,
  'halo-mcc': 976730,
  'hellblade2': 2461850,
  'helldivers-2': 553850,
  'hifi-rush': 1817230,
  'hollow-knight': 367520,
  'horizon-fw': 2420110,
  'horizon-zd': 2561580,
  'indiana-jones': 2677660,
  'katana-zero': 460950,
  'minecraft-mobile': 1928870,
  'monster-hunter-world': 582010,
  'nier-automata': 524220,
  'no-mans-sky': 275850,
  'ori-wotw': 1057090,
  'outer-wilds': 753640,
  'overwatch-2': 2357570,
  'persona-5-royal': 1687950,
  'ratchet-rift': 1895880,
  'red-dead-2': 1174180,
  'resident-village': 1196590,
  'returnal': 1649240,
  'rise-of-the-ronin': 1340990,
  'rocket-league': 252950,
  'sea-of-thieves': 1172620,
  'sekiro': 814380,
  'spiderman-2': 2651280,
  'spiderman-mm': 1817190,
  'stardew': 413150,
  'starfield': 1716740,
  'stellar-blade': 3489700,
  'stray': 2531940,
  'street-fighter-6': 1364780,
  'subnautica': 264710,
  'terraria': 105600,
  'tlou-remake': 1888930,
  'tlou2': 2531310,
  'uncharted-4': 1659420,
  'undertale': 391540,
  'vampire-survivors': 1794680,
  'witcher-3': 292030,
  'yinyangshi': 551170,
}

/**
 * 站内 gameId → Steam appid。
 *
 * 兼容两套命名空间：
 *   - 多平台发现目录的 `dc_xxx`（如 dc_elden-ring）
 *   - 精选库的裸 id（如 elden-ring）
 * 找不到就返回 null —— 调用方必须把 null 当作「本站此游戏确实没有 Steam 数据」处理，
 * **不许拿别的 appid 顶上**（旧表就是这么错的）。
 */
export function resolveSteamAppId(gameId: string): number | null {
  const bare = gameId.startsWith('dc_') ? gameId.slice(3) : gameId
  return STEAM_APP_ID_DC[bare] ?? STEAM_APP_ID[bare] ?? null
}
