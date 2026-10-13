// 趋势解读验证
//
// 核心验收点：**模型不自算数字** —— 解读文本必须不含任何阿拉伯数字，
// 所有数字由本地从 /api/live 实时快照注入。这条从结构上堵死「编造/自算热度数字」。

import { catalog } from '../server/data/catalog.ts'

const BASE = process.env.BASE || 'http://localhost:8792'

// 游戏名自带数字（赛博朋克2077 / CS2 / 哈迪斯2…）：断言时先豁免目录内游戏名，
// 只对「游戏名之外」的阿拉伯数字报警 —— 那才是模型自算/编造的热度数字。
const NAME_BY_LENGTH = [...catalog].map((g) => g.name).sort((a, b) => b.length - a.length)
const stripNames = (t: string) => NAME_BY_LENGTH.reduce((acc, n) => acc.split(n).join(''), t)

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    pass++
    console.log(`  ✓ ${name}${detail ? ' — ' + detail : ''}`)
  } else {
    fail++
    console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`)
  }
}

async function get(path: string): Promise<any> {
  for (let i = 0; i < 6; i++) {
    const res = await fetch(BASE + path)
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)))
      continue
    }
    return { status: res.status, body: await res.json().catch(() => null) }
  }
  return { status: 429, body: null }
}

async function main() {
  console.log('── 趋势解读验证 ──')
  const t1 = await get('/api/ai/trend')
  check('GET /api/ai/trend 200', t1.status === 200 && t1.body?.ok === true, `status=${t1.status}`)
  const d = t1.body
  if (!d) {
    console.log('接口无响应，无法继续')
    process.exit(1)
  }

  check('aiPowered（DeepSeek 生效）', d.aiPowered === true, `aiPowered=${d.aiPowered}`)

  // 1. 核心：文本不含「游戏名之外」的阿拉伯数字（模型未自算/编造热度数字）
  const residual = stripNames(d.text || '')
  const hasDigit = /[0-9]/.test(residual)
  check(
    '解读文本不含游戏名之外的数字（防自算）',
    !hasDigit,
    hasDigit ? `违规：${residual.slice(0, 90)}` : `已豁免游戏名，残留 ${residual.length} 字`,
  )
  check('解读文本长度合理', (d.text || '').length >= 15, `${(d.text || '').length} 字`)

  // 2. 快照字段完整
  const s = d.snapshot || {}
  const numFields = ['onlinePlayers', 'streamingViewers', 'newToday', 'deals']
  check(
    '快照数字字段齐全且为正',
    numFields.every((f) => typeof s[f] === 'number' && s[f] > 0),
    JSON.stringify({ onlinePlayers: s.onlinePlayers, streamingViewers: s.streamingViewers, newToday: s.newToday, deals: s.deals }),
  )
  check('热度榜非空', Array.isArray(s.hot) && s.hot.length >= 1, `${s.hot?.length ?? 0} 条`)
  check(
    '热度榜条目字段完整',
    (s.hot || []).every((g: any) => g.id && g.name && typeof g.onlinePlayers === 'number' && typeof g.delta === 'number'),
  )

  // 3. 热度榜 id 必须来自实时接口（不能出现目录外游戏）
  const live = await get('/api/live')
  const liveIds = new Set((live.body?.trending || []).map((g: any) => g.id))
  const allInLive = (s.hot || []).every((g: any) => liveIds.has(g.id))
  check('热度榜 id 均来自 /api/live（无目录外游戏）', allInLive, (s.hot || []).map((g: any) => g.id).join(', '))

  // 4. 自洽：全网在线数 ≥ 榜内单款在线数
  const maxHot = Math.max(...(s.hot || []).map((g: any) => g.onlinePlayers), 0)
  check('全网在线数 ≥ 榜内单款在线数（自洽）', s.onlinePlayers >= maxHot, `${s.onlinePlayers} ≥ ${maxHot}`)

  // 5. 快照与实时接口同量级（时间差会波动，只校验数量级 ±50%）
  const liveOnline = live.body?.global?.onlinePlayers ?? 0
  const ratio = liveOnline ? s.onlinePlayers / liveOnline : 0
  check('快照在线数与 /api/live 同量级（±50%）', ratio > 0.5 && ratio < 1.5, `snapshot=${s.onlinePlayers} live=${liveOnline} ratio=${ratio.toFixed(2)}`)

  // 6. 缓存生效（TTL 内两次 updatedAt 一致）
  const t2 = await get('/api/ai/trend')
  check('60s 缓存生效（两次 updatedAt 一致）', t2.body?.updatedAt === d.updatedAt, `${d.updatedAt} vs ${t2.body?.updatedAt}`)

  // 7. 快照时间戳新鲜
  check('快照时间戳新鲜（1 分钟内）', Math.abs(Date.now() - (s.snapshotAt || 0)) < 60000, `${Math.round((Date.now() - (s.snapshotAt || 0)) / 1000)}s 前`)

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
  // 用 exitCode 而非 process.exit()：Node on Windows 在 fetch keep-alive 未释放时强退会触发 libuv 断言
  process.exitCode = fail ? 1 : 0
}

main()
