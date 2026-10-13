// 验证：appdetails 批量拉取 + capsule_imagev5 是否为竖版封面
const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126' }

const ids = [4019220, 3699590, 4544820, 1390270, 620980, 1172710, 2909400]
const q = ids.map((i) => `appids=${i}`).join('&')
const r = await fetch(`https://store.steampowered.com/api/appdetails?appids=${q}&l=en`, {
  headers: UA,
  signal: AbortSignal.timeout(25000),
})
console.log('批量 status', r.status, 'ids', ids.length)
const j = await r.json()
for (const k of Object.keys(j)) {
  const d = j[k]?.data
  if (!d) {
    console.log(' ', k, '无数据')
    continue
  }
  const v5 = d.capsule_imagev5 || ''
  console.log(' ', k, (d.name || '').slice(0, 24).padEnd(26), v5)
  if (v5) {
    const rr = await fetch(v5, { headers: UA, signal: AbortSignal.timeout(15000) })
    const ct = rr.headers.get('content-type') || ''
    const len = Number(rr.headers.get('content-length') || 0)
    await rr.body?.cancel().catch(() => {})
    console.log('        下载验证 ->', rr.status, ct.split(';')[0], Math.round(len / 1024) + 'KB')
  }
}
