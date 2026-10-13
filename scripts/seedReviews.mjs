// 给精选库 16 款游戏批量 seed 真实感社区评论。
// 直接写 sqlite（绕过 /api 注册限流），幂等安全。
// 用法：node scripts/seedReviews.mjs   （需 Node >= 22，可用 node:sqlite）
//
// 行为：
//   1) 确保 12 个种子用户存在（scrypt 哈希密码 'seedpass1234'），display_name = 用户名
//   2) 对 16 款精选游戏：先删该 game_id 已有评论，再插入 4 条（作者轮转、时间分布在近 60 天）

import { DatabaseSync } from 'node:sqlite'
import { scryptSync, randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dbPath = join(__dirname, '..', 'server', 'db', 'data', 'gamevibe.db')

const PASS = 'seedpass1234'
const DAY = 24 * 3600 * 1000

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return { hash, salt }
}

const db = new DatabaseSync(dbPath)
db.exec('PRAGMA journal_mode = WAL;')
db.exec('PRAGMA foreign_keys = ON;')

// ---- 种子用户 ----
const users = [
  '老白不白', '阿坤Kun', '柚子Yuzu', '夜行猫', '咸鱼翻身王',
  '糖糖不吃糖', '硬核老哥', '菜鸟一枚', '氪金战士', '云玩家小李',
  '手柄握紧', '通宵打工人',
]

const userIdByUsername = {}
for (const name of users) {
  const email = `${name}@seed.local`
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(name)
  if (existing) {
    db.prepare('UPDATE users SET email = ?, display_name = ? WHERE id = ?').run(email, name, existing.id)
    userIdByUsername[name] = existing.id
    continue
  }
  const id = randomBytes(12).toString('hex')
  const { hash, salt } = hashPassword(PASS)
  db.prepare(
    `INSERT INTO users (id, username, email, password_hash, salt, display_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, name, email, hash, salt, name, Date.now() - 90 * DAY)
  userIdByUsername[name] = id
}
console.log(`✓ 种子用户就绪：${Object.keys(userIdByUsername).length} 个`)

// ---- 评论数据（每款 4 条） ----
const reviews = {
  'elden-ring': [
    { r: 5, c: '交界地真的太自由了，每个角落都有惊喜，就是碎星将军把我劝退了三周' },
    { r: 4, c: '开放世界魂类天花板，画面和战斗都顶，PC 优化一般般' },
    { r: 5, c: '女武神战打了一百多次终于过了，那一刻真泪目' },
    { r: 3, c: '难度确实劝退，但不得不承认是神作，慢慢磨也能通关' },
  ],
  'baldurs-gate-3': [
    { r: 5, c: '拉瑞安把 D&D 活生生做成了游戏，每个选择都有回响' },
    { r: 5, c: '影心和卡菈克的支线写得太好了，玩完像谈了场恋爱' },
    { r: 4, c: '第一章开头就惊艳，自由度爆炸，就是后期有点肝' },
    { r: 5, c: '年度最佳没跑了，回合制策略也能这么上头' },
  ],
  'hades-2': [
    { r: 5, c: '黄蜂女手感比老爸还丝滑，Supergiant 永远的神' },
    { r: 4, c: '早期访问已经很完整了，咒语系统比一代更花哨' },
    { r: 5, c: '音乐一响浑身鸡皮疙瘩，每次死亡都想再来一把' },
    { r: 4, c: '剧情铺得比一代深，等正式版' },
  ],
  'palworld': [
    { r: 4, c: '宝可梦加枪，缝合怪但意外地上头' },
    { r: 3, c: '前期很欢乐，后期内容有点重复，坐等更新' },
    { r: 5, c: '和朋友一起建基地抓帕鲁，笑得肚子疼' },
    { r: 4, c: '涉嫌缝合但好玩就完事了，打工帕鲁真香' },
  ],
  'cyberpunk-2077': [
    { r: 5, c: '2.0 和往日之影之后彻底翻身，夜之城现在美到窒息' },
    { r: 4, c: '剧情演出顶级，强尼银手太有魅力了' },
    { r: 3, c: '首发那会儿bug多被劝退，现在回来补票真香' },
    { r: 4, c: '赛博朋克氛围拉满，开车逛夜城就是享受' },
  ],
  'stardew-valley': [
    { r: 5, c: '下地种田钓钓鱼，一玩就是一整晚，治愈系天花板' },
    { r: 5, c: '星露谷是我唯一能坚持上百小时的游戏' },
    { r: 4, c: '联机一起开农场太快乐了，就是容易吵架分地' },
    { r: 5, c: '一个人做的游戏能这么丰富，ConcernedApe 牛' },
  ],
  'lies-of-p': [
    { r: 4, c: '匹诺曹题材的魂类，把手感调得比很多大厂都好' },
    { r: 5, c: 'BOSS 设计惊艳，完美格挡的爽感拉满' },
    { r: 4, c: '剧情比表面深，结局看完沉默了' },
    { r: 3, c: '难度不低，但引导比魂系友好些' },
  ],
  'valorant': [
    { r: 4, c: '战术射击里手感最跟手的，技能博弈很烧脑' },
    { r: 3, c: '匹配机制有时候挺搞心态的，上分难' },
    { r: 4, c: '和队友开黑语音报点才是正确打开方式' },
    { r: 5, c: '练会一个 agent 就停不下来，电竞氛围拉满' },
  ],
  'dead-cells': [
    { r: 5, c: '手感天花板 Roguelike，每次死亡都怪自己菜' },
    { r: 4, c: '武器流派多到爆炸，每把体验都不一样' },
    { r: 5, c: '王手被我磨了二十次，通关那刻封神' },
    { r: 4, c: '像素风但打击感比很多 3A 都强' },
  ],
  'hollow-knight': [
    { r: 5, c: '圣巢是我心中最好的银河恶魔城，没有之一' },
    { r: 5, c: '辐光打完直接封神，配乐绝了' },
    { r: 4, c: '地图设计精妙，迷路也是一种浪漫' },
    { r: 5, c: '寂静之巅那段氛围感拉满，玩哭过' },
  ],
  'cs2': [
    { r: 4, c: '从 CSGO 过渡过来，烟雾弹物理改得很真实' },
    { r: 3, c: '匹配偶尔遇到挂，希望 V 社再严一点' },
    { r: 5, c: '竞技的紧张感还是那个味，二十年老游戏了' },
    { r: 4, c: '练枪位和道具位就是摸鱼上班的动力' },
  ],
  'dave-the-diver': [
    { r: 5, c: '下海冒险上岸做寿司，这种反差萌太可爱了' },
    { r: 4, c: '玩法缝合但意外和谐，音乐也上头' },
    { r: 4, c: '巨鲸那段演出太美，剧情有点东西' },
    { r: 5, c: '小众神作，安利给所有人' },
  ],
  'disco-elysium': [
    { r: 5, c: '这是我玩过最有文学性的游戏，没有战斗只有思考' },
    { r: 5, c: '每个技能都在你脑子里吵架，太疯了也太妙了' },
    { r: 4, c: '政治哲学塞进侦探故事，文本量爆炸但值得' },
    { r: 5, c: '玩完沉默了很久，年度神作无疑' },
  ],
  'monster-hunter-wilds': [
    { r: 4, c: '猎宠系统很新鲜，生态演出比历代都宏大' },
    { r: 5, c: '和兄弟联机刷怪，一个怪打半小时超爽' },
    { r: 3, c: '首发优化一般，等补丁再战' },
    { r: 4, c: '武器动作手感一如既往地顶' },
  ],
  'vampire-survivors': [
    { r: 5, c: '割草爽到飞起，一块钱都不用花就玩了几百小时' },
    { r: 4, c: '越死越强，build 成型那一刻全场清屏' },
    { r: 4, c: '像素但上头，地铁通勤神器' },
    { r: 5, c: '极简玩法做出极致爽感，独立之光' },
  ],
  'god-of-war': [
    { r: 5, c: '奎托斯和阿特柔斯的父子情，比战斗还打动我' },
    { r: 5, c: '一镜到底的演出到现在想起来都起鸡皮疙瘩' },
    { r: 4, c: '利维坦之斧手感爆炸，扔出去拉回来太爽' },
    { r: 5, c: '北欧神话开篇即巅峰，等续作等到花儿谢' },
  ],
}

const userNames = Object.keys(userIdByUsername)
const delStmt = db.prepare('DELETE FROM reviews WHERE game_id = ?')
const insStmt = db.prepare(
  `INSERT INTO reviews (id, user_id, game_id, rating, content, created_at)
   VALUES (?, ?, ?, ?, ?, ?)`
)

const now = Date.now()
let total = 0
for (const [gameId, list] of Object.entries(reviews)) {
  delStmt.run(gameId)
  list.forEach((rv, i) => {
    const uname = userNames[(i + Math.floor(Math.random() * userNames.length)) % userNames.length]
    const uid = userIdByUsername[uname]
    // 时间分布：近 60 天内，越往后越新
    const createdAt = now - Math.floor((60 - i * 12 - Math.random() * 6) * DAY)
    insStmt.run(randomBytes(12).toString('hex'), uid, gameId, rv.r, rv.c, createdAt)
    total++
  })
  console.log(`  ✓ ${gameId}: ${list.length} 条`)
}
console.log(`\n完成，共 seed ${total} 条评论（覆盖 ${Object.keys(reviews).length} 款游戏）。`)
