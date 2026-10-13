// 仅用于本机构建（scripts/syncDist.mjs 调用）。
//
// 与 vite.config.ts 的差别只有一处：把产物写进中转目录 .build-out，
// 且 **关掉 emptyOutDir** —— 否则 vite 会试图清空目录，触发本机工具沙箱的
// 批量删除拦截，整个构建直接失败（详见 scripts/syncDist.mjs 顶部说明）。
//
// 线上部署仍然走 vite.config.ts 的默认行为（输出 dist/ 并自动清空），不受影响。
import { defineConfig, mergeConfig } from 'vite'
import base from './vite.config.ts'

export default mergeConfig(
  base,
  defineConfig({
    build: {
      outDir: '.build-out',
      emptyOutDir: false,
    },
  }),
)
