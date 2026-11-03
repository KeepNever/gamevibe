/**
 * Turso 迁移 codemod 总入口（node --experimental-strip-types 运行）。
 * 步骤：
 *   1. 对运行时文件把 db.prepare(/db.exec( 前面补 await（含多行链式）
 *   2. 把"含 await 但非 async"的函数 async 化，返回类型包 Promise
 *   3. session/audit 的 db 参数签名 DatabaseSync → GameVibeDb
 * 之后的调用点级联由 fixPromiseCalls 处理（读 typecheck 输出）。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import * as ts from 'typescript'

const RUNTIME = [
  'server/routes/social.ts',
  'server/routes/account.ts',
  'server/routes/auth.ts',
  'server/routes/admin.ts',
  'server/routes/collections.ts',
  'server/routes/reviews.ts',
  'server/routes/library.ts',
  'server/routes/chat.ts',
  'server/routes/recommendations.ts',
  'server/routes/stats.ts',
  'server/routes/aiPersonal.ts',
  'server/lib/rbac.ts',
  'server/lib/session.ts',
  'server/lib/audit.ts',
  'server/lib/playerProfile.ts',
  'server/lib/gameProfile.ts',
  'server/lib/requirements.ts',
  'server/middleware/auth.ts',
  'server/index.ts',
]

// ── 1. 补 await ─────────────────────────────────────────────
let totalAwait = 0
for (const f of RUNTIME) {
  const src = readFileSync(f, 'utf8')
  let n = 0
  const out = src
    .replace(/(?<!await\s)(?<![\w.])db(\s*\.\s*prepare\s*\()/g, (_m, g) => { n++; return 'await db' + g })
    .replace(/(?<!await\s)(?<![\w.])db(\s*\.\s*exec\s*\()/g, (_m, g) => { n++; return 'await db' + g })
  if (n) { writeFileSync(f, out); totalAwait += n }
}
console.log(`1) 补 await：${totalAwait} 处`)

// ── 2. async 化 ─────────────────────────────────────────────
function bodyHasAwait(fn: ts.Node): boolean {
  let found = false
  function visit(node: ts.Node): void {
    if (found) return
    if (ts.isAwaitExpression(node)) { found = true; return }
    if (
      node !== fn &&
      (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node) || ts.isMethodDeclaration(node))
    ) return
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(fn, visit)
  return found
}

function asyncify(file: string): void {
  const src = readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true)
  const inserts: { pos: number; text: string }[] = []
  const wraps: { start: number; end: number; text: string }[] = []

  function visit(node: ts.Node): void {
    const isFn =
      (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node) || ts.isMethodDeclaration(node)) &&
      !!(node as ts.FunctionLikeDeclaration).body
    if (isFn) {
      const fn = node as ts.FunctionLikeDeclaration
      const hasAsync = !!fn.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)
      if (bodyHasAwait(fn) && !hasAsync) {
        let pos = fn.getStart(sf)
        const mods = (fn.modifiers || []).filter((m) =>
          [ts.SyntaxKind.ExportKeyword, ts.SyntaxKind.DefaultKeyword, ts.SyntaxKind.StaticKeyword,
            ts.SyntaxKind.PublicKeyword, ts.SyntaxKind.PrivateKeyword].includes(m.kind),
        )
        if (mods.length) pos = mods[mods.length - 1].getEnd()
        inserts.push({ pos, text: 'async ' })
        if (fn.type && !/^(Promise<|void\b)/.test(fn.type.getText(sf).trim())) {
          wraps.push({ start: fn.type.getStart(sf), end: fn.type.getEnd(), text: `Promise<${fn.type.getText(sf)}>` })
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  if (!inserts.length && !wraps.length) return

  const edits = [
    ...inserts.map((i) => ({ pos: i.pos, end: i.pos, text: i.text })),
    ...wraps.map((w) => ({ pos: w.start, end: w.end, text: w.text })),
  ].sort((a, b) => b.pos - a.pos)
  let out = src
  for (const e of edits) out = out.slice(0, e.pos) + e.text + out.slice(e.end)
  out = out.replace(/\b(export|static|public|private)async\s+/g, '$1 async ')
  writeFileSync(file, out)
  console.log(`2) ${file}: async 化 ${inserts.length}，返回类型 ${wraps.length}`)
}

for (const f of RUNTIME) asyncify(f)

// ── 3. 签名修正 ─────────────────────────────────────────────
for (const f of ['server/lib/audit.ts', 'server/lib/session.ts']) {
  let s = readFileSync(f, 'utf8')
  s = s.replace(/import type \{ DatabaseSync \} from 'node:sqlite'\r?\n/, '')
  s = s.replace(/db: DatabaseSync/g, 'db: GameVibeDb')
  if (!s.includes("../db/driver.ts'") && !s.includes('../db/driver.ts')) {
    s = `import type { GameVibeDb } from '../db/driver.ts'\n` + s
  }
  writeFileSync(f, s)
  console.log(`3) ${f}: 签名 → GameVibeDb`)
}
console.log('done')
