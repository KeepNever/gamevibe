/**
 * 密码策略（注册、改密、重置共用同一份口径）
 * 分散写三处迟早漂移——注册要求的强度比改密低，就会出现「注册能过的密码改密过不了」。
 */
export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 128

const WEAK = [
  '12345678', 'password', 'qwerty123', 'abc12345', 'admin123',
  'password123', 'iloveyou', '11111111', '00000000', '88888888',
]

/** 返回错误信息，通过则返回 null */
export function checkPasswordStrength(pw: string): string | null {
  if (typeof pw !== 'string' || !pw) return '密码为必填'
  if (pw.length < PASSWORD_MIN) return `密码至少 ${PASSWORD_MIN} 位`
  if (pw.length > PASSWORD_MAX) return `密码最多 ${PASSWORD_MAX} 位`
  if (!/[a-zA-Z]/.test(pw)) return '密码需包含英文字母'
  if (!/[0-9]/.test(pw)) return '密码需包含数字'
  if (WEAK.some((w) => pw.toLowerCase() === w)) return '此密码过于常见，请更换更复杂的密码'
  return null
}

/** 用户名规则（注册与改名共用）：2-24 字符，中英文数字下划线 */
export const USERNAME_MIN = 2
export const USERNAME_MAX = 24
export const USERNAME_RE = /^[a-zA-Z0-9_\u4e00-\u9fa5]+$/

export function checkUsername(name: string): string | null {
  const v = (name || '').trim()
  if (!v) return '请填写用户名'
  if (v.length < USERNAME_MIN || v.length > USERNAME_MAX) {
    return `用户名需 ${USERNAME_MIN}-${USERNAME_MAX} 个字符`
  }
  if (!USERNAME_RE.test(v)) return '用户名只能包含字母、数字、下划线、中文'
  return null
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** 中国大陆手机号 */
export const PHONE_RE = /^1[3-9]\d{9}$/
