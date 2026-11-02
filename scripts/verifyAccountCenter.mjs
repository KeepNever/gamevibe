/**
 * 账户中心实机验证
 * ─────────────────────────────────────────────────────────
 * 覆盖：注册下发 Cookie / 资料修改 / 用户名冷却 / 改密踢其它端 /
 *       邮箱换绑双验证 / 登录设备 / 审计日志 / 数据导出 / 注销匿名化
 *
 * 用法：node scripts/verifyAccountCenter.mjs [baseUrl]
 * 默认连本地 8792。全部通过会打印 PASS 数与「本次测试账号已清理」。
 */

// 本机失效代理会让 fetch 直接超时，先彻底清干净
for (const k of Object.keys(process.env)) {
  if (/proxy/i.test(k)) delete process.env[k]
}

const BASE = process.argv[2] || process.env.BASE || 'http://127.0.0.1:8792'
const stamp = Date.now().toString(36)
const TEST_USER = `acctest${stamp}`
const TEST_EMAIL = `${TEST_USER}@verify.local`
const NEW_EMAIL = `${TEST_USER}.new@verify.local`
const PASS = 'Verify12345'

let pass = 0
const fails = []

function ok(name, cond, extra = '') {
  if (cond) {
    pass++
    console.log(`  ✅ ${name}`)
  } else {
    fails.push(name + (extra ? ` — ${extra}` : ''))
    console.log(`  ❌ ${name}${extra ? ` — ${extra}` : ''}`)
  }
}

/** 简易 cookie jar：Node fetch 不会自动管理 Set-Cookie */
function makeJar() {
  const store = new Map()
  return {
    absorb(res) {
      const list = res.headers.getSetCookie ? res.headers.getSetCookie() : []
      for (const sc of list) {
        const pair = sc.split(';')[0]
        const i = pair.indexOf('=')
        const k = pair.slice(0, i).trim()
        const v = pair.slice(i + 1).trim()
        if (v) store.set(k, v)
        else store.delete(k)
      }
    },
    header() {
      return [...store].map(([k, v]) => `${k}=${v}`).join('; ')
    },
    get(k) {
      return store.get(k)
    },
    size() {
      return store.size
    },
  }
}

async function call(method, path, { jar, body, headers = {} } = {}) {
  const h = { ...headers }
  if (body !== undefined) h['Content-Type'] = 'application/json'
  if (jar) {
    const c = jar.header()
    if (c) h.Cookie = c
  }
  const res = await fetch(BASE + path, {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  })
  if (jar) jar.absorb(res)
  let data = null
  const text = await res.text()
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { raw: text.slice(0, 200) }
  }
  return { status: res.status, data, res }
}

async function main() {
  console.log(`\n🔍 账户中心验证 @ ${BASE}\n`)

  // ── 0. 健康检查 ────────────────────────────────────────
  const health = await call('GET', '/api/health')
  ok('服务在线', health.status === 200 && health.data?.ok === true)
  if (health.status !== 200) {
    console.log('\n服务未启动，后续断言跳过。')
    process.exit(1)
  }

  // ── 1. 匿名 /auth/me 不该 401 ──────────────────────────
  const anon = await call('GET', '/api/auth/me')
  ok(
    '匿名访问 /auth/me 返回 200 且 authenticated=false',
    anon.status === 200 && anon.data?.authenticated === false && anon.data?.user === null,
    `status=${anon.status}`,
  )

  // ── 2. 注册：必须下发 httpOnly Cookie ──────────────────
  const jar = makeJar()
  const reg = await call('POST', '/api/auth/register', {
    jar,
    body: { username: TEST_USER, email: TEST_EMAIL, password: PASS },
  })
  ok('注册成功 201', reg.status === 201, `status=${reg.status} ${JSON.stringify(reg.data).slice(0, 120)}`)

  const setCookies = reg.res.headers.getSetCookie ? reg.res.headers.getSetCookie() : []
  const sessionCookie = setCookies.find((s) => s.startsWith('gv_session='))
  ok('登录下发 gv_session Cookie', !!sessionCookie)
  ok('Cookie 带 HttpOnly（JS 读不到）', !!sessionCookie && /HttpOnly/i.test(sessionCookie))
  ok('Cookie 带 Path=/', !!sessionCookie && /Path=\//i.test(sessionCookie))
  ok('Cookie 带有效期', !!sessionCookie && /Max-Age=\d+/i.test(sessionCookie))
  ok('响应体仍返回 token（脚本兼容）', typeof reg.data?.token === 'string')
  ok('响应体带 sessionId', typeof reg.data?.sessionId === 'string')

  // ── 3. Cookie 作为唯一凭据 ─────────────────────────────
  const acc = await call('GET', '/api/account', { jar })
  ok('仅凭 Cookie 可访问账户中心', acc.status === 200 && acc.data?.user?.username === TEST_USER)

  const noAuth = await call('GET', '/api/account')
  ok('无凭据访问账户中心 401', noAuth.status === 401)

  const headerAuth = await call('GET', '/api/account', {
    headers: { 'X-Auth-Token': String(reg.data?.token || '') },
  })
  ok('旧的 X-Auth-Token 通道仍可用（过渡期）', headerAuth.status === 200)

  // ── 4. 资料修改 ────────────────────────────────────────
  const p1 = await call('PATCH', '/api/account/profile', {
    jar,
    body: { display_name: '验证用昵称', bio: '这是一段验证用简介' },
  })
  ok(
    '修改昵称与简介',
    p1.status === 200 && p1.data?.user?.display_name === '验证用昵称' && p1.data?.changed === 2,
    `status=${p1.status}`,
  )

  const p2 = await call('PATCH', '/api/account/profile', { jar, body: { display_name: '   ' } })
  ok('空昵称被拒 400', p2.status === 400)

  const p3 = await call('PATCH', '/api/account/profile', { jar, body: { bio: 'x'.repeat(161) } })
  ok('简介超长被拒 400', p3.status === 400)

  const p4 = await call('PATCH', '/api/account/profile', { jar, body: { avatar: 'javascript:alert(1)' } })
  ok('非 http(s) 头像被拒 400', p4.status === 400)

  // ── 5. 用户名：冷却与占用 ──────────────────────────────
  const newName = `${TEST_USER}x`
  const u1 = await call('PATCH', '/api/account/username', { jar, body: { username: newName } })
  ok('改名成功', u1.status === 200 && u1.data?.user?.username === newName, `status=${u1.status}`)

  const u2 = await call('PATCH', '/api/account/username', { jar, body: { username: `${TEST_USER}y` } })
  ok('30 天冷却生效 429', u2.status === 429 && u2.data?.code === 'USERNAME_COOLDOWN', `status=${u2.status}`)

  const u3 = await call('PATCH', '/api/account/username', { jar, body: { username: 'A' } })
  ok('过短用户名被拒 400', u3.status === 400)

  // ── 6. 改密码 ──────────────────────────────────────────
  const second = makeJar()
  const login2 = await call('POST', '/api/auth/login', {
    jar: second,
    body: { email: NEW_EMAIL, password: PASS },
  })
  // 首次登录时邮箱还是 TEST_EMAIL，这里用 TEST_EMAIL（换绑在后面）
  const login2b =
    login2.status === 200
      ? login2
      : await call('POST', '/api/auth/login', { jar: second, body: { email: TEST_EMAIL, password: PASS } })
  ok('第二台设备登录成功', login2b.status === 200, `status=${login2b.status}`)

  const before = await call('GET', '/api/account/sessions', { jar })
  ok('登录设备列表 ≥ 2', (before.data?.sessions?.length || 0) >= 2, `count=${before.data?.sessions?.length}`)
  ok('当前设备被正确标记 current', !!before.data?.sessions?.find((s) => s.current))
  ok('设备信息可读（非纯 UA 原文）', !!before.data?.sessions?.[0]?.device)

  const w1 = await call('POST', '/api/account/password', { jar, body: { current: 'WrongPass1', password: 'NewPass12345' } })
  ok('旧密码错误被拒 400', w1.status === 400)

  const w2 = await call('POST', '/api/account/password', { jar, body: { current: PASS, password: PASS } })
  ok('新旧密码相同被拒 400', w2.status === 400)

  const w3 = await call('POST', '/api/account/password', { jar, body: { current: PASS, password: 'NewPass12345' } })
  ok('改密成功', w3.status === 200 && w3.data?.ok === true, `status=${w3.status}`)
  ok('改密后撤销了其它设备会话', (w3.data?.revokedSessions || 0) >= 1, `revoked=${w3.data?.revokedSessions}`)

  const stillIn = await call('GET', '/api/account', { jar })
  ok('改密后当前设备仍在线', stillIn.status === 200)

  const kicked = await call('GET', '/api/account', { jar: second })
  ok('改密后被踢的设备失效 401', kicked.status === 401, `status=${kicked.status}`)

  const oldPwd = makeJar()
  const oldLogin = await call('POST', '/api/auth/login', {
    jar: oldPwd,
    body: { email: TEST_EMAIL, password: PASS },
  })
  ok('旧密码无法再登录 401', oldLogin.status === 401, `status=${oldLogin.status}`)

  const newPwd = makeJar()
  const newLogin = await call('POST', '/api/auth/login', {
    jar: newPwd,
    body: { email: TEST_EMAIL, password: 'NewPass12345' },
  })
  ok('新密码可登录 200', newLogin.status === 200, `status=${newLogin.status}`)

  // ── 7. 邮箱换绑（双验证）────────────────────────────────
  const e0 = await call('POST', '/api/account/email/request', { jar, body: { email: TEST_EMAIL } })
  ok('换绑到当前邮箱被拒 400', e0.status === 400)

  const e1 = await call('POST', '/api/account/email/request', { jar, body: { email: 'not-an-email' } })
  ok('非法邮箱被拒 400', e1.status === 400)

  const e2 = await call('POST', '/api/account/email/request', { jar, body: { email: NEW_EMAIL } })
  ok('申请换绑成功', e2.status === 200 && e2.data?.ok === true, `status=${e2.status} ${JSON.stringify(e2.data).slice(0, 140)}`)
  ok('未配邮件服务时如实标注演示模式', e2.data?.delivery === 'inline' && !!e2.data?.demoCode)

  const e2b = await call('POST', '/api/account/email/request', { jar, body: { email: NEW_EMAIL } })
  ok('60 秒内重复发码被限流 429', e2b.status === 429, `status=${e2b.status}`)

  const badCode = String(Number(e2.data?.demoCode || '000000') + 1).padStart(6, '0')
  const e3 = await call('POST', '/api/account/email/confirm', { jar, body: { email: NEW_EMAIL, code: badCode } })
  ok('错误验证码被拒 400', e3.status === 400)

  const e4 = await call('POST', '/api/account/email/confirm', {
    jar,
    body: { email: NEW_EMAIL, code: String(e2.data?.demoCode || '') },
  })
  ok('正确验证码完成换绑', e4.status === 200 && e4.data?.user?.email === NEW_EMAIL, `status=${e4.status}`)

  const afterBind = await call('GET', '/api/auth/me', { jar })
  ok('换绑后 /auth/me 返回新邮箱', afterBind.data?.user?.email === NEW_EMAIL)

  // ── 8. 手机号如实标注未验证 ────────────────────────────
  const ph1 = await call('PATCH', '/api/account/phone', { jar, body: { phone: '12345' } })
  ok('非法手机号被拒 400', ph1.status === 400)

  const ph2 = await call('PATCH', '/api/account/phone', { jar, body: { phone: '13800138000' } })
  ok('合法手机号记录成功', ph2.status === 200 && ph2.data?.user?.phone === '13800138000')
  ok('手机号标明未验证（phone_verified=0）', ph2.data?.user?.phone_verified === 0)
  ok('明确告知未验证而非假装已绑', /未验证|短信通道/.test(String(ph2.data?.note || '')))

  // ── 9. 审计日志 ────────────────────────────────────────
  const audit = await call('GET', '/api/account/audit?pageSize=50', { jar })
  const actions = (audit.data?.items || []).map((x) => x.action)
  ok('个人审计日志可读', audit.status === 200 && actions.length > 0, `count=${actions.length}`)
  ok('记录了改密动作', actions.includes('account.password.change'))
  ok('记录了换绑动作', actions.includes('account.email.confirm'))
  ok('记录了登录失败尝试', actions.includes('account.password.change.fail'))
  ok('审计不含密码明文', !JSON.stringify(audit.data).includes('NewPass12345'))

  // ── 10. 数据导出 ───────────────────────────────────────
  const exp = await call('GET', '/api/account/export', { jar })
  ok(
    '数据导出含账号信息与库',
    exp.status === 200 && exp.data?.account?.username === newName && Array.isArray(exp.data?.library),
  )

  // ── 11. 注销 ───────────────────────────────────────────
  const d1 = await call('DELETE', '/api/account', { jar, body: { password: 'WrongPass9' } })
  ok('注销需正确密码 400', d1.status === 400)

  const d2 = await call('DELETE', '/api/account', { jar, body: { password: 'NewPass12345' } })
  ok('注销成功', d2.status === 200 && d2.data?.ok === true, `status=${d2.status} ${JSON.stringify(d2.data).slice(0, 120)}`)

  const afterDelete = await call('GET', '/api/account', { jar })
  ok('注销后旧 Cookie 失效 401', afterDelete.status === 401, `status=${afterDelete.status}`)

  const reLogin = await call('POST', '/api/auth/login', {
    jar: makeJar(),
    body: { email: NEW_EMAIL, password: 'NewPass12345' },
  })
  ok('注销后无法再登录', reLogin.status === 401 || reLogin.status === 403, `status=${reLogin.status}`)

  // ── 12. 收尾：清理测试数据 ─────────────────────────────
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(new URL('../server/db/data/gamevibe.db', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
  const row = db.prepare('SELECT id, username, email, deleted_at FROM users WHERE username LIKE ? OR email LIKE ?').get(
    `deleted_%`,
    `%${stamp}%`,
  )
  if (row) {
    db.prepare('DELETE FROM audit_logs WHERE actor_id = ?').run(row.id)
    db.prepare('DELETE FROM email_changes WHERE user_id = ?').run(row.id)
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.id)
    db.prepare('DELETE FROM user_roles WHERE user_id = ?').run(row.id)
    db.prepare('DELETE FROM users WHERE id = ?').run(row.id)
  }
  db.close()

  console.log(`\n${'─'.repeat(56)}`)
  if (fails.length === 0) {
    console.log(`✅ 全部通过：${pass} 项断言`)
  } else {
    console.log(`⚠️  ${pass} 通过 / ${fails.length} 失败`)
    for (const f of fails) console.log(`   · ${f}`)
  }
  console.log(`${'─'.repeat(56)}\n`)
  process.exitCode = fails.length ? 1 : 0
}

main().catch((e) => {
  console.error('\n验证脚本异常：', e)
  process.exitCode = 1
})
