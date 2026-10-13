// 校验并升级封面分辨率：Steam library_600x900 -> _2x；iTunes 512 -> 1024
// 用法: node scripts/upgradeCoverRes.mjs [--apply]
import fs from 'node:fs'

const APPLY = process.argv.includes('--apply')
const FILES = ['server/data/discoverCatalog.ts', 'src/data/discoverFallback.json', 'scripts/fixCoversAll.mjs']

const raw = fs.readFileSync('server/data/discoverCatalog.ts', 'utf8')
const urls = [...raw.matchAll(/https:\/\/cdn\.cloudflare\.steamstatic\.com\/steam\/apps\/(\d+)\/library_600x900\.jpg/g)].map((m) => ({ id: m[1], u: m[0] }))
const itunes = [...new Set([...raw.matchAll(/https:\/\/[^"'\s]*\/512x512bb\.jpg/g)].map((m) => m[0]))]

async function ok(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0' }, signal: AbortSignal.timeout(12000) })
      if (r.status === 200 || r.status === 206) return true
      if (r.status === 404) return false
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 600))
  }
  return false
}

console.log('Steam 竖版封面待升级:', urls.length, '| iTunes 待升级:', itunes.length)

const bad = []
let idx = 0
const CONC = 8
await Promise.all(
  Array.from({ length: CONC }, async () => {
    while (idx < urls.length) {
      const { id, u } = urls[idx++]
      const up = u.replace('library_600x900.jpg', 'library_600x900_2x.jpg')
      if (!(await ok(up))) bad.push(id)
    }
  }),
)
console.log('Steam _2x 不可用:', bad.length, bad.slice(0, 20).join(','))

const badIt = []
for (const u of itunes) {
  const up = u.replace('512x512bb.jpg', '1024x1024bb.jpg')
  if (!(await ok(up))) badIt.push(u)
}
console.log('iTunes 1024 不可用:', badIt.length, badIt.slice(0, 6).join(' '))

if (!APPLY) {
  console.log('\n(未加 --apply，仅校验)')
  process.exitCode = 0
} else {
  for (const f of FILES) {
    if (!fs.existsSync(f)) { console.log('跳过（不存在）', f); continue }
    let s = fs.readFileSync(f, 'utf8')
    const before = s
    s = s.replace(/library_600x900\.jpg/g, 'library_600x900_2x.jpg')
    s = s.replace(/512x512bb\.jpg/g, '1024x1024bb.jpg')
    if (s !== before) {
      fs.writeFileSync(f + '.bak', before)
      fs.writeFileSync(f, s)
      console.log('已升级', f)
    } else console.log('无变化', f)
  }
  process.exitCode = 0
}
