// AI 效果评测（Step C 验收 / 基线）
// 用法：node --experimental-strip-types --env-file=.env --no-warnings scripts/evalAI.ts [--label baseline]
//
// 做什么：
//   1) 读取 eval/queries.jsonl（30 条自然语言 query + 可机检的硬条件）
//   2) 逐条走 /api/ai/chat（真实 LLM 链路），解析 SSE 拿到回复文案与 gameIds
//   3) 机检：硬条件是否 100% 遵守、返回 id 是否都在目录内、文案里的价格是否与目录一致
//   4) 输出 docs/eval-report.md（含 人工评分 列，待人工复核）
//
// 说明：人工 1-5 的「表达质量」分留空，由人工填写；硬条件与事实正确率由脚本判定。

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { db } from '../server/db/index.ts'
import { catalog } from '../server/data/catalog.ts'
import type { CatalogGame } from '../server/types.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const BASE = process.env.EVAL_BASE || 'http://localhost:8792'
const LABEL = process.argv.includes('--label') ? process.argv[process.argv.indexOf('--label') + 1] : 'current'
const GAP_MS = 3200 // 规避 /api/ai 每分钟 20 次限流

const CAT = new Map(catalog.map((g) => [g.id, g]))

interface HardCond {
  kind: string
  value?: number
  values?: string[]
  of?: HardCond[]
}
interface EvalCase {
  id: string
  query: string
  hard: HardCond[]
}

interface GameProfileRow {
  game_id: string
  story_intensity: number
  difficulty: number
  exploration: number
  combat_intensity: number
  multiplayer: string
  estimated_length: string
}

function loadProfiles(): Map<string, GameProfileRow> {
  const map = new Map<string, GameProfileRow>()
  try {
    const b = db.prepare("SELECT batch_id FROM profile_batches WHERE is_active=1 AND status='frozen' ORDER BY created_at DESC LIMIT 1").get() as any
    if (!b) return map
    for (const r of db.prepare('SELECT * FROM game_profiles WHERE batch_id=?').all(b.batch_id) as any[]) map.set(r.game_id, r)
  } catch {
    /* 无画像 → 相关硬条件跳过 */
  }
  return map
}

function checkCond(cond: HardCond, id: string, profiles: Map<string, GameProfileRow>): boolean | null {
  const g = CAT.get(id)
  if (!g) return false
  const pool = [...g.genres, ...g.tags]
  switch (cond.kind) {
    case 'free':
      return g.price === 0
    case 'price_lte':
      return g.price <= (cond.value ?? 0)
    case 'rating_gte':
      return g.rating >= (cond.value ?? 0)
    case 'genre':
    case 'tag':
      return (cond.values ?? []).some((v) => pool.some((x) => x.includes(v)))
    case 'multiplayer': {
      const p = profiles.get(id)
      return p ? (cond.values ?? []).includes(p.multiplayer) : null
    }
    case 'length': {
      const p = profiles.get(id)
      return p ? (cond.values ?? []).includes(p.estimated_length) : null
    }
    case 'story_gte': {
      const p = profiles.get(id)
      return p ? p.story_intensity >= (cond.value ?? 0) : null
    }
    case 'difficulty_lte': {
      const p = profiles.get(id)
      return p ? p.difficulty <= (cond.value ?? 0) : null
    }
    case 'difficulty_gte': {
      const p = profiles.get(id)
      return p ? p.difficulty >= (cond.value ?? 0) : null
    }
    case 'any':
      return (cond.of ?? []).some((c) => checkCond(c, id, profiles) === true)
    default:
      return null
  }
}

function priceMentions(text: string): number[] {
  return [...text.matchAll(/[¥￥]\s*(\d+)/g)].map((m) => Number(m[1]))
}

async function chat(token: string, message: string): Promise<{ text: string; gameIds: string[]; status: number }> {
  const res = await fetch(`${BASE}/api/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Auth-Token': token },
    body: JSON.stringify({ message }),
  })
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    return { text: t, gameIds: [], status: res.status }
  }
  const raw = await res.text()
  let text = ''
  let gameIds: string[] = []
  for (const line of raw.split('\n')) {
    const m = line.match(/^data:\s*(.+)$/)
    if (!m) continue
    try {
      const ev = JSON.parse(m[1])
      if (ev.type === 'token') text += ev.content
      if (ev.type === 'done') gameIds = ev.gameIds || []
    } catch {
      /* 忽略非 JSON 行 */
    }
  }
  return { text, gameIds, status: res.status }
}

async function main() {
  const casesPath = join(ROOT, 'eval', 'queries.jsonl')
  const cases: EvalCase[] = readFileSync(casesPath, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l))

  const profiles = loadProfiles()
  console.log(`评测集 ${cases.length} 条 · 画像覆盖 ${profiles.size} 款 · 标签=${LABEL}`)

  // 用临时评测账号（避免污染演示账号的聊天记录）
  const uname = 'eval' + Date.now().toString().slice(-6)
  const email = `${uname}@eval.local`
  const reg = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: uname, email, password: 'evalPass123' }),
  }).then((r) => r.json())
  if (!reg?.token) throw new Error('评测账号注册失败: ' + JSON.stringify(reg).slice(0, 150))
  const token: string = reg.token

  const rows: string[] = []
  let hardPass = 0
  let hardTotal = 0
  let factOkCount = 0
  let autoSum = 0
  let idOkCount = 0
  let emptyCount = 0

  for (const c of cases) {
    const r = await new Promise<{ text: string; gameIds: string[]; status: number }>((resolve) => {
      chat(token, c.query).then(resolve)
    })
    const ids = r.gameIds
    if (ids.length === 0) emptyCount++
    // 目录校验：只判「是否出现了目录外的 id」；空结果单独记为「无返回」，不计入编造
    const allInCatalog = ids.every((id) => CAT.has(id))
    if (allInCatalog) idOkCount++

    // 硬条件判定（对每条硬条件，要求所有返回游戏都满足；无返回游戏视为不满足）
    let condResult = '—'
    let hardOk = true
    if (c.hard.length) {
      hardTotal++
      const per = c.hard.map((cond) => {
        const results = ids.map((id) => checkCond(cond, id, profiles))
        const known = results.filter((x) => x !== null) as boolean[]
        const ok = ids.length > 0 && known.length > 0 && known.every(Boolean)
        if (!ok) hardOk = false
        return `${cond.kind}${cond.value ?? ''}${cond.values ? '[' + cond.values.join('/') + ']' : ''}=${ok ? '✓' : '✗'}`
      })
      condResult = per.join(' + ')
      if (hardOk) hardPass++
    }

    // 事实核对：文案里的金额必须能在目录中找到对应价格
    const prices = priceMentions(r.text)
    const allPrices = [...CAT.values()].map((g) => g.price)
    const factOk = prices.every((p) => allPrices.includes(p)) && allInCatalog
    if (factOk) factOkCount++

    const autoScore = !hardOk ? 0 : Math.min(5, 3 + (allInCatalog ? 1 : 0) + (factOk ? 1 : 0))
    autoSum += autoScore

    rows.push(
      `| ${c.id} | ${c.query} | ${c.hard.length ? condResult : '（软查询）'} | ${ids.join(', ') || '—'} | ${c.hard.length ? (hardOk ? '✅' : '❌') : '—'} | ${factOk ? '✅' : '❌'} | ${autoScore} | |`,
    )
    console.log(
      `${hardOk ? '✅' : c.hard.length ? '❌' : '·'} ${c.id} ${c.query} → [${ids.join(',')}] ${allInCatalog ? '' : '(存在目录外 id)'} ${r.text.slice(0, 40).replace(/\n/g, ' ')}`,
    )
    await new Promise((res) => setTimeout(res, GAP_MS))
  }

  db.prepare('DELETE FROM chat_messages WHERE user_id=?').run(reg.user.id)
  db.prepare('DELETE FROM users WHERE id=?').run(reg.user.id)

  const n = cases.length
  const hardRate = hardTotal ? Math.round((hardPass / hardTotal) * 1000) / 10 : null
  const factRate = Math.round((factOkCount / n) * 1000) / 10
  const idRate = Math.round((idOkCount / n) * 1000) / 10
  const avg = Math.round((autoSum / n) * 100) / 100

  mkdirSync(join(ROOT, 'docs'), { recursive: true })
  const out: string[] = []
  out.push(`# AI 效果评测报告（${LABEL}）`)
  out.push('')
  out.push(`- 时间：${new Date().toISOString()}`)
  out.push(`- 评测集：\`eval/queries.jsonl\`（${n} 条）`)
  out.push(`- 链路：\`POST /api/ai/chat\`（真实 LLM，含接地两遍式）`)
  out.push(`- 画像批次：${profiles.size ? [...db.prepare("SELECT batch_id FROM profile_batches WHERE is_active=1").all()].map((r: any) => r.batch_id).join(',') : '无'}`)
  out.push('')
  out.push('## 汇总')
  out.push('')
  out.push('| 指标 | 结果 | 通过线 |')
  out.push('|---|---|---|')
  out.push(`| 硬条件遵守率 | ${hardRate === null ? '无硬条件样本' : hardRate + '%'} | 100% |`)
  out.push(`| 无编造 id（返回项均在目录内） | ${idRate}% | 100% |`)
  out.push(`| 事实正确率（无编造价格） | ${factRate}% | ≥98% |`)
  out.push(`| 空结果率（答「没找到」但目录里有） | ${Math.round((emptyCount / n) * 1000) / 10}%（${emptyCount}/${n}） | 0 |`)
  out.push(`| 自动分（0-5，硬条件一票否决） | ${avg} | ≥3.5 |`)
  out.push('')
  out.push('> 自动分 = 基础 3 + 目录内 1 + 事实正确 1；硬条件不满足直接记 0。')
  out.push('> 「表达质量」需人工按 1-5 打分填入下表最后一列，本表不替代人工判断。')
  out.push('')
  out.push('## 逐条明细')
  out.push('')
  out.push('| # | 用户 query | 硬条件判定 | 返回游戏 | 硬条件 | 事实 | 自动分 | 人工分 |')
  out.push('|---|---|---|---|---|---|---|---|')
  out.push(...rows)
  const reportName = LABEL === 'baseline' ? 'eval-report-baseline.md' : `eval-report-${LABEL}.md`
  writeFileSync(join(ROOT, 'docs', reportName), out.join('\n'), 'utf8')

  console.log(`\n──── 汇总 ────`)
  console.log(`硬条件遵守率：${hardRate === null ? '无样本' : hardRate + '%'}（${hardPass}/${hardTotal}）`)
  console.log(`目录内 id：${idRate}% ｜ 事实正确率：${factRate}% ｜ 自动均分：${avg}`)
  console.log(`报告已写出：docs/${reportName}`)
}

main().catch((e) => {
  console.error('评测脚本异常：', e)
  process.exit(1)
})
