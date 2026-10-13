import { Hono } from 'hono'
import { randomBytes } from 'node:crypto'
import { db } from '../db/index.ts'
import { authMiddleware } from '../middleware/auth.ts'
import { getAIRecommendation } from '../lib/ai.ts'
import { streamSSE } from 'hono/streaming'

const chat = new Hono()

// AI 对话：密钥在后端，结果流式推送（打字机效果），聊天记录持久化
// 注意：auth 仅按路由挂载，避免污染同前缀的公开接口 /api/ai/spotlight、/api/ai/review
chat.post('/chat', authMiddleware, async (c) => {
  const userId = c.get('userId')
  let body: any
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: '请求体格式错误' }, 400)
  }
  const message = body?.message
  if (!message) return c.json({ error: '缺少 message' }, 400)

  // 联网开关：auto = 命中资讯意图才联网；on = 强制联网；off = 关闭
  const webMode: 'auto' | 'on' | 'off' = body?.web === 'on' || body?.web === 'off' ? body.web : 'auto'

  // 存用户消息
  db.prepare('INSERT INTO chat_messages (id,user_id,role,content,game_ids,created_at) VALUES (?,?,?,?,?,?)').run(
    randomBytes(12).toString('hex'),
    userId,
    'user',
    message,
    '[]',
    Date.now(),
  )

  const result = await getAIRecommendation(message, { web: webMode })

  // 存 AI 回复
  db.prepare('INSERT INTO chat_messages (id,user_id,role,content,game_ids,created_at) VALUES (?,?,?,?,?,?)').run(
    randomBytes(12).toString('hex'),
    userId,
    'assistant',
    result.text,
    JSON.stringify(result.gameIds),
    Date.now(),
  )

  return streamSSE(c, async (stream) => {
    const tokens = Array.from(result.text) // 按字符（正确支持中文）
    for (const ch of tokens) {
      await stream.writeSSE({ data: JSON.stringify({ type: 'token', content: ch }) })
      await stream.sleep(12)
    }
    await stream.writeSSE({
      data: JSON.stringify({
        type: 'done',
        gameIds: result.gameIds,
        // 需求结构化结果：前端可展示「已按…筛选」与「哪条被放宽」
        constraints: result.constraints ?? [],
        relaxed: result.relaxed ?? [],
        engine: result.engine ?? null,
        // 联网检索结果：来源条目（标题/日期/链接均来自接口原文）+ 状态，供前端如实标注
        sources: result.sources ?? [],
        web: result.web ?? null,
      }),
    })
  })
})

chat.get('/history', authMiddleware, (c) => {
  const userId = c.get('userId')
  const rows = db.prepare('SELECT * FROM chat_messages WHERE user_id=? ORDER BY created_at ASC').all(userId)
  return c.json({
    messages: rows.map((r: any) => ({
      id: r.id,
      role: r.role,
      content: r.content,
      game_ids: JSON.parse(r.game_ids || '[]'),
      created_at: r.created_at,
    })),
  })
})

export default chat
