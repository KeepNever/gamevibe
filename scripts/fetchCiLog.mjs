// 拉取指定 run 的完整日志，提取 ❌ 断言行（需要 repo 权限的 token）
import { readFileSync, writeFileSync } from 'node:fs'

const token = readFileSync('D:/GameVibe/.ghpat', 'utf8').trim()
const runId = process.argv[2]

const jobs = (
  await (
    await fetch(`https://api.github.com/repos/KeepNever/gamevibe/actions/runs/${runId}/jobs`, {
      headers: { Authorization: `token ${token}` },
    })
  ).json()
).jobs

const parts = []
for (const job of jobs) {
  const res = await fetch(job.logs_url, { headers: { Authorization: `token ${token}` } })
  if (res.ok) parts.push(await res.text())
  else parts.push(`[log HTTP ${res.status}]`)
}
writeFileSync('D:/GameVibe/ci-full.log', parts.join('\n\n'))
console.log('log bytes:', parts.join('').length)
