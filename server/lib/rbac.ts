import { db } from '../db/index.ts'

export interface Role {
  id: string
  key: string
  name: string
  level: number
}

export interface Permission {
  key: string
  name: string
  group_name: string
}

/** 用户持有的角色（按 level 降序，越高越靠前） */
export function getUserRoles(userId: string): Role[] {
  return db
    .prepare(
      `SELECT r.id, r.key, r.name, r.level
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = ?
        ORDER BY r.level DESC`,
    )
    .all(userId) as unknown as Role[]
}

/** 用户权限点集合（多角色取并集，已去重） */
export function getUserPermissions(userId: string): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT p.key
         FROM user_roles ur
         JOIN role_permissions rp ON rp.role_id = ur.role_id
         JOIN permissions p     ON p.id = rp.permission_id
        WHERE ur.user_id = ?
        ORDER BY p.key`,
    )
    .all(userId) as unknown as { key: string }[]
  return rows.map((r) => r.key)
}

/** 是否具备某个权限点 */
export function hasPermission(userId: string, perm: string): boolean {
  const row = db
    .prepare(
      `SELECT 1
         FROM user_roles ur
         JOIN role_permissions rp ON rp.role_id = ur.role_id
         JOIN permissions p     ON p.id = rp.permission_id
        WHERE ur.user_id = ? AND p.key = ?
        LIMIT 1`,
    )
    .get(userId, perm)
  return !!row
}

/**
 * 账号状态：token 只证明「签发时这个人存在」，不证明「现在还能用」。
 * 管理员停用某人后，对方手里的旧 token 必须立刻失去业务访问能力，否则停用形同虚设。
 * deleted：用户主动注销（软删除进冷静期），与管理员停用区分开，前端提示语不同。
 */
export function getAccountState(
  userId: string,
): 'active' | 'disabled' | 'deleted' | 'missing' {
  const row = db.prepare('SELECT status, deleted_at FROM users WHERE id = ?').get(userId) as
    | { status: string | null; deleted_at: number | null }
    | undefined
  if (!row) return 'missing'
  if (row.deleted_at) return 'deleted'
  return row.status === 'disabled' ? 'disabled' : 'active'
}

/** 用户最高角色等级（无角色为 0）。用于「不能管理同级或更高权限的人」 */
export function getMaxLevel(userId: string): number {
  const row = db
    .prepare(
      `SELECT MAX(r.level) AS lv
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = ?`,
    )
    .get(userId) as unknown as { lv: number | null } | undefined
  return row?.lv ?? 0
}

/** 角色详情（含权限点），供管理界面展示 */
export function listRoles(): (Role & { permissions: string[] })[] {
  const roles = db
    .prepare('SELECT id, key, name, level FROM roles ORDER BY level DESC')
    .all() as unknown as Role[]
  return roles.map((r) => ({
    ...r,
    permissions: (
      db
        .prepare(
          `SELECT p.key FROM role_permissions rp
             JOIN permissions p ON p.id = rp.permission_id
            WHERE rp.role_id = ? ORDER BY p.key`,
        )
        .all(r.id) as unknown as { key: string }[]
    ).map((x) => x.key),
  }))
}

/** 赋予角色（重复赋予静默忽略） */
export function assignRole(userId: string, roleKey: string, grantedBy?: string): boolean {
  const role = db.prepare('SELECT id FROM roles WHERE key = ?').get(roleKey) as unknown as
    | { id: string }
    | undefined
  if (!role) return false
  db.prepare(
    `INSERT OR IGNORE INTO user_roles (user_id, role_id, granted_at, granted_by)
     VALUES (?, ?, ?, ?)`,
  ).run(userId, role.id, Date.now(), grantedBy ?? null)
  return true
}

/** 收回角色 */
export function revokeRole(userId: string, roleKey: string): void {
  const role = db.prepare('SELECT id FROM roles WHERE key = ?').get(roleKey) as unknown as
    | { id: string }
    | undefined
  if (!role) return
  db.prepare('DELETE FROM user_roles WHERE user_id = ? AND role_id = ?').run(userId, role.id)
}

/** 无任何角色时补上默认 user 角色 */
export function ensureUserRole(userId: string): void {
  const has = db.prepare('SELECT 1 FROM user_roles WHERE user_id = ? LIMIT 1').get(userId)
  if (!has) assignRole(userId, 'user', 'system')
}
