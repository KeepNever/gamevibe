// 测试 DeepSeek 真实 LLM 连通性 + 验证 "你好" 不再幻觉
const BASE = 'http://localhost:8789'

async function test() {
  console.log('=== 1. 后端健康检查 ===')
  const h = await fetch(BASE + '/api/health').then(r => r.json())
  console.log('OK:', JSON.stringify(h))

  console.log('\n=== 2. 注册 ===')
  const ts = Date.now()
  const reg = await fetch(BASE + '/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'deepseek_' + ts,
      email: `deepseek_${ts}@t.com`,
      password: 'Test1234',
    }),
  }).then(r => r.json())
  const token = reg.token
  console.log('注册:', reg.token ? '✅ 有token' : '❌', reg.error || '')

  if (!token) return

  console.log('\n=== 3. AI 对话: "你好"（测试 DeepSeek 真实回复）===')
  const t0 = Date.now()
  const res = await fetch(BASE + '/api/ai/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ message: '你好' }),
  })
  const elapsed = Date.now() - t0
  const raw = await res.text()

  console.log(`状态码: ${res.status}  耗时: ${elapsed}ms`)
  console.log(`数据行数: ${raw.split('\n').filter(l => l.startsWith('data:')).length}`)

  // 拼接完整回复
  let fullText = ''
  let usedFallback = false
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data:')) continue
    try {
      const j = JSON.parse(line.replace('data:', '').trim())
      if (j.type === 'token') fullText += j.content
      if (j.type === 'done' || j.type === 'error') {
        console.log('结束标记:', j.type, j.message || '')
        if (j.type === 'error') usedFallback = true
      }
    } catch {}
  }

  console.log(`\n完整回复:\n"""\n${fullText}\n"""`)

  console.log('\n=== 判断 ===')
  const isGreeting = /你好|顾问|游戏|你好！|您好|很高兴|可以帮助/.test(fullText)
  const isGameRec = /(军需物资|硝云之门|空间骑士|霓奥库布|为你精选的高分|以下是我为你筛选)/.test(fullText)
  const mentionsGenericGames = /(CS2|博德之门|艾尔登|塞尔达|原神|GTA)/.test(fullText) // 真实 LLM 可能真的推荐游戏，这是合理的

  console.log('回复包含问候/对话式内容:', isGreeting ? '✅' : '❌')
  console.log('回复是固定兜底游戏列表:', isGameRec ? '⚠️ (规则引擎兜底)' : '✅ 否')
  console.log('回复看起来像真实 LLM 生成:', (fullText.length > 20 && !isGameRec) ? '✅ 是' : '⚠️ 可能是兜底')

  // 测试第二个问题（游戏推荐）
  console.log('\n=== 4. AI 对话: "推荐一款像素风独立游戏"（应该真推荐）===')
  const t1 = Date.now()
  const res2 = await fetch(BASE + '/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message: '推荐一款像素风独立游戏' }),
  })
  const raw2 = await res2.text()
  let fullText2 = ''
  for (const line of raw2.split('\n')) {
    if (!line.startsWith('data:')) continue
    try {
      const j = JSON.parse(line.replace('data:', '').trim())
      if (j.type === 'token') fullText2 += j.content
    } catch {}
  }
  console.log(`耗时: ${Date.now() - t1}ms`)
  console.log(`回复:\n"""\n${fullText2.substring(0, 300)}\n"""`)
}

test().catch(e => console.error('FATAL:', e.message))
