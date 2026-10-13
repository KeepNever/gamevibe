<script setup lang="ts">
import { computed } from 'vue'
import { Share2, Download, Copy, Link2, X, Check } from 'lucide-vue-next'
import { useToastStore } from '@/stores/toastStore'

interface ShareGame {
  id: string
  name: string
  coverUrl: string
  rating?: number | null
  description?: string | null
  genres?: string[]
}

const props = defineProps<{ game: ShareGame; open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const toast = useToastStore()

const shareUrl = computed(() => `${window.location.origin}/game/${props.game.id}`)
const tagline = computed(() => {
  const d = props.game.description?.replace(/<[^>]+>/g, '') || ''
  return d.length > 80 ? d.slice(0, 80) + '…' : d
})

async function copyText(text: string, okMsg: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.add(okMsg, 'success')
  } catch {
    toast.add('复制失败，请手动复制', 'error')
  }
}

function shareText() {
  const r = props.game.rating ? `（评分 ${props.game.rating}）` : ''
  return `我在 GameVibe 发现了《${props.game.name}》${r}，快来一起看：${shareUrl.value}`
}

// ── 导出 PNG（canvas 手绘，零依赖）──
function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number, maxLines = 3) {
  const chars = text.split('')
  let line = ''
  let lines = 0
  for (const ch of chars) {
    if (ctx.measureText(line + ch).width > maxW && lines < maxLines - 1) {
      ctx.fillText(line, x, y)
      line = ch
      y += lh
      lines++
    } else {
      line += ch
    }
  }
  // 最后一行截断
  if (ctx.measureText(line).width > maxW) {
    while (ctx.measureText(line + '…').width > maxW && line.length) line = line.slice(0, -1)
    line += '…'
  }
  ctx.fillText(line, x, y)
  return y
}

async function exportPng() {
  const scale = 2
  const W = 600
  const H = 800
  const canvas = document.createElement('canvas')
  canvas.width = W * scale
  canvas.height = H * scale
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.scale(scale, scale)

  // 背景
  const grad = ctx.createLinearGradient(0, 0, 0, H)
  grad.addColorStop(0, '#1e1b4b')
  grad.addColorStop(1, '#0b1020')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, W, H)

  // 封面
  const cover = await loadImage(props.game.coverUrl)
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, W, 340)
  ctx.clip()
  if (cover) {
    // cover cover-fit
    const ar = cover.width / cover.height
    let dw = W
    let dh = W / ar
    let dx = 0
    let dy = (340 - dh) / 2
    if (dh < 340) {
      dh = 340
      dw = 340 * ar
      dx = (W - dw) / 2
      dy = 0
    }
    ctx.drawImage(cover, dx, dy, dw, dh)
  } else {
    ctx.fillStyle = '#312e81'
    ctx.fillRect(0, 0, W, 340)
    ctx.fillStyle = '#a5b4fc'
    ctx.font = 'bold 120px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(props.game.name.charAt(0), W / 2, 220)
    ctx.textAlign = 'left'
  }
  ctx.restore()
  // 封面底部渐隐
  const cg = ctx.createLinearGradient(0, 220, 0, 340)
  cg.addColorStop(0, 'rgba(11,16,32,0)')
  cg.addColorStop(1, 'rgba(11,16,32,0.95)')
  ctx.fillStyle = cg
  ctx.fillRect(0, 220, W, 120)

  // 品牌
  ctx.fillStyle = '#fff'
  ctx.font = 'bold 22px sans-serif'
  ctx.fillText('🎮 GameVibe', 24, 40)

  // 标题
  ctx.fillStyle = '#fff'
  ctx.font = 'bold 32px sans-serif'
  let y = wrapText(ctx, props.game.name, 24, 410, W - 48, 38, 2)
  y += 20

  // 评分
  if (props.game.rating != null) {
    ctx.fillStyle = '#fbbf24'
    ctx.font = '20px sans-serif'
    const full = Math.round(props.game.rating)
    let stars = ''
    for (let i = 0; i < 5; i++) stars += i < full ? '★' : '☆'
    ctx.fillText(stars, 24, y)
    ctx.fillStyle = '#cbd5e1'
    ctx.font = '16px sans-serif'
    ctx.fillText(String(props.game.rating), 24 + 130, y)
    y += 34
  }

  // 简介
  if (tagline.value) {
    ctx.fillStyle = '#cbd5e1'
    ctx.font = '16px sans-serif'
    y = wrapText(ctx, tagline.value, 24, y + 6, W - 48, 24, 3)
    y += 14
  }

  // 类型胶囊
  const genres = (props.game.genres || []).slice(0, 4)
  let gx = 24
  ctx.font = '14px sans-serif'
  for (const g of genres) {
    const tw = ctx.measureText(g).width + 24
    ctx.fillStyle = 'rgba(139,92,246,0.25)'
    roundRect(ctx, gx, y, tw, 28, 14)
    ctx.fill()
    ctx.fillStyle = '#ddd6fe'
    ctx.fillText(g, gx + 12, y + 19)
    gx += tw + 8
  }

  // 底部分隔 + 口令
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'
  ctx.beginPath()
  ctx.moveTo(24, H - 56)
  ctx.lineTo(W - 24, H - 56)
  ctx.stroke()
  ctx.fillStyle = '#94a3b8'
  ctx.font = '15px sans-serif'
  ctx.fillText('在 GameVibe 发现你的下一款游戏', 24, H - 30)
  ctx.fillStyle = '#a78bfa'
  ctx.font = 'bold 15px sans-serif'
  ctx.textAlign = 'right'
  ctx.fillText(shareUrl.value, W - 24, H - 30)
  ctx.textAlign = 'left'

  // 导出
  try {
    const blob: Blob | null = await new Promise((res) => canvas.toBlob((b) => res(b), 'image/png'))
    if (!blob) throw new Error('blob null')
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `GameVibe-${props.game.name}.png`
    a.click()
    URL.revokeObjectURL(url)
    toast.add('分享卡片已导出', 'success')
  } catch {
    toast.add('封面来自外部图床，无法直接导出图片，已为你复制分享链接', 'info')
    copyText(shareUrl.value, '链接已复制')
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="open" class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" @click.self="emit('close')">
        <div class="w-full max-w-md rounded-3xl bg-[var(--surface)] border border-[var(--border)] shadow-2xl overflow-hidden">
          <!-- 头部 -->
          <div class="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
            <div class="flex items-center gap-2 text-[var(--text)] font-semibold">
              <Share2 class="w-5 h-5 text-accent" /> 分享《{{ game.name }}》
            </div>
            <button @click="emit('close')" class="p-1.5 rounded-lg hover:bg-[var(--surface-2)] text-[var(--text-dim)] transition-colors">
              <X class="w-5 h-5" />
            </button>
          </div>

          <!-- 预览卡 -->
          <div class="p-5">
            <div class="relative rounded-2xl overflow-hidden bg-gradient-to-b from-[#1e1b4b] to-[#0b1020] border border-white/10">
              <div class="relative h-40 bg-[var(--surface-3)]">
                <img v-if="game.coverUrl" :src="game.coverUrl" :alt="game.name" class="w-full h-full object-cover" />
                <div v-else class="w-full h-full flex items-center justify-center text-5xl font-bold text-[var(--text-faint)]">{{ game.name.charAt(0) }}</div>
                <div class="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#0b1020] to-transparent"></div>
                <div class="absolute top-3 left-3 text-sm font-bold text-white drop-shadow">🎮 GameVibe</div>
              </div>
              <div class="p-4">
                <h3 class="text-lg font-display font-bold text-white leading-snug">{{ game.name }}</h3>
                <div v-if="game.rating != null" class="flex items-center gap-1 mt-1">
                  <span class="text-accent-amber text-sm">{{ '★'.repeat(Math.round(game.rating)) }}<span class="text-white/30">{{ '★'.repeat(5 - Math.round(game.rating)) }}</span></span>
                  <span class="text-xs text-white/60 ml-1">{{ game.rating }}</span>
                </div>
                <p v-if="tagline" class="text-xs text-white/70 mt-2 leading-relaxed line-clamp-3">{{ tagline }}</p>
                <div v-if="game.genres?.length" class="flex flex-wrap gap-1.5 mt-3">
                  <span v-for="g in game.genres.slice(0, 4)" :key="g" class="text-[11px] px-2 py-0.5 rounded-full bg-accent/20 text-accent-cyan">{{ g }}</span>
                </div>
                <div class="mt-4 pt-3 border-t border-white/10 flex items-center justify-between text-[11px] text-white/50">
                  <span>在 GameVibe 发现你的下一款游戏</span>
                </div>
              </div>
            </div>

            <!-- 操作 -->
            <div class="grid grid-cols-3 gap-2 mt-4">
              <button @click="exportPng" class="flex flex-col items-center gap-1 py-3 rounded-xl bg-accent text-white text-xs font-medium hover:bg-accent-strong transition-colors">
                <Download class="w-4 h-4" /> 导出图片
              </button>
              <button @click="copyText(shareText(), '分享文案已复制')" class="flex flex-col items-center gap-1 py-3 rounded-xl bg-[var(--surface-2)] text-[var(--text)] text-xs font-medium hover:bg-[var(--surface-3)] transition-colors">
                <Copy class="w-4 h-4" /> 复制文案
              </button>
              <button @click="copyText(shareUrl, '链接已复制')" class="flex flex-col items-center gap-1 py-3 rounded-xl bg-[var(--surface-2)] text-[var(--text)] text-xs font-medium hover:bg-[var(--surface-3)] transition-colors">
                <Link2 class="w-4 h-4" /> 复制链接
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
