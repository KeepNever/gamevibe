// 站内目录 gameId → Steam appid 映射（2026-09-23 通过 store.steampowered.com/api/storesearch 实解析生成）
//
// 为什么硬编码：实时在线人数接口需要 appid，而按名字搜每次都要联网、且中文名不可靠。
// 站内目录是固定的 16 款，一次性解析后写死最稳、最快，且完全确定（不依赖网络与模型）。
// 维护：目录新增游戏时，重新跑 scripts/resolveAppIds 逻辑（见 docs/AI-UPGRADE-PLAN.md 第 18 节）。
//
// 注意：VALORANT 不在 Steam 上架（Riot 自家启动器），故无 appid，实时在线人数对它不可用。
export const STEAM_APP_ID: Record<string, number> = {
  'elden-ring': 1245620,
  'baldurs-gate-3': 1086940,
  'hades-2': 1145350,
  palworld: 1623730,
  'cyberpunk-2077': 1091500,
  'stardew-valley': 413150,
  'lies-of-p': 1627720,
  'dead-cells': 588650,
  'hollow-knight': 367520,
  cs2: 730,
  'dave-the-diver': 1868140,
  'disco-elysium': 632470,
  'monster-hunter-wilds': 2246340,
  'vampire-survivors': 1794680,
  'god-of-war': 1593500,
}

/** 反查：appid → gameId */
export const APP_ID_TO_GAME: Record<number, string> = Object.fromEntries(
  Object.entries(STEAM_APP_ID).map(([id, appid]) => [appid, id]),
)
