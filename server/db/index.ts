import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import { existsSync, mkdirSync, renameSync } from 'node:fs'
import { CREATE_TABLES } from './schema.ts'
import { seedRbac } from './seedRbac.ts'
import { runMigrations, SCHEMA_VERSION } from './migrations.ts'
import { backend, initLocalDb, initTursoDb, localConn, type GameVibeDb } from './driver.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataDir = join(__dirname, 'data')
mkdirSync(dataDir, { recursive: true })

const dbPath = process.env.DB_FILE
  ? resolve(process.env.DB_FILE)
  : join(dataDir, 'gamevibe.db')

/**
 * 数据库文件损坏时，不要带着它启动，也不要直接删掉。
 *
 * 背景：部署会把本地这份库当快照上传，而沙箱里可能残留上一次运行留下的
 * -wal / -shm。文件与 WAL 对不上时 SQLite 抛 SQLITE_CORRUPT(11)，表现为
 * 「malformed database schema ... invalid rootpage」。过去这种情况会让整个
 * 服务起不来、分享链接直接挂掉——一个数据文件的问题不该炸掉整个网站。
 *
 * 策略：把坏文件连同 -wal/-shm 一起改名移开（保留现场，不删），再重建空库，
 * 由 schema + migrations + 种子把结构补齐。只在「确实是损坏」时这么做，
 * 其他错误照常抛出，避免把真实问题掩盖成一次静默重建。DB_NO_HEAL=1 可关闭。
 */
function looksCorrupt(err: unknown): boolean {
  if ((err as { errcode?: number })?.errcode === 11) return true // SQLITE_CORRUPT
  const msg = err instanceof Error ? err.message : String(err)
  return /malformed|not a database|invalid rootpage|disk image is malformed/i.test(msg)
}

function setAside(path: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const aside = `${path}.corrupt-${stamp}`
  for (const suffix of ['', '-wal', '-shm']) {
    const from = `${path}${suffix}`
    if (!existsSync(from)) continue
    try {
      renameSync(from, `${aside}${suffix}`)
    } catch {
      /* 单个文件移不动不阻断，重建时会被覆盖 */
    }
  }
  return aside
}

function attemptOpen(path: string): DatabaseSync {
  const conn = new DatabaseSync(path)
  try {
    // 第一条 PRAGMA 就会读 schema，损坏在这里暴露，而不是等到某个业务查询才炸
    conn.exec('PRAGMA journal_mode = WAL;')
    conn.exec('PRAGMA foreign_keys = ON;')
    return conn
  } catch (e) {
    try {
      conn.close()
    } catch {
      /* 已关闭或本就打不开 */
    }
    throw e
  }
}

function openDatabase(path: string): DatabaseSync {
  try {
    return attemptOpen(path)
  } catch (e) {
    if (!looksCorrupt(e) || process.env.DB_NO_HEAL === '1') throw e
    const aside = setAside(path)
    console.warn('  ⚠️ 数据库文件损坏，已移开并重建空库')
    console.warn(`     现场保留在：${aside}`)
    console.warn(`     原因：${e instanceof Error ? e.message : String(e)}`)
    return attemptOpen(path)
  }
}

export const db: GameVibeDb =
  backend === 'turso'
    ? initTursoDb(process.env.TURSO_DATABASE_URL!, process.env.TURSO_AUTH_TOKEN!)
    : initLocalDb(openDatabase(dbPath))

if (backend === 'local') {
  // 结构与种子只属于本地后端：Turso 的结构由 scripts/pushToTurso.mjs 推送，
  // 远程库带着自己的 schema_migrations，重复跑迁移只会白慢启动。
  await db.exec(CREATE_TABLES)

  // 版本化迁移：老库里历史遗留的「幂等 ALTER」由 migration 1 接管，
  // 新库则一次性建到位。失败直接抛错拒绝启动——带着半套结构跑起来更危险。
  const mig = runMigrations(localConn!)
  if (mig.applied.length) {
    console.log(`  🧱 数据库迁移：${mig.from} → ${mig.to}（执行 ${mig.applied.join(', ')}）`)
  } else {
    console.log(`  🧱 数据库架构已是最新：v${SCHEMA_VERSION}`)
  }

  // RBAC 种子：角色 / 权限点 / 默认角色 / 首个管理员（幂等，每次启动都跑）
  seedRbac(localConn!)
} else {
  console.log(`  🧱 数据后端：Turso 远程库（${new URL(String(process.env.TURSO_DATABASE_URL).replace(/^libsql:\/\//, 'https://')).host}）`)
}

/** 兼容旧导出：运行时统一走 GameVibeDb；本地连接在 localConn 上 */
export function getDb(): DatabaseSync {
  if (!localConn) throw new Error('getDb() 只在本地后端可用')
  return localConn
}
