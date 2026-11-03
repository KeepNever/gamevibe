// 一次性：async 函数显式 void 返回类型 → Promise<void>
import { readFileSync, writeFileSync } from 'node:fs'
import * as ts from 'typescript'

const files = [
  'server/lib/audit.ts', 'server/lib/rbac.ts', 'server/lib/session.ts',
  'server/lib/gameProfile.ts', 'server/lib/playerProfile.ts',
  'server/lib/requirements.ts', 'server/middleware/auth.ts',
]
for (const f of files) {
  const src = readFileSync(f, 'utf8')
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true)
  const edits: { start: number; end: number }[] = []
  function visit(n: ts.Node): void {
    if (ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isFunctionExpression(n)) {
      const fn = n as ts.FunctionLikeDeclaration
      const hasAsync = !!fn.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)
      if (hasAsync && fn.type && fn.type.getText(sf).trim() === 'void') {
        edits.push({ start: fn.type.getStart(sf), end: fn.type.getEnd() })
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  if (!edits.length) continue
  edits.sort((a, b) => b.start - a.start)
  let out = src
  for (const e of edits) out = out.slice(0, e.start) + 'Promise<void>' + out.slice(e.end)
  writeFileSync(f, out)
  console.log(`${f}: void → Promise<void> ×${edits.length}`)
}
