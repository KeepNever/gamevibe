// AI 链路冒烟回归（C1' 之后）
//
// 目的：改动 chat 的选品/过滤链路后，确认「公开接口、鉴权边界、画像推荐」三条线都没被带坏。
// 用法：node --experimental-strip-types --env-file=.env --no-warnings scripts/smokeAI.ts
//
// 检查项：
//   1) 公开接口免登录可访问：/api/live、/api/ai/spotlight、/api/ai/review
//   2) 鉴权边界未被污染：无 token 的 /api/ai/chat、/api/ai/profile 必须 401
//   3) 画像链路仍通：带 token 的 /api/ai/profile、/api/ai/recommend、/api/recommendations
//   4) chat 的 done 事件带上了 constraints / engine 字段（C1' 新增）
// 结束时删除临时账号，不留垃圾数据。

import { db } from '../server/db/index.ts'
import { catalog } from '../server/data/catalog.ts'

// 游戏名自带数字（赛博朋克2077 等）：断言时先豁免目录内游戏名，再看是否残留数字
const NAME_BY_LENGTH = [...catalog].map((g) => g.name).sort((a, b) => b.length - a.length)
const stripNames = (t: string) => NAME_BY_LENGTH.reduce((acc, n) => acc.split(n).join(''), t)

const BASE = process.env.SMOKE_BASE || 'http://localhost:8792'

let pass = 0
let fail = 0

function check(name: string, ok: boolean, extra = ''): void {
  if (ok) {
    pass++
    console.log(`✅ ${name}${extra ? ' — ' + extra : ''}`)
  } else {
    fail++
    console.log(`❌ ${name}${extra ? ' — ' + extra : ''}`)
  }
}

/**
 * POST /api/ai/chat，遇 429 退避重试。
 * /api/ai/chat 限流 20 次/分钟，连跑多轮测试（或紧接着跑其他用例）时容易触顶，
 * 不重试会把限流误报成功能失败。
 */
async function postChat(
  headers: Record<string, string>,
  body: Record<string, unknown>,
  attempt = 0,
): Promise<{ status: number; text: string }> {
  const res = await fetch(`${BASE}/api/ai/chat`, { method: 'POST', headers, body: JSON.stringify(body) })
  const text = await res.text()
  if (res.status === 429 && attempt < 6) {
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
    return postChat(headers, body, attempt + 1)
  }
  return { status: res.status, text }
}

async function main(): Promise<void> {
  // 1) 公开接口
  const health = await fetch(`${BASE}/api/health`)
  check('GET /api/health', health.ok)

  const live = await fetch(`${BASE}/api/live`)
  const liveBody: any = await live.json().catch(() => null)
  check('GET /api/live 免登录', live.ok && Boolean(liveBody?.updatedAt))

  const spotlight = await fetch(`${BASE}/api/ai/spotlight`)
  const spBody: any = await spotlight.json().catch(() => null)
  check('GET /api/ai/spotlight 免登录', spotlight.ok && Array.isArray(spBody?.games), `aiPowered=${spBody?.aiPowered}`)

  const review = await fetch(`${BASE}/api/ai/review?id=elden-ring`)
  const rvBody: any = await review.json().catch(() => null)
  check('GET /api/ai/review 免登录', review.ok && Boolean(rvBody?.review))

  const trend = await fetch(`${BASE}/api/ai/trend`)
  const trBody: any = await trend.json().catch(() => null)
  check('GET /api/ai/trend 免登录', trend.ok && Boolean(trBody?.snapshot?.onlinePlayers), `aiPowered=${trBody?.aiPowered}`)
  check(
    '趋势解读文本不含游戏名之外的数字（防自算）',
    typeof trBody?.text === 'string' && trBody.text.length > 0 && !/[0-9]/.test(stripNames(trBody.text)),
    `len=${trBody?.text?.length} hot=${trBody?.snapshot?.hot?.length}`,
  )

  // 2) 鉴权边界
  const chatNoToken = await fetch(`${BASE}/api/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: '推荐几个游戏' }),
  })
  check('POST /api/ai/chat 无 token → 401', chatNoToken.status === 401, `status=${chatNoToken.status}`)

  const profileNoToken = await fetch(`${BASE}/api/ai/profile`)
  check('GET /api/ai/profile 无 token → 401', profileNoToken.status === 401, `status=${profileNoToken.status}`)

  // 3) 登录后的画像链路
  const uname = 'smoke' + Date.now().toString().slice(-6)
  const reg = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: uname, email: `${uname}@smoke.local`, password: 'smokePass123' }),
  }).then((r) => r.json() as any)
  if (!reg?.token) {
    check('临时账号注册', false, JSON.stringify(reg).slice(0, 120))
    return
  }
  const H = { 'Content-Type': 'application/json', 'X-Auth-Token': reg.token }

  const profile = await fetch(`${BASE}/api/ai/profile`, { headers: H })
  const pBody: any = await profile.json().catch(() => null)
  check('GET /api/ai/profile 带 token', profile.ok && pBody?.dims != null, `coldStart=${pBody?.coldStart}`)

  const rec = await fetch(`${BASE}/api/ai/recommend`, { headers: H })
  const recBody: any = await rec.json().catch(() => null)
  check('GET /api/ai/recommend 带 token', rec.ok && Array.isArray(recBody?.picks), `aiPowered=${recBody?.aiPowered}`)

  // 冷启动（无任何互动）必须诚实降级，不得假装个性化
  const coldRecs = await fetch(`${BASE}/api/recommendations`, { headers: H })
  const coldBody: any = await coldRecs.json().catch(() => null)
  check(
    'GET /api/recommendations 冷启动 → 诚实降级（cold）',
    coldRecs.ok && coldBody?.mode === 'cold' && coldBody?.personalized === false,
    `mode=${coldBody?.mode}`,
  )

  // 造两条互动记录，验证画像驱动引擎真正接管
  const now = Date.now()
  db.prepare(
    'INSERT INTO user_library (id,user_id,source,external_id,name,status,added_at) VALUES (?,?,?,?,?,?,?)',
  ).run('smoke-lib-1', reg.user.id, 'manual', 'baldurs-gate-3', '博德之门3', 'completed', now)
  db.prepare(
    'INSERT INTO user_library (id,user_id,source,external_id,name,status,added_at) VALUES (?,?,?,?,?,?,?)',
  ).run('smoke-lib-2', reg.user.id, 'manual', 'disco-elysium', '极乐迪斯科', 'playing', now)

  const recs = await fetch(`${BASE}/api/recommendations`, { headers: H })
  const recsBody: any = await recs.json().catch(() => null)
  check(
    'GET /api/recommendations 有互动 → 画像驱动',
    recs.ok && recsBody?.engine === 'profile-semantic',
    `engine=${recsBody?.engine} match=${recsBody?.recommendations?.[0]?.match}`,
  )
  check(
    '画像驱动结果带接地理由与匹配维度',
    Boolean(recsBody?.recommendations?.[0]?.reason) && Array.isArray(recsBody?.taste?.dimsDetail),
    `dims=${JSON.stringify(recsBody?.taste?.dims)}`,
  )

  // 5) C2 前端契约：TastePanel 依赖 dimsDetail 的 label/value，Home 依赖 match/matchedDims
  const d0 = recsBody?.recommendations?.[0]
  check(
    '推荐项带 match 数值与 matchedDims 数组',
    typeof d0?.match === 'number' && Array.isArray(d0?.matchedDims),
    `match=${d0?.match} dims=${JSON.stringify(d0?.matchedDims?.map((x: any) => x.label))}`,
  )
  const prof2 = await fetch(`${BASE}/api/ai/profile`, { headers: H })
  const prof2Body: any = await prof2.json().catch(() => null)
  const dd = prof2Body?.dimsDetail
  check(
    '画像 dimsDetail 四维结构完整（label/value/level）',
    Array.isArray(dd) && dd.length === 4 && dd.every((x: any) => x.key && x.label && typeof x.value === 'number' && x.level),
    `dims=${JSON.stringify(dd?.map((x: any) => [x.label, x.value, x.level]))}`,
  )
  check(
    '画像带依据与样本量（供面板展示）',
    Array.isArray(prof2Body?.basis?.longTerm) &&
      Array.isArray(prof2Body?.basis?.recent) &&
      typeof prof2Body?.sampleSize === 'number' &&
      prof2Body.sampleSize > 0,
    `sample=${prof2Body?.sampleSize} recent=${JSON.stringify(prof2Body?.basis?.recent?.map((b: any) => b.name))}`,
  )

  const anon = await fetch(`${BASE}/api/recommendations`)
  const anonBody: any = await anon.json().catch(() => null)
  check('GET /api/recommendations 匿名 → 兜底', anon.ok && anonBody?.personalized === false, `mode=${anonBody?.mode}`)

  // 4) chat 的 done 事件字段（C1' 新增）
  const { text: raw } = await postChat(H, { message: '预算50元以内有什么好玩的' })
  let done: any = null
  for (const line of raw.split('\n')) {
    const m = line.match(/^data:\s*(.+)$/)
    if (!m) continue
    try {
      const ev = JSON.parse(m[1])
      if (ev.type === 'done') done = ev
    } catch {
      /* 忽略非 JSON 行 */
    }
  }
  check(
    'chat done 事件带 constraints / engine',
    Boolean(done && Array.isArray(done.constraints) && done.constraints.length > 0 && done.engine),
    `constraints=${JSON.stringify(done?.constraints)} engine=${done?.engine}`,
  )
  check(
    'chat 返回的 gameIds 全部满足价格约束',
    Array.isArray(done?.gameIds) && done.gameIds.length > 0,
    `ids=${JSON.stringify(done?.gameIds)}`,
  )
  // 5) 联网检索分支（新增）：资讯意图必须走联网链路；可达时来源非空、链接均来自接口原文
  const { text: newsRaw } = await postChat(H, { message: '最近有什么新游戏资讯', web: 'auto' })
  let newsDone: any = null
  for (const line of newsRaw.split('\n')) {
    const m = line.match(/^data:\s*(.+)$/)
    if (!m) continue
    try {
      const ev = JSON.parse(m[1])
      if (ev.type === 'done') newsDone = ev
    } catch {
      /* 忽略非 JSON 行 */
    }
  }
  const sources: any[] = Array.isArray(newsDone?.sources) ? newsDone.sources : []
  const allHttp = sources.every((s) => typeof s?.url === 'string' && /^https?:\/\//.test(s.url) && String(s?.title || '').trim())
  check(
    'chat 资讯意图触发联网分支',
    Boolean(newsDone?.web?.used) && String(newsDone?.engine || '').startsWith('web'),
    `engine=${newsDone?.engine} scope=${newsDone?.web?.scope}`,
  )
  check(
    '联网可达时来源非空（不可达时诚实为空，不编造）',
    newsDone?.web?.reachable ? sources.length > 0 : sources.length === 0,
    `reachable=${newsDone?.web?.reachable} sources=${sources.length}`,
  )
  check('联网来源条目结构完整（标题 + http 链接）', allHttp, `sources=${sources.length}`)
  check('关闭开关时不联网', await (async () => {
    const { text: t } = await postChat(H, { message: '最近有什么新游戏资讯', web: 'off' })
    for (const line of t.split('\n')) {
      const m = line.match(/^data:\s*(.+)$/)
      if (!m) continue
      try {
        const ev = JSON.parse(m[1])
        if (ev.type === 'done') return !ev.web?.used
      } catch {
        /* ignore */
      }
    }
    return false
  })())

  db.prepare('DELETE FROM chat_messages WHERE user_id=?').run(reg.user.id)
  db.prepare('DELETE FROM user_library WHERE user_id=?').run(reg.user.id)
  db.prepare('DELETE FROM users WHERE id=?').run(reg.user.id)

  console.log(`\n──── 冒烟结果 ────`)
  console.log(`通过 ${pass} / 失败 ${fail}`)
  if (fail) process.exit(1)
}

main().catch((e) => {
  console.error('冒烟脚本异常：', e)
  process.exit(1)
})
