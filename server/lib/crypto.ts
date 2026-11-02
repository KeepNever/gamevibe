import { scryptSync, randomBytes, timingSafeEqual, createHmac } from 'node:crypto'
import { env } from '../env.ts'

/** 密码哈希：返回 hash + salt（scrypt，抗暴力破解） */
export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return { hash, salt }
}

/** 校验密码（常量时间比较，防时序攻击） */
export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const candidate = scryptSync(password, salt, 64)
  const stored = Buffer.from(hash, 'hex')
  return candidate.length === stored.length && timingSafeEqual(candidate, stored)
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url')
}

export interface TokenPayload {
  sub: string
  username: string
  /** 服务端会话 id；无 sid 的老令牌仍可校验通过（兼容期） */
  sid?: string
  /** 签发时间（秒），用于和 password_changed_at 比对 */
  iat?: number
}

/** 签发 JWT（HS256，手写，零依赖）。expiresInSeconds 默认 7 天，"记住我" 传 30 天 */
export function signToken(
  payload: TokenPayload,
  expiresInSeconds = 60 * 60 * 24 * 7,
): string {
  const header = { alg: 'HS256', typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)
  const body = { ...payload, iat: now, exp: now + expiresInSeconds }
  const data = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(body))}`
  const sig = createHmac('sha256', env.JWT_SECRET).update(data).digest('base64url')
  return `${data}.${sig}`
}

/** 校验 JWT，失败返回 null */
export function verifyToken(token: string): TokenPayload | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const [h, p, s] = parts
    const data = `${h}.${p}`
    const sig = createHmac('sha256', env.JWT_SECRET).update(data).digest('base64url')
    if (sig !== s) return null
    const body = JSON.parse(Buffer.from(p, 'base64url').toString()) as {
      sub: string
      username: string
      sid?: string
      iat?: number
      exp: number
    }
    if (body.exp < Math.floor(Date.now() / 1000)) return null
    return { sub: body.sub, username: body.username, sid: body.sid, iat: body.iat }
  } catch {
    return null
  }
}
