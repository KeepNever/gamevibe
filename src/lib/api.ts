// 前端 API 封装
// ─────────────────────────────────────────────────────────
// 鉴权已迁移到 httpOnly Cookie：页面 JS 读不到令牌，XSS 也就偷不走。
// 这里只保留一个「是否登录过」的布尔提示（不含任何凭据），
// 用来在请求发出前决定要不要打接口，以及 401 时判断该不该跳登录页。
const HINT_KEY = 'gv_signed_in'

function readHint(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === '1'
  } catch {
    return false
  }
}

let sessionHint = readHint()

/** 是否处于登录态（用于决定是否发起需要鉴权的请求） */
export function hasSession(): boolean {
  return sessionHint
}

/** 登录 / 登出时同步提示位；真正的凭据在 Cookie 里，由服务端写入与清除 */
export function setSessionHint(on: boolean): void {
  sessionHint = on
  try {
    if (on) localStorage.setItem(HINT_KEY, '1')
    else localStorage.removeItem(HINT_KEY)
  } catch {
    /* 隐私模式下 localStorage 可能不可写，忽略即可 */
  }
}

export class ApiError extends Error {
  status: number
  /** 服务端附带的机器可读错误码，如 TOO_MANY_ATTEMPTS / FORBIDDEN */
  code?: string
  /** 登录失败时剩余可尝试次数 */
  remaining?: number
  constructor(message: string, status: number, code?: string, remaining?: number) {
    super(message)
    this.status = status
    this.code = code
    this.remaining = remaining
    this.name = 'ApiError'
  }
}

// 会话失效时的统一出口（只跳一次，避免并发请求连环跳转）
let redirecting = false
function handleSessionExpired() {
  if (redirecting) return
  const p = window.location.pathname
  if (p === '/login' || p === '/register' || p === '/forgot-password' || p === '/reset-password') return
  redirecting = true
  setSessionHint(false)
  const redirect = encodeURIComponent(p + window.location.search)
  window.location.assign(`/login?redirect=${redirect}`)
}

export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers)
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')

  const res = await fetch(`/api${path}`, {
    ...options,
    headers,
    // 同源请求会带上 gv_session Cookie；显式写出来避免将来改成跨域时静默丢凭据
    credentials: 'same-origin',
  })

  // 登录/注册接口的 401 是密码错误，不能当成会话过期处理
  const isAuthEndpoint = path.startsWith('/auth/login') || path.startsWith('/auth/register')
  if (res.status === 401 && hasSession() && !isAuthEndpoint) {
    handleSessionExpired()
  }

  if (!res.ok) {
    let msg = `请求失败 (${res.status})`
    let code: string | undefined
    let remaining: number | undefined
    try {
      const d = await res.json()
      if (d?.error) msg = d.error
      code = d?.code
      remaining = typeof d?.remaining === 'number' ? d.remaining : undefined
    } catch {
      /* 忽略解析错误 */
    }
    // 403 里的「权限不足」不能登出，否则普通用户点一下管理入口就被踢掉；
    // 只有账号级失效（停用 / 已注销）才清会话
    if (res.status === 403 && (code === 'ACCOUNT_DISABLED' || code === 'ACCOUNT_DELETED')) {
      handleSessionExpired()
    }
    if (res.status === 401 && (code === 'ACCOUNT_DELETED' || code === 'ACCOUNT_MISSING')) {
      handleSessionExpired()
    }
    throw new ApiError(msg, res.status, code, remaining)
  }
  return res
}

export const api = {
  get: (p: string) => apiFetch(p),
  post: (p: string, body?: unknown) =>
    apiFetch(p, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined }),
  put: (p: string, body?: unknown) =>
    apiFetch(p, { method: 'PUT', body: body !== undefined ? JSON.stringify(body) : undefined }),
  patch: (p: string, body?: unknown) =>
    apiFetch(p, { method: 'PATCH', body: body !== undefined ? JSON.stringify(body) : undefined }),
  del: (p: string, body?: unknown) =>
    apiFetch(p, { method: 'DELETE', body: body !== undefined ? JSON.stringify(body) : undefined }),
}
