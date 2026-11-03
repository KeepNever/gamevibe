// README 作品集更新：CI 徽章、Turso 架构、社区回归、持久化章节重写（英中两份）
import { readFileSync, writeFileSync } from 'node:fs'

let s = readFileSync('README.md', 'utf8').replace(/\r\n/g, '\n')
const R = (oldStr, newStr, label) => {
  if (!s.includes(oldStr)) throw new Error('未匹配: ' + label)
  s = s.replace(oldStr, newStr)
  console.log('✓', label)
}

// 1) 头部：加 CI 徽章
R(
  '[![SQLite](https://img.shields.io/badge/SQLite-node%3Asqlite-003b57?logo=sqlite&logoColor=white)](https://nodejs.org/api/sqlite.html)',
  `[![CI](https://github.com/KeepNever/gamevibe/actions/workflows/ci.yml/badge.svg)](https://github.com/KeepNever/gamevibe/actions/workflows/ci.yml)
[![SQLite](https://img.shields.io/badge/SQLite-node%3Asqlite%20%7C%20Turso-003b57?logo=sqlite&logoColor=white)](https://nodejs.org/api/sqlite.html)`,
  'CI 徽章 + SQLite→Turso 徽章',
)

// 2) Highlights：更新存储行 + 加安全/CI 两行
R(
  '| 🗄️ **Zero-dependency backend** | Node\'s built-in `node:sqlite`, JWT + scrypt, SSE streaming — no Postgres, no Redis, no ORM |',
  `| 🗄️ **Pluggable storage** | Same SQL against two backends: \`node:sqlite\` locally, **Turso (libSQL) in production** — data survives releases. No Postgres, no Redis, no ORM |
| 🛡️ **Real anti-abuse** | Cloudflare Turnstile on registration (server-side verified, fail-closed), scrypt + httpOnly cookie sessions, RBAC, full audit trail |`,
  'Highlights 存储行',
)
R(
  '| 📦 **One process = whole app** | The same server hosts the API and the built SPA; Dockerfile included |',
  `| 📦 **One process = whole app** | The same server hosts the API and the built SPA; Dockerfile included |
| 🔁 **130+ assertions in CI** | Every push runs typechecks + 3 regression suites (community / account lifecycle / login UI) on a real server with a real browser |`,
  'Highlights CI 行',
)

// 3) EN 持久化章节重写
R(
  `### ⚠️ Persistence on the public demo

The demo instance runs on an ephemeral sandbox where **the deployment uploads the local \`server/db/data/gamevibe.db\` as a snapshot on every release**. Measured behaviour, not a guess: an account registered on the live site is gone after the next deploy (login returns 401), and a marker row inserted into the *local* database appears on the live site after deployment.

Practical consequences:

- The local database is the source of truth. If you want a demo account to survive releases, create it locally and redeploy.
- Accounts created by visitors are valid until the next deployment. Treat the public link as a showcase, not as durable storage.
- For real user data, point the data layer at an external database. A single SQLite file inside the sandbox cannot persist across releases.`,
  `### ✅ Persistence on the public demo (solved)

It used to be broken — and honestly documented here: the sandbox re-uploaded the local SQLite file on every release, wiping visitor accounts. That section existed as a warning; now it's a changelog entry.

The storage layer is a thin facade (\`server/db/driver.ts\`): when \`TURSO_DATABASE_URL\` is configured, every query goes to a hosted **Turso (libSQL)** database over HTTPS; without it, the same SQL runs on the local \`node:sqlite\` file. Migrations, seeds and demo-data bootstrapping stay local-only. The production demo therefore keeps accounts, reviews, follows and notifications across releases.

Latency was the trade-off (one ~200 ms round-trip per query from the sandbox), so the hot paths were reworked: auth resolves session + account state in one JOIN, the recommendation pipeline fetches its inputs in parallel with de-duplicated queries, and batch metadata is TTL-cached. Measured medians: notifications 1068 → ~400 ms, personalized recommendations 1718 → ~830 ms.`,
  'EN 持久化重写',
)

// 4) 质量门槛表：加社区回归 + CI 行
R(
  '| `verifyFirstScreen.mjs` | AI features genuinely visible above the fold, logged out |',
  `| \`verifyFirstScreen.mjs\` | AI features genuinely visible above the fold, logged out |
| \`verifyCommunity.mjs\` | 14 assertions on the community loop: fan gets notified on a followee's review, report → moderator delete → author notified → audit trail |`,
  'EN 质量门槛',
)
R(
  'Type safety: `npm run server:typecheck` plus `vue-tsc` during build, both clean.',
  `Type safety: \`npm run server:typecheck\` plus \`vue-tsc\` during build, both clean.

All of the above run automatically on every push via GitHub Actions (typechecks → build → boot the server on local SQLite → run the API suites → run the browser suite on bundled Chromium).`,
  'EN CI 说明',
)

// 5) CN：数据持久化章节重写
R(
  `### ⚠️ 线上演示站的数据不持久

演示实例跑在临时沙箱里，**每次发布都会把本地的 \`server/db/data/gamevibe.db\` 作为快照上传覆盖**。这是实测结论，不是推测：线上注册的账号在下次发布后登录返回 401（已消失），而在**本地**库里插入的标记行在发布后出现在了线上。

所以：

- **本地数据库才是母版**。想让某个演示账号长期存在，就在本地建好再发布。
- 访客注册的账号只在下次发布前有效。公开链接当展示用，别当正式存储。
- 要承载真实用户数据，得把数据层换成外部数据库——沙箱里的单个 SQLite 文件扛不过一次发布。`,
  `### ✅ 线上演示站的数据持久（已解决）

这个问题曾经真实存在，也曾在这里如实挂过警告：沙箱每次发布都会用本地 SQLite 文件覆盖线上，访客注册的账号发布即蒸发。

现在的数据层是一个薄门面（\`server/db/driver.ts\`）：配置了 \`TURSO_DATABASE_URL\` 时，所有查询走托管 **Turso（libSQL）** 数据库（HTTPS）；不配置时同一套 SQL 落在本地 \`node:sqlite\` 文件上。迁移、种子和演示数据灌装只在本地执行。生产演示站的账号、评论、关注与通知现在可以跨发布保留。

代价是延迟（沙箱到库每次查询一个 ~200ms 往返），所以热点路径做了治理：鉴权一次 JOIN 拿齐会话与账号状态、推荐管线并行取数且事件查询去重、批次元数据加 TTL 缓存。实测中位数：通知 1068 → 约 400ms，个性化推荐 1718 → 约 830ms。`,
  'CN 持久化重写',
)

// 6) CN 质量保障：加社区回归 + CI
R(
  '| `verifyFirstScreen.mjs` | 未登录状态下首屏 AI 能力是否真的可见 |',
  `| \`verifyFirstScreen.mjs\` | 未登录状态下首屏 AI 能力是否真的可见 |
| \`verifyCommunity.mjs\` | 14 条：粉丝收到关注对象的新评测通知、举报→版主删除→作者收通知→审计留痕的社区闭环 |`,
  'CN 质量保障',
)
R(
  '类型检查（`npm run server:typecheck` + 构建期 `vue-tsc`）全绿。',
  `类型检查（\`npm run server:typecheck\` + 构建期 \`vue-tsc\`）全绿。

以上全部通过 GitHub Actions 在每次 push 时自动执行：类型检查 → 构建 → 本地 SQLite 起服务 → API 回归三套 → 内置 Chromium 跑浏览器回归。`,
  'CN CI 说明',
)

// 7) CN 功能一览：加持久化与防刷
R(
  '## 账号与权限（RBAC）',
  `## 数据持久与防刷

- **Turso（libSQL）托管库**：同一套 SQL 双后端，线上数据跨发布保留，本地无配置也能跑
- **Cloudflare Turnstile**：注册强制人机验证，服务端 siteverify 校验（fail-closed），伪造 token 被真实拒绝
- **审计日志**：登录、改密、换绑、权限调整、举报处理全部留痕，不含密码与令牌原文

## 账号与权限（RBAC）`,
  'CN 新章节',
)

writeFileSync('README.md', s)
console.log('README 更新完成，共', s.split('\n').length, '行')
