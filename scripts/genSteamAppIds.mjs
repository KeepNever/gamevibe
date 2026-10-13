// 从 scripts/.appid-audit.json 生成 server/lib/steamAppIds.ts
// 用法：先跑 auditSteamAppIds.mjs，再跑本脚本（--apply 才落盘）
import { readFileSync, writeFileSync } from 'node:fs'

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\//, '')
const audit = JSON.parse(readFileSync(ROOT + 'scripts/.appid-audit.json', 'utf8'))

// 人工订正：审计中名实不符的条目（appid 由 storesearch / appdetails 二次解析确认）
const FIX = {
  'dc_cod-modern-warfare': 3595270, // storesearch「Call of Duty: Modern Warfare III」首选
  'dc_uncharted-4': 1659420, // 只有「UNCHARTED: Legacy of Thieves Collection」在 Steam 上架
  'dc_fall-guys': 1097150, // storesearch 不收录，appdetails 实查确认
  'dc_overwatch-2': 2357570, // 游戏已改名为「Overwatch®」，2358720 实为黑神话悟空
  'dc_alan-wake-2': null, // Epic 独占，Steam 无此游戏 → 不映射（如实无数据）
}

const entries = []
for (const r of audit.ok) {
  const id = FIX[r.id] !== undefined ? FIX[r.id] : r.chosen
  if (id == null) continue
  entries.push([r.id.replace(/^dc_/, ''), id])
}
// 审计判为不符但已人工订正的，也要收进来
for (const r of audit.mismatch) {
  const v = FIX[r.id]
  if (v == null) continue
  entries.push([r.id.replace(/^dc_/, ''), v])
}
entries.sort((a, b) => a[0].localeCompare(b[0]))

const lines = []
lines.push('// 站内游戏 ID → Steam appid 映射（2026-09-24 全量核验）')
lines.push('//')
lines.push('// 为什么要有这张表：Steam 的评测、成就、在线人数都按 appid 索引，而站内用的是自己的 id。')
lines.push('// 为什么必须核验：旧表里有 5 条名实不符（例如 dc_overwatch-2 指向 2358720，实际是《黑神话：悟空》），')
lines.push('//   会让详情页把另一款游戏的数据当成本作的数据展示 —— 这类错误比没数据更糟，故全量用')
lines.push('//   store.steampowered.com/api/appdetails 逐个回读游戏名核对（scripts/auditSteamAppIds.mjs）。')
lines.push('//')
lines.push('// 维护：目录新增或改名时重跑 scripts/auditSteamAppIds.mjs，再跑 scripts/genSteamAppIds.mjs --apply。')
lines.push('// 注意：Nintendo / PlayStation / 手游 / 网页游戏多数没有 Steam 版，不在表内；')
lines.push('//   《Alan Wake 2》为 Epic 独占，同样无 Steam appid（如实不提供 Steam 数据，不猜）。')
lines.push('')
lines.push('export const STEAM_APP_ID_DC: Record<string, number> = {')
for (const [k, v] of entries) lines.push(`  '${k}': ${v},`)
lines.push('}')
lines.push('')

writeFileSync(ROOT + 'scripts/.steamAppIds.generated.ts', lines.join('\n'))
console.log(`生成 ${entries.length} 条映射 → scripts/.steamAppIds.generated.ts`)
console.log(
  '订正的 5 条：' +
    Object.entries(FIX)
      .map(([k, v]) => `${k}→${v ?? '无'}`)
      .join('  '),
)
