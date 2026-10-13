# GameVibe · AI 能力升级施工图纸

> 版本 v1 · 2026-09-22
> 状态：待执行（本文件只定义方案，不含实现）
> 范围：精选库 16 款（`server/data/catalog.ts`）
> 目标：让 AI 在推荐链路上可见且可解释，同时不破坏现有防幻觉叙事

---

## 0. 背景与目标

**现状**

- AI 只存在于独立的 `/ai` 聊天页；主页「为你推荐」是纯规则打分，理由是写死的模板句。
- 推荐链路的数据基础是 `server/data/catalog.ts`，仅 16 款，字段为
  `id / name / genres / tags / rating / price / coverUrl`。
- `server/routes/recommendations.ts` 的 `buildProfile` 已有一份「请求时临时算的 genres/tags 加权画像」（第 31–55 行），但它是隐性的、只有两个维度、且不分长期与近期。

**目标**

1. 补齐游戏侧语义画像，作为推荐与解释的地基。
2. 把隐性的临时画像升级为显性、多维、区分长期与近期的玩家画像。
3. 推荐理由由 LLM 接地生成，引用真实画像与目录数据，不编造。
4. 升级详情页点评为口碑分析（主题分歧 / 共识）。

**三层结构**

```
第一层 游戏语义画像（地基，Step B）
   ↓
第二层 玩家画像 + 画像驱动推荐与接地解释（核心，Step C）
   ↓
第三层 口碑分析（Step D，依赖社区评论数据）
   ↓
Step E 实时数据线合流（AI 今日趋势解读）
```

---

## 1. 画像落库方案与 DDL

### 1.1 落位决策

| 方案 | 结论 |
|---|---|
| 写进 `catalog.ts` 当源码常量 | 否决。会污染事实源，且难以重建与追溯 |
| **新建 SQLite 表 `game_profiles`** | **采用**。catalog 保持原样，画像表是可随时重建的派生资产 |

关键原则：**catalog 是事实源，画像表是派生产物**。二者分离，才能保住「推荐理由可追溯到原始事实」这条叙事。

### 1.2 DDL

```sql
-- 游戏语义画像（派生资产，可重建）
CREATE TABLE IF NOT EXISTS game_profiles (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id          TEXT    NOT NULL,           -- 逻辑指向 catalog.id（catalog 是源码常量，不设外键）
  batch_id         TEXT    NOT NULL,           -- 所属批次，用于冻结与追溯
  story_intensity  INTEGER,                    -- 1-5
  difficulty       INTEGER,                    -- 1-5
  exploration      INTEGER,                    -- 1-5
  combat_intensity INTEGER,                    -- 1-5
  core_gameplay    TEXT,                       -- 枚举集合，逗号分隔
  multiplayer      TEXT,                       -- none | single | co-op | pvp | both
  estimated_length TEXT,                       -- 见 2.2 枚举
  target_players   TEXT,                       -- 一句话
  semantic_summary TEXT,                       -- 1-2 句，仅可引用 name/genres/tags/rating
  content_notes    TEXT,                       -- 可能劝退点（可空）
  model            TEXT,                       -- 生成所用模型
  prompt_version   TEXT,                       -- 模板版本
  generated_at     TEXT,                       -- ISO8601
  status           TEXT    NOT NULL DEFAULT 'draft',  -- draft | verified
  UNIQUE(game_id, batch_id)
);

-- 批次表：冻结与激活状态的唯一来源
CREATE TABLE IF NOT EXISTS profile_batches (
  batch_id       TEXT PRIMARY KEY,
  model          TEXT,
  prompt_version TEXT,
  created_at     TEXT,
  status         TEXT NOT NULL DEFAULT 'draft',  -- draft | frozen
  is_active      INTEGER NOT NULL DEFAULT 0,     -- 仅一个批次为 1
  game_count     INTEGER,
  verified_count INTEGER,
  notes          TEXT
);

CREATE INDEX IF NOT EXISTS idx_game_profiles_active ON game_profiles(game_id, batch_id);
CREATE INDEX IF NOT EXISTS idx_game_profiles_batch  ON game_profiles(batch_id);
```

### 1.3 读取约定

- 运行期读取画像：取 `profile_batches.is_active = 1` 的 `batch_id`，再连表取 `game_profiles`。
- 无 active 批次时：整条第二层自动降级到现状（`buildProfile` 的 genres/tags 加权），不报错。
- 写画像只在离线脚本中发生，运行期一律只读。

---

## 2. 游戏语义画像字段表

### 2.1 字段定义（只列新增字段）

| 字段 | 类型 | 取值域 | 生成依据 | 示例 |
|---|---|---|---|---|
| story_intensity | int | 1–5 | genres/tags | 极乐迪斯科 = 5 |
| difficulty | int | 1–5 | tags（如「高难度」「困难」）/rating | 艾尔登法环 = 5 |
| exploration | int | 1–5 | genres/tags（开放世界/探索） | 艾尔登法环 = 5 |
| combat_intensity | int | 1–5 | genres/tags（动作/射击/战斗） | 星露谷物语 = 1 |
| core_gameplay | str | 枚举集合 | genres/tags | `战斗,探索,角色养成` |
| multiplayer | str | 枚举 | tags（多人在线/共斗/竞技） | 艾尔登法环 = both |
| estimated_length | str | 枚举 | tags/rating（无从判断时给 `unknown`） |
| target_players | str | 自由文本 | 综合 | 「喜欢高难度挑战与探索的玩家」 |
| semantic_summary | str | 1–2 句 | 仅可引用 name/genres/tags/rating | 见下 |
| content_notes | str | 自由文本（可空） | tags | 「难度较高，新手劝退」 |

**不生成**：`name / genres / tags / rating / price`——这些目录里已有，属搬运而非生成，禁止重复。

### 2.2 枚举定义

```
core_gameplay    ∈ {战斗, 探索, 建造, 解谜, 叙事, 经营, 收集, 社交, 竞速, 策略推演}
multiplayer      ∈ {none, single, co-op, pvp, both}
estimated_length ∈ {<5h, 5-15h, 15-30h, 30-60h, >60h, ongoing, unknown}

multiplayer 判定要点：pvp 仅对抗、co-op 仅合作、both 两者皆有（如联机合作 + 入侵 PvP）；
                       纯对抗竞技射击（无畏契约 / CS2）不得标 both。
estimated_length：长期运营型（持续更新的多人竞技或沙盒）标 ongoing，无法判断时才用 unknown。
```

### 2.3 1–5 分档锚点（供 prompt 统一口径）

| 分值 | 含义 |
|---|---|
| 1 | 很低，几乎不涉及 |
| 2 | 偏低，偶尔出现 |
| 3 | 中等，明显存在但非核心 |
| 4 | 偏高，是主要体验之一 |
| 5 | 极高，是核心卖点 |

### 2.4 硬约束（防幻觉）

1. 只能依据 `name / genres / tags / rating` 推断，**禁止**引入角色名、具体剧情、发售日、价格。
2. `semantic_summary` 中不得出现任何数字价格、平台名称（除非来自 tags）。
3. 无法判断的字段一律留空或标 `unknown`，**不许猜**。
4. 输出严格 JSON，字段白名单外一律丢弃。

---

## 3. 生成与冻结流程

### 3.1 Prompt 模板（要点）

```
System:
你是游戏标签结构化助手。仅依据给定的名称、类型、标签、评分推断语义字段。
禁止引入任何未给出的具体事实（角色名、剧情细节、发售日期、价格）。
无法判断时留空或填 unknown，不要猜测。
只输出 JSON，字段：story_intensity, difficulty, exploration, combat_intensity,
core_gameplay, multiplayer, estimated_length, target_players,
semantic_summary, content_notes。

User:
名称: {name}
类型: {genres}
标签: {tags}
评分: {rating}
```

- 温度 0.2，追求稳定复现。
- 请求级校验：JSON 可解析 + 枚举合法 + 分值在 1–5 + summary 长度 ≤ 200 字。

### 3.2 批处理脚本（拟建 `scripts/genProfiles.mjs`）

1. 读 `catalog.ts`（16 款）。
2. 生成 `batch_id = profiles-YYYYMMDD-HHmm`，写入 `profile_batches`（status=draft, is_active=0）。
3. 逐款调用 LLM → 校验 → 写 `game_profiles`（status=draft）。
4. 任一款校验失败：记录并跳过，不写半成品；全部完成后再进入抽检。
5. 无 API key：脚本直接报错退出，绝不留半成品批次。

### 3.3 抽检（16 款 = 全量核对）

- 规模小，直接全量人工核对，不抽样。
- 逐款核对 10 个新增字段，重点看 `difficulty / exploration / multiplayer`。
- 不符项：手工修正后重新写入该款，或调整 prompt 重跑该款。
- 记录核对结果到 `profile_batches.verified_count` 与 `notes`。

### 3.4 冻结

1. 全量核对通过后，将批次 `status = frozen`、`is_active = 1`（同时把旧批次 `is_active = 0`）。
2. `game_profiles.status = verified`。
3. **冻结后运行期不再重新生成**；如需更新，新建批次，旧批次保留可回溯。
4. 冻结生效后，这批画像即视为事实源的延伸，「推荐理由可追溯」成立。

---

## 4. 玩家画像算法

### 4.1 数据源与权重

| 来源 | 表 | 权重 |
|---|---|---|
| 已通关 | `user_library.status = completed` | 2.0 |
| 在玩 | `user_library.status = playing` | 1.5 |
| 想玩 | `user_library.status = wishlist` | 1.0 |
| 写评论 | `reviews.rating` 存在 | 额外 +1 + (rating/5)×1.5 |
| 浏览 | `user_recent` 去重计一次 | 0.5 |

- 权重沿用现有 `buildProfile` 的口径，保证升级前后可比。
- `reviews` 当前为空，评分加成先定义、待 seed 后生效。

### 4.2 时间窗

| 画像 | 范围 | 判定字段 |
|---|---|---|
| 长期 | 全部历史 | — |
| 近期 | 最近 30 天 | `user_library.added_at` / `user_recent.viewed_at` |

### 4.3 计算方式

分值型字段（story_intensity / difficulty / exploration / combat_intensity）：

```
pref(dim) = Σ( w_g × dim_g ) / Σ( w_g )        结果落在 1–5
```

枚举型字段（core_gameplay / multiplayer / estimated_length / target_players）：
按 `w_g` 加权统计频次，取 top-N 作为偏好标签。

归一化：1–5 直接输出；供排序用的分值再线性映射到 0–1。

### 4.4 冷启动

- 无任何交互：各维度取默认 3.0，`core_gameplay` 为空，标 `cold_start = true`。
- 推荐走「高评分热门」，与现有 `mode = cold` 分支保持一致。

### 4.5 可解释输出

- 输出 top-3 贡献游戏（按 `w_g` 与该维度的贴合度排序），作为理由依据。
- 长期与近期分别输出；生成推荐理由时优先引用近期依据。
- 示例：「你近期通关了《艾尔登法环》《空洞骑士》，因此推荐同属高难度探索类的……」

### 4.6 与现有代码的关系

- 把 `recommendations.ts` 的 `buildProfile` 从「genres/tags 加权」升级为「读 `game_profiles` 的语义维度」。
- 保留 genres/tags 作为兜底：画像表缺失或未冻结时，降级到现状逻辑。

### 4.7 伪码

```
function buildPlayerProfile(userId, window):
    events = collect(user_library[userId], reviews[userId], user_recent[userId])
    events = filterByWindow(events, window)          # all | last30d
    w = weightOf(events)                             # 见 4.1
    if w.isEmpty(): return coldStartProfile()
    dims = {}
    for dim in [story_intensity, difficulty, exploration, combat_intensity]:
        dims[dim] = Σ(w_g × profile(g)[dim]) / Σ(w_g)
    enums = weightedTopN(events, w, [core_gameplay, multiplayer, estimated_length])
    top3  = topContributors(events, w, 3)
    return { dims, enums, top3, cold_start: false }
```

---

## 5. 评测口径

### 5.1 评测集

- **30 条自然语言 query**：覆盖免费 / 平台 / 类型 / 心情 / 时长 / 多人 / 难度 / 混合条件。
- **20 个用户场景**：不同画像（含至少 3 个冷启动），验证个性化。
- 以文件固定：`eval/queries.jsonl`，逐条含 `query`、`期望条件`、`硬条件标记`。

### 5.2 评分与通过线

| 项 | 标准 |
|---|---|
| 单条评分 | 1–5 |
| 通过线 | 平均 ≥ 3.5，且无单条 ≤ 1 |

### 5.3 硬判据（条件遵循）

- query 含硬条件时，返回结果必须 **100% 满足**：如「免费」→ 全部 `price === 0`；「Switch」→ 全部含 Switch 平台。
- 任一条违反：该项直接记 0 分（一票否决）。

### 5.4 事实正确率

- 人工核对 AI 理由中每个引用字段（价格 / 评分 / 类型）是否与 catalog 一致。
- 目标 ≥ 98%，即几乎不允许编造。

### 5.5 解释一致性

- 理由是否与玩家画像依据吻合（引用真实交互过的游戏），不允许张冠李戴。

### 5.6 多样性

- top-N 结果中不同 `core_gameplay` 覆盖数 ≥ 2。

### 5.7 基线与报告

- 改造前（规则 + 模板理由）先跑一遍存档，作为基线。
- 改造后同集复跑，输出对比报告 `docs/eval-report.md`：
  表格列为 query / 期望 / 实际 / 硬条件 / 分数 / 备注。

---

## 6. 接口与工程约束

### 6.1 接口决策

| 接口 | 决策 | 说明 |
|---|---|---|
| `POST /api/ai/chat` | 复用并增强 | 需求结构化并入其内部（结构化需求 → 选 gameIds → 接地成文） |
| `POST /api/ai/discover` | **不新增** | 与 chat 功能重叠，面试官必问「这俩什么区别」 |
| `GET /api/ai/profile` | 新增 | 返回玩家画像（长期 + 近期 + top3 依据），需登录 |
| `GET /api/ai/recommend` | 新增或并入 | 画像驱动推荐 + 接地理由，需登录 |

### 6.2 硬性工程约束

1. **鉴权必须按路由挂**：`/api/ai` 下已有 `chat` 与 `aiPublic` 两组路由，新增接口一律单路由挂 `authMiddleware`，**禁止 `use('*')`**——上次正是它让公开接口集体 401。
2. **生产走 `X-Auth-Token`**：EdgeOne / STGW 网关会覆写 `Authorization` 头，所有需鉴权请求必须带 `X-Auth-Token`。
3. **画像运行期只读**：不得在请求路径上调用 LLM 生成画像。
4. **复用接地封装**：新 LLM 调用点必须走 `server/lib/ai.ts`，不新开裸调用。
5. **优雅降级**：任一新接口在无画像 / 无 key / 表缺失时，必须回退到现有逻辑，不报错。

---

## 7. 非目标（本次不做）

| 项 | 理由 |
|---|---|
| 社区内容理解（评论聚类 / 话题抽取） | 投入产出最低，暂缓 |
| 独立 `POST /api/ai/discover` 接口 | 与 chat 重叠 |
| 发现库 132 款的画像 | 本次只铺精选库 16 款；发现库已有 description，需要另设抽取流程 |
| 实时数据线 | **Step E 单列**，见路线图；不在此文档展开，但不允许蒸发 |
| 向量检索 / 召回-排序重管线 | 16 款规模不需要，杀鸡用牛刀 |

---

## 8. 分阶段与验收

| 阶段 | 交付 | 验收标准 |
|---|---|---|
| **Step A** 施工图纸 | 本文件 | 六块内容齐备，用户确认 |
| **Step B** 游戏语义画像 | `game_profiles` + `profile_batches` 表、`scripts/genProfiles.mjs`、冻结批次 | 16 款全量生成 + 全量核对通过，批次冻结激活，运行期可只读读取 |
| **Step C** 玩家画像 + 推荐 | `GET /api/ai/profile`、画像驱动推荐、接地理由 | 评测集平均 ≥ 3.5，硬条件 100% 遵守，事实正确率 ≥ 98%，冷启动正常降级 |
| **Step D** 口碑分析 | 先跑 `seedReviews.mjs`，升级详情页点评为主题分歧 / 共识 | 点评引用真实评论内容，标注为演示数据 |
| **Step E** 实时线合流 | 「AI 今日趋势解读」 | 用 `/api/live` 数据驱动，AI 解读中数字与实时接口一致 |

---

## 9. 与现有代码的衔接点

| 文件 | 变更性质 |
|---|---|
| `server/data/catalog.ts` | **不动**（事实源） |
| `server/db/schema.ts` | 新增两张表 DDL |
| `scripts/genProfiles.mjs` | 新增（离线生成；实际落地为 `scripts/genProfiles.ts`） |
| `scripts/evalAI.ts` + `eval/queries.jsonl` | 新增（评测集与评测执行，产出 `docs/eval-report*.md`） |
| `server/lib/ai.ts` | 复用；按需增导出（`describeGame`、`composePersonalizedNarrative`） |
| `server/lib/gameProfile.ts` | 新增（只读读取冻结画像，按批次缓存） |
| `server/lib/playerProfile.ts` | 新增（玩家画像计算 + 画像驱动排序 + 接地理由） |
| `server/routes/aiPersonal.ts` | 新增（`GET /api/ai/profile`、`GET /api/ai/recommend`，单路由挂鉴权） |
| `server/routes/aiPublic.ts` | 不动（保持公开：spotlight / review） |
| `server/routes/recommendations.ts` | 升级：优先画像驱动，缺失时兜底旧口径；可选鉴权同时支持 `X-Auth-Token` |
| `server/routes/chat.ts` | 内部增加需求结构化步骤（Step C 后半） |

---

## 10. Step C1' 实施记录（chat 需求结构化 + 硬约束过滤）

**背景**：基线评测（`docs/eval-report-baseline.md`）硬条件遵守率仅 62.1%（18/29）、自动均分 3.17。
根因不是模型差，而是**架构缺一层**——让 LLM 直接「凭感觉」从目录挑游戏，预算 / 评分 / 时长 / 类型
这类可机检的硬约束必然会被漏判。

**改法（把「读懂需求」从 LLM 手里拿走）**：

| 环节 | 做法 |
|---|---|
| 需求结构化 | `server/lib/requirements.ts` → `extractByRules()`：正则 + 词典（15 个 genre、65 个 tag、21 个游戏别名）确定性抽取；规则全空且句子够长时才调一次 LLM 补漏，输出经白名单校验 |
| 硬约束过滤 | `filterCatalog()`：catalog（价格/评分/类型/标签）× 冻结画像（难度/时长/剧情/联机）逐条 AND；`any` 组走 OR |
| 类似 X | `similarCandidates()`：优先用目标的**独有特征**判定同类；若独有特征无人共享（它在目录里独一份，如空洞骑士之于银河城）→ 只返回目标本身，不硬塞不相关游戏 |
| 空结果处理 | 两级放宽：先试「只丢一类」取最小放宽解，不成再按 `RELAX_ORDER` 累积放宽；放宽了哪条**如实告知用户**，不假装匹配、也不答「没找到」 |
| LLM 定位 | 只做两件事：在**已过滤的候选集内**选 1-4 款（`llmSelect` 的白名单被收窄到候选集）、把真实事实写成推荐语 |

**新增 / 改动的文件**：
- 新增 `server/lib/requirements.ts`（抽取 + 过滤 + 放宽）
- 新增 `scripts/evalConstraints.ts`（**纯函数自检**，不依赖 LLM/HTTP，改完先跑这个）
- 新增 `scripts/smokeAI.ts`（AI 链路冒烟回归：公开接口 / 鉴权边界 / 画像引擎）
- 改 `server/lib/ai.ts`（三段式主链路 + `AIResult` 增加 `constraints/relaxed/engine`）
- 改 `server/routes/chat.ts`（SSE `done` 事件下发 `constraints/relaxed/engine`）
- 改 `scripts/evalAI.ts`（报告按 label 落盘为 `eval-report-<label>.md`，不再覆盖基线）

**验收结果（`docs/eval-report-c1p.md`）**：

| 指标 | 基线 | C1' | 通过线 |
|---|---|---|---|
| 硬条件遵守率 | 62.1% | **100%**（29/29） | 100% |
| 无编造 id | 100% | 100% | 100% |
| 事实正确率 | 100% | 100% | ≥98% |
| 空结果率 | 6.7%（2/30） | **0%** | 0 |
| 自动均分 | 3.17 | **5.00** | ≥3.5 |

**已知取舍**：当目标游戏的独有特征在目录里无人共享时，「类似 X」只会返回 X 本身并说明原因
（目录 16 款规模下，同类稀缺是事实，硬塞近邻反而降低可信度）。

---

## 11. Step C2 实施记录（前端露出：把「AI 懂了」变得可见）

**背景**：C1 / C1' 的能力全部沉在后端，前端只消费了 `id/name/score/reason`——匹配度、命中维度、
口味画像、约束标签统统被丢弃。用户看不出「AI 在起作用」。

**改法（只动前端，不动表结构与后端）**：

| 改动 | 文件 | 说明 |
|---|---|---|
| 类型补齐 | `src/lib/recommendApi.ts` | 新增 `match / dimsFit / matchedCore / matchedDims`、`taste.*`、`engine`；全部可选，匿名/冷启动不受影响 |
| 画像客户端 | `src/lib/profileApi.ts`（新增） | 对接 `GET /api/ai/profile`，类型化 `dimsDetail / prefs / basis / source` |
| 首页匹配度 | `src/pages/Home.vue` | 推荐卡下方加「匹配 N%」+ 命中维度 chips；副标题按 `engine` 区分画像驱动/兜底 |
| 口味画像面板 | `src/components/TastePanel.vue`（新增） | 四维条形（长期 + 近期对照）、口味标签、偏好核心玩法、画像依据（可点进游戏）、样本量与批次 |
| AI 助手页布局 | `src/pages/AIAssistant.vue` | 改双栏（`xl` 断点右侧挂面板），聊天列宽度不变 |
| 约束标签 | `src/lib/ai.ts`、`src/types/game.ts`、`AIAssistant.vue` | `onDone` 透传 `constraints / relaxed / engine`；消息气泡内渲染「已按 ⋯ 筛选」「已放宽 ⋯」 |

**设计取舍**：
- 口味画像面板挂 **AI 助手页右侧**，不改社交页 `UserProfile.vue`（那是看别人的页面，语义不对）。
- 匹配度做成**卡下一行**而不是封面角标——封面左上已有折扣标、右上已有收藏按钮，再加角标会打架。
- 面板只在 `xl`（≥1280px）显示，窄屏不挤压聊天区。

**验收（`scripts/smokeAI.ts` + `scripts/verifyC2UI.ts`）**：

| 项 | 结果 |
|---|---|
| 后端契约（17 项，含 `matchedDims` 标签、`dimsDetail` 四维 label/value/level、`basis` + `sampleSize`） | 17/17 ✅ |
| 前端类型检查 `vue-tsc --noEmit` | 0 error |
| 真实浏览器渲染（1440×900，登录态） | 首页出现「匹配 N%」✅ / 画像面板四维齐全 ✅ / chat 出现「已按 预算 50 元以内 筛选」✅ |
| 运行期 console / page error | 0 |

截图存档：`docs/c2-screenshots/`（home.png / home-foryou.png / ai-profile.png / ai-chat.png）。

---

## 12. 部署记录（C1' + C2 上线）

**发布形态**：单端口 HTTP 服务。前端 `npm run build` 产出 `dist/`，由 `server/index.ts` 同源托管（`DIST_DIR` 存在时启用），因此一个 Node 进程 = 完整应用。

| 项 | 取值 |
|---|---|
| 访问链接 | https://gamevibe.app.workbuddy.host/ |
| 安装命令 | `npm install && npm run build`（沙箱内重建 `dist/`，不依赖上传产物） |
| 启动命令 | `node --experimental-strip-types --experimental-sqlite --env-file=.env --no-warnings server/index.ts` |
| 监听端口 | `8792`（后端 `env.ts` 优先读 `PORT`，回退 `SERVER_PORT`，两者一致避免环境差异） |

**为什么显式指定启动命令**：`package.json` 的 `server` 脚本没带 `--experimental-strip-types` / `--experimental-sqlite`，
Node 22.x 需要这两个标志（Node 24 已默认开启，传入亦不报错），显式写出可同时兼容两种运行时。

**线上验收（与本地同口径）**：

| 检查 | 结果 |
|---|---|
| `GET /api/health` | `{"ok":true,"version":"1.1.0"}` |
| 前端 bundle 含 C2 代码 | 「口味画像」「已按」「已放宽」均在产物中 ✅ |
| `GET /api/ai/spotlight` | `aiPowered: true`（沙箱内 DeepSeek key 生效）✅ |
| `GET /api/live` | `simulated: true`，`onlinePlayers` 3 秒内变化（10175007 → 10160919）✅ |
| 线上硬约束 E2E（`scripts/deployE2E.mjs`，7 项） | 预算 ≤¥50 → 星露谷/吸血鬼幸存者/CS2/无畏契约；评分 ≥9.5 → 4 款全达标；免费 → CS2/无畏契约；类似空洞骑士 → 只回空洞骑士；≤¥100 的 RPG → 星露谷/戴夫；画像接口 `dims={story:4.4,difficulty:3.1,exploration:4,combat:2.5}`（与本地一致）；无 token 仍 401 ✅ 7/7 |
| 生产站点浏览器冒烟（`scripts/deployUISmoke.mjs`，5 项） | 页面非空白（正文 2730 字）、「实时」可见、AI 精选模块可见、运行期报错 0 ✅ 5/5 |

截图存档：`docs/deploy-screenshots/prod-home.png`。

**注意**：沙箱内 `dist/` 是在部署环境重新构建的，产物哈希与本机不同（本机 `index-BYCWekul.js`，线上 `index-Bx8Bu25j.js`），
内容一致——验证线上新版**不能比对哈希，要 grep 产物内容**。

---

## 13. Step D 实施记录（口碑分析：共识 / 分歧）

**背景**：`reviews` 表长期为 0 行，详情页只有「AI 一句话点评」——那是对**目录字段**的复述，
没有用到任何玩家声音。口碑分析要把真实评论变成可读的「共识 / 分歧」。

**数据**：先跑 `scripts/seedReviews.mjs`（幂等、先删该 game_id 再插），产出 16 款 × 4 条 = **64 条**演示评论
（12 个种子用户轮转、近 60 天分布、4-5 星为主并混入 3 星差评）。

**核心设计——防编造引用（这是本步的关键）**：

| 风险 | 做法 |
|---|---|
| 模型编造「玩家说……」 | 送给模型的评论**一律带序号**（`序号｜星级｜正文`），且**不给作者名**；模型只能回传序号数组 `quotes:[0,2]` |
| 引文与原文不一致 | 引文**由本地按序号从库里回填**——模型在结构上碰不到引文内容，不可能篡改 |
| 归纳引入评论外事实 | prompt 明确禁止提价格/平台/发售日期；`theme`/`summary` 仅做长度与去空校验，不参与事实陈述 |
| 无效引用蒙混过关 | 序号越界/非整数直接丢弃；一条主题若没有任何有效引用就**整条丢弃**（宁缺毋滥） |

**降级链（永不报错）**：评论 < 3 条或无 key → 确定性兜底（按星级取最高/最低分评论做原生引用）并如实标注
「暂未做主题归纳」；LLM 失败 → 同上；0 条评论 → 明确提示「还没有玩家评论」。

**改动**：
- 新增 `server/lib/reviewDigest.ts`（读库 → LLM 归纳序号 → 本地回填引文；30 分钟缓存）
- 改 `server/routes/aiPublic.ts`：新增公开路由 `GET /api/ai/reviewDigest?gameId=`（免登录；未收录 404、缺参 400）
- 前端：`src/types/live.ts` 补 `DigestQuote/DigestTheme/ReviewDigestResult`；`src/lib/liveApi.ts` 加 `getAiReviewDigest()`；
  `src/pages/GameDetail.vue` 在 AI 点评下方新增「玩家怎么说」区块（评分分布条 + 共识 chips + 分歧 chips + 引用 + 数据来源说明）

**顺带修掉一个真问题（加口碑接口带出来的）**：
`server/index.ts` 原先把整个 `/api/ai/*` 限流在 **20 次/分钟**。详情页现在一次要打 `review` + `reviewDigest`
两个 AI 请求 → **快速浏览 10 个详情页就触顶 429**，而前端 `catch → null` 会静默留白。
改为分层限流：`/api/ai/chat`（真实调用 LLM、流式）保持 20 次/分钟，其余 AI 端点（均有缓存）放宽到 60 次/分钟。
**这是真机测试时被 429 打出来才发现的**——纯看代码不会暴露。

**验收**：

| 项 | 结果 |
|---|---|
| `scripts/verifyDigest.ts`（16 款 × 5 类断言 = 82 项） | **82/0** ✅：count 与库一致、**引用零编造（逐字比对 DB）**、主题字段完整、有主题归纳、评分分布自洽；未收录 404 / 缺参 400 均正确 |
| AI 归纳是否真生效 | 16 款全部 `aiPowered: true`，每款 1-3 个主题、2-5 条引用 |
| `vue-tsc --noEmit` | 0 error |
| `scripts/verifyDigestUI.mjs`（真实 Playwright） | 6/6 ✅：区块出现、评论数+平均分、共识分区、带引号引用、来源说明、CS2 页正常；**运行期报错 0** |

截图存档：`docs/d-screenshots/`（game-detail-digest.png / game-detail-digest-cs2.png）。

**已知取舍**：演示评论 4-5 星偏多，「分歧」区有时只有 1 条主题（如 elden-ring 的「优化问题」）；
这是演示数据的分布问题，不是归纳逻辑问题——真实数据下分歧会更丰富。

---

## 14. Step E 实施记录（实时线合流：AI 今日趋势解读）

**背景**：`/api/live` 已能提供会波动的实时指标，但 AI 侧完全没接——主页有「AI 精选」却没有任何
与实时数据相关的解读。本步把实时线接到 AI 的嘴上。

**核心设计——模型只写定性，数字由本地注入（与 Step D 的「引用回填」同一套防幻觉哲学）**：

| 风险 | 做法 |
|---|---|
| 模型自算 / 编造热度数字 | 送给模型的快照带真实数字供判断，但**强制要求正文不含任何阿拉伯数字**（在线人数、涨幅、日期都不许写），改用「持续升温」「稳居榜首」这类定性表达 |
| 模型不听话写了数字 | 正文做 `/[0-9]/` 检测，**命中即丢弃并重试一次**；仍违规则回退确定性模板 |
| 界面数字与实时接口不一致 | 所有数字（全局四项指标 + 热度榜在线数/趋势）+ 游戏 id **全部由本地从 `/api/live` 快照注入**，模型结构上碰不到 |
| 出现目录外游戏 | 热度榜直接取 `/api/live` 的 `trending` 子集，天然只含目录内 id |

**改动**：
- 新增 `server/lib/trend.ts`：读 `getLiveStats()` → 派生升温榜（delta 降序前 3 + 降温最明显 1）→
  LLM 只写定性文本（含数字即重试、仍失败则模板）→ 返回 `{ text, snapshot, aiPowered }`；**60s 缓存**
  （缓存期内 `text` 与 `snapshot` 同源，保证界面数字自洽）。
- 改 `server/routes/aiPublic.ts`：新增公开路由 `GET /api/ai/trend`（免登录）。
- 前端：`src/types/live.ts` 补 `AiTrendResult / AiTrendSnapshot / TrendHotGame`；`src/lib/liveApi.ts` 加
  `getAiTrend()`；`src/pages/Home.vue` 在「AI 精选」下方新增「📈 AI 今日趋势」卡（左侧定性解读 +
  四项全局指标，右侧热度榜带 `↗/↘` 趋势），30s 轮询、`onUnmounted` 清理定时器。

**验收**：

| 项 | 结果 |
|---|---|
| `scripts/verifyTrend.ts`（12 项） | **12/0** ✅：**文本不含阿拉伯数字**（防自算）、`aiPowered`、快照字段齐全、热度榜 id 全来自 `/api/live`、全网在线 ≥ 榜内单款、与 `/api/live` 同量级（ratio 1.00）、60s 缓存生效、快照时间戳新鲜 |
| `scripts/smokeAI.ts` 扩到 19 项 | **19/19** ✅（新增「`/api/ai/trend` 免登录」「趋势文本不含数字」） |
| `vue-tsc --noEmit` | 0 error |
| `scripts/verifyTrendUI.mjs`（真实 Playwright） | 5/5 ✅：卡片出现、「实时 · 快照」标记、热度榜、「四项指标齐全」、定性文本非空且不含数字；**运行期报错 0** |

截图存档：`docs/e-screenshots/home-trend.png`。

**部署与线上验收（C1' + C2 + D + E 全量上线，链接不变）**：

| 检查 | 结果 |
|---|---|
| `GET /api/ai/trend`（`BASE` 指向生产域名，跑同一套 `scripts/verifyTrend.ts`） | **12/0** ✅：`aiPowered: true`、文本 136 字且无「游戏名之外」的数字、热度榜 4 条、与 `/api/live` 同量级（ratio 0.99）、60s 缓存生效 |
| 生产站点浏览器冒烟（`scripts/deployUISmoke.mjs`，扩到 6 项） | **6/6** ✅：live 动态、页面非空白（3208 字）、「实时」可见、AI 精选可见、**「AI 今日趋势」卡可见**、运行期报错 0 |
| `GET /api/ai/reviewDigest?gameId=elden-ring`（确认 Step D 已上线） | `aiPowered: true`、count 4、共识 2 条 ✅ |

截图存档：`docs/deploy-screenshots/prod-trend.png`。

**⚠️ 一处修正（值得记住的测试缺陷）**：首次上线后线上 `trend` 返回 `aiPowered: false` —— 根因是
「禁止正文出现阿拉伯数字」这条约束与「必须能提游戏名」冲突：**游戏名本身可能带数字**
（赛博朋克2077、CS2、哈迪斯2…），凡提到这类游戏名就被判违规，两次后回退模板。而**本地验证当时
「通过」纯属数据侥幸**——那次升温榜恰好是 stardew-valley / elden-ring / valorant 等不含数字的名字。
修正：检测前先豁免目录内全部游戏名（长名优先，避免子串误伤），只对「游戏名之外」的数字报警。

> **教训**：凡断言「文本不含 X」，先检查 X 会不会被**正常内容合法包含**；否则测试是 flaky 的，
> 换一份数据（或换到线上）就翻车。这条同样适用于 smoke 断言。

**已知取舍**：热度榜按**趋势（delta）**排序而非在线人数，故列表内数值不单调（如榜首在线数低于同行）；
这是「趋势榜」语义使然，非排序错误。`/api/live` 本身是本地模拟数据（`simulated: true`），
接入真实数据源后本模块无需改动——`trend.ts` 只消费 `getLiveStats()` 的结构。

---

---

## 15. 可见性修复（用户反馈「看不出和之前的区别」）

**问题**：Step A–E 的 AI 成果在 UI 上不可见——实测匿名态首页第一屏（900px）内只有 Hero + 统计卡；「AI 精选」在 1202px、「AI 今日趋势」在 1516px（均在第一屏之下）；带匹配度的推荐位**匿名时退化为「精选推荐 / 登录后解锁个性化推荐」**。所有 AI 能力都藏在「登录后」「第二屏之下」「详情页」「主动提问」里。

**改动（前端重排 + 后端理由接地，不动表结构）**：
1. **区块重排**：`Home.vue` 把「AI 精选」上移到 Hero 之后第一块、「AI 今日趋势」第二块，推荐位下移到第三块。AI 精选由此落在 604px，**首屏即可见**。
2. **拆「登录墙」**：推荐位标题匿名态由「🔥 精选推荐」改为「🤖 AI 推荐」，副标题改「AI 依据全站口碑与热度挑选」，移除「登录后解锁个性化推荐」。
3. **匿名推荐理由接地化**：`server/routes/recommendations.ts` 的匿名 / 冷启动分支新增 `engine: 'popular-fallback'`，`reason` 由无信息量的「热门精选」改为只用目录真实字段生成（如 `评分 9.8 · 农场 · 像素风`），不调 LLM、不编造。

**验收**：
| 项 | 结果 |
|---|---|
| 首屏（900px）可见「AI 精选」 | 匿名 / 登录均 **604px 命中** |
| 匿名标题为「🤖 AI 推荐」 | ✅（登录态仍「🎯 为你推荐」） |
| 「登录后解锁个性化推荐」文案已消失 | ✅ |
| 匿名 `/api/recommendations` | `engine=popular-fallback`、`reason="评分 9.8 · 农场 · 像素风"` |
| `scripts/smokeAI.ts` 回归 | **19/19** |
| `vue-tsc --noEmit` | 0 error |
| 线上同一套首屏验证（`verifyFirstScreen.mjs`） | 与本地**完全一致**（604px 命中） |

截图：`docs/diag/anon-firstscreen.png`（改前）→ `docs/deploy-screenshots/prod-firstscreen.png`（改后线上）。

**⚠️ 环境坑（重要）**：本机存在失效代理环境变量 `HTTPS_PROXY=http://127.0.0.1:53869`，**Chromium 会走它导致线上访问 `ERR_TIMED_OUT`**（Node 的 fetch 默认不读该变量，故接口验证正常）。解法：Playwright 脚本内 `delete process.env.HTTPS_PROXY / HTTP_PROXY / ALL_PROXY` + `launch({ args: ['--no-proxy-server'] })`。凡连**线上**的 Playwright 脚本都要这样处理。

## 16. AI 助手「联网检索」（Steam 公开接口 + 事实接地）

**需求**：在 AI 助手里加联网搜索，能搜到最新游戏资讯。

**数据源（免密钥的 Steam 公开接口，网页版商店背后就是它们）**

| 用途 | 接口 |
|---|---|
| 游戏名 → appid | `store.steampowered.com/api/storesearch?term=&l=schinese&cc=cn` |
| 某款游戏的官方新闻 / 公告 | `api.steampowered.com/ISteamNews/GetNewsForApp/v2?appid=&count=` |
| 全局：特价 / 最新发售 / 即将发售 / 热销 | `store.steampowered.com/api/featuredcategories` |

**新增文件**
- `server/lib/webSearch.ts`：统一检索层（短超时 + 10 分钟缓存 + 失败即空 + 可达性回报），含 `detectWebIntent` / `extractTerm` / `resolveApp` / `runWebSearch` / `normalizeGameName`。
- `server/routes/diag.ts` → `GET /api/diag/egress`：出网探测（目标写死、只读，用于确定运行环境能连哪些外网）。

**接入链路（沿用「模型只写定性、事实本地注入」的防幻觉哲学）**
1. `chat` 先做意图识别：命中「资讯 / 最新 / 新闻 / 更新 / 发售 / 特价 / 打折…」→ 走联网分支；否则原目录推荐链路**完全不变**。
2. 联网分支：本地取回真实条目（标题 / 日期 / 链接 / 来源均来自接口原文）→ 交给 LLM 只写中文简报（明令禁止编造、禁止输出 URL）→ **链接由后端回填**，模型结构上碰不到出处。
3. 前端：回答下方渲染「🌐 联网来源」卡片（标题可点跳原文）+ 状态标「已联网 · N 条 / 联网不可用」+ 输入框旁「联网检索 自动 / 联网 / 关闭」三态开关。
4. **诚实降级**：全局类意图取不到数据 → 退回站内目录推荐并前置「（联网检索当前不可用…）」；指定游戏资讯取不到 → 如实说明，不硬塞无关游戏。

**⚠️ 两个关键环境事实（本步最大收获）**
1. **中文游戏名检索不可靠**：`storesearch` 对中文关键词经常返回 0（实测「艾尔登法环」0 条，而「elden」命中 ELDEN RING/1245620），且英文关键词会返回本地化中文名。→ 增加 `normalizeGameName()`：中文名搜不到时，让 LLM 把它规范化成**官方英文名**再搜。这一步只产出「检索词」，最终命中与否由 Steam 真实解析决定，不产生假数据。
2. **本机 vs 线上出网完全不同**：
   - 本机 Node 直连被墙（`UND_ERR_CONNECT_TIMEOUT`），系统代理 `127.0.0.1:7890` 可用 → 本地起后端需 `HTTPS_PROXY=http://127.0.0.1:7890` + `NODE_USE_ENV_PROXY=1`（**不要把这两个变量写进 `.env`**，否则会上传到线上干扰 DeepSeek 出口）。
   - 线上沙箱（Node v22.13.1）出网**白名单式且不稳定**：`store.steampowered.com` 时通时不通（实测一次 378ms/51KB 成功、一次 8s 超时）、`api.steampowered.com` 基本不可达、`baidu` / `deepseek` 可达、`rawg` / `github` ECONNRESET。
   - 因此线上：**全局新游动态可用**（偶发降级），**指定游戏新闻不可用**（自动用全局动态兜底）。为提升命中率给主数据源加了 1 次重试，超时压到 6s。

**验收**

| 项 | 本地 | 线上 |
|---|---|---|
| 联网层单测 `verifyWebSearch.ts` | **19/0** | — |
| 端到端 `verifyChatWeb.ts` | **18/0** | 契约版 `verifyWebProd.ts` **11/0** |
| 冒烟 `smokeAI.ts` | **23/23**（含 4 项新增） | — |
| 真机 UI `verifyWebUI.mjs` | 全绿（3 条真实链接、0 报错） | 全绿（6 条真实来源、0 报错） |
| 零编造校验 | 新闻条目链接**逐条比对直连接口原文** | 同左 |
| `vue-tsc` | 0 error | — |

线上实测（`docs/deploy-screenshots/ai-websearch.png`）：「已联网 · 6 条」+ 6 条真实来源（Steam 特价 / 最新发售，链接指向 `store.steampowered.com/app/…`）。

**顺带修复**：`server/lib/gameNews.ts` 中 `featuredcategories` 的字段是 `id` 而非 `appid`，原代码产出的 id 是 `steam_undefined`，已修正。

---

## 17. 联网来源扩量与口味相关性（用户反馈「只给了这几个链接，有点少」）

**问题定位（三处叠加，不是数据不够）**

| # | 位置 | 原因 |
|---|---|---|
| 1 | `server/lib/ai.ts` | `MAX_SOURCES = 6` 硬上限，前端最多只拿 6 条 |
| 2 | `server/lib/webSearch.ts` | 取数池太窄：口味类提问（无资讯词）被误判成「指定游戏资讯」，拿抽出的噪声词去搜商店必然失败 → 只用 `getFeatured(4)` 补 8 条 |
| 3 | 同上 | 回退路径只取「特价 + 最新发售」两类，「即将发售 / 热销榜」根本没进池 |

实测接口天花板：`featuredcategories` 每类真实有 **特价 10 / 最新发售 30 / 即将发售 10 / 热销 10**，6 条纯属自设。

**方案（用户拍板：20 条四类各 5 + 做轻量相关性）**
1. `MAX_SOURCES` 6 → **25**；`getFeatured(perCategory=5)` → 四类各 5 共 **20 条**。
2. **修误判**：命中口味词时走 `global` 快照（四类齐全），不再拿噪声词空搜游戏；指定游戏解析失败也改为回退四类快照（原来只补 4 条）。
3. **轻量相关性**：新增 `detectTasteLabels()`（15 组口味/类型词表）+ `findRelatedCatalogGames()`（按标签从站内 17 款里挑代表游戏，命中标签数优先、评分次之）+ `getRelatedGameSources()`（逐款取真实 Steam 动态）。相关条目排在最前，最多 5 条。
4. 前端按类别分组展示（`SOURCE_GROUPS`：相关游戏 / 游戏资讯 / 特价 / 最新发售 / 即将发售 / 热销榜）。

**⚠️ 相关性这层的边界（如实声明）**：Steam 免密钥公开接口**只支持按名字搜**，不支持按标签搜——实测 `storesearch?term=pixel` 返回的是《Pixel Gun 3D》而不是《星露谷物语》。所以「按类型精准检索」做不到，只能靠站内目录先映射出代表游戏。相关条目的形态是「相关游戏的最新动态」或「其商店页（含现价）」，不是全网泛搜。

**相关条目的取数与降级**：内置 `STEAM_EN_NAME`（17 款目录游戏的官方英文名，避免每轮调 LLM 做名字规范化）→ `searchSteamApp` 解析 appid → 先试 `getAppNews`（本地可达；线上多半不通）→ 不通则退回该游戏的商店页（含价格）。两条路都是真实接口原文。

**验收**

| 项 | 结果 |
|---|---|
| 端到端 `verifyChatWeb.ts` | **27/0**（新增：全局 ≥15 条 + ≥3 类；口味类 ≥15 条 + 含 related + 锚定真实 appid） |
| 冒烟 `smokeAI.ts` | **23/23**（并补了 429 退避，避免限流被误报成失败） |
| 真机 UI `verifyWebUI.mjs` | 全绿，来源 **24 条**、分组标题齐、0 报错 |
| `vue-tsc` | 0 error |

本地实测：问「我喜欢像素风和独立游戏」+ 强制联网 → 相关游戏 5 条（星露谷 3D/VR mod、星露谷 1.16.107 hotfix、死亡细胞工作室致谢 del Toro、死亡细胞 9/15 Patch Notes、潜水员戴夫 1.5.12620）+ 特价 5 + 最新发售 5 + 即将发售 5 + 热销榜 4 = **24 条**，AI 推荐卡片为星露谷 / 吸血鬼幸存者 / 死亡细胞 / 潜水员戴夫。截图见 `docs/web-screenshots/ai-websearch-groups-tall.png`。

---

## 18. 真·实时数据接入 + 全网搜索 provider + 诚实标注

**触发**：用户提问「能否获取到实时的最新的信息和数据」，随后选择四个方向全做（真·实时在线人数、主页模拟换真实、第三方搜索 API、诚实标注），并提供 Serper / Tavily 两把 key。

### 18.1 三类数据的真实度盘点（实施前）

| 数据 | 真实度 | 时效 | 本机 | 线上沙箱 |
|---|---|---|---|---|
| 特价 / 最新发售 / 即将发售 / 热销榜 | 真（Steam 商店） | 小时级 | ✅ | ✅ store 域放行 |
| 游戏名搜索 / 商店详情 / 价格 | 真（Steam 商店） | 请求即最新 | ✅ | ✅ |
| 单游戏官方新闻 / 公告 | 真（Steam API） | 有真实发布时间 | ✅ | ❌ api 域不通 |
| 当前在线人数 | **有真接口，原未接** | 分钟级（真·实时） | ✅ | ❌ api 域不通 |
| 主页「在线玩家 / 直播观众」 | **原为本地模拟**（`simulated: true`） | 正弦波假波动 | — | — |

**硬边界**：线上沙箱白名单只放行 `store.steampowered.com` 与 baidu；`api.steampowered.com` 8s 超时。故所有挂在 api 域的实时数据（在线人数、官方新闻、最热榜）**本机完整、线上降级**。

### 18.2 第 1 步｜真·实时在线人数

- 新增 `server/data/steamAppIds.ts`：站内 16 款 → appid 的**硬编码映射**（用 `storesearch` 一次性实解析生成）。理由：实时接口需要 appid，按名字搜每次要联网且中文名不可靠；目录固定，写死最稳最快且完全确定。VALORANT 未在 Steam 上架，无 appid（如实缺失）。
- 新增 `server/lib/steamRealtime.ts`：`ISteamUserStats/GetNumberOfCurrentPlayers`，单 appid 60s 缓存、单请求 3.5s 超时、**整批失败进入 5 分钟冷却**（否则线上每 5s 一次的 `/api/live` 轮询会反复撞超时拖慢首页）。失败即空，绝不返回假数。

### 18.3 第 2 步｜`/api/live` 改真实优先

- `getLiveStats()` 由同步改**异步**（`trend.ts` 同步调用点已改为 `await`）。
- 逐指标 `real` 标记：`totalGames`（真）· `onlinePlayers`（真·本机 / 演示·线上）· `deals`/`newToday`（Steam 商店真实计数，来自新增的 `getStoreCounts()`）· `streamingViewers`（**始终演示**，未接入 Twitch，如实暴露）。
- 趋势 `delta` 真实化：维护上一个**真实**采样窗口，按 60s 窗口算真实变化率；无历史时给 0，不再用假波动。直播观众的趋势数字仍为演示波动，故其 `real=false`。
- 主页四张卡：`收录游戏 / 在线玩家 / 特价中 / 今日上新`（原「直播观众」卡被替换——一个永远为假的指标不该占真数据看板的位置；直播观众仍保留在趋势区，但打「演示」角标）。

### 18.4 第 3 步｜第三方全网搜索 provider（可插拔）

- 新增 `server/lib/searchProviders.ts`：`Serper`（优先：免费额度 2500、有专门 news 频道、返回 Google 原生结构）→ `Tavily`（备选：AI 专用搜索、1000/月）→ 都不可用返回 `null`。
- 返回条目**归一化为 `WebSourceItem`**（新增 kind `web`）：标题 / 链接 / 日期 / 来源 / 摘要全部取接口原文，模型不参与 → 沿用防幻觉哲学。
- 相对时间（`"5 days ago"`）转时间戳，解析不出返回 `null`（宁缺毋滥）。
- 集成进 `runWebSearch`：`scope=game` 时查询词为「`<游戏名> 最新消息`」，否则用用户原话；**纯口味提问不搜全网**（避免拿噪声句搜出无关结果），改走站内口味映射。
- 单游戏场景追加**实时在线人数**（`fetchPlayerCount`）：数字由本地注入、模型完全接触不到；取不到就不加，绝不编数字。
- `MAX_SOURCES` 25 → 32（全网 10 + 商店四类 20 + 相关 5）。

### 18.5 第 4 步｜诚实标注

- 主页：每张统计卡「实时 / 演示」角标；底部状态标只描述**它正上方那四张卡**（避免张冠李戴）+「数据来源」行完整列出各源真实度。
- 趋势区：四个数字各自按 `snapshot.real` 打角标。
- 趋势 prompt 的 facts 里给模拟项显式标注「（演示数据）」，避免模型把演示数当事实解读。
- AI 助手来源区新增「全网资讯」分组 + 「全网 + Steam」标签。
- 新增诊断端点：`GET /api/diag/realtime`、`GET /api/diag/providers`。

### 18.6 验收

| 项 | 结果 |
|---|---|
| `verifyRealtime.ts`（新） | **24/0** |
| `verifyChatWeb.ts` 回归 | 27/0 |
| `smokeAI.ts` 回归 | 23/23 |
| 真机 `verifyRealtimeUI.mjs`（新） | 全绿：四卡齐全、来源行完整、10 个「实时」角标、0 报错 |
| 真机 `verifyWebUI.mjs` | 全绿：新增「全网资讯」分组与「全网 + Steam」标注断言 |
| `vue-tsc` | 0 error |

本机实测：实时在线 **15/15 款**、合计 71.7 万人（CS2 52.8 万、幻兽帕鲁 4.3 万…）；Serper 943ms / Tavily 688ms 均可用；问「最近有什么新游戏资讯」→ **29 条来源**（全网 10 + 特价/最新发售/即将发售/热销 19），provider=serper；问「艾尔登法环最近有什么更新」→ 正文附「📊 实时数据：当前 Steam 在线 20,490 人」，与 diag 一致。

**结论（如实记录）**：线上沙箱**能拿到商店侧真实数据**（特价/上新/搜索/价格），**拿不到** api 域的实时在线人数与官方新闻；第三方 provider 线上大概率也不可达 → 自动回退 Steam。线上表现由部署后实测确认。

---

## 19. 线上部署 + 出网实测修正 + 后端类型债清零（2026-09-23）

### 19.1 部署

第 18 节成果已上线：`https://gamevibe.app.workbuddy.host/`，`verified: true`。

### 19.2 ⚠️ 线上出网实测 —— 推翻第 18 节的判断

三轮 `GET /api/diag/egress`（线上 Node v22.13.1）：

| 目标 | 结果 | 旧判断 |
|---|---|---|
| `api.steampowered.com` | **200 / 200 / 200 稳定** | ❌ 旧记「不可达」 |
| `store.steampowered.com` | 超时 / 200 / 超时 **抖动** | 旧记「放行」（部分对） |
| `serper` / `tavily` / `deepseek` | 403 / 401 / 401（**网络通，仅缺 key**） | ❌ 旧记「大概率够不着」 |
| `api.twitch.tv`、`id.twitch.tv` | **ECONNRESET 稳定被拒** | 未记 |
| `rawg` / `github` | ECONNRESET | 一致 |

**线上实测红利（与第 18 节的悲观预期相反）**：
- `/api/diag/realtime` → **15/15 款真实在线人数，合计 82.6 万**（不是降级为演示数据）。
- `/api/diag/providers` → `anyUsable=true`，serper 与 tavily 线上都可用。

**硬阻塞（如实记录）**：**Twitch 与 IGDB 在线上都接不了** —— OAuth 取 token 必经 `id.twitch.tv`，被 ECONNRESET 拒绝；`api.igdb.com` 本机直连可达（401）但线上拿不到 token 也无意义。本机则相反：`api.twitch.tv` 直连超时、**走 7890 代理返回 401（连通）**。

### 19.3 诊断端点判据升级（三档）

`server/routes/diag.ts` 原判据是「2xx/3xx 才算通」，会把带鉴权接口的 401 误读成「被墙」——这正是当初误判 Twitch 的依据。现改为：

| 字段 | 含义 |
|---|---|
| `healthy` | 2xx/3xx，服务可用 |
| `needsAuth` | 401/403，**网络通、仅缺凭证** |
| `blocked` | 连不上（DNS / 超时 / 连接被拒） |

同时把 `twitch-api`、`twitch-oauth`、`serper`、`tavily` 加入探测目标。

### 19.4 后端类型债清零（52 处 → 0，历史首次通过）

`npm run server:typecheck` 此前从未通过，属长期失效的安全网。逐类修复：

| 类别 | 数量 | 根因与修法 |
|---|---|---|
| `CatalogGame` 缺字段 | 17 | `catalog.ts` 生成本就带 `coverUrl`，接口漏声明 → `server/types.ts` 补上 |
| `c.get('userId')` 为 unknown | 21 | `use('*', mw)` 挂载时 Hono **不**传播 Variables → 路由声明 `new Hono<{ Variables: {...} }>()` |
| SQL 值类型 | 3 | `auth.ts` 用 `String()` 包装 |
| 类型转换不兼容 | 1 | `reviewDigest.ts` 改 `as unknown as` |
| **mock 字段拼写（真 bug）** | 2 | `steamReviews.ts` 的 `playtime_forevar`→`playtime_forever`、`origin`→`author`、`playtimeforever`→`playtime_forever`；**`author` 写错会让作者名取不到** |
| 后端误引入前端文件 | 1 | `server/routes/games.ts` import 了 `src/data/games.ts` → tsconfig 加 `baseUrl` + `paths` |

**关键坑（已实证）**：`paths` 只写 `"@/*": ["./src/*"]` **不生效**。`moduleResolution: NodeNext` 属 ESM 语义，不带扩展名的说明符只被当目录查找、不试 `.ts`。必须补第二个候选 `"./src/*.ts"`。用 `tsc --traceResolution` 可确认。

### 19.5 详情页文案修正

原文「引用均为站内真实玩家评论原文…· 评论为演示数据」自相矛盾：引文确实照抄站内 `reviews` 表原文（未经改写），但该表主体是种子数据。改为「引文照抄站内评论原文（未经改写）… · 站内评论含演示数据」。

### 19.6 验收

| 项 | 结果 |
|---|---|
| 后端 `tsc -p tsconfig.server.json` | **0 error**（历史首次） |
| `vue-tsc -b` | 通过 |
| `smokeAI.ts` | **23/23** |
| `verifyRealtime.ts` | **24/0** |
| 线上 `diag/realtime` | **15/15**（82.6 万） |
| 线上 `diag/providers` | serper + tavily 双通 |

### 19.7 未决事项

- **Twitch / IGDB 方向需重新决策**：线上不可用、本机可用（详见 19.2）。
- 站内 16 款游戏目录仍是静态 mock（`src/data/games.ts`，被 12 个文件引用），只有 Steam 动态与评论是真数据。
- 若未来切真实数据源，`STEAM_EN_NAME`（16 款官方英文名）与 `steamAppIds`（16 款 appid）两处硬编码映射需同步改为动态解析。

---

*本文件为施工图纸，Step A–E、可见性修复（第 15 节）、联网检索（第 16 节）、来源扩量与口味相关性（第 17 节）、真·实时数据与全网搜索（第 18 节）、线上部署与类型债清零（第 19 节）均已实施、验收。*

