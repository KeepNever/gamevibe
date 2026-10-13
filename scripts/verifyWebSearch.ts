/**
 * 联网检索层验证（真实调用 Steam 公开接口）
 *
 * 覆盖：
 *   - 意图识别 / 检索词抽取（纯函数，不依赖网络）
 *   - 指定游戏资讯（按名搜 → 取官方新闻）
 *   - 全局新游动态（特价 / 最新发售 / 即将发售）
 *   - 关闭开关
 *   - 关键断言：来源条目的链接必须与直连接口返回的链接完全一致（零编造）
 *
 * 运行：node --experimental-strip-types --no-warnings scripts/verifyWebSearch.ts
 */

import {
  detectWebIntent,
  extractTerm,
  runWebSearch,
  getAppNews,
  getFeatured,
  searchSteamApp,
  type WebSourceItem,
} from '../server/lib/webSearch.ts'

let pass = 0
let fail = 0
const failures: string[] = []

function ok(name: string, cond: boolean, extra = ''): void {
  if (cond) {
    pass++
    console.log(`  ✅ ${name}`)
  } else {
    fail++
    failures.push(name + (extra ? ` — ${extra}` : ''))
    console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`)
  }
}

function section(t: string): void {
  console.log(`\n── ${t} ──`)
}

async function main(): Promise<void> {
  // ── 1. 意图识别（纯函数） ──
  section('意图识别 / 检索词抽取')
  ok('「最近有什么新游戏」→ 联网 global', (() => {
    const i = detectWebIntent('最近有什么新游戏')
    return i.want && i.scope === 'global'
  })())
  ok('「艾尔登法环最近有什么新闻」→ 联网 game', (() => {
    const i = detectWebIntent('艾尔登法环最近有什么新闻')
    return i.want && i.scope === 'game'
  })())
  ok('「推荐几款免费游戏」→ 不联网', detectWebIntent('推荐几款免费游戏').want === false)
  ok('「你好」→ 不联网', detectWebIntent('你好').want === false)
  ok('抽词：艾尔登法环最近有什么新闻 → 含「艾尔登法环」', (extractTerm('艾尔登法环最近有什么新闻') || '').includes('艾尔登法环'))
  ok('抽词：最近有什么新游戏 → 空（走全局）', extractTerm('最近有什么新游戏') === null)

  // ── 2. 指定游戏资讯 ──
  section('指定游戏资讯（真实联网）')
  const gameRes = await runWebSearch({ message: '艾尔登法环最近有什么新闻', force: 'auto' })
  console.log(`  reachable=${gameRes.reachable} scope=${gameRes.scope} term=${gameRes.term} game=${gameRes.game?.name ?? '-'} items=${gameRes.items.length}`)
  if (gameRes.notes.length) console.log(`  notes: ${gameRes.notes.join(' | ')}`)
  ok('取到了游戏条目', gameRes.items.length > 0)
  ok('解析到了游戏', Boolean(gameRes.game))
  ok('条目链接均为 http(s)', gameRes.items.every((i) => /^https?:\/\//.test(i.url)))
  ok('条目标题非空', gameRes.items.every((i) => i.title.trim().length > 0))

  // —— 零编造校验：新闻条目的链接必须出现在直连接口的原始返回里 ——
  if (gameRes.game) {
    const direct = await getAppNews(gameRes.game.appid, 6)
    const directUrls = new Set(direct.map((d) => d.url))
    const newsItems = gameRes.items.filter((i) => i.kind === 'news')
    const allFromApi = newsItems.every((i) => directUrls.has(i.url))
    ok(`新闻条目链接零编造（${newsItems.length} 条全部来自接口原文）`, allFromApi)
    ok('新闻条目带发布时间', newsItems.some((i) => i.date !== null))
  }

  // ── 3. 全局新游动态 ──
  section('全局新游动态（真实联网）')
  const globalRes = await runWebSearch({ message: '最近有什么新游戏', force: 'auto' })
  console.log(`  reachable=${globalRes.reachable} scope=${globalRes.scope} items=${globalRes.items.length}`)
  const kinds = new Set(globalRes.items.map((i) => i.kind))
  console.log(`  kinds=${[...kinds].join(',')}`)
  ok('全局检索取到条目', globalRes.items.length > 0)
  ok('包含多种类别（特价/发售/即将/热销）', kinds.size >= 2)
  ok('全局条目链接指向 Steam 商店', globalRes.items.every((i) => i.url.includes('store.steampowered.com')))

  // ── 4. 商店搜索能力 ──
  section('商店搜索（游戏名 → appid）')
  const hit = await searchSteamApp('艾尔登法环')
  console.log(`  hit=${hit ? hit.name + ' / ' + hit.appid : '-'}`)
  ok('中文名可搜到 appid', Boolean(hit && hit.appid > 0))

  // ── 5. 开关 ──
  section('开关行为')
  const offRes = await runWebSearch({ message: '艾尔登法环最近有什么新闻', force: 'off' })
  ok('force=off 时不联网', offRes.reachable === false && offRes.items.length === 0)
  const onRes = await runWebSearch({ message: '赛博朋克2077', force: 'on' })
  console.log(`  force=on 无意图词 → scope=${onRes.scope} game=${onRes.game?.name ?? '-'} items=${onRes.items.length}`)
  ok('force=on 时即使无意图词也尝试联网', onRes.items.length > 0)

  // ── 6. 缓存 ──
  section('缓存')
  const t0 = Date.now()
  await getFeatured(6)
  const dt = Date.now() - t0
  ok('第二次取全局动态命中缓存（<50ms）', dt < 50, `耗时 ${dt}ms`)

  // ── 汇总 ──
  console.log(`\n════════════════════════════════`)
  console.log(`  通过 ${pass} / 失败 ${fail}`)
  if (failures.length) {
    console.log('  失败项：')
    for (const f of failures) console.log(`   - ${f}`)
  }
  console.log(`════════════════════════════════`)
  process.exitCode = fail === 0 ? 0 : 1
}

main().catch((e) => {
  console.error('脚本异常：', e)
  process.exitCode = 2
})

// 占位：确保类型被使用，避免 TS 未使用告警
export type _Unused = WebSourceItem
