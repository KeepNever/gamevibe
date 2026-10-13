// 离线批量生成游戏语义画像（Step B）
// 用法：node --experimental-strip-types --env-file=.env --no-warnings scripts/genProfiles.ts
//
// 行为：
//   1) 无 API key 直接退出，不写半成品批次
//   2) 新建一个 draft 批次（is_active=0），逐款调用 LLM
//   3) 逐款校验 JSON（枚举合法 / 分值 1-5 / 不含价格与平台等目录外事实）
//   4) 写入 game_profiles（status=draft），并输出核对表到 docs/profile-draft-review.md
//
// 注意：只生成「新增字段」，genres/tags/rating/price 等目录已有字段一律不重复生成。

import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { db } from '../server/db/index.ts'
import { catalog } from '../server/data/catalog.ts'
import { env } from '../server/env.ts'
import type { CatalogGame } from '../server/types.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const PROMPT_VERSION = 'v1.1'

const CORE_GAMEPLAY = ['战斗', '探索', '建造', '解谜', '叙事', '经营', '收集', '社交', '竞速', '策略推演']
const MULTIPLAYER = ['none', 'single', 'co-op', 'pvp', 'both']
const LENGTHS = ['<5h', '5-15h', '15-30h', '30-60h', '>60h', 'ongoing', 'unknown']

interface ProfileDraft {
  story_intensity: number
  difficulty: number
  exploration: number
  combat_intensity: number
  core_gameplay: string
  multiplayer: string
  estimated_length: string
  target_players: string
  semantic_summary: string
  content_notes: string
}

const SYSTEM = `你是游戏标签结构化助手。仅依据给定的名称、类型、标签、评分推断语义字段。
绝对禁止引入任何未给出的具体事实（角色名、剧情细节、发售日期、价格、平台名称）。
无法判断时填 unknown（枚举字段）或留空（文本字段），不要猜测。
只输出 JSON，字段为：
story_intensity, difficulty, exploration, combat_intensity, core_gameplay,
multiplayer, estimated_length, target_players, semantic_summary, content_notes

字段取值规则：
- story_intensity/difficulty/exploration/combat_intensity：整数 1-5（1 很低 3 中等 5 极高）
- core_gameplay：从 [${CORE_GAMEPLAY.join(', ')}] 中选 1-4 个，逗号分隔
- multiplayer：从 [${MULTIPLAYER.join(', ')}] 中选一个（pvp 仅对抗、co-op 仅合作、both 两者皆有；纯对抗竞技射击不得标 both）
- estimated_length：从 [${LENGTHS.join(', ')}] 中选一个（长期运营型标 ongoing，无法判断才用 unknown）
- target_players：一句话，不超过 40 字
- semantic_summary：1-2 句，不超过 120 字，只能引用给定的类型与标签信息
- content_notes：一句话劝退提示（可空字符串），不超过 40 字`

function buildUser(g: CatalogGame): string {
  return [
    `名称: ${g.name}`,
    `类型: ${g.genres.join('/')}`,
    `标签: ${g.tags.join('/')}`,
    `评分: ${g.rating}`,
    '',
    '请以 JSON 输出上述字段。',
  ].join('\n')
}

function extractJson(content: string): any {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = fenced ? fenced[1] : content
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('no JSON object in response')
  return JSON.parse(raw.slice(start, end + 1))
}

function clampInt(v: unknown): number {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return 0
  return Math.min(5, Math.max(1, n))
}

function validate(o: any): { ok: boolean; errors: string[]; data: ProfileDraft } {
  const errors: string[] = []
  const data: ProfileDraft = {
    story_intensity: clampInt(o.story_intensity),
    difficulty: clampInt(o.difficulty),
    exploration: clampInt(o.exploration),
    combat_intensity: clampInt(o.combat_intensity),
    core_gameplay: '',
    multiplayer: '',
    estimated_length: '',
    target_players: String(o.target_players ?? '').trim(),
    semantic_summary: String(o.semantic_summary ?? '').trim(),
    content_notes: String(o.content_notes ?? '').trim(),
  }

  for (const k of ['story_intensity', 'difficulty', 'exploration', 'combat_intensity'] as const) {
    const v = Number(o[k])
    if (!Number.isInteger(v) || v < 1 || v > 5) errors.push(`${k} 越界(${o[k]})`)
  }

  const cg = String(o.core_gameplay ?? '')
    .split(/[,，、/]/)
    .map((s) => s.trim())
    .filter(Boolean)
  const badCg = cg.filter((x) => !CORE_GAMEPLAY.includes(x))
  if (badCg.length) errors.push(`core_gameplay 非法枚举(${badCg.join('/')})`)
  data.core_gameplay = cg.filter((x) => CORE_GAMEPLAY.includes(x)).slice(0, 4).join(',')

  data.multiplayer = String(o.multiplayer ?? '').trim()
  if (!MULTIPLAYER.includes(data.multiplayer)) errors.push(`multiplayer 非法(${data.multiplayer})`)

  data.estimated_length = String(o.estimated_length ?? '').trim()
  if (!LENGTHS.includes(data.estimated_length)) errors.push(`estimated_length 非法(${data.estimated_length})`)

  if (!data.semantic_summary) errors.push('semantic_summary 为空')
  if (data.semantic_summary.length > 200) errors.push('semantic_summary 超长')

  // 防幻觉硬校验：不得出现价格 / 平台等目录外事实
  const forbidden = /[¥￥]\s*\d|\d+\s*元|Switch|PS[45]|PlayStation|Xbox|Steam|任天堂|索尼|微软/i
  if (forbidden.test(data.semantic_summary)) errors.push('semantic_summary 含价格或平台等目录外事实')
  if (forbidden.test(data.target_players)) errors.push('target_players 含价格或平台等目录外事实')

  return { ok: errors.length === 0, errors, data }
}

async function callLLM(g: CatalogGame): Promise<ProfileDraft> {
  const baseUrl = env.DEEPSEEK_BASE_URL
  const apiKey = env.DEEPSEEK_API_KEY
  const model = env.DEEPSEEK_MODEL

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: buildUser(g) },
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' },
    }),
  })
  if (!res.ok) throw new Error(`LLM API ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`)
  const data = await res.json()
  const content: string = data?.choices?.[0]?.message?.content ?? ''
  if (!content.trim()) throw new Error('empty response')
  return extractJson(content)
}

async function generateWithRetry(g: CatalogGame, tries = 2): Promise<ProfileDraft> {
  let lastErr: unknown
  for (let i = 0; i < tries; i++) {
    try {
      const raw = await callLLM(g)
      const { ok, errors, data } = validate(raw)
      if (ok) return data
      lastErr = new Error('校验未通过: ' + errors.join('; '))
      console.warn(`    ↻ ${g.name} 校验失败，重试 ${i + 1}/${tries} — ${errors.join('; ')}`)
    } catch (e) {
      lastErr = e
      console.warn(`    ↻ ${g.name} 调用失败，重试 ${i + 1}/${tries} — ${e instanceof Error ? e.message : e}`)
    }
    await new Promise((r) => setTimeout(r, 800))
  }
  throw lastErr
}

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

async function main() {
  if (!env.DEEPSEEK_API_KEY && !env.AI_API_KEY) {
    console.error('✗ 未配置 DEEPSEEK_API_KEY / AI_API_KEY，无法生成画像。已终止，未写入任何数据。')
    process.exit(1)
  }
  const useDeepSeek = Boolean(env.DEEPSEEK_API_KEY)
  const model = useDeepSeek ? env.DEEPSEEK_MODEL : env.AI_MODEL

  const batchId = `profiles-${stamp()}`
  console.log(`批次 ${batchId} · 模型 ${model} · prompt ${PROMPT_VERSION} · 共 ${catalog.length} 款`)

  db.prepare(
    `INSERT INTO profile_batches (batch_id, model, prompt_version, created_at, status, is_active, game_count, verified_count, notes)
     VALUES (?, ?, ?, ?, 'draft', 0, 0, 0, '')`,
  ).run(batchId, model, PROMPT_VERSION, new Date().toISOString())

  const rows: { game: CatalogGame; draft: ProfileDraft }[] = []
  const failed: { game: CatalogGame; error: string }[] = []

  for (const g of catalog) {
    process.stdout.write(`  · ${g.name} … `)
    try {
      const draft = await generateWithRetry(g)
      db.prepare(
        `INSERT INTO game_profiles
         (game_id, batch_id, story_intensity, difficulty, exploration, combat_intensity,
          core_gameplay, multiplayer, estimated_length, target_players, semantic_summary,
          content_notes, model, prompt_version, generated_at, status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'draft')`,
      ).run(
        g.id, batchId, draft.story_intensity, draft.difficulty, draft.exploration, draft.combat_intensity,
        draft.core_gameplay, draft.multiplayer, draft.estimated_length, draft.target_players,
        draft.semantic_summary, draft.content_notes, model, PROMPT_VERSION, new Date().toISOString(),
      )
      rows.push({ game: g, draft })
      console.log('OK')
    } catch (e) {
      failed.push({ game: g, error: e instanceof Error ? e.message : String(e) })
      console.log('FAILED')
    }
    await new Promise((r) => setTimeout(r, 300))
  }

  db.prepare('UPDATE profile_batches SET game_count=?, notes=? WHERE batch_id=?')
    .run(rows.length, failed.length ? `失败 ${failed.length} 款` : '', batchId)

  // 核对表
  mkdirSync(join(ROOT, 'docs'), { recursive: true })
  const lines: string[] = []
  lines.push(`# 游戏语义画像 · draft 核对表`)
  lines.push('')
  lines.push(`- 批次：\`${batchId}\``)
  lines.push(`- 模型：${model} · prompt ${PROMPT_VERSION}`)
  lines.push(`- 状态：draft（未冻结）· 成功 ${rows.length} / ${catalog.length}${failed.length ? ` · 失败 ${failed.length}` : ''}`)
  lines.push(`- 说明：以下字段均由 LLM 依据「名称/类型/标签/评分」推断，逐条人工核对后再冻结。`)
  lines.push('')
  lines.push('| 游戏 | 剧情 | 难度 | 探索 | 战斗 | 核心玩法 | 多人 | 时长 | 适合人群 | 一句话概述 |')
  lines.push('|---|---|---|---|---|---|---|---|---|---|')
  for (const { game, draft } of rows) {
    lines.push(
      `| ${game.name} | ${draft.story_intensity} | ${draft.difficulty} | ${draft.exploration} | ${draft.combat_intensity} | ${draft.core_gameplay} | ${draft.multiplayer} | ${draft.estimated_length} | ${draft.target_players} | ${draft.semantic_summary} |`,
    )
  }
  if (failed.length) {
    lines.push('')
    lines.push('## 生成失败')
    lines.push('')
    for (const f of failed) lines.push(`- ${f.game.name}：${f.error}`)
  }
  writeFileSync(join(ROOT, 'docs', 'profile-draft-review.md'), lines.join('\n'), 'utf8')

  console.log(`\n完成：成功 ${rows.length}/${catalog.length}${failed.length ? `，失败 ${failed.length}` : ''}`)
  console.log(`核对表已写出：docs/profile-draft-review.md`)
  if (failed.length) process.exitCode = 1
}

main().catch((e) => {
  console.error('脚本异常：', e)
  process.exit(1)
})
