import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { CREATE_TABLES } from './schema.ts'
import { seedRbac } from './seedRbac.ts'
import { runMigrations, SCHEMA_VERSION } from './migrations.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataDir = join(__dirname, 'data')
mkdirSync(dataDir, { recursive: true })

const dbPath = join(dataDir, 'gamevibe.db')

export const db: DatabaseSync = new DatabaseSync(dbPath)
db.exec('PRAGMA journal_mode = WAL;')
db.exec('PRAGMA foreign_keys = ON;')
db.exec(CREATE_TABLES)

// 版本化迁移：老库里历史遗留的「幂等 ALTER」由 migration 1 接管，
// 新库则一次性建到位。失败直接抛错拒绝启动——带着半套结构跑起来更危险。
const mig = runMigrations(db)
if (mig.applied.length) {
  console.log(`  🧱 数据库迁移：${mig.from} → ${mig.to}（执行 ${mig.applied.join(', ')}）`)
} else {
  console.log(`  🧱 数据库架构已是最新：v${SCHEMA_VERSION}`)
}

// RBAC 种子：角色 / 权限点 / 默认角色 / 首个管理员（幂等，每次启动都跑）
seedRbac(db)

export function getDb(): DatabaseSync {
  return db
}
