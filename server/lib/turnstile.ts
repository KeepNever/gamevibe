/**
 * Cloudflare Turnstile 人机验证（防注册刷）。
 *
 * 模式由环境变量决定：
 * - TURNSTILE_SITE_KEY + TURNSTILE_SECRET_KEY 都配置 → 强制校验
 * - 缺任一 → 关闭（注册不需要验证码），/api/auth/captcha-config 如实返回 enabled:false
 *
 * Cloudflare 官方测试密钥（永远通过，组件可见，用于演示与 CI）：
 *   site:  1x00000000000000000000AA
 *   secret: 1x0000000000000000000000000000000AA
 * 注意：测试 secret 接受任意 token，不构成真实拦截；上真密钥才是真防护。
 *
 * 校验走 Cloudflare siteverify API（443 出网），8 秒超时；开启时 fail-closed——
 * 验证服务不可达就拒绝注册并如实报错，绝不静默放行。
 */

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export function turnstileConfig() {
  const siteKey = process.env.TURNSTILE_SITE_KEY?.trim() || ''
  const secretKey = process.env.TURNSTILE_SECRET_KEY?.trim() || ''
  const enabled = !!(siteKey && secretKey)
  return { enabled, siteKey: enabled ? siteKey : '', mode: detectMode(siteKey) }
}

function detectMode(siteKey: string): 'test' | 'production' {
  // 官方测试 sitekey 一律 1x / 2x / 3x 开头
  return /^['"]?[123]x00000000000000000000(AA|XX|FF)/.test(siteKey) ? 'test' : 'production'
}

export async function verifyTurnstile(token: string, ip?: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim() || ''
  if (!secret) return { ok: false, reason: '服务端未配置验证密钥' }

  const body = new URLSearchParams({ secret, response: token })
  if (ip) body.set('remoteip', ip)

  try {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), 8000)
    const res = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: ctl.signal,
    })
    clearTimeout(timer)
    if (!res.ok) return { ok: false, reason: `验证服务响应异常（HTTP ${res.status}）` }
    const data = (await res.json()) as { success: boolean; 'error-codes'?: string[] }
    if (data.success) return { ok: true }
    const codes = (data['error-codes'] || []).join(', ')
    return {
      ok: false,
      reason: codes.includes('timeout-or-duplicate') || codes.includes('invalid-input-response')
        ? '验证已过期，请刷新页面重试'
        : `人机验证未通过${codes ? `（${codes}）` : ''}`,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, reason: msg.includes('abort') ? '验证服务响应超时，请重试' : `验证服务暂时不可用：${msg}` }
  }
}
