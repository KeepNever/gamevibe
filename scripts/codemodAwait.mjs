// 一次性 codemod：给运行时文件里的 db.prepare / db.exec 前面补 await。
// 只处理指定文件；migrations/seedRbac/diag 等本地专用文件不动。
import { readFileSync, writeFileSync } from 'node:fs'

const files = [
  'server/routes/social.ts',
  'server/routes/account.ts',
  'server/routes/auth.ts',
  'server/routes/admin.ts',
  'server/routes/collections.ts',
  'server/routes/reviews.ts',
  'server/routes/library.ts',
  'server/routes/chat.ts',
  'server/routes/recommendations.ts',
  'server/lib/rbac.ts',
  'server/lib/session.ts',
  'server/lib/audit.ts',
  'server/lib/playerProfile.ts',
  'server/lib/gameProfile.ts',
  'server/middleware/auth.ts',
  'server/index.ts',
]

let total = 0
for (const f of files) {
  const src = readFileSync(f, 'utf8')
  let n = 0
  const out = src
    .replace(/(?<!await\s)(?<![\w.])db\.prepare\(/g, () => {
      n++
      return 'await db.prepare('
    })
    .replace(/(?<!await\s)(?<![\w.])db\.exec\(/g, () => {
      n++
      return 'await db.exec('
    })
  if (n) {
    writeFileSync(f, out)
    console.log(`${f}: ${n} 处`)
    total += n
  }
}
console.log('共', total, '处加 await')
