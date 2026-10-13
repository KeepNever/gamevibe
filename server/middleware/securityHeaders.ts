/**
 * 安全响应头中间件
 *
 * 自动为所有响应添加安全相关 HTTP 头，
 * 参考 Helmet.js / OWASP 推荐配置。
 */

export function securityHeaders() {
  return async function securityHeadersMiddleware(c: any, next: any) {
    const headers = c.res.headers

    // 防止 MIME 类型嗅探
    headers.set('X-Content-Type-Options', 'nosniff')

    // 防止点击劫持（不允许任何域 iframe 嵌入）
    headers.set('X-Frame-Options', 'DENY')

    // 限制 Referrer 信息泄露
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')

    // 浏览器 XSS 防护
    headers.set('X-XSS-Protection', '1; mode=block')

    // 权限策略（禁止使用某些危险 API）
    headers.set(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), accelerometer=()'
    )

    // 内容安全策略
    // 放行同源 + Google Fonts + 常用 CDN（前端 index.html 引入了 Inter/Space Grotesk 字体）
    const isDev = process.env.NODE_ENV !== 'production'
    headers.set(
      'Content-Security-Policy',
      isDev
        ? "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net; font-src 'self' data: https://fonts.gstatic.com https://cdn.jsdelivr.net; img-src 'self' data: https: blob:; connect-src 'self' https://api.openai.com https://*.openai.com https://*.rawg.io https://api.igdb.com https://store.steampowered.com https://id.twitch.tv"
        : "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.jsdelivr.net; font-src 'self' data: https://fonts.gstatic.com https://cdn.jsdelivr.net; img-src 'self' data: https: blob:; connect-src 'self' https://api.openai.com https://*.openai.com https://*.rawg.io https://api.igdb.com https://store.steampowered.com https://id.twitch.tv; frame-ancestors 'none'"
    )

    // HSTS（仅 HTTPS）
    // headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')

    await next()
  }
}
