// 把"含 await 但非 async"的函数 async 化（供 fixPromiseCalls 每轮调用）
import { readFileSync, writeFileSync } from 'node:fs'
import * as ts from 'typescript'

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
  console.log(`  async 化 ${file}: ${inserts.length} 函数 / ${wraps.length} 类型`)
}

for (const f of process.argv.slice(2)) asyncify(f)
