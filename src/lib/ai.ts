// AI 顾问（前端客户端）：调用后端 /api/ai/chat 流式接口
// 密钥与 LLM 调用已移至后端，前端不再直连大模型
import { api } from '@/lib/api'

/** 联网检索到的一条真实来源（标题/日期/链接均来自后端接口原文） */
export interface ChatSource {
  id: string
  title: string
  url: string
  date: number | null
  source: string
  kind: 'news' | 'web' | 'deal' | 'release' | 'upcoming' | 'top' | 'related'
  summary: string
  appid?: number
  gameName?: string
  discount?: number
}

/** 本轮联网检索状态 */
export interface ChatWebMeta {
  used: boolean
  reachable: boolean
  scope: 'game' | 'global' | 'none'
  term: string | null
  game: { appid: number; name: string } | null
  count: number
  /** 本轮全网搜索使用的 provider（serper / tavily）；未使用为 null */
  provider?: string | null
  notes: string[]
}

/** done 事件附带的「需求结构化」元信息（供 UI 展示筛选与放宽） */
export interface ChatDoneMeta {
  /** 从用户话里抽出的硬约束标签 */
  constraints: string[]
  /** 因目录内无匹配而被放宽掉的条件 */
  relaxed: string[]
  /** 本次走的是哪条链路 */
  engine: string | null
  /** 联网检索到的来源条目 */
  sources: ChatSource[]
  /** 联网检索状态（未触发联网时为 null） */
  web: ChatWebMeta | null
}

/** 联网开关模式：auto = 按意图自动；on = 强制联网；off = 关闭 */
export type WebMode = 'auto' | 'on' | 'off'

export interface ChatStreamHandlers {
  onToken: (chunk: string) => void
  onDone: (gameIds: string[], fullText: string, meta: ChatDoneMeta) => void
  onError?: (msg: string) => void
}

/** 调用后端流式 AI 对话，逐字回调 onToken，结束回调 onDone */
export async function streamAIChat(
  message: string,
  handlers: ChatStreamHandlers,
  opts: { web?: WebMode } = {},
): Promise<void> {
  try {
    const res = await api.post('/ai/chat', { message, web: opts.web ?? 'auto' })
    if (!res.body) throw new Error('无响应流')

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let full = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const payload = trimmed.slice(5).trim()
        if (!payload) continue
        try {
          const evt = JSON.parse(payload)
          if (evt.type === 'token') {
            handlers.onToken(evt.content)
            full += evt.content
          } else if (evt.type === 'done') {
            handlers.onDone(evt.gameIds || [], full, {
              constraints: Array.isArray(evt.constraints) ? evt.constraints : [],
              relaxed: Array.isArray(evt.relaxed) ? evt.relaxed : [],
              engine: evt.engine ?? null,
              sources: Array.isArray(evt.sources) ? evt.sources : [],
              web: evt.web ?? null,
            })
          }
        } catch {
          /* 忽略非 JSON 行 */
        }
      }
    }
  } catch (err: any) {
    handlers.onError?.(err?.message || 'AI 请求失败')
  }
}
