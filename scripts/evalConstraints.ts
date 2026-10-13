// 硬约束层自检（不依赖 LLM / 不依赖 HTTP 服务）
//
// 用途：改完 server/lib/requirements.ts 后，先在这里跑一遍，
//       确认「抽取 + 过滤」能在 30 条评测 query 上 100% 命中硬条件，
//       再去跑完整的 scripts/evalAI.ts（那条链路慢且耗 LLM 配额）。
//
// 用法：node --experimental-strip-types --env-file=.env --no-warnings scripts/evalConstraints.ts

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { db } from '../server/db/index.ts'
import { catalog } from '../server/data/catalog.ts'
import { extractByRules, filterCatalog, type Requirement } from '../server/lib/requirements.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
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

function loadProfiles(): Map<string, any> {
  const map = new Map<string, any>()
  try {
    const b = db
      .prepare("SELECT batch_id FROM profile_batches WHERE is_active=1 AND status='frozen' ORDER BY created_at DESC LIMIT 1")
      .get() as any
    if (!b) return map
    for (const r of db.prepare('SELECT * FROM game_profiles WHERE batch_id=?').all(b.batch_id) as any[]) map.set(r.game_id, r)
  } catch {
    /* 无画像 */
  }
  return map
}

/** 与 evalAI.ts 完全一致的判定口径，保证两处结论可比 */
function checkCond(cond: HardCond, id: string, profiles: Map<string, any>): boolean | null {
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

async function main() {
  const cases: EvalCase[] = readFileSync(join(ROOT, 'eval', 'queries.jsonl'), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l))

  const profiles = loadProfiles()
  console.log(`硬约束层自检 · ${cases.length} 条 · 画像覆盖 ${profiles.size}\n`)

  let pass = 0
  let total = 0
  let missed = 0
  const failures: string[] = []

  for (const c of cases) {
    const reqs = extractByRules(c.query)
    const { ids, relaxed } = filterCatalog(reqs, 8)
    console.log(`· ${c.id} ${c.query}`)
    console.log(`  抽取：${reqs.map((r: Requirement) => r.label).join(' / ') || '（无硬约束）'}`)
    console.log(`  候选：${ids.join(', ') || '（空）'}${relaxed.length ? `  放宽：${relaxed.map((r) => r.label).join(',')}` : ''}`)
    if (!ids.length) missed++

    if (c.hard.length) {
      total++
      const ok =
        ids.length > 0 &&
        c.hard.every((cond) => {
          const results = ids.map((id) => checkCond(cond, id, profiles))
          const known = results.filter((x) => x !== null) as boolean[]
          return known.length > 0 && known.every(Boolean)
        })
      if (ok) pass++
      else {
        failures.push(`${c.id} ${c.query}`)
        console.log(`  ❌ 硬条件未满足：${c.hard.map((h) => h.kind + (h.value ?? '')).join('+')}`)
      }
    }
  }

  console.log(`\n──── 硬约束层结果 ────`)
  console.log(`硬条件命中率：${Math.round((pass / total) * 1000) / 10}%（${pass}/${total}）`)
  console.log(`空结果：${missed} 条`)
  if (failures.length) console.log(`未命中：\n  - ${failures.join('\n  - ')}`)
}

main().catch((e) => {
  console.error('自检异常：', e)
  process.exit(1)
})
