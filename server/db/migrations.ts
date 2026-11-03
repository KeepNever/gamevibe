import type { DatabaseSync } from 'node:sqlite'

/**
 * 版本化迁移
 * ─────────────────────────────────────────────────────────
 * 之前靠「启动时逐条 ALTER + try/catch 忽略重复列」来补字段，问题是：
 *   1. 没有版本号，改了什么、改到哪一步，事后无从查证
 *   2. 一旦某条改错（比如类型写错），旧库已经带上错误结构，无法回滚
 *   3. 无法判断「线上库跑到哪个版本了」
 * 现在改为按 id 顺序执行、记录在 schema_migrations 表里，跑过的不再重复跑。
 *
 * 规则：
 *   - 迁移只增不改：已发布的迁移绝不修改 SQL，要改就追加新的一条
 *   - 每条迁移在自己的事务里执行，失败整体回滚，不会留下半套结构
 *   - 迁移必须幂等安全：老库里可能已有该列/该表（历史遗留），用 try 兜住
 */

export interface Migration {
  id: number
  name: string
  up: (db: DatabaseSync) => void
}

/** 安全加列：列已存在时静默跳过（兼容历史库） */
function addColumn(db: DatabaseSync, table: string, column: string, ddl: string): void {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl};`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (!/duplicate column|already exists/i.test(msg)) throw e
  }
}

export const MIGRATIONS: Migration[] = [
  // ── 1. 用户表：账户中心所需字段 ──────────────────────────
  {
    id: 1,
    name: 'users_account_center_columns',
    up(db) {
      // 手机号（国内 C 端标配；本期只做「可填写 + 待验证」，短信通道后接）
      addColumn(db, 'users', 'phone', 'TEXT')
      addColumn(db, 'users', 'phone_verified', 'INTEGER NOT NULL DEFAULT 0')
      addColumn(db, 'users', 'phone_verified_at', 'INTEGER')
      // 资料变更审计
      addColumn(db, 'users', 'updated_at', 'INTEGER')
      // 用户名冷却：改过一次要等 30 天
      addColumn(db, 'users', 'username_changed_at', 'INTEGER')
      // 软删除 + 冷静期
      addColumn(db, 'users', 'deleted_at', 'INTEGER')
      // 改密时间：用于让「改密前签发的旧令牌」立即失效
      addColumn(db, 'users', 'password_changed_at', 'INTEGER NOT NULL DEFAULT 0')
      // 兼容更老的库
      addColumn(db, 'users', 'bio', 'TEXT')
      addColumn(db, 'users', 'status', "TEXT NOT NULL DEFAULT 'active'")
      db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone ON users(phone) WHERE phone IS NOT NULL;')
    },
  },

  // ── 2. 会话表：支持「登录设备」与「踢下线」──────────────
  {
    id: 2,
    name: 'sessions',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          id           TEXT PRIMARY KEY,
          user_id      TEXT NOT NULL,
          ip           TEXT,
          ua           TEXT,
          created_at   INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL,
          expires_at   INTEGER NOT NULL,
          revoked_at   INTEGER,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, last_seen_at DESC);
      `)
    },
  },

  // ── 3. 审计日志：谁在何时对谁做了什么 ────────────────────
  {
    id: 3,
    name: 'audit_logs',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS audit_logs (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          actor_id    TEXT,
          actor_name  TEXT,
          action      TEXT NOT NULL,
          target_type TEXT,
          target_id   TEXT,
          detail      TEXT,
          ip          TEXT,
          ua          TEXT,
          result      TEXT NOT NULL DEFAULT 'ok',
          created_at  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_audit_actor  ON audit_logs(actor_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action, created_at DESC);
      `)
    },
  },

  // ── 5. 评论举报：用户提交，版主处理 ─────────────────────
  {
    id: 5,
    name: 'review_reports',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS review_reports (
          id          TEXT PRIMARY KEY,
          review_id   TEXT NOT NULL,
          reporter_id TEXT NOT NULL,
          reason      TEXT,
          handled_at  INTEGER,
          created_at  INTEGER NOT NULL,
          UNIQUE(review_id, reporter_id)
        );
        CREATE INDEX IF NOT EXISTS idx_reports_open ON review_reports(handled_at, created_at DESC);
      `)
    },
  },

  // ── 4. 邮箱换绑：双验证的一次性凭据 ─────────────────────
  {
    id: 4,
    name: 'email_changes',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS email_changes (
          id         TEXT PRIMARY KEY,
          user_id    TEXT NOT NULL,
          new_email  TEXT NOT NULL,
          code_hash  TEXT NOT NULL,
          attempts   INTEGER NOT NULL DEFAULT 0,
          expires_at INTEGER NOT NULL,
          used_at    INTEGER,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_email_changes_user ON email_changes(user_id, created_at DESC);
      `)
    },
  },
]

/** 当前代码期望的 schema 版本（= 最后一条迁移的 id） */
export const SCHEMA_VERSION = MIGRATIONS.reduce((m, x) => Math.max(m, x.id), 0)

export interface MigrationResult {
  from: number
  to: number
  applied: number[]
}

/** 执行所有未应用的迁移，返回本次跑了哪些 */
export function runMigrations(db: DatabaseSync): MigrationResult {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `)

  const done = new Set(
    (db.prepare('SELECT id FROM schema_migrations').all() as unknown as { id: number }[]).map((r) =>
      Number(r.id),
    ),
  )
  const from = done.size ? Math.max(...done) : 0
  const applied: number[] = []

  for (const m of [...MIGRATIONS].sort((a, b) => a.id - b.id)) {
    if (done.has(m.id)) continue
    db.exec('BEGIN')
    try {
      m.up(db)
      db.prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?,?,?)').run(
        m.id,
        m.name,
        Date.now(),
      )
      db.exec('COMMIT')
      applied.push(m.id)
    } catch (e) {
      db.exec('ROLLBACK')
      const msg = e instanceof Error ? e.message : String(e)
      throw new Error(`迁移 ${m.id} (${m.name}) 失败：${msg}`)
    }
  }

  return { from, to: applied.length ? applied[applied.length - 1] : from, applied }
}
