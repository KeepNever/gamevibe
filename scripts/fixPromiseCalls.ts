/**
 * 调用点级联修复（node --experimental-strip-types 运行）。
 * 读 typecheck 输出，对"把 Promise 当同步值用"的位置加 await 并括号包裹，
 * 然后重跑 codemodAsync 把外层函数 async 化。反复执行直到收敛。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import * as ts from 'typescript'

interface Err { file: string; line: number; col: number; code: string; msg: string }

function typecheck(): string {
  try {
    return execSync('npm run server:typecheck 2>&1', { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  } catch (e: unknown) {
    const out = (e as { stdout?: string }).stdout ?? ''
    return out + ((e as { stderr?: string }).stderr ?? '')
  }
}

function parseErrors(raw: string): Err[] {
  const out: Err[] = []
  const re = /^([^\s(]+)\((\d+),(\d+)\): error (TS\d+): (.*)$/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(raw))) {
    const [, file, line, col, code, msg] = m
    // 默认跳过 scripts/（eval 脚本要修时设 INCLUDE_SCRIPTS=1）
    if (file.startsWith('scripts/') && process.env.INCLUDE_SCRIPTS !== '1') continue
    if (file === 'scripts/fixPromiseCalls.ts') continue
    if (!['TS2339', 'TS2345', 'TS2367', 'TS2769'].includes(code)) continue
    if (!/Promise</.test(msg)) continue
    out.push({ file, line: +line, col: +col, code, msg })
  }
  return out
}

function findEnclosingFn(node: ts.Node): ts.Node | undefined {
  let n: ts.Node | undefined = node
  while (n) {
    if (
      (ts.isFunctionDeclaration(n) || ts.isArrowFunction(n) ||
        ts.isMethodDeclaration(n) || ts.isFunctionExpression(n)) &&
      (n as ts.FunctionLikeDeclaration).body
    ) return n
    n = n.parent
  }
  return undefined
}

function findVarInit(fn: ts.Node | undefined, name: string): ts.CallExpression | undefined {
  if (!fn) return undefined
  let found: ts.CallExpression | undefined
  function walk(n: ts.Node): void {
    if (found) return
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && n.initializer) {
      if (ts.isAwaitExpression(n.initializer)) return
      let head: ts.Expression = n.initializer
      while (ts.isPropertyAccessExpression(head) || ts.isElementAccessExpression(head)) head = head.expression
      if (ts.isCallExpression(head)) { found = head; return }
    }
    ts.forEachChild(n, walk)
  }
  walk(fn)
  return found
}

function fixFile(file: string, errs: Err[]): number {
  const src = readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true)
  const edits: { start: number; end: number; text: string }[] = []
  const seen = new Set<string>()
  let skipped = 0

  for (const e of errs) {
    const pos = ts.getPositionOfLineAndCharacter(sf, e.line - 1, e.col - 1)
    // getTouchingToken 在部分版本的类型定义里未导出，运行时是存在的
    const token = (ts as any).getTouchingToken(sf, pos) as ts.Node

    let anc: ts.Node | undefined = token
    let inAwait = false
    while (anc) { if (ts.isAwaitExpression(anc)) inAwait = true; anc = anc.parent }
    if (inAwait) { skipped++; continue }

    // 沿属性访问链爬到最外层，再取链头表达式
    let top: ts.Expression = token as ts.Expression
    while (top.parent && (ts.isPropertyAccessExpression(top.parent) || ts.isElementAccessExpression(top.parent))) {
      top = top.parent
    }
    let head: ts.Expression = top
    while (ts.isPropertyAccessExpression(head) || ts.isElementAccessExpression(head)) head = head.expression

    let target: ts.CallExpression | undefined
    if (ts.isCallExpression(head)) target = head
    else if (ts.isIdentifier(head)) target = findVarInit(findEnclosingFn(token), head.text)

    if (!target) { skipped++; continue }
    const key = `${target.getStart()}-${target.getEnd()}`
    if (seen.has(key)) continue
    seen.add(key)
    edits.push({ start: target.getStart(), end: target.getEnd(), text: `(await ${target.getText(sf)})` })
  }
  if (!edits.length) return 0
  edits.sort((a, b) => b.start - a.start)
  let out = src
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end)
  writeFileSync(file, out)
  return edits.length
}

const RUNTIME = [
  'server/routes/social.ts', 'server/routes/account.ts', 'server/routes/auth.ts',
  'server/routes/admin.ts', 'server/routes/collections.ts', 'server/routes/reviews.ts',
  'server/routes/library.ts', 'server/routes/chat.ts', 'server/routes/recommendations.ts',
  'server/routes/stats.ts', 'server/routes/aiPersonal.ts',
  'server/lib/rbac.ts', 'server/lib/session.ts', 'server/lib/audit.ts',
  'server/lib/playerProfile.ts', 'server/lib/gameProfile.ts', 'server/lib/requirements.ts',
  'server/middleware/auth.ts', 'server/index.ts',
]

for (let round = 1; round <= 6; round++) {
  const errs = parseErrors(typecheck())
  if (!errs.length) { console.log(`第 ${round} 轮：没有 Promise 级联错误，收敛`); break }
  const byFile = new Map<string, Err[]>()
  for (const e of errs) {
    if (!byFile.has(e.file)) byFile.set(e.file, [])
    byFile.get(e.file)!.push(e)
  }
  let total = 0
  for (const [file, list] of byFile) {
    const SCOPES = process.env.INCLUDE_SCRIPTS === '1' ? [...RUNTIME, 'scripts/evalAI.ts', 'scripts/evalConstraints.ts'] : RUNTIME
  if (!SCOPES.includes(file)) continue
    total += fixFile(file, list)
  }
  console.log(`第 ${round} 轮：修 ${total} 处`)
  if (!total) { console.log('无可修错误，剩余：'); 
    for (const e of errs.slice(0, 8)) console.log(`  ${e.file}(${e.line},${e.col}) ${e.code} ${e.msg.slice(0, 90)}`)
    break }
  // async 化新产生的 await
  execSync(`/d/node.js/node.exe --experimental-strip-types --no-warnings scripts/codemodAsyncOnce.ts ${(process.env.INCLUDE_SCRIPTS === '1' ? [...RUNTIME, 'scripts/evalAI.ts', 'scripts/evalConstraints.ts'] : RUNTIME).join(' ')}`, { stdio: 'inherit' })
}
