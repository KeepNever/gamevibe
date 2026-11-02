/**
 * 邮件发送
 * ─────────────────────────────────────────────────────────
 * 只有配置了 RESEND_API_KEY 才真正发信。没配时不假装发了——
 * 调用方拿到 delivered:false 后要如实告诉用户「当前为演示模式」，
 * 并把凭证直接呈现在页面上，而不是编一句「邮件已发送」。
 */
export const MAIL_ENABLED = !!(process.env.RESEND_API_KEY || process.env.SMTP_URL)

export interface MailResult {
  delivered: boolean
  error?: string
}

export async function sendMail(opts: {
  to: string
  subject: string
  html: string
  text?: string
}): Promise<MailResult> {
  const key = process.env.RESEND_API_KEY
  if (!key) return { delivered: false, error: '未配置邮件服务（RESEND_API_KEY）' }

  const from = process.env.MAIL_FROM || 'GameVibe <onboarding@resend.dev>'
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
        ...(opts.text ? { text: opts.text } : {}),
      }),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { delivered: false, error: `邮件服务返回 ${res.status}${body ? `：${body.slice(0, 120)}` : ''}` }
    }
    return { delivered: true }
  } catch (e) {
    return { delivered: false, error: e instanceof Error ? e.message : '邮件发送失败' }
  }
}
