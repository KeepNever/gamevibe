# GameVibe 后端 归纳文档（Summary）

> 给 review 者 / 接手者的快速上手与架构归纳。

## 1. 技术决策归纳（为什么这么选）

| 决策 | 选择 | 理由 |
|------|------|------|
| 运行时 | **Node.js 24** | 内置 `node:sqlite` 在 24 下稳定，无需实验 flag |
| 数据库 | **node:sqlite（内置）** | **零依赖、零原生编译**，Windows 最稳，规避 better-sqlite3 编译坑 |
| Web 框架 | **Hono** | 轻量现代、TS 一流、性能好、上手快 |
| 鉴权 | **JWT（手写 HS256）+ scrypt** | 零额外依赖，密钥绝不进前端 |
| TS 运行 | **`node server/index.ts` 直接跑** | Node 24 类型剥离，无 tsx / 无构建步骤 |
| 联调 | **Vite proxy `/api` → 8787** | 前后端分离但同仓，开发体验丝滑 |
| AI | **后端代理 + 前端流式 SSE** | 密钥安全、打字机体验、对话记忆 |

> 核心收益：**所有密钥收敛到后端 `.env`，前端从此不再直连大模型**；用户数据落地，刷新不丢。

## 2. 目录结构

```
gamevibe/
├── server/                     # 后端（Node 24 + Hono + node:sqlite）
│   ├── index.ts                # 入口：挂载路由 + CORS + 启动
│   ├── env.ts                  # 读取/校验环境变量（密钥仅后端）
│   ├── types.ts                # 后端共享类型
│   ├── db/{schema,index}.ts    # 建表 + 连接（首次启动建库）
│   ├── middleware/auth.ts      # JWT 校验中间件
│   ├── lib/{crypto,steam,ai}.ts# 密码哈希/JWT、Steam 扫描、LLM 代理
│   ├── routes/                 # auth / library / collections / chat / games / reviews / igdb
│   └── data/{catalog.ts,gamevibe.db}  # AI 检索目录（脚本生成）/ SQLite
├── src/                        # 前端（改造）
│   ├── lib/api.ts              # fetch 封装（自动带 JWT）
│   ├── context/AuthContext.tsx # 登录态（token 持久化 + 启动校验）
│   ├── pages/{Login,Register,Library}.tsx  # 新增页
│   ├── lib/ai.ts               # 改为调用后端流式接口
│   ├── store/useGameStore.ts   # 收藏/愿望单/最近浏览同步后端
│   ├── pages/AIAssistant.tsx   # 流式对话 UI
│   ├── components/Layout.tsx   # 用户菜单 + 游戏库导航
│   └── App.tsx                 # AuthProvider + 路由
├── docs/                       # BACKEND_PRD / CONSTRAINTS / SUMMARY
├── scripts/{gen-catalog.ts,test-backend.sh}  # 目录生成 / 联调脚本
├── .env                        # 后端密钥（gitignore）
├── vite.config.ts              # /api proxy
├── tsconfig.server.json        # 后端 TS 检查
└── package.json                # server / dev:all 脚本
```

## 3. 如何运行

```bash
# 1. 安装依赖（已装 hono / @hono/node-server / concurrently）
npm install

# 2. 配置后端环境变量：编辑 .env 增加
#    JWT_SECRET=xxx
#    AI_API_KEY=sk-xxx        # 可选，缺省走规则引擎
#    AI_BASE_URL / AI_MODEL   # 可选
#    SERVER_PORT=8787         # 可选

# 3. 一键启动前后端（Vite :5173 + 后端 :8787）
npm run dev:all

# 或分开：
npm run dev        # 前端
npm run server     # 后端（需 Node 24）

# 4. 后端类型检查
npm run server:typecheck

# 5. 端到端联调脚本（需后端已启动）
bash scripts/test-backend.sh
```

前端访问 `http://localhost:5173`，注册 / 登录后即可体验收藏持久化、本机游戏库、AI 流式对话。

## 4. 已做 / 未做

**已交付（端到端跑通）**
- ✅ 账号体系（注册 / 登录 / me，scrypt + JWT）
- ✅ 收藏 / 愿望单 / 在玩 / 通关 / 最近浏览持久化（登录自动同步）
- ✅ 本机 Steam 游戏库扫描 + 导入 + 状态 / 评分 / 备注管理
- ✅ AI 对话代理（后端密钥 + SSE 流式 + 对话记忆 + 规则引擎降级）
- ✅ 数据库：users / user_library / user_recent / chat_messages / reviews
- ✅ 前端：登录注册页、游戏库页、AuthContext、api 封装、store 同步、AI 流式 UI、Layout 用户菜单

**骨架预留（仅接口 / 表，未完整实现）**
- 🚧 IGDB 真实数据代理（`/api/igdb/games` 占位）
- 🚧 社区评论 / 评分前端接入（`reviews` 表 + CRUD 已有，UI 未接）

## 5. 后续迭代路线

1. **IGDB 代理落地**：后端实现 OAuth2 获取 token → 代理 `/v4/games` → 映射为 `Game`；前端 `dataSource` 切 `igdb` 即可替换 mock。
2. **社区功能**：游戏详情页接入评论区，调用 `/api/reviews`，聚合平均分。
3. **完善本机扫描**：补充 macOS（~/Library/Application Support/Steam）与 Linux、Epic / GOG 路径解析。
4. **生产化**：JWT 引入刷新令牌；`CORS_ORIGIN` 收敛；可选 PostgreSQL 替换 SQLite（保持 SQL 接口）。
5. **测试**：为路由补充单元测试（vitest）+ 集成测试。

## 6. 验证记录（2026-07-11）

后端联调脚本 `scripts/test-backend.sh` 全部通过：health / register / login / me / library-scan / import / collections(wishlist+recent) / ai-chat(流式) / ai-history / igdb(501)。前端 `npm run build` 通过。
