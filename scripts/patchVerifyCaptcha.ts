// 一次性补丁：回归脚本接入 captcha 感知注册
// 服务端开了 Turnstile 就带测试 token（官方测试 secret 接受任意值）
import { readFileSync, writeFileSync } from 'node:fs'

const patch = `
// ── captcha 感知注册：服务端开了 Turnstile 就带测试 token ──
let CAPTCHA_TOKEN = undefined
try {
  const cfg = await fetch(BASE + '/api/auth/captcha-config').then((r) => r.json())
  if (cfg.enabled) CAPTCHA_TOKEN = 'ci-test-token'
} catch {}
function regBody(body) {
  return CAPTCHA_TOKEN ? { ...body, turnstileToken: CAPTCHA_TOKEN } : body
}
`

let s1 = readFileSync('scripts/verifyCommunity.mjs', 'utf8')
if (!s1.includes('regBody')) {
  s1 = s1.replace('async function main() {', patch + '\nasync function main() {')
  s1 = s1.replace(
    'body: { username: `社区A${stamp}`, email: `ca${stamp}@test.local`, password: \'communityPass1\' },',
    'body: regBody({ username: `社区A${stamp}`, email: `ca${stamp}@test.local`, password: \'communityPass1\' }),',
  )
  s1 = s1.replace(
    'body: { username: `社区B${stamp}`, email: `cb${stamp}@test.local`, password: \'communityPass1\' },',
    'body: regBody({ username: `社区B${stamp}`, email: `cb${stamp}@test.local`, password: \'communityPass1\' }),',
  )
  writeFileSync('scripts/verifyCommunity.mjs', s1)
  console.log('verifyCommunity 补丁完成')
}

let s2 = readFileSync('scripts/verifyAccountCenter.mjs', 'utf8')
if (!s2.includes('regBody')) {
  s2 = s2.replace('async function main() {', patch + '\nasync function main() {')
  s2 = s2.replace(
    'body: { username: TEST_USER, email: TEST_EMAIL, password: PASS },',
    'body: regBody({ username: TEST_USER, email: TEST_EMAIL, password: PASS }),',
  )
  writeFileSync('scripts/verifyAccountCenter.mjs', s2)
  console.log('verifyAccountCenter 补丁完成')
}
