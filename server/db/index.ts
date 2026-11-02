import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { CREATE_TABLES } from './schema.ts'
import { seedRbac } from './seedRbac.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataDir = join(__dirname, 'data')
mkdirSync(dataDir, { recursive: true })

const dbPath = join(dataDir, 'gamevibe.db')

export const db: DatabaseSync = new DatabaseSync(dbPath)
db.exec('PRAGMA journal_mode = WAL;')
db.exec('PRAGMA foreign_keys = ON;')
db.exec(CREATE_TABLES)

// 幂等迁移：为已存在的库补充新列（忽略「列已存在」错误）
for (const col of ['bio TEXT', "status TEXT NOT NULL DEFAULT 'active'"]) {
  try {
    db.exec(`ALTER TABLE users ADD COLUMN ${col};`)
  } catch {
    // duplicate column — 忽略
  }
}

// RBAC 种子：角色 / 权限点 / 默认角色 / 首个管理员（幂等，每次启动都跑）
seedRbac(db)

export function getDb(): DatabaseSync {
  return db
}
