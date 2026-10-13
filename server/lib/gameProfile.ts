// 游戏语义画像读取层（运行期只读）
//
// 数据来源：Step B 冻结的 game_profiles 批次（profile_batches.is_active = 1）
// 原则：catalog.ts 是事实源，画像表是可重建的派生资产；这里只读，绝不生成。
// 降级：表缺失 / 无激活批次 / 查询异常 → 返回空 Map，调用方自行回退到 genres/tags 逻辑。

import { db } from '../db/index.ts'

export interface GameProfile {
  gameId: string
  storyIntensity: number
  difficulty: number
  exploration: number
  combatIntensity: number
  coreGameplay: string[]
  multiplayer: string
  estimatedLength: string
  targetPlayers: string
  semanticSummary: string
  contentNotes: string
}

/** 四个 1-5 分值维度 */
export const DIMENSIONS = ['story', 'difficulty', 'exploration', 'combat'] as const
export type Dimension = (typeof DIMENSIONS)[number]

export const DIM_LABEL: Record<Dimension, string> = {
  story: '剧情',
  difficulty: '难度',
  exploration: '探索',
  combat: '战斗',
}

export const DIM_HIGH_LABEL: Record<Dimension, string> = {
  story: '重剧情',
  difficulty: '高难度',
  exploration: '重探索',
  combat: '强战斗',
}

export const DIM_LOW_LABEL: Record<Dimension, string> = {
  story: '轻剧情',
  difficulty: '低难度',
  exploration: '轻探索',
  combat: '弱战斗',
}

export interface ActiveBatchInfo {
  batchId: string
  model: string | null
  promptVersion: string | null
  createdAt: string | null
  gameCount: number
  verifiedCount: number
  coverage: number
}

interface ProfileCache {
  batchId: string | null
  map: Map<string, GameProfile>
}

let cache: ProfileCache = { batchId: null, map: new Map() }

/** 查询当前激活（且已冻结）的批次 id；异常时返回 null */
export function getActiveBatchId(): string | null {
  try {
    const row = db
      .prepare("SELECT batch_id FROM profile_batches WHERE is_active=1 AND status='frozen' ORDER BY created_at DESC LIMIT 1")
      .get() as { batch_id?: string } | undefined
    return row?.batch_id ?? null
  } catch {
    return null
  }
}

/** 批次溯源信息（供画像接口展示「数据从哪来」） */
export function getActiveBatchInfo(): ActiveBatchInfo | null {
  try {
    const row = db
      .prepare("SELECT * FROM profile_batches WHERE is_active=1 AND status='frozen' ORDER BY created_at DESC LIMIT 1")
      .get() as any
    if (!row) return null
    const cnt = db.prepare('SELECT COUNT(*) AS c FROM game_profiles WHERE batch_id=?').get(row.batch_id) as any
    return {
      batchId: row.batch_id,
      model: row.model ?? null,
      promptVersion: row.prompt_version ?? null,
      createdAt: row.created_at ?? null,
      gameCount: row.game_count ?? cnt.c,
      verifiedCount: row.verified_count ?? 0,
      coverage: cnt.c,
    }
  } catch {
    return null
  }
}

function toProfile(r: any): GameProfile {
  return {
    gameId: r.game_id,
    storyIntensity: Number(r.story_intensity) || 0,
    difficulty: Number(r.difficulty) || 0,
    exploration: Number(r.exploration) || 0,
    combatIntensity: Number(r.combat_intensity) || 0,
    coreGameplay: String(r.core_gameplay || '')
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean),
    multiplayer: String(r.multiplayer || ''),
    estimatedLength: String(r.estimated_length || ''),
    targetPlayers: String(r.target_players || ''),
    semanticSummary: String(r.semantic_summary || ''),
    contentNotes: String(r.content_notes || ''),
  }
}

/**
 * 读取激活批次的全部画像。内部按 batch_id 缓存，仅在激活批次变化时重载。
 * 每次调用只做一次极轻的批次查询，运行期不触发任何 LLM。
 */
export function loadGameProfiles(): Map<string, GameProfile> {
  const batchId = getActiveBatchId()
  if (cache.batchId === batchId) return cache.map

  const map = new Map<string, GameProfile>()
  if (batchId) {
    try {
      const rows = db.prepare('SELECT * FROM game_profiles WHERE batch_id=?').all(batchId) as any[]
      for (const r of rows) map.set(r.game_id, toProfile(r))
    } catch {
      // 表缺失或结构异常 → 视作无画像，交由调用方降级
    }
  }
  cache = { batchId, map }
  return map
}

export function getGameProfile(gameId: string): GameProfile | null {
  return loadGameProfiles().get(gameId) ?? null
}

/** 该游戏画像的维度分值数组（供相似度计算） */
export function dimVector(p: GameProfile): number[] {
  return [p.storyIntensity, p.difficulty, p.exploration, p.combatIntensity]
}
