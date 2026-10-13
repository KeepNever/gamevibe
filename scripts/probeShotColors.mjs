// 统计截图分区主色 + 裁出左侧侧边栏区域放大另存，便于目视
// 用法: node scripts/probeShotColors.mjs <图片路径> [裁剪输出路径]
import { chromium } from 'playwright'
import fs from 'node:fs'

delete process.env.HTTPS_PROXY
delete process.env.HTTP_PROXY
delete process.env.ALL_PROXY

const file = process.argv[2]
const clipOut = process.argv[3]
const [fy0, fy1] = (process.argv[4] || '0,0.28').split(',').map(Number)
const b64 = fs.readFileSync(file).toString('base64')

const browser = await chromium.launch({ args: ['--no-proxy-server'] })
const page = await browser.newPage()
await page.setContent('<html><body></body></html>')

const out = await page.evaluate(
  async ({ b64, wantClip, fy0, fy1 }) => {
    const img = new Image()
    img.src = 'data:image/png;base64,' + b64
    await img.decode()
    const W = img.naturalWidth
    const H = img.naturalHeight
    const c = document.createElement('canvas')
    c.width = W
    c.height = H
    const ctx = c.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const full = ctx.getImageData(0, 0, W, H)

    // 分区统计：左半 / 右半 的平均色与最亮/最暗
    function stat(x0, x1) {
      let r = 0, g = 0, b = 0, n = 0
      let minL = 255, maxL = 0
      for (let y = 0; y < H; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * W + x) * 4
          r += full.data[i]
          g += full.data[i + 1]
          b += full.data[i + 2]
          const L = (full.data[i] * 299 + full.data[i + 1] * 587 + full.data[i + 2] * 114) / 1000
          if (L < minL) minL = L
          if (L > maxL) maxL = L
          n++
        }
      }
      const hex = (v) => Math.round(v / n).toString(16).padStart(2, '0')
      return { avg: '#' + hex(r) + hex(g) + hex(b), minL: Math.round(minL), maxL: Math.round(maxL) }
    }

    const right = stat(Math.floor(W * 0.78), W)
    const left = stat(0, Math.floor(W * 0.78))

    let clipData = null
    if (wantClip) {
      const cw = W
      const sy = Math.round(H * fy0)
      const ch = Math.max(1, Math.round(H * fy1) - sy)
      const cc = document.createElement('canvas')
      cc.width = cw * 2
      cc.height = ch * 2
      const cx = cc.getContext('2d')
      cx.imageSmoothingEnabled = false
      cx.drawImage(img, 0, sy, cw, ch, 0, 0, cw * 2, ch * 2)
      clipData = cc.toDataURL('image/png').split(',')[1]
    }
    return { W, H, left, right, clipData }
  },
  { b64, wantClip: !!clipOut, fy0, fy1 },
)

console.log(JSON.stringify({ W: out.W, H: out.H, left: out.left, right: out.right }, null, 1))
if (clipOut && out.clipData) {
  fs.writeFileSync(clipOut, Buffer.from(out.clipData, 'base64'))
  console.log('已裁剪放大输出:', clipOut)
}
await browser.close()
