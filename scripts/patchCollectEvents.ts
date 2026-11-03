// 一次性补丁：collectEvents 三类事件源并行化
import { readFileSync, writeFileSync } from 'node:fs'

const f = 'server/lib/playerProfile.ts'
let s = readFileSync(f, 'utf8').replace(/\r\n/g, '\n')

const fnStart = s.indexOf('export async function collectEvents')
const fnEnd = s.indexOf('return events', fnStart)
if (fnStart < 0 || fnEnd < 0) throw new Error('collectEvents 定位失败')
const block = s.slice(fnStart, fnEnd)

// 1) 三条查询提前并行发出
let nb = block.replace(
  'const events: InteractionEvent[] = []\n',
  `const events: InteractionEvent[] = []

  // 三类事件源互不依赖：并行发查询，远程库下省两次往返
  const libP = db
    .prepare(
      "SELECT external_id, status, added_at FROM user_library WHERE user_id=? AND status IN ('wishlist','playing','completed') AND external_id IS NOT NULL",
    )
    .all(userId)
    .catch(() => [] as any[])
  const rvP = db
    .prepare('SELECT game_id, rating, created_at FROM reviews WHERE user_id=?')
    .all(userId)
    .catch(() => [] as any[])
  const rcP = db
    .prepare('SELECT game_id, viewed_at FROM user_recent WHERE user_id=?')
    .all(userId)
    .catch(() => [] as any[])
`,
)

// 2) 三处 await 改为等已发出的 Promise
nb = nb.replace(/const lib = await db[\s\S]*?\.all\(userId\) as any\[\]/, 'const lib = await libP')
nb = nb.replace(
  /const rv = await db\s*\.prepare\('SELECT game_id, rating, created_at FROM reviews WHERE user_id=\?'\)\s*\.all\(userId\) as any\[\]/,
  'const rv = await rvP',
)
nb = nb.replace(
  /const rc = await db\s*\.prepare\('SELECT game_id, viewed_at FROM user_recent WHERE user_id=\?'\)\s*\.all\(userId\) as any\[\]/,
  'const rc = await rcP',
)

if (nb === block) throw new Error('没有任何替换发生')
s = s.slice(0, fnStart) + nb + s.slice(fnEnd)
writeFileSync(f, s)
console.log('collectEvents 并行化完成')
