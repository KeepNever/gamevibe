// 探测：① 剩余 4 条游戏的 og:image 兜底源 ② Xbox/PS 列表级接口的真实字段结构
const UA = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
}
const T = 20000

async function og(label, page) {
  try {
    const r = await fetch(page, { headers: UA, signal: AbortSignal.timeout(T) })
    const t = await r.text()
    const m =
      t.match(/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)/i) ||
      t.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image/i) ||
      t.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)/i)
    console.log(`${r.ok ? '✅' : '⚠️ '} ${label}  ${r.status}  og: ${m ? m[1] : '(未找到)'}`)
    return m?.[1]
  } catch (e) {
    console.log(`❌ ${label}  ${(e?.cause?.code || e.message)}`)
    return null
  }
}

async function json(label, url) {
  try {
    const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(T) })
    const j = await r.json()
    console.log(`\n===== ${label} (${r.status}) =====`)
    console.log('  top keys:', Object.keys(j).join(','))
    // 打印可能承载列表的字段样本
    for (const k of ['links', 'Products', 'response', 'data', 'items', 'cache']) {
      if (j[k]) {
        const v = j[k]
        if (Array.isArray(v)) {
          console.log(`  ${k}: array(${v.length}) sample=`, JSON.stringify(v[0])?.slice(0, 400))
        } else if (Array.isArray(v.docs)) {
          console.log(`  ${k}.docs(${v.docs.length}) sample=`, JSON.stringify(v.docs[0])?.slice(0, 500))
        } else if (typeof v === 'object') {
          console.log(`  ${k}: {${Object.keys(v).slice(0, 12).join(',')}}`)
          for (const kk of ['products', 'links', 'productsList']) {
            if (Array.isArray(v[kk])) console.log(`    ${k}.${kk}: array(${v[kk].length}) sample=`, JSON.stringify(v[kk][0])?.slice(0, 400))
          }
        }
      }
    }
    return j
  } catch (e) {
    console.log(`❌ ${label}  ${(e?.cause?.code || e.message)}`)
    return null
  }
}

console.log('===== 剩余 4 条：官网 og:image =====')
await og('geoguessr.com', 'https://www.geoguessr.com/')
await og('agar.io', 'https://agar.io/')
await og('gp.qq.com 和平精英', 'https://gp.qq.com/')
await og('pubgmobile', 'https://www.pubgmobile.com/en-US/home.shtml')

console.log('\n===== 任天堂 Europe 列表级：字段结构 =====')
const nin = await json(
  'nintendo q=* sort release desc',
  'https://search.nintendo-europe.com/en/select?q=*&fq=type%3AGAME&sort=dates_released_dts%20desc&rows=5&wt=json&fl=title,image_url_sq_s,image_url,image_url_h2x1_s,nsuid,dates_released_dts,price,players',
)
if (nin?.response?.docs) console.log('  docs[0]=', JSON.stringify(nin.response.docs[0], null, 1).slice(0, 900))

console.log('\n===== PS Store 列表级：字段结构 =====')
const ps = await json(
  'ps container ALLGAMES',
  'https://store.playstation.com/store/api/chihiro/00_09_000/container/US/en/19/STORE-MSF77008-ALLGAMES/0?size=10',
)
if (ps) console.log('  full sample=', JSON.stringify(ps, null, 1).slice(0, 2000))

console.log('\n===== Xbox displaycatalog：字段结构 =====')
const xb = await json(
  'xbox search halo',
  'https://displaycatalog.mp.microsoft.com/v7.0/productFamilies/Games/products?market=US&languages=en-US&query=halo&fieldsTemplate=details&$top=3',
)
if (xb?.Products) console.log('  product[0]=', JSON.stringify(xb.Products[0], null, 1).slice(0, 1500))
