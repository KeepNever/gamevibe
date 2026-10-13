// 从前端 mock 数据生成后端 AI 检索目录（精简版，仅保留推荐所需字段）
// 运行：node --experimental-strip-types scripts/gen-catalog.ts
import { games } from '../src/data/games.ts'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const catalog = games.map((g) => ({
  id: g.id,
  name: g.name,
  genres: g.genres,
  tags: g.tags,
  rating: g.rating,
  price: g.price,
  coverUrl: g.coverUrl,
}))

const content = `// 自动生成（源：src/data/games.ts），由 scripts/gen-catalog.ts 生成，勿手改
import type { CatalogGame } from '../types.ts'

export const catalog: CatalogGame[] = ${JSON.stringify(catalog, null, 2)}
`

const outDir = join(__dirname, '..', 'server', 'data')
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'catalog.ts'), content)
console.log(`[gen-catalog] 已生成 ${catalog.length} 款游戏目录 -> server/data/catalog.ts`)
