// 环境变量读取与校验（仅后端使用，绝不暴露给前端）
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// 共享密钥文件：部署平台往往会给每个实例注入不同的 JWT_SECRET，
// 导致多实例间签发的令牌无法互相校验。因此优先从随源码部署的
// 密钥文件中读取一个所有实例一致的固定密钥。
function loadJwtSecret(): string | undefined {
  try {
    const p = fileURLToPath(new URL('./jwtsecret.txt', import.meta.url))
    const s = readFileSync(p, 'utf8').trim()
    return s.length > 0 ? s : undefined
  } catch {
    return undefined
  }
}

export const env = {
  PORT: Number(process.env.PORT || process.env.SERVER_PORT || 8787),
  JWT_SECRET: loadJwtSecret() || process.env.JWT_SECRET || 'dev-insecure-secret-change-me',
  AI_API_KEY: process.env.AI_API_KEY || '',
  AI_BASE_URL: process.env.AI_BASE_URL || 'https://api.openai.com/v1',
  AI_MODEL: process.env.AI_MODEL || 'gpt-4o-mini',
  // DeepSeek 兼容配置（国内直连，与 OpenAI API 格式兼容）
  DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY || '',
  DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
  DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
  IGDB_CLIENT_ID: process.env.IGDB_CLIENT_ID || '',
  IGDB_CLIENT_SECRET: process.env.IGDB_CLIENT_SECRET || '',
  // 第三方全网搜索（AI 助手联网检索用；两家任一可用即可，Serper 优先）
  SERPER_API_KEY: process.env.SERPER_API_KEY || '',
  TAVILY_API_KEY: process.env.TAVILY_API_KEY || '',
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
}

if (!process.env.JWT_SECRET) {
  console.warn('[env] 未设置 JWT_SECRET，使用不安全默认值（仅限本地开发）')
}

if (env.AI_API_KEY) {
  console.log('[env] AI_API_KEY 已配置，使用', env.AI_BASE_URL)
} if (env.DEEPSEEK_API_KEY) {
  console.log('[env] DEEPSEEK_API_KEY 已配置，使用 DeepSeek API')
} else {
  console.warn('[env] 未设置 AI_API_KEY / DEEPSEEK_API_KEY，AI 助手将使用本地规则引擎降级')
}
