/**
 * 一次性安全处置：线上 Turso 库的种子账号密码轮换（README 曾公开 seedpass1234）。
 * - 所有 @seed.local 账号：随机 24 位私钥（写入本地 .seed-private-passwords.txt，勿提交）
 * - 新建公开演示账号 demo@seed.local（DemoPass12345，user 角色，非管理员）
 * - 全部种子账号的会话清空、password_changed_at 置新
 * 幂等：重复执行会再次轮换。
 */
import { createClient } from '@libsql/client/web'
import { randomBytes } from 'node:crypto'
import { scryptSync, randomBytes as rb } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

for (const k of Object.keys(process.env)) if (/proxy/i.test(k)) delete process.env[k]

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)
const url = env.TURSO_DATABASE_URL
const token = env.TURSO_AUTH_TOKEN
if (!url || !token) throw new Error('缺少 TURSO 凭据')
const db = createClient({ url, authToken: token })

function makeHash(pw) {
  const salt = rb(16).toString('hex')
  return { salt, hash: scryptSync(pw, salt, 64).toString('hex') }
}

async function main() {
  const users = (await db.execute("SELECT id, username, email FROM users WHERE email LIKE '%@seed.local'")).rows
  console.log('种子账号:', users.length, '个')

  const privates = []
  for (const u of users) {
    if (u.email === 'demo@seed.local') continue
    const pw = randomBytes(18).toString('base64url')
    privates.push(`${u.username}  ${u.email}  ${pw}`)
    const { hash, salt } = makeHash(pw)
    await db.execute({
      sql: 'UPDATE users SET password_hash=?, salt=?, password_changed_at=? WHERE id=?',
      args: [hash, salt, Date.now(), u.id],
    })
    await db.execute({ sql: 'DELETE FROM sessions WHERE user_id=?', args: [u.id] })
  }

  // 公开演示账号（非管理员）
  const demoEmail = 'demo@seed.local'
  const demoPw = 'DemoPass12345'
  const exist = (await db.execute({ sql: 'SELECT id FROM users WHERE email=?', args: [demoEmail] })).rows
  if (!exist.length) {
    const { hash, salt } = makeHash(demoPw)
    const id = randomBytes(12).toString('hex')
    const now = Date.now()
    await db.execute({
      sql: "INSERT INTO users (id, username, email, password_hash, salt, status, created_at, updated_at, display_name) VALUES (?,?,?,?,?,'active',?,?, '演示账号')",
      args: [id, 'Demo 游客', demoEmail, hash, salt, now, now],
    })
    // user 角色
    await db.execute({
      sql: "INSERT OR IGNORE INTO user_roles (user_id, role_id, granted_at, granted_by) SELECT ?, id, ?, 'system' FROM roles WHERE key='user'",
      args: [id, now],
    })
    console.log('演示账号已创建: demo@seed.local / DemoPass12345')
  } else {
    const { hash, salt } = makeHash(demoPw)
    await db.execute({
      sql: "UPDATE users SET password_hash=?, salt=?, password_changed_at=? WHERE email=?",
      args: [hash, salt, Date.now(), demoEmail],
    })
    console.log('演示账号已重置: demo@seed.local / DemoPass12345')
  }

  writeFileSync('.seed-private-passwords.txt', `# 种子账号私钥（轮换于 ${new Date().toISOString()}）——勿提交、勿外传\n` + privates.join('\n') + '\n')
  console.log('私钥清单 → .seed-private-passwords.txt（已确认在 .gitignore 之外则手动移出仓库目录）')
}

main().catch((e) => {
  console.log('FAIL', e.message)
  process.exitCode = 1
})
