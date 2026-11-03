// 一次性补丁：AdminUsers.vue 补 RouterLink / relativeShort / 修路由绑定
import { readFileSync, writeFileSync } from 'node:fs'

const f = 'src/pages/AdminUsers.vue'
let s = readFileSync(f, 'utf8')

if (!s.includes('RouterLink')) {
  s = s.replace(
    "import { ref, onMounted, computed } from 'vue'",
    "import { ref, onMounted, computed } from 'vue'\nimport { RouterLink } from 'vue-router'",
  )
}

if (!s.includes('function relativeShort')) {
  const helper = [
    'const toast = useToastStore()',
    '',
    'function relativeShort(ts: number): string {',
    '  const d = Date.now() - ts',
    '  const m = 60_000, h = 3_600_000, day = 86_400_000',
    "  if (d < m) return '刚刚'",
    '  if (d < h) return `${Math.floor(d / m)} 分钟前`',
    '  if (d < day) return `${Math.floor(d / h)} 小时前`',
    '  const dt = new Date(ts)',
    "  return `${dt.getMonth() + 1}-${dt.getDate()} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`",
    '}',
  ].join('\n')
  s = s.replace('const toast = useToastStore()', helper)
}

// 修绑定：:to="/game/" + r.game_id  →  :to="'/game/' + r.game_id"
s = s.replace(':to="/game/" + r.game_id', ':to="\'/game/\' + r.game_id"')

writeFileSync(f, s)
console.log('补丁完成')
