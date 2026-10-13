# AI 效果评测报告（baseline）

- 时间：2026-09-22T07:59:25.504Z
- 评测集：`eval/queries.jsonl`（30 条）
- 链路：`POST /api/ai/chat`（真实 LLM，含接地两遍式）
- 画像批次：profiles-20260922-1543

## 汇总

| 指标 | 结果 | 通过线 |
|---|---|---|
| 硬条件遵守率 | 62.1% | 100% |
| 无编造 id（返回项均在目录内） | 100% | 100% |
| 事实正确率（无编造价格） | 100% | ≥98% |
| 空结果率（答「没找到」但目录里有） | 6.7%（2/30） | 0 |
| 自动分（0-5，硬条件一票否决） | 3.17 | ≥3.5 |

> 自动分 = 基础 3 + 目录内 1 + 事实正确 1；硬条件不满足直接记 0。
> 「表达质量」需人工按 1-5 打分填入下表最后一列，本表不替代人工判断。

## 逐条明细

| # | 用户 query | 硬条件判定 | 返回游戏 | 硬条件 | 事实 | 自动分 | 人工分 |
|---|---|---|---|---|---|---|---|
| q01 | 有没有免费的游戏推荐 | free=✓ | valorant, cs2 | ✅ | ✅ | 5 | |
| q02 | 我没什么预算，0元能玩的 | free=✓ | valorant, cs2 | ✅ | ✅ | 5 | |
| q03 | 白嫖党求推荐，免费的最好 | free=✓ | valorant, cs2 | ✅ | ✅ | 5 | |
| q04 | 100块以内的游戏 | price_lte100=✓ | vampire-survivors, dead-cells, hollow-knight, stardew-valley | ✅ | ✅ | 5 | |
| q05 | 预算50元以内有什么好玩的 | price_lte50=✗ | — | ❌ | ✅ | 0 | |
| q06 | 类似空洞骑士的游戏 | any=✗ | hollow-knight, dead-cells, lies-of-p, hades-2 | ❌ | ✅ | 0 | |
| q07 | 类似星露谷的种田游戏 | any=✗ | stardew-valley, dave-the-diver, vampire-survivors | ❌ | ✅ | 0 | |
| q08 | 推荐点像素风游戏 | tag[像素风]=✗ | stardew-valley, dead-cells, hollow-knight, vampire-survivors | ❌ | ✅ | 0 | |
| q09 | 我要像素风的肉鸽 | tag[像素风]=✗ + genre[Roguelike]=✓ | dead-cells, vampire-survivors, hades-2 | ❌ | ✅ | 0 | |
| q10 | 有什么好玩的Roguelike | genre[Roguelike]=✓ | hades-2, dead-cells, vampire-survivors | ✅ | ✅ | 5 | |
| q11 | 评分最高的神作，9.5分以上那种 | rating_gte9.5=✗ | elden-ring, baldurs-gate-3, disco-elysium, god-of-war | ❌ | ✅ | 0 | |
| q12 | 9分以上的动作游戏 | rating_gte9=✗ + genre[动作]=✓ | elden-ring, god-of-war, hollow-knight, monster-hunter-wilds | ❌ | ✅ | 0 | |
| q13 | 高难度的魂类游戏 | genre[魂类]=✓ | elden-ring, lies-of-p | ✅ | ✅ | 5 | |
| q14 | 想要能受苦的硬核动作游戏 | any=✓ | elden-ring, lies-of-p, hollow-knight, dead-cells | ✅ | ✅ | 5 | |
| q15 | 难度不要太高，轻松一点的 | difficulty_lte3=✓ | stardew-valley, dave-the-diver, vampire-survivors | ✅ | ✅ | 5 | |
| q16 | 能和朋友一起联机的合作游戏 | multiplayer[co-op/both]=✓ | palworld, monster-hunter-wilds, baldurs-gate-3, stardew-valley | ✅ | ✅ | 5 | |
| q17 | 双人合作的生存建造游戏 | multiplayer[co-op/both]=✓ | palworld | ✅ | ✅ | 5 | |
| q18 | 能长期玩下去的游戏 | length[ongoing/>60h]=✓ | stardew-valley, monster-hunter-wilds, baldurs-gate-3, elden-ring | ✅ | ✅ | 5 | |
| q19 | 玩不腻的长线游戏 | length[ongoing/>60h]=✓ | elden-ring, baldurs-gate-3, monster-hunter-wilds, stardew-valley | ✅ | ✅ | 5 | |
| q20 | 单人剧情向的游戏 | multiplayer[none/single/co-op]=✓ + story_gte4=✓ | baldurs-gate-3, cyberpunk-2077, disco-elysium, god-of-war | ✅ | ✅ | 5 | |
| q21 | 剧情很强的RPG | story_gte4=✓ + genre[RPG]=✓ | baldurs-gate-3, disco-elysium, cyberpunk-2077, elden-ring | ✅ | ✅ | 5 | |
| q22 | 休闲放松的游戏 | any=✗ | stardew-valley, dave-the-diver, vampire-survivors | ❌ | ✅ | 0 | |
| q23 | 一小时就能上手的短游戏 | length[<5h/5-15h]=✗ | vampire-survivors, hades-2, dead-cells | ❌ | ✅ | 0 | |
| q24 | 射击竞技游戏 | genre[射击/FPS]=✓ | valorant, cs2 | ✅ | ✅ | 5 | |
| q25 | 开放世界探索类的游戏 | genre[开放世界]=✓ | elden-ring, cyberpunk-2077, palworld, monster-hunter-wilds | ✅ | ✅ | 5 | |
| q26 | 模拟经营类的游戏 | genre[模拟]=✗ | stardew-valley, dave-the-diver, palworld | ❌ | ✅ | 0 | |
| q27 | 免费又好玩的第一人称射击 | free=✓ + genre[射击/FPS]=✓ | valorant, cs2 | ✅ | ✅ | 5 | |
| q28 | 100元以内的高分RPG | price_lte100=✗ + genre[RPG]=✗ | — | ❌ | ✅ | 0 | |
| q29 | 类似极乐迪斯科的叙事游戏 | any=✓ | disco-elysium, baldurs-gate-3, cyberpunk-2077 | ✅ | ✅ | 5 | |
| q30 | 帮我随便推荐几款好玩的 | （软查询） | elden-ring, baldurs-gate-3, stardew-valley, hades-2 | — | ✅ | 5 | |