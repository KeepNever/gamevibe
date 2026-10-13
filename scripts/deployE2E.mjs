// 线上端到端验证：登录演示账号 → 跑硬约束 query → 校验约束层是否真的在生产生效
// 用法：node scripts/deployE2E.mjs [base]
const BASE = process.argv[2] || 'https://gamevibe.app.workbuddy.host'

const PRICE = {
  'elden-ring': 298, 'baldurs-gate-3': 298, 'hades-2': 108, 'palworld': 108,
  'cyberpunk-2077': 298, 'stardew-valley': 48, 'lies-of-p': 298, 'valorant': 0,
  'dead-cells': 80, 'hollow-knight': 58, 'cs2': 0, 'dave-the-diver': 80,
  'disco-elysium': 116, 'monster-hunter-wilds': 368, 'vampire-survivors': 22,
  'god-of-war': 345,
}
const RATING = {
  'elden-ring': 9.6, 'baldurs-gate-3': 9.7, 'hades-2': 9.4, 'palworld': 8.8,
  'cyberpunk-2077': 8.6, 'stardew-valley': 9.8, 'lies-of-p': 9.0, 'valorant': 8.2,
  'dead-cells': 9.6, 'hollow-knight': 9.7, 'cs2': 8.4, 'dave-the-diver': 9.5,
  'disco-elysium': 9.5, 'monster-hunter-wilds': 8.0, 'vampire-survivors': 9.7,
  'god-of-war': 9.4,
}

const out = []
let pass = 0, fail = 0
function check(name, ok, detail) {
  if (ok) { pass++; out.push(`  ✅ ${name}` + (detail ? ` — ${detail}` : '')) }
  else { fail++; out.push(`  ❌ ${name}` + (detail ? ` — ${detail}` : '')) }
}

async function login() {
  const r = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: '糖糖不吃糖@seed.local', password: 'seedpass1234' }),
  })
  if (!r.ok) throw new Error(`login ${r.status}: ${await r.text().catch(() => '')}`)
  const j = await r.json()
  return j.token
}

async function chat(token, message) {
  const r = await fetch(`${BASE}/api/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Auth-Token': token },
    body: JSON.stringify({ message }),
  })
  if (!r.ok) throw new Error(`chat ${r.status}: ${await r.text().catch(() => '')}`)
  const raw = await r.text()
  let done = null
  let text = ''
  for (const line of raw.split('\n')) {
    const s = line.trim()
    if (!s.startsWith('data:')) continue
    const payload = s.slice(5).trim()
    if (!payload) continue
    try {
      const evt = JSON.parse(payload)
      if (evt.type === 'token') text += evt.content || ''
      if (evt.type === 'done') done = evt
    } catch { /* ignore */ }
  }
  return { done, text }
}

const CASES = [
  { q: '预算50元以内有什么好玩的', assert: (ids) => ids.length > 0 && ids.every((id) => PRICE[id] <= 50), desc: '全部 ≤¥50' },
  { q: '评分9.5以上的神作推荐几个', assert: (ids) => ids.length > 0 && ids.every((id) => RATING[id] >= 9.5), desc: '全部评分 ≥9.5' },
  { q: '想找一款免费的游戏', assert: (ids) => ids.length > 0 && ids.every((id) => PRICE[id] === 0), desc: '全部免费' },
  { q: '类似空洞骑士的游戏', assert: (ids) => ids.includes('hollow-knight'), desc: '含空洞骑士' },
  { q: '100元以内的RPG', assert: (ids) => ids.length > 0 && ids.every((id) => PRICE[id] <= 100), desc: '全部 ≤¥100' },
]

const t = await login()
out.push(`[login] ok, token len=${t.length}`)

for (const c of CASES) {
  try {
    const { done } = await chat(t, c.q)
    const ids = (done && done.gameIds) || []
    const cons = (done && done.constraints) || []
    const relaxed = (done && done.relaxed) || []
    const engine = done && done.engine
    const ok = c.assert(ids)
    check(`Q「${c.q}」(${c.desc})`, ok,
      `ids=[${ids.join(',')}] engine=${engine} constraints=${cons.map((x) => x.label || x.kind).join('/') || '无'} relaxed=${relaxed.map((x) => x.label || x.kind).join('/') || '无'}`)
  } catch (e) {
    check(`Q「${c.q}」`, false, String(e.message || e))
  }
}

// 画像接口
try {
  const r = await fetch(`${BASE}/api/ai/profile`, { headers: { 'X-Auth-Token': t } })
  const j = await r.json()
  check('GET /api/ai/profile 带 token', r.ok && j.dims != null, `coldStart=${j.coldStart} dims=${JSON.stringify(j.dims)}`)
} catch (e) { check('GET /api/ai/profile', false, String(e.message || e)) }

// 匿名鉴权边界
try {
  const r = await fetch(`${BASE}/api/ai/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'hi' }) })
  check('POST /api/ai/chat 无 token → 401', r.status === 401, `status=${r.status}`)
} catch (e) { check('POST /api/ai/chat 无 token', false, String(e.message || e)) }

out.push(``)
out.push(`──── 汇总：通过 ${pass} / 失败 ${fail} ────`)
console.log(out.join('\n'))
process.exit(fail === 0 ? 0 : 1)
