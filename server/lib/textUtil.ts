// 纯文本处理小工具（无外部依赖，供 webSearch / searchProviders 共用）

/** 去掉 HTML 标签与常见实体，得到纯文本 */
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 截断到 n 个字符，超出加省略号 */
export function clip(s: string, n = 220): string {
  const t = s.trim()
  return t.length > n ? `${t.slice(0, n)}…` : t
}
