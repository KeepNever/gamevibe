import { Hono } from 'hono'
import { randomBytes } from 'node:crypto'
import { db } from '../db/index.ts'
import { hashPassword, verifyPassword, signToken } from '../lib/crypto.ts'
import { authMiddleware } from '../middleware/auth.ts'
import type { User } from '../types.ts'

const auth = new Hono()

// ── 输入校验常量 ──────────────────────────────────────
const USERNAME_MIN = 2
const USERNAME_MAX = 24
const PASSWORD_MIN = 8
const PASSWORD_MAX = 128
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** 密码强度检查：返回错误信息或 null（通过） */
function checkPasswordStrength(pw: string): string | null {
  if (pw.length < PASSWORD_MIN) return `密码至少 ${PASSWORD_MIN} 位`
  if (pw.length > PASSWORD_MAX) return `密码最多 ${PASSWORD_MAX} 位`
  // 至少包含字母和数字（演示级策略，生产可加特殊字符要求）
  if (!/[a-zA-Z]/.test(pw)) return '密码需包含英文字母'
  if (!/[0-9]/.test(pw)) return '密码需包含数字'
  // 禁止常见弱密码（仅精确匹配，避免误伤正常密码）
  const weak = ['12345678', 'password', 'qwerty123', 'abc12345', 'admin123', 'password123', 'iloveyou', '11111111', '00000000']
  if (weak.some((w) => pw.toLowerCase() === w)) return '此密码过于常见，请更换更复杂的密码'
  return null
}

function rowToUser(row: any): User {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    display_name: row.display_name ?? null,
    avatar: row.avatar ?? null,
    created_at: row.created_at,
  }
}

/**
 * 安全的 JSON 解析，带大小限制防止 DoS
 */
async function safeBody(c: any, maxSizeKB = 64): Promise<any> {
  const len = Number(c.req.header('content-length') || 0)
  if (len > maxSizeKB * 1024) {
    throw new Error('请求体过大')
  }
  return c.req.json()
}

auth.post('/register', async (c) => {
  let body: any
  try {
    body = await safeBody(c)
  } catch {
    return c.json({ error: '请求体格式错误' }, 400)
  }

  const { username, email, password } = body || {}

  // ── 字段存在性校验 ──
  if (!username || typeof username !== 'string') return c.json({ error: '用户名为必填' }, 400)
  if (!email || typeof email !== 'string') return c.json({ error: '邮箱为必填' }, 400)
  if (!password || typeof password !== 'string') return c.json({ error: '密码为必填' }, 400)

  // ── 格式与强度校验 ──
  const uname = username.trim()
  if (uname.length < USERNAME_MIN || uname.length > USERNAME_MAX) {
    return c.json({ error: `用户名需 ${USERNAME_MIN}-${USERNAME_MAX} 个字符` }, 400)
  }
  // 只允许字母、数字、下划线、中文
  if (!/^[a-zA-Z0-9_\u4e00-\u9fa5]+$/.test(uname)) {
    return c.json({ error: '用户名只能包含字母、数字、下划线、中文' }, 400)
  }
  if (!EMAIL_RE.test(email.trim())) {
    return c.json({ error: '邮箱格式不正确' }, 400)
  }
  const pwdErr = checkPasswordStrength(password)
  if (pwdErr) return c.json({ error: pwdErr }, 400)

  // ── 唯一性检查 ──
  const exist = db.prepare('SELECT id FROM users WHERE username=? OR email=?').get(uname, email.trim())
  if (exist) {
    // 不泄露是用户名还是邮箱已被占用（防枚举）
    return c.json({ error: '账号已存在' }, 409)
  }

  // ── 写入 DB ──
  const { hash, salt } = hashPassword(password)
  const id = randomBytes(12).toString('hex')
  db.prepare(
    'INSERT INTO users (id,username,email,password_hash,salt,display_name,created_at) VALUES (?,?,?,?,?,?,?)',
  ).run(id, uname, email.trim(), hash, salt, uname, Date.now())

  const row = db.prepare('SELECT * FROM users WHERE id=?').get(id)!
  const token = signToken({ sub: id, username: uname })
  return c.json({ token, user: rowToUser(row) }, 201)
})

auth.post('/login', async (c) => {
  let body: any
  try {
    body = await safeBody(c)
  } catch {
    return c.json({ error: '请求体格式错误' }, 400)
  }

  const { email, password } = body || {}
  if (!email || !password) {
    return c.json({ error: '邮箱、密码均为必填' }, 400)
  }

  const row = db.prepare('SELECT * FROM users WHERE email=?').get(email.trim())
  if (!row) {
    // 统一错误消息，不泄露"账号不存在"信息（防枚举）
    return c.json({ error: '邮箱或密码错误' }, 401)
  }
  if (!verifyPassword(String(password), String(row.password_hash), String(row.salt))) {
    return c.json({ error: '邮箱或密码错误' }, 401)
  }
  const token = signToken({ sub: String(row.id), username: String(row.username) })
  return c.json({ token, user: rowToUser(row) })
})

auth.get('/me', authMiddleware, (c) => {
  const userId = c.get('userId')
  const row = db.prepare('SELECT * FROM users WHERE id=?').get(userId)
  if (!row) return c.json({ error: '用户不存在' }, 404)
  // 不返回密码哈希等敏感字段
  return c.json({ user: rowToUser(row) })
})

export default auth
