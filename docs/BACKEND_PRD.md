# GameVibe 后端 产品需求文档（PRD）

> 版本：v1.0　|　状态：M1–M3 已交付，M4–M5 骨架预留　|　最后更新：2026-07-11

## 1. 背景与目标

GameVibe 原本是一个**纯前端**（React 19 + Vite + Tailwind v4）的 AI 游戏发现平台，所有数据来自本地 mock，用户的收藏 / 愿望单 / 聊天记录全部存在前端内存中，**刷新页面即丢失**；AI 助手的 API Key 直接写在前端 `.env`（`VITE_AI_API_KEY`），存在泄露风险。

本次引入**前后端分离**架构，补齐后端能力，目标：

1. **账号体系**：用户注册 / 登录，数据可跨设备、刷新后保留。
2. **数据持久化**：收藏、愿望单、在玩、通关、最近浏览落到数据库。
3. **本机游戏库管理**（用户特别提出）：扫描本机已安装游戏，用户可标注状态 / 评分 / 备注。
4. **AI 对话代理**：LLM 调用移到后端，隐藏密钥，支持流式输出与对话记忆。
5. **可扩展骨架**：为 IGDB 真实数据代理、社区评论评分预留接口与数据表。

## 2. 用户故事

- 作为玩家，我希望注册登录后收藏游戏，**刷新不丢失、换设备也能看**。
- 作为玩家，我希望**扫描本机已装游戏**，并标记「想玩 / 在玩 / 通关」、打分、写备注。
- 作为玩家，我希望用自然语言问 AI 帮我找游戏，并且**对话被记住**。
- 作为求职者（展示项目），我希望架构清晰、本地一键跑通、密钥不暴露在前端。

## 3. 功能范围

### 3.1 账号与认证（✅ 已交付）
- 邮箱 + 密码注册、登录、获取当前用户。
- 密码使用 **scrypt** 加盐哈希存储；会话使用 **JWT**（HS256，7 天过期）。
- 所有业务接口通过 `Authorization: Bearer <token>` 鉴权。

### 3.2 收藏与集合持久化（✅ 已交付）
- `wishlist`（想玩）/ `playing`（在玩）/ `completed`（通关）/ `favorites` / `recent`（最近浏览）。
- 登录后前端自动从后端拉取并写入本地状态；本地操作实时同步后端（乐观更新，失败仅告警）。

### 3.3 本机游戏库扫描与管理（✅ 已交付 · 用户新增需求）
- 扫描本机 **Steam** 游戏库：读取注册表安装路径 → `libraryfolders.vdf` 解析多库 → `appmanifest_*.acf` 解析 appid / 名称 / 大小 / 最后更新；封面用 Steam CDN。
- 本机未安装 Steam 时返回 **开发演示数据**，保证导入流程可演示。
- 导入后进入用户库，可改 `status` / `user_rating`（0–10）/ `note` / `tags`，可删除。

### 3.4 AI 对话代理（✅ 已交付）
- 前端 `/api/ai/chat` 走 **SSE 流式**返回（打字机效果），密钥仅在后端。
- 配置了 `AI_API_KEY` 调用真实 LLM（OpenAI 兼容）；未配置或失败则降级到**本地规则引擎**。
- 用户消息与 AI 回复**持久化**到 `chat_messages`，支持历史回看。

### 3.5 IGDB 真实数据代理（🚧 骨架）
- 后端 `/api/igdb/games` 已占位（501），并预留 OAuth2 + `/v4/games` 代理实现。
- 前端 `dataSource.ts` 已留 `igdbProvider` 切换点，配置后无需改 UI。

### 3.6 社区评论 / 评分（🚧 骨架）
- `reviews` 表已建，基础 CRUD 已实现；前端接入（游戏详情页评论区）留待迭代。

## 4. 非功能需求

- **安全**：密码 scrypt 哈希；JWT 7 天过期；CORS 受控；密钥绝不进前端；`.env` 已 gitignore。
- **性能**：SQLite 本地文件库，单用户场景毫秒级；AI 流式输出降低感知延迟。
- **兼容**：要求 **Node.js ≥ 24**（使用内置 `node:sqlite`）；前端构建要求 Node ≥ 20。
- **可演示**：无外部依赖、无原生编译；本机无 Steam 也有演示数据。

## 5. API 契约（核心端点）

| 方法 | 路径 | 鉴权 | 说明 |
|------|------|------|------|
| POST | `/api/auth/register` | 否 | `{username,email,password}` → `{token,user}` |
| POST | `/api/auth/login` | 否 | `{email,password}` → `{token,user}` |
| GET | `/api/auth/me` | 是 | → `{user}` |
| GET | `/api/library/scan` | 是 | → `{games:[{external_id,name,install_path,size_bytes,last_played,cover_url,source}],count}` |
| POST | `/api/library/import` | 是 | `{items:[...]}` → `{inserted}` |
| GET | `/api/library` | 是 | → `{items:UserLibraryItem[]}` |
| PUT | `/api/library/:id` | 是 | `{status?,user_rating?,note?,tags?}` → `{ok}` |
| DELETE | `/api/library/:id` | 是 | → `{ok}` |
| GET | `/api/collections/:kind` | 是 | `kind=wishlist\|playing\|completed\|favorites\|recent` |
| POST/DELETE | `/api/collections/:kind` | 是 | `{gameId,name?,coverUrl?}` |
| POST | `/api/ai/chat` | 是 | `{message}` → **SSE 流** `{type:"token"\|"done",...}` |
| GET | `/api/ai/history` | 是 | → `{messages}` |
| GET | `/api/games` | 否 | 透传前端 mock（后续切 IGDB） |
| GET | `/api/igdb/games` | 否 | 501 骨架占位 |
| POST/GET | `/api/reviews` | 是 | 社区评论骨架 |

> 完整字段见 `server/types.ts` 与 `server/db/schema.ts`。

## 6. 里程碑

- **M1** 后端骨架 + 账号 + 数据持久化 —— ✅
- **M2** 本机游戏扫描与管理 —— ✅
- **M3** AI 对话代理（流式 + 记忆）—— ✅
- **M4** IGDB 真实数据代理 —— 🚧 骨架
- **M5** 社区评论 / 评分前端接入 —— 🚧 骨架

## 7. 验收标准（本轮）

- [x] 后端启动建库建表成功，`GET /api/health` 正常
- [x] 注册 / 登录 / me 端到端可用
- [x] 本机扫描返回结果，可导入、改状态、评分、删除
- [x] 收藏 / 愿望单 / 最近浏览登录后同步，刷新不丢
- [x] AI 对话流式返回，聊天记录持久化
- [x] 前端 `npm run build` 通过
