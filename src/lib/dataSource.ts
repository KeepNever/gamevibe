import type { Game } from '@/types/game'
import { games as mockGames } from '@/data/games'

/**
 * 数据源接入层（前端脚手架）
 *
 * 当前使用本地 mock 数据。配置环境变量后可无缝切换到真实数据源：
 *   - IGDB（Twitch 旗下游戏数据库，覆盖全、元数据丰富）
 *   - Steam Store API（价格、在线人数、评测）
 *
 * 由于全站组件目前以同步方式消费 `games`，真实数据接入建议配合后端代理
 * （避免 CORS 与密钥暴露），届时只需实现下方 `GameProvider` 接口并在
 * `getProvider()` 中返回即可，UI 层无需改动。
 */

export interface GameProvider {
  id: string
  name: string
  /** 拉取游戏列表（真实实现应返回与本地结构一致的 Game[]） */
  getGames: () => Promise<Game[]>
}

/** 本地 Mock 数据源（默认） */
const mockProvider: GameProvider = {
  id: 'mock',
  name: '本地示例数据',
  async getGames() {
    return mockGames
  },
}

/**
 * IGDB 数据源（骨架）
 * 真实接入时：
 *   1. 在后端代理 IGDB /oauth2/token 与 /v4/games 接口
 *   2. 将返回字段映射为 Game 结构
 *   3. 在下方返回 igdbProvider
 */
const igdbProvider: GameProvider = {
  id: 'igdb',
  name: 'IGDB',
  async getGames() {
    const clientId = import.meta.env.VITE_IGDB_CLIENT_ID
    const base = import.meta.env.VITE_GAME_API_BASE
    if (!clientId || !base) {
      console.warn('[数据源] 未配置 IGDB，降级到本地数据')
      return mockGames
    }
    // TODO(后端): 通过后端代理拉取并映射为 Game[]
    // const res = await fetch(`${base}/games?limit=50`, { headers: { 'Client-ID': clientId, ... } })
    // const raw = await res.json()
    // return raw.map(mapIgdbToGame)
    return mockGames
  },
}

function getProvider(): GameProvider {
  const source = (import.meta.env.VITE_GAME_SOURCE as string | undefined) || 'mock'
  return source === 'igdb' ? igdbProvider : mockProvider
}

/** 统一的游戏数据获取入口 */
export async function fetchGames(): Promise<Game[]> {
  const provider = getProvider()
  try {
    return await provider.getGames()
  } catch (err) {
    console.warn(`[数据源] ${provider.name} 拉取失败，降级到本地数据`, err)
    return mockGames
  }
}

export const currentSource = getProvider().name
