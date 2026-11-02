import { Hono } from 'hono'
import { randomBytes, createHash } from 'node:crypto'
import { db } from '../db/index.ts'
import { hashPassword, verifyPassword, signToken } from '../lib/crypto.ts'
import { authMiddleware } from '../middleware/auth.ts'
import { assignRole, ensureUserRole, getUserRoles, getUserPermissions } from '../lib/rbac.ts'
import type { User } from '../types.ts'

const auth = new Hono()

// ── 输入校验常量 ──────────────────────────────────────
const USERNAME_MIN = 2
const USERNAME_MAX = 24
const PASSWORD_MIN = 8
const PASSWORD_MAX = 128
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// ── 会话策略 ──────────────────────────────────────────
const SESSION_DEFAULT = 60 * 60 * 24 * 7 // 7 天
const SESSION_REMEMBER = 60 * 60 * 24 * 30 // 记住我：30 天

// ── 登录限流（账号维度，区别于全站 IP 限流）──────────────
const LOGIN_WINDOW_MS = 15 * 60 * 1000
const LOGIN_MAX_FAILS = 5

// ── 密码重置 ──────────────────────────────────────────
const RESET_TTL_MS = 30 * 60 * 1000 // 30 分钟
/** 配置了邮件服务就走真发信，否则退化为「链接直接显示」的演示通道 */
const MAIL_ENABLED = !!(process.env.RESEND_API_KEY || process.env.SMTP_URL)

/** 密码强度检查：返回错误信息或 null（通过） */
function checkPasswordStrength(pw: string): string | null {
  if (pw.length < PASSWORD_MIN) return `密码至少 ${PASSWORD_MIN} 位`
  if (pw.length > PASSWORD_MAX) return `密码最多 ${PASSWORD_MAX} 位`
  if (!/[a-zA-Z]/.test(pw)) return '密码需包含英文字母'
  if (!/[0-9]/.test(pw)) return '密码需包含数字'
  const weak = [
    '12345678', 'password', 'qwerty123', 'abc12345', 'admin123',
    'password123', 'iloveyou', '11111111', '00000000',
  ]
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

/** 组装登录态：用户 + 角色 + 权限点，前端据此控制菜单与按钮 */
function sessionPayload(row: any) {
  const roles = getUserRoles(String(row.id))
  return {
    user: rowToUser(row),
    roles: roles.map((r) => ({ key: r.key, name: r.name, level: r.level })),
    permissions: getUserPermissions(String(row.id)),
  }
}

async function safeBody(c: any, maxSizeKB = 64): Promise<any> {
  const len = Number(c.req.header('content-length') || 0)
  if (len > maxSizeKB * 1024) throw new Error('请求体过大')
  return c.req.json()
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

/** 统计窗口内该邮箱的失败次数 */
function recentFails(email: string): number {
  const since = Date.now() - LOGIN_WINDOW_MS
  const row = db
    .prepare('SELECT COUNT(*) AS c FROM login_attempts WHERE email = ? AND success = 0 AND created_at > ?')
    .get(email, since) as unknown as { c: number }
  return row?.c ?? 0
}

function recordAttempt(email: string, ip: string | undefined, success: boolean): void {
  db.prepare('INSERT INTO login_attempts (email, ip, success, created_at) VALUES (?, ?, ?, ?)').run(
    email,
    ip ?? null,
    success ? 1 : 0,
    Date.now(),
  )
  // 成功登录后清掉该邮箱的失败记录，避免影响下次
  if (success) {
    db.prepare('DELETE FROM login_attempts WHERE email = ? AND success = 0').run(email)
  }
}

// ══ 注册（开放注册，即时可用）══════════════════════════
auth.post('/register', async (c) => {
  let body: any
  try {
    body = await safeBody(c)
  } catch {
    return c.json({ error: '请求体格式错误' }, 400)
  }

  const { username, email, password, remember } = body || {}

  if (!username || typeof username !== 'string') return c.json({ error: '用户名为必填' }, 400)
  if (!email || typeof email !== 'string') return c.json({ error: '邮箱为必填' }, 400)
  if (!password || typeof password !== 'string') return c.json({ error: '密码为必填' }, 400)

  const uname = username.trim()
  if (uname.length < USERNAME_MIN || uname.length > USERNAME_MAX) {
    return c.json({ error: `用户名需 ${USERNAME_MIN}-${USERNAME_MAX} 个字符` }, 400)
  }
  if (!/^[a-zA-Z0-9_\u4e00-\u9fa5]+$/.test(uname)) {
    return c.json({ error: '用户名只能包含字母、数字、下划线、中文' }, 400)
  }
  if (!EMAIL_RE.test(email.trim())) {
    return c.json({ error: '邮箱格式不正确' }, 400)
  }
  const pwdErr = checkPasswordStrength(password)
  if (pwdErr) return c.json({ error: pwdErr }, 400)

  const exist = db.prepare('SELECT id FROM users WHERE username=? OR email=?').get(uname, email.trim())
  if (exist) {
    // 不泄露是用户名还是邮箱已被占用（防枚举）
    return c.json({ error: '账号已存在' }, 409)
  }

  const { hash, salt } = hashPassword(password)
  const id = randomBytes(12).toString('hex')
  db.prepare(
    `INSERT INTO users (id, username, email, password_hash, salt, display_name, status, created_at)
     VALUES (?,?,?,?,?,?,'active',?)`,
  ).run(id, uname, email.trim(), hash, salt, uname, Date.now())

  // 新用户一律分配普通用户角色（RBAC 的入口）
  assignRole(id, 'user', 'register')

  const row = db.prepare('SELECT * FROM users WHERE id=?').get(id)!
  const ttl = remember ? SESSION_REMEMBER : SESSION_DEFAULT
  const token = signToken({ sub: id, username: uname }, ttl)
  return c.json({ token, expiresIn: ttl, ...sessionPayload(row) }, 201)
})

// ══ 登录 ══════════════════════════════════════════════
auth.post('/login', async (c) => {
  let body: any
  try {
    body = await safeBody(c)
  } catch {
    return c.json({ error: '请求体格式错误' }, 400)
  }

  const { email, password, remember } = body || {}
  if (!email || !password) return c.json({ error: '邮箱、密码均为必填' }, 400)

  const addr = String(email).trim()
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip')

  // 账号级锁定：窗口内失败达上限直接拒绝，挡住慢速撞库
  if (recentFails(addr) >= LOGIN_MAX_FAILS) {
    const mins = Math.ceil(LOGIN_WINDOW_MS / 60000)
    return c.json(
      { error: `尝试次数过多，请 ${mins} 分钟后再试`, code: 'TOO_MANY_ATTEMPTS' },
      429,
    )
  }

  const row = db.prepare('SELECT * FROM users WHERE email=?').get(addr) as any
  if (!row) {
    recordAttempt(addr, ip, false)
    return c.json({ error: '邮箱或密码错误' }, 401)
  }
  if (row.status === 'disabled') {
    recordAttempt(addr, ip, false)
    return c.json({ error: '账号已被停用，请联系管理员' }, 403)
  }
  if (!verifyPassword(String(password), String(row.password_hash), String(row.salt))) {
    recordAttempt(addr, ip, false)
    const left = LOGIN_MAX_FAILS - recentFails(addr)
    // 提示剩余次数：只在快锁定时提醒，避免变成试探工具
    return c.json({ error: '邮箱或密码错误', remaining: left > 0 ? left : 0 }, 401)
  }

  recordAttempt(addr, ip, true)
  ensureUserRole(String(row.id)) // 兜底：历史账号若无角色则补默认角色

  const ttl = remember ? SESSION_REMEMBER : SESSION_DEFAULT
  const token = signToken({ sub: String(row.id), username: String(row.username) }, ttl)
  return c.json({ token, expiresIn: ttl, ...sessionPayload(row) })
})

// ══ 当前用户（含角色与权限点）══════════════════════════
auth.get('/me', authMiddleware, (c) => {
  const userId = c.get('userId')
  const row = db.prepare('SELECT * FROM users WHERE id=?').get(userId) as any
  if (!row) return c.json({ error: '用户不存在' }, 404)
  if (row.status === 'disabled') return c.json({ error: '账号已被停用' }, 403)
  return c.json(sessionPayload(row))
})

// ══ 忘记密码 ══════════════════════════════════════════
auth.post('/forgot-password', async (c) => {
  let body: any
  try {
    body = await safeBody(c)
  } catch {
    return c.json({ error: '请求体格式错误' }, 400)
  }
  const email = String(body?.email || '').trim()
  if (!email) return c.json({ error: '请填写邮箱' }, 400)

  const row = db.prepare('SELECT id, email FROM users WHERE email=?').get(email) as any
  const origin = c.req.header('origin') || ''

  // 邮箱不存在：不生成令牌，但也不直接叫破（真实发信模式下应完全一致地返回成功）
  if (!row) {
    return c.json({
      ok: true,
      delivery: MAIL_ENABLED ? 'mail' : 'inline',
      found: MAIL_ENABLED ? undefined : false,
      note: MAIL_ENABLED
        ? '如果该邮箱已注册，重置链接已发送'
        : '演示模式（未配置邮件服务）会暴露邮箱是否注册，生产环境请务必接入邮件通道',
    })
  }

  const raw = randomBytes(32).toString('hex')
  const now = Date.now()
  db.prepare(
    'INSERT INTO password_resets (id, user_id, token_hash, expires_at, used_at, created_at) VALUES (?,?,?,?,NULL,?)',
  ).run(randomBytes(8).toString('hex'), row.id, sha256(raw), now + RESET_TTL_MS, now)

  const link = `${origin}/reset-password?token=${raw}`

  if (MAIL_ENABLED) {
    // 真实发信通道：目前只接 Resend（配置 RESEND_API_KEY 即启用）
    try {
      await sendResetMail(row.email, link)
      return c.json({ ok: true, delivery: 'mail', note: '重置链接已发送到邮箱，30 分钟内有效' })
    } catch (e: any) {
      return c.json({ ok: false, error: `邮件发送失败：${e?.message || '未知错误'}` }, 502)
    }
  }

  return c.json({
    ok: true,
    delivery: 'inline',
    found: true,
    resetUrl: link,
    expiresIn: RESET_TTL_MS,
    note: '演示模式：未配置邮件服务，重置链接直接显示在此',
  })
})

/** 邮件发送（仅在配置 RESEND_API_KEY 时可用） */
async function sendResetMail(to: string, link: string): Promise<void> {
  const key = process.env.RESEND_API_KEY
  if (!key) throw new Error('未配置 RESEND_API_KEY')
  const from = process.env.MAIL_FROM || 'GameVibe <onboarding@resend.dev>'
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to,
      subject: 'GameVibe 密码重置',
      html: `<p>你请求重置 GameVibe 账号密码，点击下方链接（30 分钟内有效）：</p>
             <p><a href="${link}">${link}</a></p>
             <p>如果这不是你本人操作，忽略此邮件即可。</p>`,
    }),
  })
  if (!res.ok) throw new Error(`邮件服务返回 ${res.status}`)
}

// ══ 重置密码 ══════════════════════════════════════════
auth.post('/reset-password', async (c) => {
  let body: any
  try {
    body = await safeBody(c)
  } catch {
    return c.json({ error: '请求体格式错误' }, 400)
  }
  const token = String(body?.token || '')
  const password = String(body?.password || '')
  if (!token) return c.json({ error: '重置令牌缺失' }, 400)

  const pwdErr = checkPasswordStrength(password)
  if (pwdErr) return c.json({ error: pwdErr }, 400)

  const rec = db
    .prepare('SELECT * FROM password_resets WHERE token_hash=? AND used_at IS NULL')
    .get(sha256(token)) as any
  if (!rec) return c.json({ error: '重置链接无效或已使用' }, 400)
  if (Number(rec.expires_at) < Date.now()) return c.json({ error: '重置链接已过期，请重新申请' }, 400)

  const { hash, salt } = hashPassword(password)
  db.prepare('UPDATE users SET password_hash=?, salt=? WHERE id=?').run(hash, salt, rec.user_id)
  // 令牌一次性使用；同用户其余未用令牌一并作废
  db.prepare('UPDATE password_resets SET used_at=? WHERE user_id=? AND used_at IS NULL').run(
    Date.now(),
    rec.user_id,
  )
  // 重置成功后清空失败计数，避免旧锁定挡住正常登录
  db.prepare('DELETE FROM login_attempts WHERE email = (SELECT email FROM users WHERE id=?)').run(
    rec.user_id,
  )

  return c.json({ ok: true, note: '密码已重置，请用新密码登录' })
})

export default auth
