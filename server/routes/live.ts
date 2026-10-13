import { Hono } from 'hono'
import { getLiveStats } from '../lib/live.ts'

// 动态实时数据（真实优先：Steam 官方实时在线 + 商店实时计数；不可达时降级为演示数据并如实标记）
const live = new Hono()

live.get('/', async (c) => c.json(await getLiveStats()))

export default live
