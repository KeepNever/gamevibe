import { api, ApiError } from './api'

/** 账户中心 API 封装：统一抛 ApiError，页面只管展示 message */
async function json<T>(res: Response): Promise<T> {
  try {
    return (await res.json()) as T
  } catch {
    throw new ApiError('返回内容解析失败', res.status)
  }
}

export interface AccountUser {
  id: string
  username: string
  email: string
  display_name: string | null
  avatar: string | null
  bio: string | null
  phone: string | null
  phone_verified: 0 | 1
  created_at: number
  updated_at: number | null
}

export interface AccountMeta {
  roles: { key: string; name: string; level: number }[]
  permissions: string[]
  usernameChangedAt: number | null
  canRenameAt: number | null
  canRename: boolean
  renameCooldownDays: number
  mailEnabled: boolean
}

export interface AccountView {
  user: AccountUser
  meta: AccountMeta
}

export interface SessionItem {
  id: string
  ip: string | null
  device: string
  os: string
  current: boolean
  created_at: number
  last_seen_at: number
}

export interface AuditItem {
  id: number
  actorId: string | null
  actorName: string | null
  action: string
  targetType: string | null
  targetId: string | null
  detail: string | null
  ip: string | null
  result: string
  created_at: number
}

export const getAccount = async (): Promise<AccountView> => json(await api.get('/account'))

export const updateProfile = async (patch: {
  display_name?: string
  bio?: string
  avatar?: string
}): Promise<AccountView & { changed: number }> => json(await api.patch('/account/profile', patch))

export const updateUsername = async (username: string): Promise<AccountView> =>
  json(await api.patch('/account/username', { username }))

export const changePassword = async (
  current: string,
  password: string,
): Promise<{ ok: boolean; revokedSessions: number; note: string }> =>
  json(await api.post('/account/password', { current, password }))

export const requestEmailChange = async (
  email: string,
): Promise<{
  ok: boolean
  to: string
  delivery: 'mail' | 'inline'
  expiresIn: number
  demoCode?: string
  reason?: string
  note: string
}> => json(await api.post('/account/email/request', { email }))

export const confirmEmailChange = async (
  email: string,
  code: string,
): Promise<AccountView & { revokedSessions: number; oldEmailNotified: boolean }> =>
  json(await api.post('/account/email/confirm', { email, code }))

export const updatePhone = async (
  phone: string,
): Promise<AccountView & { note?: string }> => json(await api.patch('/account/phone', { phone }))

export const listSessions = async (): Promise<{ sessions: SessionItem[] }> =>
  json(await api.get('/account/sessions'))

export const revokeSession = async (id: string): Promise<{ ok: boolean }> =>
  json(await api.del(`/account/sessions/${id}`))

export const logoutAll = async (): Promise<{ ok: boolean; revokedSessions: number }> =>
  json(await api.post('/account/logout-all'))

export const getMyAudit = async (
  page = 1,
  pageSize = 20,
): Promise<{ items: AuditItem[]; total: number; page: number; pageSize: number }> =>
  json(await api.get(`/account/audit?page=${page}&pageSize=${pageSize}`))

export const exportMyData = async (): Promise<any> => json(await api.get('/account/export'))

export const deleteAccount = async (password: string): Promise<{ ok: boolean; note: string }> =>
  json(await api.del('/account', { password }))

/** 动作码 → 中文，与后端 AUDIT_LABELS 同口径 */
export const ACTION_LABELS: Record<string, string> = {
  'auth.register': '注册账号',
  'auth.login': '登录',
  'auth.login.fail': '登录失败',
  'auth.logout': '退出登录',
  'auth.password.reset': '重置密码',
  'account.profile.update': '修改个人资料',
  'account.username.update': '修改用户名',
  'account.password.change': '修改密码',
  'account.password.change.fail': '改密失败',
  'account.email.request': '申请换绑邮箱',
  'account.email.confirm': '完成换绑邮箱',
  'account.email.confirm.fail': '换绑验证失败',
  'account.phone.update': '更新手机号',
  'account.session.revoke': '踢下线设备',
  'account.logout_all': '退出所有设备',
  'account.delete': '注销账号',
  'admin.user.role': '调整用户角色',
  'admin.user.status': '启用/停用账号',
}

export function formatTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`
  if (diff < 30 * 86400_000) return `${Math.floor(diff / 86400_000)} 天前`
  return formatTime(ts)
}
