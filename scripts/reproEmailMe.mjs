// 最小复现：换绑后 /auth/me 是否返回新邮箱
const BASE = 'http://127.0.0.1:8792'

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
  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = { raw: text.slice(0, 200) } }
  return { status: res.status, data }
}

const jar = makeJar()
const stamp = Date.now().toString(36)
const REG = `repro_${stamp}@test.local`
const NEW = `repro_new_${stamp}@test.local`

const reg = await call('POST', '/api/auth/register', {
  jar, body: { username: `复现${stamp}`, email: REG, password: 'reproPass123' },
})
console.log('注册:', reg.status, reg.data?.user?.email)

const r1 = await call('POST', '/api/account/email/request', { jar, body: { email: NEW } })
console.log('换绑请求:', r1.status, 'code=', r1.data?.demoCode ? '(演示码)' : '(无)')

const c1 = await call('POST', '/api/account/email/confirm', {
  jar, body: { email: NEW, code: String(r1.data?.demoCode || '') },
})
console.log('确认换绑:', c1.status, '响应邮箱=', c1.data?.user?.email)

const me = await call('GET', '/api/auth/me', { jar })
console.log('/auth/me:', me.status, 'authenticated=', me.data?.authenticated, '邮箱=', me.data?.user?.email)
if (me.data?.user?.email !== NEW) console.log('  /me 完整响应:', JSON.stringify(me.data).slice(0, 400))
