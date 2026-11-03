/**
 * 社区链路回归：举报 → 版主删除 → 通知（评论事件）
 * 用法：node scripts/verifyCommunity.mjs [baseUrl]
 * 覆盖：
 *   - 发评论 → 粉丝收到 follow_review 通知
 *   - 举报他人评论（重复举报 409、自举报 400）
 *   - 管理员举报列表可见
 *   - 版主删除（review.moderate）→ 评论连带举报清空 → 作者收到 review_moderated 通知
 *   - 审计留痕：review.report / review.moderate
 */
for (const k of Object.keys(process.env)) if (/proxy/i.test(k)) delete process.env[k]

const BASE = process.argv[2] || 'http://127.0.0.1:8792'
const ADMIN_EMAIL = process.env.SHOT_ADMIN || '老白不白@seed.local'
const ADMIN_PASS = process.env.ADMIN_PASS || 'seedpass1234'

function makeJar() {
  const store = new Map()
  return {
    absorb(res) {
      const list = res.headers.getSetCookie ? res.headers.getSetCookie() : []
      for (const sc of list) {
        const pair = sc.split(';')[0]
        const i = pair.indexOf('=')
        if (i > 0) store.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim())
      }
    },
    header() {
      return [...store].map(([k, v]) => `${k}=${v}`).join('; ')
    },
  }
}

async function call(method, path, { jar, body } = {}) {
  const h = {}
  if (body !== undefined) h['Content-Type'] = 'application/json'
  if (jar) h.Cookie = jar.header()
  const res = await fetch(BASE + path, {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  })
  if (jar) jar.absorb(res)
  const data = await res.json().catch(() => null)
  return { status: res.status, data }
}

const checks = []
const ok = (name, pass, detail = '') => {
  checks.push([name, pass])
  console.log(`${pass ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`)
}

async function main() {
  const stamp = Date.now().toString(36)
  const jarA = makeJar()
  const jarB = makeJar()
  const jarM = makeJar()

  // 建两个测试用户
  const ra = await call('POST', '/api/auth/register', {
    jar: jarA,
    body: { username: `社区A${stamp}`, email: `ca${stamp}@test.local`, password: 'communityPass1' },
  })
  const rb = await call('POST', '/api/auth/register', {
    jar: jarB,
    body: { username: `社区B${stamp}`, email: `cb${stamp}@test.local`, password: 'communityPass1' },
  })
  ok('测试账号创建', ra.status === 201 && rb.status === 201, `A=${ra.status} B=${rb.status}`)
  const authorId = rb.data?.user?.id

  // B 发评论（A 已关注 B 才能测 follow_review，所以 A 先关注）
  const fw = await call('POST', '/api/social/follow', { jar: jarA, body: { userId: authorId } })
  ok('A 关注 B', fw.status === 200)

  const rev = await call('POST', '/api/reviews', {
    jar: jarB,
    body: { gameId: 'vampire-survivors', rating: 5, content: '社区链路回归评论' },
  })
  ok('B 发评论', rev.status === 201, `id=${rev.data?.id}`)

  // A 通知里应出现 follow_review
  const na = await call('GET', '/api/social/notifications', { jar: jarA })
  ok(
    '粉丝收到新评测通知',
    (na.data?.notifications || []).some((n) => n.type === 'follow_review' && n.ref_id === 'vampire-survivors'),
  )

  // A 举报 B 的评论
  const rep = await call('POST', `/api/reviews/${rev.data.id}/report`, { jar: jarA, body: { reason: '回归测试举报' } })
  ok('举报提交', rep.status === 201)
  const dup = await call('POST', `/api/reviews/${rev.data.id}/report`, { jar: jarA, body: { reason: '重复' } })
  ok('重复举报被拒 409', dup.status === 409)
  const self = await call('POST', `/api/reviews/${rev.data.id}/report`, { jar: jarB, body: {} })
  ok('举报自己的评论被拒 400', self.status === 400)

  // 管理员看举报列表
  const lm = await call('POST', '/api/auth/login', { jar: jarM, body: { email: ADMIN_EMAIL, password: ADMIN_PASS } })
  ok('管理员登录', lm.status === 200)
  const list = await call('GET', '/api/admin/reports', { jar: jarM })
  const found = (list.data?.reports || []).find((r) => r.review_id === rev.data.id)
  ok('举报出现在后台列表', !!found, found ? `举报人=${found.reporter_name} 作者=${found.author_name}` : '未找到')

  // 版主删除 → 通知作者 + 举报连带清除
  const del = await call('DELETE', `/api/reviews/${rev.data.id}`, { jar: jarM })
  ok('版主删除评论', del.status === 200 && del.data?.moderated === true)

  const list2 = await call('GET', '/api/admin/reports', { jar: jarM })
  ok('举报随评论连带清除', !(list2.data?.reports || []).some((r) => r.review_id === rev.data.id))

  const nb = await call('GET', '/api/social/notifications', { jar: jarB })
  ok('作者收到版主删除通知', (nb.data?.notifications || []).some((n) => n.type === 'review_moderated'))

  // 审计留痕：举报在举报人名下，版主删除在版主名下
  const au = await call('GET', '/api/account/audit', { jar: jarA })
  const actionsA = (au.data?.items || []).map((x) => x.action)
  ok('审计记录 review.report', actionsA.includes('review.report'))
  const auM = await call('GET', '/api/account/audit', { jar: jarM })
  const actionsM = (auM.data?.items || []).map((x) => x.action)
  ok('审计记录 review.moderate', actionsM.includes('review.moderate'))

  await fetch(BASE + '/api/auth/logout', { method: 'POST', headers: { Cookie: jarM.header() } }).catch(() => {})
}

try {
  await main()
} finally {
  const pass = checks.filter((c) => c[1]).length
  console.log(`\n${pass}/${checks.length} 通过`)
  process.exitCode = pass === checks.length ? 0 : 1
}
