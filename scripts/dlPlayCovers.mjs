// 下载 Play Store 直链封面到本地临时目录（Python 走代理对该主机 502，Node 正常）
import { mkdirSync, writeFileSync } from 'node:fs'

const TARGETS = [
  [
    'dc_agar',
    'https://play-lh.googleusercontent.com/3bTpJObZrCS-xzdXY7DcfmxK4nrF-FW5h4h7BAcmp0m0WZUG9488VfcNXwOevDf4cougRV9eFS4FCQ4QCoAQ=s0-br30',
  ],
  [
    'dc_geoguessr',
    'https://play-lh.googleusercontent.com/RfyvTv9Cg27F_b3eb2FcL-anYiM0A0rwfjY2inIcbHBINEiEMMOzrj08NYxRRjwDB4GM95Uj8SfKccwD36owOQ=s0-br30',
  ],
]

mkdirSync('.cover-tmp', { recursive: true })
for (const [id, url] of TARGETS) {
  try {
    const res = await fetch(url, {
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) {
      console.log(`❌ ${id} HTTP ${res.status}`)
      continue
    }
    const buf = Buffer.from(await res.arrayBuffer())
    writeFileSync(`.cover-tmp/${id}.png`, buf)
    console.log(`✅ ${id}  ${Math.round(buf.length / 1024)}KB -> .cover-tmp/${id}.png`)
  } catch (e) {
    console.log(`❌ ${id} ${e?.cause?.code || e.message}`)
  }
}
