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
  constructor(message: string, status: number) {
    super(message)
    this.status = status
    this.name = 'ApiError'
  }
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
  if (!res.ok) {
    let msg = `请求失败 (${res.status})`
    try {
      const d = await res.json()
      if (d?.error) msg = d.error
    } catch {
      /* 忽略解析错误 */
    }
    throw new ApiError(msg, res.status)
  }
  return res
}

export const api = {
  get: (p: string) => apiFetch(p),
  post: (p: string, body?: unknown) =>
    apiFetch(p, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined }),
  put: (p: string, body?: unknown) =>
    apiFetch(p, { method: 'PUT', body: body !== undefined ? JSON.stringify(body) : undefined }),
  del: (p: string, body?: unknown) =>
    apiFetch(p, { method: 'DELETE', body: body !== undefined ? JSON.stringify(body) : undefined }),
}
