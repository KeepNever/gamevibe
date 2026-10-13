// 社交系统演示数据：
//   1) 确保 12 个种子用户存在（与 seedReviews.mjs 共用，密码 seedpass1234）
//   2) 播种关注关系（糖糖不吃糖 为热门账号，几乎被所有人关注）
//   3) 给部分 demo 用户写入「游戏库」记录，让好友动态流出现「加入库存」类型
// 直接写 sqlite，幂等安全。用法：node scripts/seedSocial.mjs
import { DatabaseSync } from 'node:sqlite'
import { scryptSync, randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dbPath = join(__dirname, '..', 'server', 'db', 'data', 'gamevibe.db')
const db = new DatabaseSync(dbPath)
db.exec('PRAGMA journal_mode = WAL;')
db.exec('PRAGMA foreign_keys = ON;')
// 确保通知表存在（后端未启动时 seed 也能独立运行）
db.exec(`CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, actor_id TEXT, type TEXT NOT NULL,
  ref_id TEXT, read INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE CASCADE
);`)
try { db.exec('ALTER TABLE users ADD COLUMN bio TEXT;') } catch { /* 已存在 */ }

const PASS = 'seedpass1234'
const DAY = 24 * 3600 * 1000
const now = Date.now()

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  return { hash: scryptSync(password, salt, 64).toString('hex'), salt }
}

// ---- 种子用户（username === display_name）----
const users = [
  '老白不白', '阿坤Kun', '柚子Yuzu', '夜行猫', '咸鱼翻身王',
  '糖糖不吃糖', '硬核老哥', '菜鸟一枚', '氪金战士', '云玩家小李',
  '手柄握紧', '通宵打工人',
]
const bios = {
  '老白不白': '白嫖党但从不白给，独立游戏猎人。',
  '阿坤Kun': 'FPS 老枪，排位上分中。',
  '柚子Yuzu': '只玩可爱画风的佛系玩家。',
  '夜行猫': '深夜档选手，钟爱魂系与 rogue。',
  '咸鱼翻身王': '从咸鱼到肝帝，只看性价比。',
  '糖糖不吃糖': '全站最甜玩家，评测又多又毒舌。',
  '硬核老哥': '受苦是我快乐源泉，高难动作狂。',
  '菜鸟一枚': '新手村钉子户，求带飞。',
  '氪金战士': '钱包已空，战力拉满。',
  '云玩家小李': '看别人玩也算玩，云通关大师。',
  '手柄握紧': '手柄党，PC 主机通吃。',
  '通宵打工人': '下班后才是对的时间。',
}
const idByName = {}
for (const name of users) {
  const email = `${name}@seed.local`
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(name)
  if (existing) {
    db.prepare('UPDATE users SET email = ?, display_name = ?, bio = ? WHERE id = ?')
      .run(email, name, bios[name] || null, existing.id)
    idByName[name] = existing.id
    continue
  }
  const id = randomBytes(12).toString('hex')
  const { hash, salt } = hashPassword(PASS)
  db.prepare(
    `INSERT INTO users (id, username, email, password_hash, salt, display_name, bio, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, name, email, hash, salt, name, bios[name] || null, now - 120 * DAY)
  idByName[name] = id
}
console.log(`✓ 种子用户就绪：${Object.keys(idByName).length} 个`)

// ---- 关注关系 ----
const followPlan = {
  '糖糖不吃糖': users.filter((u) => u !== '糖糖不吃糖'),
  '硬核老哥': ['糖糖不吃糖', '菜鸟一枚', '氪金战士', '老白不白'],
  '菜鸟一枚': ['糖糖不吃糖', '硬核老哥', '云玩家小李', '手柄握紧'],
  '氪金战士': ['糖糖不吃糖', '阿坤Kun', '夜行猫', '通宵打工人'],
  '云玩家小李': ['糖糖不吃糖', '柚子Yuzu', '咸鱼翻身王', '菜鸟一枚'],
  '老白不白': ['糖糖不吃糖', '硬核老哥', '手柄握紧'],
  '阿坤Kun': ['糖糖不吃糖', '氪金战士', '夜行猫'],
  '柚子Yuzu': ['糖糖不吃糖', '云玩家小李', '咸鱼翻身王'],
  '夜行猫': ['糖糖不吃糖', '阿坤Kun', '氪金战士', '通宵打工人'],
  '咸鱼翻身王': ['糖糖不吃糖', '柚子Yuzu', '云玩家小李'],
  '手柄握紧': ['糖糖不吃糖', '老白不白', '菜鸟一枚', '硬核老哥'],
  '通宵打工人': ['糖糖不吃糖', '夜行猫', '氪金战士'],
}
const insFollow = db.prepare('INSERT OR IGNORE INTO follows (follower_id, following_id, created_at) VALUES (?, ?, ?)')
const insNotif = db.prepare(
  `INSERT OR IGNORE INTO notifications (id, user_id, actor_id, type, ref_id, read, created_at)
   VALUES (?, ?, ?, 'follow', ?, 0, ?)`
)
let fc = 0
// 重建社交关系：每次 seed 清空旧 follows / notifications，保证通知可复现
db.exec('DELETE FROM follows; DELETE FROM notifications;')
for (const [follower, targets] of Object.entries(followPlan)) {
  const fid = idByName[follower]
  if (!fid) continue
  targets.forEach((t, i) => {
    const tid = idByName[t]
    if (!tid || tid === fid) return
    const res = insFollow.run(fid, tid, now - (40 - i * 3) * DAY)
    if (res.changes) {
      fc++
      insNotif.run(randomBytes(12).toString('hex'), tid, fid, fid, now - (40 - i * 3) * DAY)
    }
  })
}
console.log(`✓ 关注关系 ${fc} 条`)

// ---- 游戏库记录（让动态流出现「加入库存」）----
const nameMap = {
  'elden-ring': '艾尔登法环', 'baldurs-gate-3': '博德之门3', 'hades-2': '黑帝斯2',
  'palworld': '幻兽帕鲁', 'cyberpunk-2077': '赛博朋克2077', 'stardew-valley': '星露谷物语',
  'lies-of-p': '匹诺曹的谎言', 'valorant': '无畏契约', 'dead-cells': '死亡细胞',
  'hollow-knight': '空洞骑士', 'cs2': '反恐精英2', 'dave-the-diver': '潜水员戴夫',
  'disco-elysium': '极乐迪斯科', 'monster-hunter-wilds': '怪物猎人：荒野',
  'vampire-survivors': '吸血鬼幸存者', 'god-of-war': '战神',
}
const libPlan = {
  '硬核老哥': [['elden-ring', 'completed'], ['lies-of-p', 'playing'], ['god-of-war', 'playing']],
  '菜鸟一枚': [['stardew-valley', 'playing'], ['hollow-knight', 'wishlist'], ['vampire-survivors', 'completed']],
  '氪金战士': [['cyberpunk-2077', 'completed'], ['monster-hunter-wilds', 'playing'], ['palworld', 'playing']],
  '云玩家小李': [['disco-elysium', 'completed'], ['baldurs-gate-3', 'playing'], ['dave-the-diver', 'wishlist']],
  '老白不白': [['dead-cells', 'completed'], ['cs2', 'playing']],
  '阿坤Kun': [['valorant', 'playing'], ['cs2', 'completed']],
  '柚子Yuzu': [['hades-2', 'playing'], ['stardew-valley', 'wishlist']],
  '夜行猫': [['hollow-knight', 'completed'], ['elden-ring', 'playing']],
  '咸鱼翻身王': [['palworld', 'playing'], ['vampire-survivors', 'completed']],
  '手柄握紧': [['god-of-war', 'completed'], ['lies-of-p', 'playing']],
  '通宵打工人': [['monster-hunter-wilds', 'playing'], ['cyberpunk-2077', 'wishlist']],
  '糖糖不吃糖': [['baldurs-gate-3', 'completed'], ['disco-elysium', 'playing'], ['dave-the-diver', 'playing']],
}
const insLib = db.prepare(
  `INSERT OR IGNORE INTO user_library (id, user_id, source, external_id, name, cover_url, status, added_at)
   VALUES (?, ?, 'seed', ?, ?, ?, ?, ?)`
)
let lc = 0
for (const [uname, games] of Object.entries(libPlan)) {
  const uid = idByName[uname]
  if (!uid) continue
  games.forEach(([gid, status], i) => {
    const res = insLib.run(
      randomBytes(12).toString('hex'), uid, gid, nameMap[gid] || gid, `/covers/${gid}.png`, status,
      now - (20 - i * 2) * DAY,
    )
    if (res.changes) lc++
  })
}
console.log(`✓ 游戏库记录 ${lc} 条`)
console.log('\n社交演示数据完成。可用 demo 账号登录：<任意种子用户名>@seed.local / 密码 seedpass1234')
