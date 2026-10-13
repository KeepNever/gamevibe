// 直接测试新后端(8788)的 AI 聊天 + API 连通性
const BASE = 'http://localhost:8788'

async function test() {
  console.log('=== 1. 后端健康检查 ===')
  const h = await fetch(BASE + '/api/health').then(r => r.json())
  console.log('OK:', JSON.stringify(h))

  console.log('\n=== 2. 注册账号 ===')
  const ts = Date.now()
  const regRes = await fetch(BASE + '/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'apitest_' + ts,
      email: `api_${ts}@t.com`,
      password: 'Test1234',
    }),
  })
  const reg = await regRes.json()
  const token = reg.token
  console.log('注册状态:', regRes.status, token ? '有token' : reg.error)

  if (!token) { console.log('❌ 无 token，无法继续'); return }

  console.log('\n=== 3. AI 聊天测试: 发送 "你好" ===')
  const t0 = Date.now()
  const aiRes = await fetch(BASE + '/api/ai/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ message: '你好' }),
  })
  const elapsed = Date.now() - t0
  const aiText = await aiRes.text()

  console.log(`耗时: ${elapsed}ms`)
  console.log(`状态码: ${aiRes.status}`)
  
  // 尝试解析 SSE 流（取前几个 data 行）
  const lines = aiText.split('\n').filter(l => l.startsWith('data:'))
  if (lines.length > 0) {
    console.log(`SEE 数据行数: ${lines.length}`)
    lines.slice(0, 5).forEach((l, i) => {
      try { 
        const j = JSON.parse(l.replace('data:', '').trim())
        console.log(`  [${i}]`, JSON.stringify(j).substring(0, 200))
      } catch { console.log(`  [${i}]`, l.substring(0, 200)) }
    })
    // 检查是否包含游戏推荐还是问候语
    const fullText = aiText
    const hasGreeting = /你好.*我是|我是.*顾问|随时为你|告诉.*类型|说得更具体/.test(fullText)
    const hasGameRec = /为你精选|高分佳作|以下是我|推荐语|找到了.*款/.test(fullText)
    console.log('\n=== 判断 ===')
    console.log('包含问候/引导语:', hasGreeting ? '✅ 是' : '❌ 否')
    console.log('包含固定游戏推荐:', hasGameRec ? '⚠️ 是 (可能是兜底)' : '✅ 否')
  } else {
    console.log('原始响应:', aiText.substring(0, 500))
  }

  console.log('\n=== 4. OpenAI 连通性测试 ===')
  try {
    const oaiStart = Date.now()
    const oaiRes = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${process.env.AI_API_KEY || 'test'}` },
      signal: AbortSignal.timeout(8000),
    })
    const oaiElapsed = Date.now() - oaiStart
    console.log(`OpenAI 状态: ${oai.status} (${oaiElapsed}ms)`)
    if (oai.ok) console.log('✅ OpenAI 直连可用！AI 将使用真实大模型')
    else console.log('❌ OpenAI 不可达 (预期：国内网络限制)')
  } catch (e) {
    console.log('❌ OpenAI 连接失败:', e.message?.substring(0, 100))
  }
}

test().catch(e => console.error('FATAL:', e.message))
