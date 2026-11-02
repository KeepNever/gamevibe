import { Hono } from 'hono'
import { randomBytes, createHash } from 'node:crypto'
import { db } from '../db/index.ts'
import { hashPassword, verifyPassword } from '../lib/crypto.ts'
import { authMiddleware } from '../middleware/auth.ts'
import {
  checkPasswordStrength,
  checkUsername,
  EMAIL_RE,
  PHONE_RE,
} from '../lib/passwordPolicy.ts'
import {
  revokeAllSessions,
  revokeSession,
  listSessions,
  clearSessionCookie,
  getSession,
  pruneSessions,
} from '../lib/session.ts'
import { writeAudit, listAudit, clientIp } from '../lib/audit.ts'
import { sendMail, MAIL_ENABLED } from '../lib/mailer.ts'
import { getMaxLevel, getUserRoles, getUserPermissions } from '../lib/rbac.ts'

/**
 * 账户中心
 * ─────────────────────────────────────────────────────────
 * 全部接口都需要登录。原则：
 *   1. 涉及凭据的操作（改密、换绑、注销）必须验旧密码或验证码，不能只凭会话
 *   2. 每次敏感变更都写审计，成功失败都记
 *   3. 改密 / 换绑 / 注销后撤销其它会话——否则「我改了密码」只是改了张纸
 */

type Env = { Variables: { userId: string; username: string; sessionId: string | undefined } }

const account = new Hono<Env>()
account.use('*', authMiddleware)

const USERNAME_COOLDOWN_MS = 30 * 24 * 3600 * 1000 // 用户名 30 天冷却
const EMAIL_CODE_TTL_MS = 10 * 60 * 1000 // 换绑验证码 10 分钟
const EMAIL_CODE_RESEND_MS = 60 * 1000 // 60 秒内不重复发
const EMAIL_CODE_MAX_ATTEMPTS = 5

async function safeBody(c: any, maxSizeKB = 32): Promise<any> {
  const len = Number(c.req.header('content-length') || 0)
  if (len > maxSizeKB * 1024) throw new Error('请求体过大')
  return c.req.json().catch(() => ({}))
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

function emailCodeHash(userId: string, code: string): string {
  // 加 userId 做盐：同一验证码在不同账号下哈希不同，彩虹表失效
  return sha256(`${userId}:${code}`)
}

function meRow(userId: string): any {
  return db
    .prepare(
      `SELECT id, username, email, display_name, avatar, bio, phone, phone_verified,
              status, created_at, updated_at, username_changed_at, password_changed_at
         FROM users WHERE id = ?`,
    )
    .get(userId) as any
}

function accountView(row: any, sessionId?: string) {
  const changedAt = Number(row.username_changed_at || 0)
  const canRenameAt = changedAt ? changedAt + USERNAME_COOLDOWN_MS : 0
  return {
    user: {
      id: row.id,
      username: row.username,
      email: row.email,
      display_name: row.display_name ?? null,
      avatar: row.avatar ?? null,
      bio: row.bio ?? null,
      phone: row.phone ?? null,
      phone_verified: Number(row.phone_verified || 0) === 1 ? 1 : 0,
      created_at: Number(row.created_at),
      updated_at: row.updated_at ?? null,
    },
    meta: {
      roles: getUserRoles(String(row.id)),
      permissions: getUserPermissions(String(row.id)),
      usernameChangedAt: changedAt || null,
      canRenameAt: canRenameAt || null,
      /** 用户名冷却是否已过 */
      canRename: !canRenameAt || Date.now() >= canRenameAt,
      renameCooldownDays: 30,
      mailEnabled: MAIL_ENABLED,
      hasSession: !!sessionId,
    },
  }
}

// ══ 账户总览 ══════════════════════════════════════════
account.get('/', (c) => {
  const row = meRow(c.get('userId'))
  if (!row) return c.json({ error: '用户不存在' }, 404)
  return c.json(accountView(row, c.get('sessionId')))
})

// ══ 修改个人资料（昵称 / 头像 / 简介）══════════════════
account.patch('/profile', async (c) => {
  const userId = c.get('userId')
  const row = meRow(userId)
  if (!row) return c.json({ error: '用户不存在' }, 404)

  let body: any
  try {
    body = await safeBody(c)
  } catch (e: any) {
    return c.json({ error: e?.message || '请求体格式错误' }, 400)
  }

  const changes: { field: string; from: any; to: any }[] = []
  const sets: string[] = []
  const args: unknown[] = []

  if (body.display_name !== undefined) {
    const v = String(body.display_name ?? '').trim()
    if (!v) return c.json({ error: '昵称不能为空' }, 400)
    if (v.length > 24) return c.json({ error: '昵称最多 24 个字符' }, 400)
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(v)) return c.json({ error: '昵称包含非法字符' }, 400)
    if (v !== (row.display_name ?? '')) {
      changes.push({ field: '昵称', from: row.display_name, to: v })
      sets.push('display_name = ?')
      args.push(v)
    }
  }

  if (body.bio !== undefined) {
    const v = String(body.bio ?? '').trim()
    if (v.length > 160) return c.json({ error: '简介最多 160 个字符' }, 400)
    if (v !== (row.bio ?? '')) {
      changes.push({ field: '简介', from: row.bio, to: v })
      sets.push('bio = ?')
      args.push(v || null)
    }
  }

  if (body.avatar !== undefined) {
    const v = String(body.avatar ?? '').trim()
    if (v && !/^https?:\/\/\S+$/i.test(v)) {
      return c.json({ error: '头像需填写 http(s) 开头的图片地址' }, 400)
    }
    if (v.length > 500) return c.json({ error: '头像地址过长' }, 400)
    if (v !== (row.avatar ?? '')) {
      changes.push({ field: '头像', from: row.avatar, to: v || null })
      sets.push('avatar = ?')
      args.push(v || null)
    }
  }

  if (!changes.length) return c.json({ ok: true, changed: 0, ...accountView(row, c.get('sessionId')) })

  sets.push('updated_at = ?')
  args.push(Date.now())
  args.push(userId)
  db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...(args as any[]))

  writeAudit(db, c, {
    actorId: userId,
    actorName: row.username,
    action: 'account.profile.update',
    targetType: 'user',
    targetId: userId,
    detail: { changes },
  })

  return c.json({ ok: true, changed: changes.length, ...accountView(meRow(userId), c.get('sessionId')) })
})

// ══ 修改用户名（30 天冷却）══════════════════════════════
account.patch('/username', async (c) => {
  const userId = c.get('userId')
  const row = meRow(userId)
  if (!row) return c.json({ error: '用户不存在' }, 404)

  const body = await safeBody(c)
  const next = String(body?.username ?? '').trim()
  const err = checkUsername(next)
  if (err) return c.json({ error: err }, 400)
  if (next === row.username) return c.json({ error: '新用户名与当前相同' }, 400)

  // 冷却：用户名是身份标识，随意改会让别人认不出、也让历史引用失效
  const changedAt = Number(row.username_changed_at || 0)
  if (changedAt && Date.now() < changedAt + USERNAME_COOLDOWN_MS) {
    const days = Math.ceil((changedAt + USERNAME_COOLDOWN_MS - Date.now()) / 86400000)
    return c.json({ error: `用户名修改有 30 天冷却，还需等待 ${days} 天`, code: 'USERNAME_COOLDOWN' }, 429)
  }

  const taken = db.prepare('SELECT id FROM users WHERE username = ? AND id <> ?').get(next, userId)
  if (taken) return c.json({ error: '该用户名已被占用' }, 409)

  const now = Date.now()
  db.prepare('UPDATE users SET username = ?, username_changed_at = ?, updated_at = ? WHERE id = ?').run(
    next,
    now,
    now,
    userId,
  )

  writeAudit(db, c, {
    actorId: userId,
    actorName: row.username,
    action: 'account.username.update',
    targetType: 'user',
    targetId: userId,
    detail: { changes: [{ field: '用户名', from: row.username, to: next }] },
  })

  return c.json({ ok: true, ...accountView(meRow(userId), c.get('sessionId')) })
})

// ══ 修改密码（验旧密码 + 踢掉其它设备）══════════════════
account.post('/password', async (c) => {
  const userId = c.get('userId')
  const row = meRow(userId)
  if (!row) return c.json({ error: '用户不存在' }, 404)

  const body = await safeBody(c)
  const current = String(body?.current ?? '')
  const password = String(body?.password ?? '')
  if (!current) return c.json({ error: '请填写当前密码' }, 400)

  const full = db.prepare('SELECT password_hash, salt FROM users WHERE id = ?').get(userId) as any
  if (!full || !verifyPassword(current, String(full.password_hash), String(full.salt))) {
    writeAudit(db, c, {
      actorId: userId,
      actorName: row.username,
      action: 'account.password.change.fail',
      targetType: 'user',
      targetId: userId,
      detail: { reason: '当前密码错误' },
      result: 'fail',
    })
    return c.json({ error: '当前密码不正确' }, 400)
  }

  const pwdErr = checkPasswordStrength(password)
  if (pwdErr) return c.json({ error: pwdErr }, 400)
  if (current === password) return c.json({ error: '新密码不能与当前密码相同' }, 400)

  const { hash, salt } = hashPassword(password)
  const now = Date.now()
  db.prepare(
    'UPDATE users SET password_hash = ?, salt = ?, password_changed_at = ?, updated_at = ? WHERE id = ?',
  ).run(hash, salt, now, now, userId)

  // 保留当前设备，其它端一律失效；无 sid 的老令牌靠 password_changed_at 兜底失效
  const keepSid = c.get('sessionId')
  const revoked = revokeAllSessions(db, userId, keepSid)

  writeAudit(db, c, {
    actorId: userId,
    actorName: row.username,
    action: 'account.password.change',
    targetType: 'user',
    targetId: userId,
    detail: { changes: [{ field: '密码', from: '旧密码', to: '已更新' }], revokedSessions: revoked },
  })

  return c.json({
    ok: true,
    revokedSessions: revoked,
    note: keepSid
      ? '密码已更新，其它设备的登录已失效'
      : '密码已更新，当前登录也已失效，请重新登录',
  })
})

// ══ 换绑邮箱：第一步，向新邮箱发验证码 ═══════════════════
account.post('/email/request', async (c) => {
  const userId = c.get('userId')
  const row = meRow(userId)
  if (!row) return c.json({ error: '用户不存在' }, 404)

  const body = await safeBody(c)
  const next = String(body?.email ?? '').trim().toLowerCase()
  if (!EMAIL_RE.test(next)) return c.json({ error: '邮箱格式不正确' }, 400)
  if (next === String(row.email).toLowerCase()) return c.json({ error: '新邮箱与当前邮箱相同' }, 400)

  const taken = db.prepare('SELECT id FROM users WHERE email = ? AND id <> ?').get(next, userId)
  if (taken) return c.json({ error: '该邮箱已被其它账号使用' }, 409)

  // 节流：60 秒内只能发一次，防止被当成短信轰炸机
  const last = db
    .prepare('SELECT created_at FROM email_changes WHERE user_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(userId) as any
  if (last && Date.now() - Number(last.created_at) < EMAIL_CODE_RESEND_MS) {
    const wait = Math.ceil((EMAIL_CODE_RESEND_MS - (Date.now() - Number(last.created_at))) / 1000)
    return c.json({ error: `请 ${wait} 秒后再试`, code: 'TOO_FREQUENT' }, 429)
  }

  const code = String(randomBytes(4).readUInt32BE(0) % 1_000_000).padStart(6, '0')
  const now = Date.now()
  db.prepare(
    `INSERT INTO email_changes (id, user_id, new_email, code_hash, attempts, expires_at, used_at, created_at)
     VALUES (?,?,?,?,0,?,NULL,?)`,
  ).run(randomBytes(8).toString('hex'), userId, next, emailCodeHash(userId, code), now + EMAIL_CODE_TTL_MS, now)

  const mail = await sendMail({
    to: next,
    subject: 'GameVibe 邮箱换绑验证码',
    html: `<p>你正在把 GameVibe 账号绑定到该邮箱，验证码：</p>
           <p style="font-size:24px;font-weight:700;letter-spacing:4px">${code}</p>
           <p>10 分钟内有效。如果不是你本人操作，请忽略此邮件并尽快修改密码。</p>`,
    text: `GameVibe 邮箱换绑验证码：${code}（10 分钟内有效）`,
  })

  writeAudit(db, c, {
    actorId: userId,
    actorName: row.username,
    action: 'account.email.request',
    targetType: 'user',
    targetId: userId,
    detail: { to: next, delivered: mail.delivered },
  })

  return c.json({
    ok: true,
    to: next,
    delivery: mail.delivered ? 'mail' : 'inline',
    expiresIn: EMAIL_CODE_TTL_MS,
    // 演示模式（未配邮件服务）直接把验证码返回页面，并在前端明确标注「演示模式」，
    // 绝不假装「邮件已发送」。配了 RESEND_API_KEY 之后这条分支自然不再走。
    ...(mail.delivered ? {} : { demoCode: code, reason: mail.error }),
    note: mail.delivered
      ? '验证码已发送到新邮箱，10 分钟内有效'
      : '当前未配置邮件服务，验证码直接显示在此（演示模式）',
  })
})

// ══ 换绑邮箱：第二步，校验验证码并落库 ═══════════════════
account.post('/email/confirm', async (c) => {
  const userId = c.get('userId')
  const row = meRow(userId)
  if (!row) return c.json({ error: '用户不存在' }, 404)

  const body = await safeBody(c)
  const next = String(body?.email ?? '').trim().toLowerCase()
  const code = String(body?.code ?? '').trim()
  if (!next || !code) return c.json({ error: '请填写邮箱与验证码' }, 400)

  const rec = db
    .prepare(
      `SELECT * FROM email_changes
        WHERE user_id = ? AND new_email = ? AND used_at IS NULL
        ORDER BY created_at DESC LIMIT 1`,
    )
    .get(userId, next) as any
  if (!rec) return c.json({ error: '没有待验证的换绑申请，请先获取验证码' }, 400)
  if (Number(rec.expires_at) < Date.now()) return c.json({ error: '验证码已过期，请重新获取' }, 400)
  if (Number(rec.attempts) >= EMAIL_CODE_MAX_ATTEMPTS) {
    db.prepare('UPDATE email_changes SET used_at = ? WHERE id = ?').run(Date.now(), rec.id)
    return c.json({ error: '验证码错误次数过多，请重新获取' }, 429)
  }

  if (emailCodeHash(userId, code) !== String(rec.code_hash)) {
    db.prepare('UPDATE email_changes SET attempts = attempts + 1 WHERE id = ?').run(rec.id)
    writeAudit(db, c, {
      actorId: userId,
      actorName: row.username,
      action: 'account.email.confirm.fail',
      targetType: 'user',
      targetId: userId,
      detail: { to: next, reason: '验证码错误' },
      result: 'fail',
    })
    const left = EMAIL_CODE_MAX_ATTEMPTS - Number(rec.attempts) - 1
    return c.json({ error: '验证码不正确', remaining: Math.max(0, left) }, 400)
  }

  // 并发兜底：校验期间可能被别人抢注
  const taken = db.prepare('SELECT id FROM users WHERE email = ? AND id <> ?').get(next, userId)
  if (taken) return c.json({ error: '该邮箱已被其它账号使用' }, 409)

  const oldEmail = String(row.email)
  const now = Date.now()
  db.prepare('UPDATE users SET email = ?, updated_at = ? WHERE id = ?').run(next, now, userId)
  db.prepare('UPDATE email_changes SET used_at = ? WHERE id = ?').run(now, rec.id)

  // 换绑后踢掉其它设备：邮箱是找回密码的凭据，换了邮箱等于换了钥匙
  const revoked = revokeAllSessions(db, userId, c.get('sessionId'))

  writeAudit(db, c, {
    actorId: userId,
    actorName: row.username,
    action: 'account.email.confirm',
    targetType: 'user',
    targetId: userId,
    detail: { changes: [{ field: '邮箱', from: oldEmail, to: next }], revokedSessions: revoked },
  })

  // 给旧邮箱留个提醒（有邮件服务时才做得到；演示模式下如实跳过）
  const notice = await sendMail({
    to: oldEmail,
    subject: 'GameVibe 账号邮箱已更换',
    html: `<p>你的 GameVibe 账号邮箱已更换为 ${next}。</p>
           <p>如果不是你本人操作，请立即通过「忘记密码」重置密码并联系管理员。</p>`,
  })

  return c.json({
    ok: true,
    revokedSessions: revoked,
    oldEmailNotified: notice.delivered,
    ...accountView(meRow(userId), c.get('sessionId')),
  })
})

// ══ 手机号（本期只记录，短信通道未接入不做假验证）═══════
account.patch('/phone', async (c) => {
  const userId = c.get('userId')
  const row = meRow(userId)
  if (!row) return c.json({ error: '用户不存在' }, 404)

  const body = await safeBody(c)
  const raw = String(body?.phone ?? '').trim()
  const phone = raw.replace(/\s|-/g, '')

  if (!phone) {
    db.prepare('UPDATE users SET phone = NULL, phone_verified = 0, phone_verified_at = NULL, updated_at = ? WHERE id = ?').run(
      Date.now(),
      userId,
    )
    writeAudit(db, c, {
      actorId: userId,
      actorName: row.username,
      action: 'account.phone.update',
      targetType: 'user',
      targetId: userId,
      detail: { changes: [{ field: '手机号', from: row.phone, to: null }] },
    })
    return c.json({ ok: true, ...accountView(meRow(userId), c.get('sessionId')) })
  }

  if (!PHONE_RE.test(phone)) return c.json({ error: '请输入有效的中国大陆手机号' }, 400)

  const taken = db.prepare('SELECT id FROM users WHERE phone = ? AND id <> ?').get(phone, userId)
  if (taken) return c.json({ error: '该手机号已被其它账号绑定' }, 409)

  db.prepare('UPDATE users SET phone = ?, phone_verified = 0, phone_verified_at = NULL, updated_at = ? WHERE id = ?').run(
    phone,
    Date.now(),
    userId,
  )

  writeAudit(db, c, {
    actorId: userId,
    actorName: row.username,
    action: 'account.phone.update',
    targetType: 'user',
    targetId: userId,
    detail: { changes: [{ field: '手机号', from: row.phone, to: phone }], verified: false },
  })

  return c.json({
    ok: true,
    note: '手机号已记录，但尚未验证——短信通道还未接入，本站不会把它当作已验证凭据',
    ...accountView(meRow(userId), c.get('sessionId')),
  })
})

// ══ 登录设备 ══════════════════════════════════════════
account.get('/sessions', (c) => {
  const userId = c.get('userId')
  pruneSessions(db)
  return c.json({ sessions: listSessions(db, userId, c.get('sessionId')) })
})

account.delete('/sessions/:id', (c) => {
  const userId = c.get('userId')
  const sid = c.req.param('id')
  const s = getSession(db, sid)
  if (!s || String(s.user_id) !== userId) return c.json({ error: '会话不存在' }, 404)
  if (sid === c.get('sessionId')) {
    return c.json({ error: '不能在这里踢掉当前设备，请用「退出登录」' }, 400)
  }

  revokeSession(db, sid)
  writeAudit(db, c, {
    actorId: userId,
    actorName: c.get('username'),
    action: 'account.session.revoke',
    targetType: 'session',
    targetId: sid,
    detail: { device: s.ua ? s.ua.slice(0, 60) : null, ip: s.ip },
  })
  return c.json({ ok: true })
})

account.post('/logout-all', (c) => {
  const userId = c.get('userId')
  const n = revokeAllSessions(db, userId)
  clearSessionCookie(c)
  writeAudit(db, c, {
    actorId: userId,
    actorName: c.get('username'),
    action: 'account.logout_all',
    targetType: 'user',
    targetId: userId,
    detail: { revokedSessions: n },
  })
  return c.json({ ok: true, revokedSessions: n })
})

// ══ 我的操作日志 ══════════════════════════════════════
account.get('/audit', (c) => {
  const userId = c.get('userId')
  const page = Number(c.req.query('page') || 1)
  const pageSize = Number(c.req.query('pageSize') || 20)
  return c.json(listAudit(db, { actorId: userId, page, pageSize }))
})

// ══ 数据导出（可携带权的最小实现）══════════════════════
account.get('/export', (c) => {
  const userId = c.get('userId')
  const row = meRow(userId)
  if (!row) return c.json({ error: '用户不存在' }, 404)

  const library = db.prepare('SELECT * FROM user_library WHERE user_id = ? ORDER BY added_at DESC').all(userId)
  const reviews = db.prepare('SELECT id, game_id, rating, content, created_at FROM reviews WHERE user_id = ?').all(userId)
  const sessions = listSessions(db, userId, c.get('sessionId')).map((s) => ({
    device: s.device,
    os: s.os,
    ip: s.ip,
    created_at: s.created_at,
    last_seen_at: s.last_seen_at,
  }))

  return c.json({
    exportedAt: new Date().toISOString(),
    account: {
      username: row.username,
      email: row.email,
      display_name: row.display_name,
      bio: row.bio,
      phone: row.phone,
      phone_verified: Number(row.phone_verified || 0),
      created_at: row.created_at,
    },
    roles: getUserRoles(userId).map((r) => r.key),
    library,
    reviews,
    sessions,
  })
})

// ══ 注销账号（软删除 + 立即匿名化）══════════════════════
account.delete('/', async (c) => {
  const userId = c.get('userId')
  const row = meRow(userId)
  if (!row) return c.json({ error: '用户不存在' }, 404)

  const body = await safeBody(c)
  const password = String(body?.password ?? '')
  if (!password) return c.json({ error: '请输入密码以确认注销' }, 400)

  const full = db.prepare('SELECT password_hash, salt FROM users WHERE id = ?').get(userId) as any
  if (!full || !verifyPassword(password, String(full.password_hash), String(full.salt))) {
    return c.json({ error: '密码不正确' }, 400)
  }

  // 最后一个管理员不能注销，否则后台直接锁死没人管
  if (getMaxLevel(userId) >= 100) {
    const admins = (
      db
        .prepare(
          `SELECT COUNT(DISTINCT ur.user_id) AS c
             FROM user_roles ur JOIN roles r ON r.id = ur.role_id
            JOIN users u ON u.id = ur.user_id
            WHERE r.key = 'admin' AND u.deleted_at IS NULL`,
        )
        .get() as unknown as { c: number }
    ).c
    if (admins <= 1) {
      return c.json({ error: '你是唯一的管理员，请先委任另一位管理员再注销' }, 400)
    }
  }

  const oldEmail = String(row.email)
  const now = Date.now()
  // 立即匿名化：用户的评论/收藏仍挂在原 id 上（社交数据不会突然消失），
  // 但姓名、邮箱、头像、手机号全部抹掉，符合「注销即不可识别」的预期。
  db.prepare(
    `UPDATE users SET
        username = ?, email = ?, display_name = '已注销用户',
        avatar = NULL, bio = NULL, phone = NULL, phone_verified = 0, phone_verified_at = NULL,
        status = 'disabled', deleted_at = ?, updated_at = ?
      WHERE id = ?`,
  ).run(`deleted_${userId}`, `deleted_${userId}@removed.local`, now, now, userId)

  revokeAllSessions(db, userId)
  clearSessionCookie(c)

  writeAudit(db, c, {
    actorId: userId,
    actorName: row.username,
    action: 'account.delete',
    targetType: 'user',
    targetId: userId,
    detail: { previousEmail: oldEmail, ip: clientIp(c) },
  })

  return c.json({
    ok: true,
    note: '账号已注销，个人资料已匿名化，名下评论与收藏保留为「已注销用户」发布',
  })
})

export default account
