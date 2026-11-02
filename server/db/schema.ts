// SQLite 建表语句（首次启动执行）

export const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,
  username     TEXT UNIQUE NOT NULL,
  email        TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  salt         TEXT NOT NULL,
  display_name TEXT,
  avatar       TEXT,
  bio          TEXT,
  status       TEXT NOT NULL DEFAULT 'active',
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_library (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  source      TEXT NOT NULL,
  external_id TEXT,
  name        TEXT NOT NULL,
  cover_url   TEXT,
  install_path TEXT,
  size_bytes  INTEGER,
  last_played INTEGER,
  status      TEXT NOT NULL DEFAULT 'wishlist',
  user_rating REAL,
  note        TEXT,
  tags        TEXT DEFAULT '[]',
  added_at    INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_recent (
  user_id   TEXT NOT NULL,
  game_id   TEXT NOT NULL,
  viewed_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, game_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id        TEXT PRIMARY KEY,
  user_id   TEXT NOT NULL,
  role      TEXT NOT NULL,
  content   TEXT NOT NULL,
  game_ids  TEXT DEFAULT '[]',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reviews (
  id        TEXT PRIMARY KEY,
  user_id   TEXT NOT NULL,
  game_id   TEXT NOT NULL,
  rating    REAL,
  content   TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_library_user ON user_library(user_id);
CREATE INDEX IF NOT EXISTS idx_recent_user ON user_recent(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_user ON chat_messages(user_id);

CREATE TABLE IF NOT EXISTS follows (
  follower_id  TEXT NOT NULL,
  following_id TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (follower_id, following_id),
  FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (following_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_id);
CREATE INDEX IF NOT EXISTS idx_follows_following ON follows(following_id);

CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  actor_id   TEXT,
  type       TEXT NOT NULL,
  ref_id     TEXT,
  read       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, created_at DESC);

-- ── AI 语义画像（派生资产，可重建；catalog 仍是事实源）────────────────
CREATE TABLE IF NOT EXISTS game_profiles (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id          TEXT    NOT NULL,           -- 逻辑指向 catalog.id
  batch_id         TEXT    NOT NULL,           -- 所属批次，用于冻结与追溯
  story_intensity  INTEGER,                    -- 1-5
  difficulty       INTEGER,                    -- 1-5
  exploration      INTEGER,                    -- 1-5
  combat_intensity INTEGER,                    -- 1-5
  core_gameplay    TEXT,                       -- 枚举集合，逗号分隔
  multiplayer      TEXT,                       -- none|single|co-op|pvp|both
  estimated_length TEXT,                       -- <5h|5-15h|15-30h|30-60h|>60h|unknown
  target_players   TEXT,
  semantic_summary TEXT,
  content_notes    TEXT,
  model            TEXT,
  prompt_version   TEXT,
  generated_at     TEXT,
  status           TEXT    NOT NULL DEFAULT 'draft',  -- draft | verified
  UNIQUE(game_id, batch_id)
);

CREATE TABLE IF NOT EXISTS profile_batches (
  batch_id       TEXT PRIMARY KEY,
  model          TEXT,
  prompt_version TEXT,
  created_at     TEXT,
  status         TEXT    NOT NULL DEFAULT 'draft',  -- draft | frozen
  is_active      INTEGER NOT NULL DEFAULT 0,        -- 仅一个批次为 1
  game_count     INTEGER,
  verified_count INTEGER,
  notes          TEXT
);

CREATE INDEX IF NOT EXISTS idx_game_profiles_active ON game_profiles(game_id, batch_id);
CREATE INDEX IF NOT EXISTS idx_game_profiles_batch  ON game_profiles(batch_id);

-- ══ RBAC 角色权限 ═══════════════════════════════════════════════
-- 角色：admin / moderator / user，level 用于「不能操作同级或更高」的判断
CREATE TABLE IF NOT EXISTS roles (
  id          TEXT PRIMARY KEY,
  key         TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  level       INTEGER NOT NULL DEFAULT 0,
  is_system   INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

-- 权限点：细到动作，key 形如 resource.action[.scope]
CREATE TABLE IF NOT EXISTS permissions (
  id          TEXT PRIMARY KEY,
  key         TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  group_name  TEXT NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       TEXT NOT NULL,
  permission_id TEXT NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id    TEXT NOT NULL,
  role_id    TEXT NOT NULL,
  granted_at INTEGER NOT NULL,
  granted_by TEXT,
  PRIMARY KEY (user_id, role_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_user_roles_user ON user_roles(user_id);

-- 密码重置令牌：只存哈希，原文不落库
CREATE TABLE IF NOT EXISTS password_resets (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_pwreset_hash ON password_resets(token_hash);

-- 登录尝试：按账号维度限流，防慢速撞库（区别于全站 IP 限流）
CREATE TABLE IF NOT EXISTS login_attempts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL,
  ip         TEXT,
  success    INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_email ON login_attempts(email, created_at DESC);
`
