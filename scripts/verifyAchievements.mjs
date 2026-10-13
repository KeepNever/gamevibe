// 成就榜 + Steam 评测「真实性」回归测试
//
// 覆盖两件事：
//   ① 全球成就榜的派生口径是否自洽（ceiling / buckets / rareRatio / 难度档位）
//   ② 有没有编造数据混进来 —— 这是本模块的历史事故点（曾被删掉的 MOCK_DB + genericMock
//      会伪造好评率、评测数、作者名与评论正文），所以这里用断言把口子焊死。
//
// 用法：node scripts/verifyAchievements.mjs [baseUrl]
const BASE = process.argv[2] || 'http://127.0.0.1:8792'

let pass = 0
let fail = 0
const failures = []
function ok(name, cond, extra = '') {
  if (cond) {
    pass++
    console.log('✅ ' + name + (extra ? ' — ' + extra : ''))
  } else {
    fail++
    failures.push(name)
    console.log('❌ ' + name + (extra ? ' — ' + extra : ''))
  }
}

const j = async (p) => {
  const r = await fetch(BASE + p, { signal: AbortSignal.timeout(60000) })
  return { status: r.status, body: await r.json() }
}

console.log('──── 全球成就榜 ────')

const elden = await j('/api/games/achievements/dc_elden-ring')
ok('成就端点匿名可访问（HTTP 200）', elden.status === 200, 'status=' + elden.status)
const e = elden.body
ok('艾尔登法环：ok=true', e.ok === true)
ok('成就条数合理（>20）', e.total > 20, 'total=' + e.total)
ok('返回了可读成就名（不是 ACH.XXX 内部名）', e.rarest.every((a) => a.name && !/^ACH[._]/i.test(a.name)), e.rarest[0]?.name)
ok('成就名是中文（schinese 变体生效）', /[\u4e00-\u9fa5]/.test(e.rarest[0]?.name || ''), e.rarest[0]?.name)

const rated = e.items.filter((a) => a.percent != null)
const minPct = Math.min(...rated.map((a) => a.percent))
ok('ceilingPercent = 全部成就里最低的解锁率', Math.abs(e.ceilingPercent - minPct) < 0.001, `${e.ceilingPercent} vs ${minPct}`)
ok('rarest 按解锁率升序', e.rarest.every((a, i, arr) => i === 0 || (arr[i - 1].percent ?? 101) <= (a.percent ?? 101)))

const bucketSum = Object.values(e.buckets).reduce((n, v) => n + v, 0)
ok('分档计数之和 = 成就总数', bucketSum === e.total, `${bucketSum} vs ${e.total}`)
const expectRare = Number(((e.buckets['0-10'] / e.total) * 100).toFixed(1))
ok('rareRatio 与 <10% 分档自洽', Math.abs(e.rareRatio - expectRare) < 0.15, `${e.rareRatio} vs ${expectRare}`)

const tierOk = { easy: 30, medium: 15, hard: 5, brutal: 1, nightmare: -1 }[e.difficulty.key]
ok(
  '难度档位与 ceilingPercent 对应',
  tierOk !== undefined && e.ceilingPercent >= tierOk && (e.difficulty.key === 'nightmare' ? e.ceilingPercent < 1 : true),
  `${e.difficulty.key} / ceiling=${e.ceilingPercent}%`,
)
ok('返回了口径说明（派生值必须标注）', /派生值/.test(e.note))
ok('图标使用项目常用 CDN 域且带备用域', e.rarest[0]?.iconUrl.includes('cdn.cloudflare.steamstatic.com') && !!e.rarest[0]?.iconFallbackUrl)

// 图标实物可达
let iconOk = 0
for (const a of e.rarest.slice(0, 3)) {
  try {
    const r = await fetch(a.iconUrl, { method: 'GET', headers: { Range: 'bytes=0-0' }, signal: AbortSignal.timeout(15000) })
    if (r.status === 200 || r.status === 206) iconOk++
  } catch { /* 计为失败 */ }
}
ok('成就图标实物可加载（抽查 3 个）', iconOk === Math.min(3, e.rarest.length), `${iconOk}/3`)

// 主机独占 / 无 Steam 版：必须如实说没有，而不是随便找个 appid 顶上
const totk = await j('/api/games/achievements/dc_totk')
ok('无 Steam 版的游戏：ok=false', totk.body.ok === false)
ok('无 Steam 版的原因用中文说清', /没有对应的 Steam 版本/.test(totk.body.reason || ''), (totk.body.reason || '').slice(0, 40))
ok('无 Steam 版时不返回任何成就条目', totk.body.items.length === 0 && totk.body.rarest.length === 0)

const bogus = await j('/api/games/achievements/dc_this-does-not-exist')
ok('未知 id 不报错、如实返回空', bogus.status === 200 && bogus.body.ok === false, 'status=' + bogus.status)

// 《Alan Wake 2》是 Epic 独占 —— 旧映射表曾把它指到一款无关游戏的 appid
const aw2 = await j('/api/games/achievements/dc_alan-wake-2')
ok('Epic 独占（Alan Wake 2）不被瞎映射', aw2.body.ok === false && aw2.body.appid === '')

console.log('\n──── Steam 评测：不允许出现编造数据 ────')

const rev = await j('/api/reviews/steam/dc_elden-ring')
const r = rev.body
ok('评测端点匿名可访问（HTTP 200）', rev.status === 200)
ok('真取到时 available=true', r.available === true)
ok("source 只在 'live' 中取值（不存在 'mock'）", r.source === 'live')
const realRatio = r.summary.totalReviews ? r.summary.totalPositive / r.summary.totalReviews : 0
ok('好评率 = 好评数 / 总评测数（不是 0–9 分档折算）', Math.abs(r.summary.reviewScore - realRatio) < 0.01, `${(r.summary.reviewScore * 100).toFixed(1)}% vs ${(realRatio * 100).toFixed(1)}%`)
ok('评测样本带真实作者与游玩时长', r.reviews.every((x) => !!x.author && x.playtime_forever > 0), `样本 ${r.reviews.length} 条`)

// appid 映射正确性：用 appdetails 反查游戏名，确认不是别的游戏的数据
const appdetail = await (await fetch(`https://store.steampowered.com/api/appdetails?appids=${r.steamAppId}&cc=us&l=english`, { signal: AbortSignal.timeout(25000) })).json()
ok('appid 反查得到「ELDEN RING」（映射没串到别的游戏）', /elden ring/i.test(appdetail?.[r.steamAppId]?.data?.name || ''), appdetail?.[r.steamAppId]?.data?.name)

const revBad = await j('/api/reviews/steam/dc_totk')
ok('无 Steam 版的游戏：available=false', revBad.body.available === false)
ok('无 Steam 版时 summary 全 0、reviews 为空（不填充假数据）',
  revBad.body.summary.totalReviews === 0 && revBad.body.summary.totalPositive === 0 && revBad.body.summary.reviewScore === 0 && revBad.body.reviews.length === 0)
ok('无 Steam 版的原因用中文说清', /没有对应的 Steam 版本/.test(revBad.body.reason || ''))
ok("source 为 'unavailable'，不是 'mock'", revBad.body.source === 'unavailable')

// 曾经串错的 4 条，逐条确认现在反查到的是本作
console.log('\n──── 旧映射表串错的条目（回归）────')
const FIXED = [
  ['dc_uncharted-4', /uncharted/i],
  ['dc_cod-modern-warfare', /modern warfare/i],
  ['dc_fall-guys', /fall guys/i],
  ['dc_overwatch-2', /overwatch/i],
]
for (const [gid, re] of FIXED) {
  const resp = await j('/api/reviews/steam/' + gid)
  if (!resp.body.available) {
    ok(`${gid} 能取到真数据`, false, resp.body.reason)
    continue
  }
  const d = await (await fetch(`https://store.steampowered.com/api/appdetails?appids=${resp.body.steamAppId}&cc=us&l=english`, { signal: AbortSignal.timeout(25000) })).json()
  const nm = d?.[resp.body.steamAppId]?.data?.name || '(取不到)'
  ok(`${gid} → ${resp.body.steamAppId} 反查是本作`, re.test(nm), nm)
}

console.log('\n════════════════════════════════')
console.log(`通过 ${pass} / 失败 ${fail}`)
if (failures.length) console.log('未通过：' + failures.join('; '))
process.exitCode = fail ? 1 : 0
