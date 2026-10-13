// 从官方站点抓取候选取景图（KV / 主视觉），供 dc_heping-jingying 与 dc_lol 本地烘焙
const UA = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
}

async function scan(label, page) {
  console.log(`\n===== ${label}  ${page} =====`)
  try {
    const r = await fetch(page, { headers: UA, signal: AbortSignal.timeout(20000) })
    const html = await r.text()
    console.log(`  status ${r.status}, ${html.length}B`)
    // 收集 img src / background-image / link rel=apple-touch-icon
    const urls = new Set()
    for (const m of html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) urls.add(m[1])
    for (const m of html.matchAll(/url\((["']?)([^"')]+)\1\)/gi)) urls.add(m[2])
    for (const m of html.matchAll(/<link[^>]+href=["']([^"']+\.(?:png|jpg|jpeg|webp))["']/gi)) urls.add(m[1])
    const list = [...urls].filter((u) => /\.(png|jpe?g|webp)(\?|$)/i.test(u) || /images?\//i.test(u))
    console.log(`  候选图片 ${list.length} 个，前 25：`)
    for (const u of list.slice(0, 25)) {
      const abs = u.startsWith('//') ? 'https:' + u : u.startsWith('/') ? new URL(page).origin + u : u
      console.log('   ', abs.slice(0, 150))
    }
  } catch (e) {
    console.log(`  ❌ ${(e?.cause?.code || e.message)}`)
  }
}

await scan('和平精英官网', 'https://gp.qq.com/main.shtml')
await scan('LoL 国服官网', 'https://lol.qq.com/main.shtml')
await scan('LoL 官网 index', 'https://lol.qq.com/')
