/**
 * async 化 codemod：找到"包含 await 但自身不是 async"的函数，
 * 加 async 修饰符，并把显式返回类型包一层 Promise<T>。
 * 用 TS 编译器 API 定位，做纯文本插入，避免正则误伤。
 * 反复跑直到类型检查不再报 "await expressions are only allowed"。
 */
const ts = require('typescript')
const { readFileSync, writeFileSync } = require('fs')

const files = process.argv.slice(2)

for (const file of files) {
  const src = readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true)

  const inserts = [] // {pos, text}
  const typeWraps = [] // {start, end, text}

  function bodyHasAwait(fn) {
    let found = false
    function visit(node) {
      if (found) return
      if (ts.isAwaitExpression(node)) {
        found = true
        return
      }
      if (
        node !== fn.body &&
        (ts.isFunctionDeclaration(node) ||
          ts.isArrowFunction(node) ||
          ts.isFunctionExpression(node) ||
          ts.isMethodDeclaration(node))
      )
        return
      ts.forEachChild(node, visit)
    }
    if (fn.body) visit(fn.body)
    return found
  }

  function hasAsync(fn) {
    return !!fn.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)
  }

  function visit(node) {
    const isFn =
      (ts.isFunctionDeclaration(node) ||
        ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isConstructorDeclaration(node)) &&
      !!node.body

    if (isFn && bodyHasAwait(node) && !hasAsync(node)) {
      // 插入点：export/static 等修饰符之后
      let pos = node.getStart(sf)
      const mods = (node.modifiers || []).filter(
        (m) =>
          m.kind === ts.SyntaxKind.ExportKeyword ||
          m.kind === ts.SyntaxKind.DefaultKeyword ||
          m.kind === ts.SyntaxKind.StaticKeyword ||
          m.kind === ts.SyntaxKind.PublicKeyword ||
          m.kind === ts.SyntaxKind.PrivateKeyword,
      )
      if (mods.length) pos = mods[mods.length - 1].getEnd()
      inserts.push({ pos, text: 'async ' })

      // 显式返回类型包 Promise<T>
      if (node.type && !/^Promise<|^void$/.test(node.type.getText(sf).trim())) {
        typeWraps.push({
          start: node.type.getStart(sf),
          end: node.type.getEnd(),
          text: `Promise<${node.type.getText(sf)}>`,
        })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)

  if (!inserts.length && !typeWraps.length) continue

  // 两类编辑统一用原始文本位置，从后往前应用才不会漂移
  const edits = [
    ...inserts.map((i) => ({ pos: i.pos, text: i.text, wrap: false })),
    ...typeWraps.map((t) => ({ pos: t.start, text: t.text, wrap: true, end: t.end })),
  ].sort((a, b) => b.pos - a.pos)

  let out = src
  for (const e of edits) {
    out = e.wrap
      ? out.slice(0, e.pos) + e.text + out.slice(e.end)
      : out.slice(0, e.pos) + e.text + out.slice(e.pos)
  }
  // 修饰符后插入的规范问题：export function → export async function
  out = out.replace(/\b(export|static|public|private)async\s+/g, '$1 async ')
  writeFileSync(file, out)
  console.log(`${file}: async 化 ${inserts.length} 个函数，包装返回类型 ${typeWraps.length} 处`)
}
