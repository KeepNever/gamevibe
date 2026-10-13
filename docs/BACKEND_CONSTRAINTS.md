# GameVibe 后端 约束文档（Constraints）

> 本文档界定技术、安全、数据、部署与兼容性方面的硬性约束，供后续迭代与评审遵循。

## 1. 技术约束

1. **运行时**：后端必须运行在 **Node.js ≥ 24**。原因：使用内置 `node:sqlite` 模块（Node 22 为实验且需 flag，Node 24 稳定）。启动命令：`node --env-file=.env --no-warnings server/index.ts`。
2. **数据库**：使用 **`node:sqlite`（内置）**，零额外依赖、零原生编译。注意 `node:sqlite` 仍带 `ExperimentalWarning`，以 `--no-warnings` 抑制；**不要**因警告将其替换为 better-sqlite3（在 Windows 上需要原生编译工具链，风险高）。
3. **Web 框架**：**Hono** + `@hono/node-server`，轻量、TS 友好。路由按 `server/routes/*` 拆分，通过 `app.route()` 挂载。
4. **前后端分离**：前端（Vite）与后端（Node）**同仓不同进程**。开发期前端 `/api` 经 Vite proxy 转发到 `http://localhost:8787`；也可独立部署，由 CORS 控制来源。
5. **TypeScript 直跑**：后端 `.ts` 由 Node 24 类型剥离直接执行（相对导入必须带 `.ts` 扩展名）。类型检查用 `tsc -p tsconfig.server.json`（`allowImportingTsExtensions`）。
6. **密钥不进前端**：任何密钥（`AI_API_KEY`、`IGDB_*`、`JWT_SECRET`）**只允许**出现在后端 `.env`，前端只通过 `/api` 间接使用。前端 `VITE_AI_API_KEY` 在本轮改造后已不再被直接调用（AI 改走后端）。
7. **TS 剥离器限制**：模板字符串内 **禁止使用 `\uXXXX` Unicode 转义**，Node 24 的 strip-types 不支持。中文字符请直接写为字面量。

## 2. 安全约束

### 2.1 认证与密码
1. **密码存储**：使用 `crypto.scrypt` 加盐哈希（salt 16 字节，派生 64 字节），**禁止明文或弱哈希（MD5/SHA1/无盐）**。
2. **密码强度策略**：
   - 最少 8 位，最多 128 位
   - 必须包含英文字母 + 数字
   - 禁止常见弱密码列表（password、12345678 等）
   - 用户名 2-24 字符，仅允许字母/数字/下划线/中文
   - 邮箱格式正则校验
3. **会话**：JWT（HS256）由后端 `JWT_SECRET` 签发，有效期 **7 天**；`verifyToken` 校验签名与过期时间。前端将 token 存于 `localStorage`。
4. **防枚举**：登录失败统一返回"邮箱或密码错误"，不区分"账号不存在"和"密码错误"；注册冲突统一返回"账号已存在"。

### 2.2 速率限制（Rate Limiting）
5. **分级限流**（内存滑动窗口实现）：
   | 路径前缀 | 限额 | 窗口 | 用途 |
   |----------|------|------|------|
   | `/api/auth/*` | 10 次 | 1 分钟 | 防暴力破解 |
   | `/api/ai/*` | 20 次 | 1 分钟 | 防 LLM 配额滥用 |
   | `/api/library/*` `/api/collections/*` | 30 次 | 1 分钟 | 写入操作保护 |
   | 其他 `/api/*` | 60 次 | 1 分钟 | 通用保护 |
6. 超限返回 HTTP **429** + `Retry-After` 头；响应头包含 `X-RateLimit-Limit` / `X-RateLimit-Remaining`。

### 2.3 安全响应头
7. 所有响应自动注入以下头（`middleware/securityHeaders.ts`）：
   | 头 | 值 | 目的 |
   |----|-----|------|
   | `X-Content-Type-Options` | nosniff | 防 MIME 嗅探 |
   | `X-Frame-Options` | DENY | 防点击劫持 |
   | `X-XSS-Protection` | 1; mode=block | 浏览器 XSS 过滤 |
   | `Referrer-Policy` | strict-origin-when-cross-origin | 限制 Referrer 泄露 |
   | `Permissions-Policy` | camera=(), microphone=(), ... | 禁止敏感 API |
   | `Content-Security-Policy` | 见源码 | 防注入 |

### 2.4 CORS 与传输
8. **CORS**：支持逗号分隔多 origin 白名单（`CORS_ORIGIN`）；开发环境宽松放行，生产环境严格匹配。预检缓存 24 小时。
9. **输入校验**：所有 JSON body 有大小限制（默认 64KB）；字段做类型+格式+长度校验后再入库。

### 2.5 注入防护
10. 所有 SQL 使用 **参数化预处理**（`db.prepare(...).run(...)`），禁止字符串拼接 SQL。
11. 错误处理：生产环境不暴露内部堆栈信息；全局 `app.onError` 兜底返回通用错误。

## 3. 数据约束

1. **Mock 数据主权**：本轮游戏目录仍由前端 `src/data/games.ts` 提供（后端 `/api/games` 透传同一份）。`IGDB` 接入前，前端是唯一数据真相源。
2. **本机扫描范围**：`/api/library/scan` 仅扫描**运行后端的本机** Steam 安装，结果不上云、不跨设备。导入到 `user_library` 的条目 `source='steam_scan'`；前端 mock 游戏的收藏 `source='catalog'`，两者通过 `external_id` 区分。
3. **用户数据归属**：`user_library` / `user_recent` / `chat_messages` / `reviews` 均带 `user_id` 外键，按用户隔离；中间件注入 `userId`，路由**必须**校验归属后再操作。
4. **最近浏览语义**：`user_recent` 存的是前端 mock 游戏的 `id`（字符串），后端不持有游戏元数据，仅做存储与返回。

## 4. 部署约束

1. **本地开发为主**：项目位于 **C 盘**工作目录（已定），后端代码同仓。启动方式：
   - 一键：`npm run dev:all`（concurrently 同时起 Vite 与后端）。
   - 分开：`npm run dev`（前端 5173）+ `npm run server`（后端 8787）。
2. **数据库文件**：`server/data/gamevibe.db`（含 WAL）由首次启动自动创建，已被 `.gitignore` 忽略。
3. **端口**：后端默认 `8787`，可用 `SERVER_PORT` 覆盖；前端 proxy 目标需同步修改。

## 5. 兼容性约束

1. **操作系统**：本机 Steam 扫描针对 **Windows**（注册表路径 + `Program Files (x86)\Steam`）。macOS / Linux 的 Steam / Epic 库扫描为 TODO，需补充对应路径解析。
2. **浏览器**：前端依赖现代浏览器（Fetch Streams、ES2022）。
3. **Node 版本漂移**：若团队 Node 低于 24，需评估 `node:sqlite` 降级方案（如 `node-sqlite3-wasm` 或 `better-sqlite3` 预编译包），并保持 SQL 接口不变。

## 6. 禁止事项（红线）

- ❌ 把任何 API Key 写进前端代码或 `VITE_` 前缀环境变量并直连第三方。
- ❌ 在后端使用字符串拼接构造 SQL（防注入）。
- ❌ 把 `.env`、`.db` 文件提交到仓库。
- ❌ 将密码以明文或可逆方式存储。
- ❌ 在后端 TS 文件的模板字符串中使用 `\uXXXX` Unicode 转义（Node 24 strip-types 不支持）。
- ❌ 绕过速率限制中间件或将其设为无限制。
- ❌ 在生产环境的错误响应用户暴露内部堆栈或路径信息。
