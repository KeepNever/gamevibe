// 前端 API 封装：自动附加 JWT，统一错误处理
const TOKEN_KEY = 'gv_token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(t: string | null): void {
  if (t) localStorage.setItem(TOKEN_KEY, t)
  else localStorage.removeItem(TOKEN_KEY)
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

// 令牌失效时的统一出口（只跳一次，避免并发请求连环跳转）
let redirecting = false
function handleSessionExpired() {
  if (redirecting) return
  const p = window.location.pathname
  if (p === '/login' || p === '/register' || p === '/forgot-password') return
  redirecting = true
  const redirect = encodeURIComponent(p + window.location.search)
  window.location.assign(`/login?redirect=${redirect}`)
}

export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers)
  const token = getToken()
  if (token) {
    // X-Auth-Token 用于绕过边缘网关对 Authorization 头的覆写
    headers.set('X-Auth-Token', token)
    headers.set('Authorization', `Bearer ${token}`)
  }
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')

  const res = await fetch(`/api${path}`, { ...options, headers })

  // 只有「本来带着令牌却被拒」才算会话失效；
  // 登录/注册接口的 401 是密码错误，不能当成会话过期处理
  const isAuthEndpoint = path.startsWith('/auth/login') || path.startsWith('/auth/register')
  if (res.status === 401 && token && !isAuthEndpoint) {
    setToken(null)
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
