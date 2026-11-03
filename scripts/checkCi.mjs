// 查最近一次 CI 运行状态（公开仓库，无需鉴权）
for (const k of Object.keys(process.env)) if (/proxy/i.test(k)) delete process.env[k]

async function main() {
  const r = await fetch('https://api.github.com/repos/KeepNever/gamevibe/actions/runs?per_page=3').then((x) => x.json())
  for (const run of r.workflow_runs ?? []) {
    console.log(`${run.head_sha.slice(0, 7)} | ${run.status} | ${run.conclusion ?? '进行中'} | ${run.html_url}`)
  }
}
main().catch((e) => {
  console.log('ERR', e.message)
  process.exitCode = 1
})
