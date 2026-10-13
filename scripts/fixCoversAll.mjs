// 全量封面解析：为 discoverCatalog 的每一条找出「真实可用」的封面
//
// 解析优先级（都实测 200 且体积达标才采用）：
//   1. Steam 官方搜索 → appid → library_600x900_2x.jpg（竖版高清，首选）
//   2. 任天堂欧洲搜索接口 → 官方封面（Switch 游戏）
//   3. iTunes 搜索接口 → artworkUrl512（移动端游戏，含国区回退）
//   4. 站点 og:image（网页游戏）
//   5. 保留原值（若实测 200）
//   6. 置空 → 前端渲染统一设计占位卡（拿不到真图就诚实留空，不再拿 favicon 充数）
//
// 用法：
//   node scripts/fixCoversAll.mjs            # 只出方案（.cover-plan.json + 报告）
//   node scripts/fixCoversAll.mjs --apply    # 采纳方案，回写两份目录文件

import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const SERVER_CATALOG = `${ROOT}server/data/discoverCatalog.ts`
const WEB_FALLBACK = `${ROOT}src/data/discoverFallback.json`
const PLAN_FILE = `${ROOT}.cover-plan.json`
const CACHE_FILE = `${ROOT}.cover-cache.json`

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) GameVibe/1.0' }
const APPLY = process.argv.includes('--apply')

// ── 解析策略里用到的「可信图床」白名单：只有这些主机才认，避免又引入垃圾图源 ──
const GOOD_HOSTS = [
  'cdn.cloudflare.steamstatic.com',
  'cdn.akamai.steamstatic.com',
  'shared.steamstatic.com',
  'www.nintendo.com',
  'assets.nintendo.eu',
  'is1-ssl.mzstatic.com',
  'store-images.s-microsoft.com',
  'image.api.playstation.com',
  'vulcan.dl.playstation.net',
  'play-lh.googleusercontent.com',
]
const SPECIAL_HOSTS = [
  'slither.io', 'assets.krunker.io', 'www.nytimes.com', 'play2048.co',
  'skribbl.io', 'www.shellshock.io', 'framerusercontent.com',
]

// 明显不是本体、而是衍生作 / DLC / 混音 / 山寨的匹配，一律拒绝。
// 依据：实测中 Astro Bot 匹配到《麻布仔》DLC、Alan Wake 2 匹配到节拍光剑混音曲、
//       League of Legends 匹配到衍生作《CONVERGENCE》、Wordle 匹配到山寨《Wordle 5》、
//       巫师3 匹配到《Songs of the Past》、守望先锋2 匹配到《Starter Pack》。
const BAD_MATCH = /convergence|mixtape|sackboy|soundtrack|songs of the past|wild rift|starter pack|battle pass|season pass|digital deluxe|deluxe edition|costume|expansion|artbook|art book|\bdemo\b|\bbeta\b|playtest|\bdlc\b|试玩|原声/i

// 搜索用别名：条目名直接搜不到（中文名 / 官方命名差异）时改用这个关键词。
// ⚠️ 只加「确实搜不到」的：给 Honor of Kings 加中文别名反而会漏掉（美区返回的就是英文名）
const ALIAS = {
  'Game for Peace': '和平精英',
  'Pokémon Scarlet': 'Pokemon Scarlet',
  'Baldur’s Gate 3': 'Baldurs Gate 3',
}

// 人工复核后的定向覆盖（仅剩确实无源可取的）。空字符串 = 走设计占位卡。
// 拿不到真图就诚实留空，不拿别人的图凑——那正是这次要修的病根。
const OVERRIDES = {
  'dc_valorant': '/covers/valorant.jpg', // 精选库已有本地封面，直接复用
  'dc_lol': '',                          // 英雄联盟不在 Steam 上；移动版 Wild Rift 是另一款游戏
}

// PS Store 封面本地化清单（由 scripts/resolvePsCovers.py 生成）：
// PS 原始封面是 1–3MB 的 PNG，已在构建期裁成 600px JPEG 放进 public/covers/。
const PS_MANIFEST_FILE = `${ROOT}.ps-covers.json`
const PS_LOCAL = existsSync(PS_MANIFEST_FILE) ? JSON.parse(readFileSync(PS_MANIFEST_FILE, 'utf8')) : {}

// 网页游戏的封面以站点 og:image 为准，不去 Steam 搜（否则 "2048" "Wordle" 会撞上山寨版）
const WEB_IDS = new Set([
  'dc_slither', 'dc_krunker', 'dc_wordle', 'dc_2048', 'dc_skribbl',
  'dc_shell-shockers', 'dc_paper-io', 'dc_geoguessr', 'dc_agar',
])

const cache = existsSync(CACHE_FILE) ? JSON.parse(readFileSync(CACHE_FILE, 'utf8')) : {}
// 只持久化「成功」结果：瞬时失败（限流/超时）若被写进磁盘，下次重跑会误以为该源没有此游戏
function saveCache() { writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 1)) }

// ── 解析目录条目（行级，保留原缩进与字段顺序）──
const src = readFileSync(SERVER_CATALOG, 'utf8')
const lines = src.split('\n')
const LINE_RE = /^(\s*\{ id: '(dc_[^']+)',\s*name: '((?:[^'\\]|\\.)*)',\s*coverUrl: ')([^']*)('\s*,)/
const entries = []
lines.forEach((ln, i) => {
  const m = ln.match(LINE_RE)
  if (!m) return
  const pm = ln.match(/platforms: \[([^\]]*)\]/)
  entries.push({
    line: i,
    id: m[2],
    name: m[3].replace(/\\'/g, "'"),
    cover: m[4],
    prefix: m[1],
    suffix: m[5],
    platforms: pm ? pm[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')) : [],
  })
})
console.log(`解析到 ${entries.length} 条目录条目`)

// ── 工具 ──
async function checkImg(url, minKB = 8) {
  if (!url) return { ok: false, reason: '空' }
  // 本地路径（/covers/...）走文件校验——重复运行时原值可能已经是本地封面
  if (url.startsWith('/')) return checkImgLocal(url, Math.min(minKB, 5))
  for (const method of ['HEAD', 'GET']) {
    try {
      const res = await fetch(url, { method, headers: UA, signal: AbortSignal.timeout(12000) })
      const ct = res.headers.get('content-type') || ''
      const len = res.headers.get('content-length')
      const kb = len ? Math.round(Number(len) / 1024) : null
      if (method === 'GET') await res.body?.cancel().catch(() => {})
      if (res.status !== 200) { if (method === 'GET') return { ok: false, reason: `HTTP ${res.status}` }; continue }
      if (!ct.startsWith('image/')) return { ok: false, reason: `非图片 ${ct}` }
      if (kb !== null && kb < minKB) return { ok: false, reason: `过小 ${kb}KB` }
      return { ok: true, kb, ct }
    } catch (e) {
      if (method === 'GET') return { ok: false, reason: (e?.cause?.code || e?.message || 'ERR').toString().slice(0, 40) }
    }
  }
  return { ok: false, reason: '未知' }
}

function norm(s) {
  return (s || '').toLowerCase().replace(/[™®:’'!.\-–—]/g, '').replace(/\s+/g, ' ').trim()
}

// 本地封面（public/ 下的路径）用文件系统校验，别当成远程 URL 去 fetch
async function checkImgLocal(webPath, minKB = 5) {
  try {
    const p = `${ROOT}public${webPath}`
    if (!existsSync(p)) return { ok: false, reason: '文件不存在' }
    const kb = Math.round(statSync(p).size / 1024)
    return kb >= minKB ? { ok: true, kb, ct: 'image/local' } : { ok: false, reason: `过小 ${kb}KB` }
  } catch (e) {
    return { ok: false, reason: (e?.message || 'ERR').toString().slice(0, 40) }
  }
}

// 名称相似度：查询词的主要 token 是否基本都被候选名覆盖
function similar(query, candidate) {
  const q = norm(query), c = norm(candidate)
  if (!q || !c) return false
  if (c.includes(q) || q.includes(c)) return true
  const qt = q.split(' ').filter((t) => t.length > 2)
  if (!qt.length) return true
  const hit = qt.filter((t) => c.includes(t)).length
  return hit / qt.length >= 0.6
}

async function cached(key, fn) {
  if (cache[key] !== undefined && cache[key] !== null) return cache[key]
  const v = await fn()
  // 只缓存成功结果，失败留着重试（见 saveCache 注释）
  if (v) { cache[key] = v; saveCache() }
  return v
}

// ── 数据源 1：Steam 官方搜索 ──
async function steamLookup(name) {
  const term = ALIAS[name] || name
  return cached(`steam:${name}`, async () => {
    try {
      const res = await fetch(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&cc=us&l=en`, {
        headers: UA, signal: AbortSignal.timeout(12000),
      })
      if (!res.ok) return null
      const j = await res.json()
      const items = (j.items || [])
        .filter((it) => similar(name, it.name) && !BAD_MATCH.test(it.name))
        // 名字最短的通常才是本体（"The Witcher 3: Wild Hunt - Complete Edition"
        // 会排在 "Wild Hunt — Songs of the Past" 这类 DLC 之前）
        .sort((a, b) => a.name.length - b.name.length)
      // 逐个试，直到有一个真带竖版 600x900 —— 光看名字相似不够，
      // 有些 appid 根本没有竖版资源（实测 Astro Bot 匹配到的那个就没有）
      for (const it of items.slice(0, 4)) {
        const url = `https://cdn.cloudflare.steamstatic.com/steam/apps/${it.id}/library_600x900_2x.jpg`
        const chk = await checkImg(url, 15)
        if (chk.ok) return { appid: String(it.id), url, kb: chk.kb, matched: it.name, kind: 'steam-portrait' }
      }
      return null
    } catch { return null }
  })
}

// ── 数据源 2：任天堂欧洲搜索（免密钥）──
async function nintendoLookup(name) {
  return cached(`nintendo:${name}`, async () => {
    try {
      const url = `https://search.nintendo-europe.com/en/select?q=${encodeURIComponent(name)}&fq=type%3AGAME&rows=5&wt=json&sort=score%20desc`
      const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(15000) })
      if (!res.ok) return null
      const j = await res.json()
      for (const doc of j.response?.docs || []) {
        if (!similar(name, doc.title) || BAD_MATCH.test(doc.title)) continue
        // 优先 Switch 版本的图（实测 Mario Kart 8 会先返回 Wii U 版美术，与 Deluxe 不同）
        const cands = [doc.image_url_sq_s, doc.image_url, doc.image_url_h2x1_s]
          .filter(Boolean)
          .sort((a, b) => (/ns?witch/i.test(b) ? 1 : 0) - (/ns?witch/i.test(a) ? 1 : 0))
        for (const cand of cands) {
          const chk = await checkImg(cand, 10)
          if (chk.ok) return { url: cand, kb: chk.kb, matched: doc.title, kind: 'nintendo' }
        }
      }
      return null
    } catch { return null }
  })
}

// ── 数据源 3：iTunes 搜索（免密钥）──
// ⚠️ 该接口约 20 次/分钟限流，超了会静默返回空结果（不报错，极难发现）。
//    所以：① 只在其它源都没命中时才调用（见 resolveOne）
//          ② 全局串行 + 每次间隔 1.1s
//          ③ 空结果视为疑似限流，等 5s 重试一次
async function itunesLookup(name) {
  const term = ALIAS[name] || name
  return cached(`itunes:${name}`, () => withItunesLock(async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt) await sleep(5000)
      let sawResult = false
      for (const country of ['us', 'cn', 'jp']) {
        try {
          const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=software&limit=5&country=${country}`, {
            headers: UA, signal: AbortSignal.timeout(12000),
          })
          if (!res.ok) continue
          const j = await res.json()
          if ((j.resultCount ?? 0) > 0) sawResult = true
          for (const a of j.results || []) {
            // 别名命中的情况要双向比对：用「和平精英」搜到的结果 trackName 可能是
            // 英文名，只比别名会判成不相似而漏掉
            if (!(similar(term, a.trackName) || similar(name, a.trackName))) continue
            if (BAD_MATCH.test(a.trackName)) continue
            const url = a.artworkUrl512 || a.artworkUrl100
            const chk = await checkImg(url, 10)
            if (chk.ok) return { url, kb: chk.kb, matched: `${a.trackName} @${country}`, kind: 'itunes' }
          }
        } catch { /* 换下一个区 */ }
      }
      // 三个区都拿不到任何结果 —— 多半是被限流了，退避后重试一次
      if (sawResult || attempt === 1) break
    }
    return null
  }))
}

// iTunes 调用串行化：并发打过去只会更快触发限流
let itunesLock = Promise.resolve()
function withItunesLock(fn) {
  const run = itunesLock.then(fn, fn)
  itunesLock = run.then(() => sleep(1100), () => sleep(1100))
  return run
}

// ── 数据源 4：站点 og:image（网页游戏）──
const WEB_OG = {
  'dc_slither': 'https://slither.io/s/fbthumb5.jpg',
  'dc_krunker': 'https://assets.krunker.io/promo/og.png',
  'dc_wordle': 'https://www.nytimes.com/games-assets/v2/assets/wordle/wordle_og_1200x630.png',
  'dc_2048': 'https://play2048.co/ogImage.jpg',
  'dc_skribbl': 'https://skribbl.io/img/thumbnail.png',
  'dc_shell-shockers': 'https://www.shellshock.io/img/previewImage_shellShockers.webp',
  'dc_paper-io': 'https://framerusercontent.com/images/cKiSnoz2B6fJXIxssj9GA1gg.jpg',
}

// ── 主流程 ──
async function resolveOne(e) {
  // 人工覆盖优先：这类条目自动匹配必错或必空，已在 OVERRIDES 里逐个核实过
  if (Object.prototype.hasOwnProperty.call(OVERRIDES, e.id)) {
    const forced = OVERRIDES[e.id]
    const chk = !forced
      ? { ok: false, reason: '人工置空' }
      : forced.startsWith('/')
        ? await checkImgLocal(forced)
        : await checkImg(forced, 10)
    const origChk = await checkImg(e.cover)
    return {
      ...e,
      newCover: forced && chk.ok ? forced : '',
      chosenKind: forced && chk.ok ? 'override' : 'placeholder',
      matched: '(人工指定)',
      kb: chk.kb ?? null,
      oldStatus: origChk.ok ? `200 ${origChk.kb}KB` : `坏(${origChk.reason})`,
      candidates: [],
    }
  }

  const candidates = []

  // 构建期已本地化的封面（PS 独占等）优先级最高：不依赖出网、体积可控
  if (PS_LOCAL[e.id]) {
    const chk = await checkImgLocal(PS_LOCAL[e.id])
    if (chk.ok) {
      const origChk0 = await checkImg(e.cover)
      return {
        ...e,
        newCover: PS_LOCAL[e.id],
        chosenKind: 'local-baked',
        matched: '(构建期本地化)',
        kb: chk.kb,
        oldStatus: origChk0.ok ? `200 ${origChk0.kb}KB` : `坏(${origChk0.reason})`,
        candidates: [],
      }
    }
  }

  // Steam 优先（PC 及绝大多数 Xbox/PS 移植版）；网页游戏跳过，避免撞上山寨版
  if (!WEB_IDS.has(e.id)) {
    const steam = await steamLookup(e.name)
    if (steam) candidates.push({ ...steam, confidence: 'high' })
  }

  // Switch 游戏：任天堂官方
  if (e.platforms.includes('Nintendo Switch')) {
    const nin = await nintendoLookup(e.name)
    if (nin) candidates.push({ ...nin, confidence: 'high' })
  }

  // 网页游戏：站点 og:image
  if (WEB_OG[e.id]) {
    const chk = await checkImg(WEB_OG[e.id], 10)
    if (chk.ok) candidates.push({ url: WEB_OG[e.id], kb: chk.kb, matched: '(og:image)', kind: 'og', confidence: 'medium' })
  }

  // iTunes 应用图标：只在前面都没命中时才试（限流原因见 itunesLookup 注释）
  if (!candidates.length) {
    const it = await itunesLookup(e.name)
    if (it) candidates.push({ ...it, confidence: 'high' })
  }

  // 原值兜底（实测 200 且主机可信才留）
  const origChk = await checkImg(e.cover)
  if (origChk.ok) {
    const host = safeHost(e.cover)
    if (!candidates.length && (GOOD_HOSTS.includes(host) || SPECIAL_HOSTS.includes(host))) {
      candidates.push({ url: e.cover, kb: origChk.kb, matched: '(原值)', kind: 'keep', confidence: 'medium' })
    }
  }

  // 选最优：按来源可信度排序，同级比体积
  const order = { 'steam-portrait': 0, nintendo: 1, itunes: 2, og: 3, keep: 4 }
  candidates.sort((a, b) => {
    const d = (order[a.kind] ?? 9) - (order[b.kind] ?? 9)
    return d !== 0 ? d : (b.kb || 0) - (a.kb || 0)
  })

  const best = candidates[0]
  return {
    ...e,
    newCover: best ? best.url : '',
    chosenKind: best ? best.kind : 'placeholder',
    matched: best?.matched || '',
    kb: best?.kb ?? null,
    oldStatus: origChk.ok ? `200 ${origChk.kb}KB` : `坏(${origChk.reason})`,
    candidates: candidates.map((c) => `${c.kind} ${c.kb}KB`),
  }
}

function safeHost(u) { try { return new URL(u).host } catch { return '' } }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function mapLimit(items, limit, fn) {
  const out = []
  let i = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]) }
  }))
  return out
}

const plan = await mapLimit(entries, 6, resolveOne)

// ── 报告 ──
const byKind = {}
for (const p of plan) byKind[p.chosenKind] = (byKind[p.chosenKind] || 0) + 1
console.log('\n=== 来源分布 ===')
for (const [k, v] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(3)}  ${k}`)

const stillBad = plan.filter((p) => p.chosenKind === 'placeholder')
console.log(`\n=== 仍无真实封面（将走设计占位卡）：${stillBad.length} ===`)
for (const p of stillBad) console.log(`  ${p.id.padEnd(30)} ${p.name.slice(0, 36)}  [原值 ${p.oldStatus}]`)

const changed = plan.filter((p) => p.newCover !== p.cover)
console.log(`\n=== 封面变更：${changed.length} / ${plan.length} ===`)
for (const p of changed.slice(0, 70)) {
  console.log(`  ${p.id.padEnd(30)} ${p.name.slice(0, 30).padEnd(32)} ${p.chosenKind.padEnd(15)} ${p.kb ?? ''}KB`)
  console.log(`      旧 ${p.oldStatus}  →  ${p.newCover.slice(0, 100) || '(置空)'}`)
}

writeFileSync(PLAN_FILE, JSON.stringify(plan, null, 1))
console.log(`\n方案已写入 ${PLAN_FILE}`)

// ── 回写 ──
if (APPLY) {
  let applied = 0
  for (const p of plan) {
    if (p.newCover === p.cover) continue
    lines[p.line] = lines[p.line].replace(LINE_RE, (_m, pre, id, name, _old, suf) => `${pre}${p.newCover}${suf}`)
    applied++
  }
  writeFileSync(SERVER_CATALOG, lines.join('\n'))
  console.log(`已回写后端目录：${applied} 行`)

  // 前端离线兜底 JSON：同步 coverUrl
  const fb = JSON.parse(readFileSync(WEB_FALLBACK, 'utf8'))
  const byId = new Map(plan.map((p) => [p.id, p.newCover]))
  let n = 0
  for (const g of fb) {
    if (byId.has(g.id) && byId.get(g.id) !== g.coverUrl) { g.coverUrl = byId.get(g.id); n++ }
  }
  writeFileSync(WEB_FALLBACK, JSON.stringify(fb))
  console.log(`已同步前端兜底 JSON：${n} 条`)
} else {
  console.log('（未加 --apply，源文件未改动）')
}
