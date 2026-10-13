// 生成前端兜底目录（用于无后端时的静态部署）
// 用法：node --experimental-strip-types scripts/gen-fallback.mjs
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { discoverCatalog } from '../server/data/discoverCatalog.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outPath = join(__dirname, '..', 'src', 'data', 'discoverFallback.json')
writeFileSync(outPath, JSON.stringify(discoverCatalog))
console.log(`✓ 已写出 ${discoverCatalog.length} 款游戏到 src/data/discoverFallback.json`)
