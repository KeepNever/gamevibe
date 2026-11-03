/**
 * 把本地 SQLite 全量推送到 Turso（node scripts/pushToTurso.mjs）
 * - 表结构：从本地 sqlite_master 取 CREATE TABLE，加 IF NOT EXISTS 后在远程执行
 * - 数据：INSERT OR IGNORE 分批灌入，可重复执行（增量补齐）
 * - 结束后逐表对账行数
 * 凭据从 .env 读 TURSO_DATABASE_URL / TURSO_AUTH_TOKEN
 */
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { createClient } from '@libsql/client/web'

// ── 读 .env ──
const env = {}
for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m) env[m[1]] = m[2]
}
const URL_ = env.TURSO_DATABASE_URL.replace(/^libsql:\/\//, 'https://').replace(/\/+$/, '')
const TOKEN = env.TURSO_AUTH_TOKEN
if (!URL_ || !TOKEN) {
  console.error('❌ .env 缺少 TURSO_DATABASE_URL / TURSO_AUTH_TOKEN')
  process.exit(1)
}

const local = new DatabaseSync('server/db/data/gamevibe.db')
const remote = createClient({ url: URL_, authToken: TOKEN })

const tables = local
  .prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid")
  .all()

console.log(`本地 ${tables.length} 张表，开始推送 → ${URL_}`)

// ── 1. 建表（幂等）──
for (const t of tables) {
  const ddl = t.sql.replace(/^CREATE TABLE /i, 'CREATE TABLE IF NOT EXISTS ')
  await remote.executeMultiple(ddl + ';')
}
console.log('✓ 表结构就绪')

// ── 2. 灌数据 ──
const BATCH = 50
for (const t of tables) {
  const name = t.name
  const cols = local.prepare(`PRAGMA table_info(${name})`).all().map((c) => c.name)
  const rows = local.prepare(`SELECT * FROM "${name}"`).all()
  if (!rows.length) {
    console.log(`  ${name}: 0 行，跳过`)
    continue
  }
  const placeholders = cols.map(() => '?').join(', ')
  const collist = cols.map((c) => `"${c}"`).join(', ')
  const sql = `INSERT OR IGNORE INTO "${name}" (${collist}) VALUES (${placeholders})`

  let done = 0
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH)
    const stmts = chunk.map((row) => ({
      sql,
      args: cols.map((c) => {
        const v = row[c]
        return typeof v === 'bigint' ? Number(v) : v
      }),
    }))
    await remote.batch(stmts, 'write')
    done += chunk.length
  }
  console.log(`  ${name}: ${done} 行已推`)
}

// ── 3. 对账 ──
console.log('\n── 行数对账（本地 / 远程）──')
let mismatch = 0
for (const t of tables) {
  const a = local.prepare(`SELECT COUNT(*) AS c FROM "${t.name}"`).get().c
  const b = (await remote.execute(`SELECT COUNT(*) AS c FROM "${t.name}"`)).rows[0][0]
  const ok = Number(a) === Number(b)
  if (!ok) mismatch++
  console.log(`  ${ok ? '✓' : '❌'} ${t.name}: ${a} / ${b}`)
}
console.log(mismatch ? `\n❌ ${mismatch} 张表行数不一致` : '\n✅ 全部对账一致')
process.exit(mismatch ? 1 : 0)
