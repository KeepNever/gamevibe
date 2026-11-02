<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import {
  User, ShieldCheck, Monitor, Database, Camera, Loader2, Check, AlertCircle,
  Mail, Phone, KeyRound, LogOut, Trash2, Download, Clock, X, Info, ChevronRight,
} from 'lucide-vue-next'
import { useAuthStore } from '@/stores/authStore'
import * as acct from '@/lib/accountApi'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

type TabKey = 'profile' | 'security' | 'devices' | 'privacy'

const tabs: { key: TabKey; label: string; icon: any; desc: string }[] = [
  { key: 'profile', label: '个人资料', icon: User, desc: '昵称、头像、用户名' },
  { key: 'security', label: '账号安全', icon: ShieldCheck, desc: '密码、邮箱、手机' },
  { key: 'devices', label: '登录设备', icon: Monitor, desc: '查看并踢下线' },
  { key: 'privacy', label: '数据与隐私', icon: Database, desc: '导出、日志、注销' },
]

const active = ref<TabKey>('profile')
const loading = ref(true)
const view = ref<acct.AccountView | null>(null)
const sessions = ref<acct.SessionItem[]>([])
const audit = ref<acct.AuditItem[]>([])

const toast = reactive<{ type: 'ok' | 'err'; msg: string; at: number }>({ type: 'ok', msg: '', at: 0 })
function say(type: 'ok' | 'err', msg: string) {
  toast.type = type
  toast.msg = msg
  toast.at = Date.now()
  window.clearTimeout((say as any)._t)
  ;(say as any)._t = window.setTimeout(() => (toast.msg = ''), 4200)
}

/** 各表单的提交态，避免一个按钮转圈全村转圈 */
const busy = reactive<Record<string, boolean>>({})
async function run(key: string, fn: () => Promise<void>) {
  if (busy[key]) return
  busy[key] = true
  try {
    await fn()
  } catch (e: any) {
    say('err', e?.message || '操作失败')
  } finally {
    busy[key] = false
  }
}

// ── 个人资料 ───────────────────────────────────────────
const profile = reactive({ display_name: '', bio: '', avatar: '' })
const nameForm = ref('')

function fillFromView(v: acct.AccountView) {
  view.value = v
  profile.display_name = v.user.display_name || v.user.username
  profile.bio = v.user.bio || ''
  profile.avatar = v.user.avatar || ''
  if (!nameForm.value) nameForm.value = v.user.username
}

const avatarPreview = computed(() => profile.avatar && /^https?:\/\//.test(profile.avatar) ? profile.avatar : '')
const avatarChar = computed(() =>
  (profile.display_name || auth.user?.username || '?').trim()[0]?.toUpperCase() || '?',
)
const dirty = computed(() => {
  const u = view.value?.user
  if (!u) return false
  return (
    profile.display_name !== (u.display_name || u.username) ||
    profile.bio !== (u.bio || '') ||
    profile.avatar !== (u.avatar || '')
  )
})

async function saveProfile() {
  const d = await acct.updateProfile({
    display_name: profile.display_name,
    bio: profile.bio,
    avatar: profile.avatar,
  })
  fillFromView(d)
  auth.patchUser({
    display_name: d.user.display_name,
    bio: d.user.bio,
    avatar: d.user.avatar,
  })
  say('ok', d.changed ? `已保存 ${d.changed} 项修改` : '没有需要保存的修改')
}

// ── 用户名 ─────────────────────────────────────────────
const canRename = computed(() => !!view.value?.meta.canRename)
const renameHint = computed(() => {
  const at = view.value?.meta.canRenameAt
  if (!at) return '用户名是账号的唯一标识，修改后旧名字会释放给他人使用'
  return `用户名有 ${view.value?.meta.renameCooldownDays || 30} 天冷却，下次可改：${acct.formatTime(at)}`
})

async function saveUsername() {
  const next = nameForm.value.trim()
  if (!next || next === view.value?.user.username) {
    say('err', '请输入新的用户名')
    return
  }
  const d = await acct.updateUsername(next)
  fillFromView(d)
  auth.patchUser({ username: d.user.username })
  say('ok', '用户名已更新')
}

// ── 密码 ───────────────────────────────────────────────
const pwd = reactive({ current: '', next: '', confirm: '' })
const pwdError = computed(() => {
  if (!pwd.next) return ''
  if (pwd.next.length < 8) return '密码至少 8 位'
  if (!/[a-zA-Z]/.test(pwd.next) || !/[0-9]/.test(pwd.next)) return '需同时包含字母和数字'
  if (pwd.confirm && pwd.next !== pwd.confirm) return '两次输入不一致'
  return ''
})
const pwdReady = computed(
  () => !!pwd.current && !!pwd.next && pwd.next === pwd.confirm && !pwdError.value,
)

async function savePassword() {
  const d = await acct.changePassword(pwd.current, pwd.next)
  pwd.current = pwd.next = pwd.confirm = ''
  say('ok', d.note || '密码已更新')
  if (d.revokedSessions > 0) say('ok', `${d.note}（${d.revokedSessions} 台设备已下线）`)
  loadSessions()
}

// ── 邮箱换绑 ───────────────────────────────────────────
const emailForm = reactive({ next: '', code: '' })
const emailStep = ref<'input' | 'code'>('input')
const demoCode = ref('')
const emailNote = ref('')

async function sendEmailCode() {
  const body = await acct.requestEmailChange(emailForm.next.trim())
  emailStep.value = 'code'
  demoCode.value = body.demoCode || ''
  emailNote.value = body.note
  say('ok', body.note)
}

async function confirmEmail() {
  const d = await acct.confirmEmailChange(emailForm.next.trim(), emailForm.code.trim())
  fillFromView(d)
  auth.patchUser({ email: d.user.email })
  emailForm.next = ''
  emailForm.code = ''
  emailStep.value = 'input'
  demoCode.value = ''
  say('ok', `邮箱已更换为 ${d.user.email}`)
}

function resetEmailFlow() {
  emailStep.value = 'input'
  emailForm.code = ''
  demoCode.value = ''
  emailNote.value = ''
}

// ── 手机号 ─────────────────────────────────────────────
const phoneForm = ref('')
async function savePhone() {
  const d = await acct.updatePhone(phoneForm.value.trim())
  fillFromView(d)
  auth.patchUser({ phone: d.user.phone, phone_verified: d.user.phone_verified })
  say('ok', d.note || '手机号已保存')
}
const phoneDirty = computed(() => phoneForm.value.trim() !== (view.value?.user.phone || ''))

// ── 登录设备 ───────────────────────────────────────────
async function loadSessions() {
  const d = await acct.listSessions()
  sessions.value = d.sessions
}

async function kick(id: string) {
  await run(`kick:${id}`, async () => {
    await acct.revokeSession(id)
    await loadSessions()
    say('ok', '该设备已下线')
  })
}

async function killAll() {
  await run('killAll', async () => {
    await acct.logoutAll()
    auth.clearSession()
    router.replace('/login')
  })
}

// ── 数据与隐私 ─────────────────────────────────────────
async function loadAudit() {
  const d = await acct.getMyAudit(1, 12)
  audit.value = d.items
}

async function doExport() {
  await run('export', async () => {
    const data = await acct.exportMyData()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `gamevibe-account-${view.value?.user.username || 'me'}-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
    say('ok', '数据已导出为 JSON 文件')
  })
}

const dangerOpen = ref(false)
const danger = reactive({ password: '', ack: false })
async function doDelete() {
  await run('delete', async () => {
    await acct.deleteAccount(danger.password)
    auth.clearSession()
    router.replace('/login?deleted=1')
  })
}

// ── 初始化与 tab 同步 ──────────────────────────────────
function syncTabFromQuery() {
  const q = String(route.query.tab || '') as TabKey
  if (tabs.some((t) => t.key === q)) active.value = q
}

watch(active, (v) => {
  if (route.query.tab !== v) router.replace({ query: { ...route.query, tab: v } })
  if (v === 'devices') loadSessions().catch(() => {})
  if (v === 'privacy') loadAudit().catch(() => {})
})
watch(() => route.query.tab, syncTabFromQuery)

onMounted(async () => {
  syncTabFromQuery()
  try {
    const v = await acct.getAccount()
    fillFromView(v)
    phoneForm.value = v.user.phone || ''
    await loadSessions()
    if (active.value === 'privacy') await loadAudit()
  } catch (e: any) {
    say('err', e?.message || '加载账户信息失败')
  } finally {
    loading.value = false
  }
})

function auditText(item: acct.AuditItem): string {
  if (!item.detail) return ''
  try {
    const d = JSON.parse(item.detail)
    if (Array.isArray(d.changes) && d.changes.length) {
      return d.changes
        .map((c: any) => `${c.field}：${c.from ?? '空'} → ${c.to ?? '空'}`)
        .join('；')
    }
    if (d.reason) return String(d.reason)
    if (d.to) return `目标：${d.to}`
  } catch {
    return item.detail.slice(0, 60)
  }
  return ''
}
</script>

<template>
  <div class="h-full overflow-y-auto">
    <div class="max-w-5xl mx-auto px-5 py-8 pb-20">
      <div class="flex items-center gap-2 text-xs text-[var(--text-faint)] mb-5">
        <RouterLink to="/" class="hover:text-accent transition-colors">首页</RouterLink>
        <ChevronRight class="w-3.5 h-3.5" />
        <span class="text-[var(--text-dim)]">账户设置</span>
      </div>

      <h1 class="text-2xl font-display font-bold mb-1">账户设置</h1>
      <p class="text-sm text-[var(--text-dim)] mb-6">管理你的资料、登录凭据与隐私数据</p>

      <!-- 全局提示 -->
      <div
        v-if="toast.msg"
        class="mb-5 flex items-start gap-2 text-sm rounded-xl px-4 py-3 border"
        :class="toast.type === 'ok'
          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
          : 'bg-red-500/10 border-red-500/30 text-red-400'"
      >
        <Check v-if="toast.type === 'ok'" class="w-4 h-4 shrink-0 mt-0.5" />
        <AlertCircle v-else class="w-4 h-4 shrink-0 mt-0.5" />
        <span>{{ toast.msg }}</span>
      </div>

      <div v-if="loading" class="flex items-center gap-2 text-sm text-[var(--text-faint)] py-16 justify-center">
        <Loader2 class="w-4 h-4 animate-spin" /> 正在读取账户信息…
      </div>

      <div v-else class="grid lg:grid-cols-[220px_1fr] gap-6 items-start">
        <!-- 左侧导航 -->
        <nav class="lg:sticky lg:top-4 flex lg:flex-col gap-1.5 overflow-x-auto">
          <button
            v-for="t in tabs"
            :key="t.key"
            @click="active = t.key"
            class="flex items-center gap-3 px-3.5 py-3 rounded-xl text-left transition-all shrink-0"
            :class="active === t.key
              ? 'bg-accent/10 text-accent border border-accent/30'
              : 'text-[var(--text-dim)] hover:bg-[var(--surface-2)] border border-transparent'"
          >
            <component :is="t.icon" class="w-4.5 h-4.5 shrink-0" />
            <span class="min-w-0">
              <span class="block text-sm font-medium">{{ t.label }}</span>
              <span class="hidden lg:block text-[11px] text-[var(--text-faint)]">{{ t.desc }}</span>
            </span>
          </button>
        </nav>

        <!-- 内容区 -->
        <div class="space-y-5 min-w-0">

          <!-- ══ 个人资料 ══ -->
          <template v-if="active === 'profile'">
            <section class="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-5">
              <h2 class="text-sm font-semibold mb-1">头像与昵称</h2>
              <p class="text-xs text-[var(--text-faint)] mb-4">昵称可随时修改，会显示在评论与社区页</p>

              <div class="flex items-start gap-4 mb-5">
                <div class="w-16 h-16 rounded-full overflow-hidden shrink-0 bg-gradient-to-br from-accent to-accent-cyan flex items-center justify-center text-white text-2xl font-bold">
                  <img v-if="avatarPreview" :src="avatarPreview" class="w-full h-full object-cover" alt="头像" />
                  <span v-else>{{ avatarChar }}</span>
                </div>
                <div class="flex-1 min-w-0">
                  <label class="text-xs text-[var(--text-dim)]">头像图片地址（http/https，留空则用昵称首字）</label>
                  <div class="mt-1.5 flex items-center gap-2 px-3 py-2.5 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] focus-within:border-accent/50">
                    <Camera class="w-4 h-4 text-[var(--text-faint)] shrink-0" />
                    <input v-model="profile.avatar" placeholder="https://example.com/avatar.png"
                      class="flex-1 bg-transparent text-sm text-[var(--text)] outline-none" />
                  </div>
                </div>
              </div>

              <label class="text-xs text-[var(--text-dim)]">昵称</label>
              <div class="mt-1.5 flex items-center gap-2 px-3 py-2.5 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] focus-within:border-accent/50">
                <User class="w-4 h-4 text-[var(--text-faint)] shrink-0" />
                <input v-model="profile.display_name" maxlength="24" placeholder="给自己起个名字"
                  class="flex-1 bg-transparent text-sm text-[var(--text)] outline-none" />
                <span class="text-[11px] text-[var(--text-faint)]">{{ profile.display_name.length }}/24</span>
              </div>

              <label class="text-xs text-[var(--text-dim)] mt-4 block">简介</label>
              <textarea v-model="profile.bio" rows="3" maxlength="160" placeholder="一句话介绍自己，比如常玩的游戏类型"
                class="mt-1.5 w-full px-3 py-2.5 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] focus:border-accent/50 text-sm text-[var(--text)] outline-none resize-none"></textarea>
              <div class="text-right text-[11px] text-[var(--text-faint)]">{{ profile.bio.length }}/160</div>

              <div class="flex items-center justify-between mt-4">
                <span class="text-xs text-[var(--text-faint)]">{{ dirty ? '有未保存的修改' : '已同步' }}</span>
                <button @click="run('profile', saveProfile)" :disabled="busy.profile || !dirty"
                  class="flex items-center gap-2 px-4 py-2 rounded-xl bg-accent hover:bg-accent-strong text-white text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                  <Loader2 v-if="busy.profile" class="w-4 h-4 animate-spin" />
                  保存修改
                </button>
              </div>
            </section>

            <section class="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-5">
              <h2 class="text-sm font-semibold mb-1">用户名</h2>
              <p class="text-xs text-[var(--text-faint)] mb-4">{{ renameHint }}</p>
              <div class="flex flex-col sm:flex-row gap-2">
                <div class="flex-1 flex items-center gap-2 px-3 py-2.5 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] focus-within:border-accent/50">
                  <span class="text-sm text-[var(--text-faint)]">@</span>
                  <input v-model="nameForm" maxlength="24" :disabled="!canRename"
                    class="flex-1 bg-transparent text-sm text-[var(--text)] outline-none disabled:opacity-60" />
                </div>
                <button @click="run('name', saveUsername)" :disabled="busy.name || !canRename || nameForm.trim() === view?.user.username"
                  class="px-4 py-2.5 rounded-xl text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  :class="canRename ? 'bg-accent hover:bg-accent-strong text-white' : 'bg-[var(--surface-2)] text-[var(--text-faint)]'">
                  <Loader2 v-if="busy.name" class="w-4 h-4 animate-spin inline" />
                  <template v-else>{{ canRename ? '确认改名' : '冷却中' }}</template>
                </button>
              </div>
              <p v-if="!canRename" class="mt-2 text-[11px] text-amber-500 flex items-center gap-1">
                <Clock class="w-3 h-3" /> 用户名改动有冷却期，防止被用来冒名或逃避历史记录
              </p>
              <p class="mt-2 text-[11px] text-[var(--text-faint)]">
                账号 ID：{{ view?.user.id }} · 注册于 {{ view ? acct.formatTime(view.user.created_at) : '' }}
              </p>
            </section>
          </template>

          <!-- ══ 账号安全 ══ -->
          <template v-if="active === 'security'">
            <section class="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-5">
              <h2 class="text-sm font-semibold mb-1 flex items-center gap-2"><KeyRound class="w-4 h-4" /> 修改密码</h2>
              <p class="text-xs text-[var(--text-faint)] mb-4">修改后其它设备会自动下线，当前设备保持登录</p>

              <div class="space-y-3">
                <div>
                  <label class="text-xs text-[var(--text-dim)]">当前密码</label>
                  <input type="password" v-model="pwd.current" autocomplete="current-password" placeholder="••••••••"
                    class="mt-1.5 w-full px-3 py-2.5 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] focus:border-accent/50 text-sm text-[var(--text)] outline-none" />
                </div>
                <div class="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label class="text-xs text-[var(--text-dim)]">新密码</label>
                    <input type="password" v-model="pwd.next" autocomplete="new-password" placeholder="至少 8 位，含字母和数字"
                      class="mt-1.5 w-full px-3 py-2.5 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] focus:border-accent/50 text-sm text-[var(--text)] outline-none" />
                  </div>
                  <div>
                    <label class="text-xs text-[var(--text-dim)]">确认新密码</label>
                    <input type="password" v-model="pwd.confirm" autocomplete="new-password" placeholder="再输一次"
                      class="mt-1.5 w-full px-3 py-2.5 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] focus:border-accent/50 text-sm text-[var(--text)] outline-none" />
                  </div>
                </div>
                <p v-if="pwdError" class="text-xs text-red-400">{{ pwdError }}</p>
              </div>

              <div class="flex justify-end mt-4">
                <button @click="run('pwd', savePassword)" :disabled="busy.pwd || !pwdReady"
                  class="flex items-center gap-2 px-4 py-2 rounded-xl bg-accent hover:bg-accent-strong text-white text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                  <Loader2 v-if="busy.pwd" class="w-4 h-4 animate-spin" /> 更新密码
                </button>
              </div>
            </section>

            <section class="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-5">
              <h2 class="text-sm font-semibold mb-1 flex items-center gap-2"><Mail class="w-4 h-4" /> 邮箱</h2>
              <p class="text-xs text-[var(--text-faint)] mb-3">
                当前绑定：<span class="text-[var(--text-dim)]">{{ view?.user.email }}</span>
                <span class="ml-2 text-[11px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400">已验证</span>
              </p>

              <div v-if="emailStep === 'input'" class="flex flex-col sm:flex-row gap-2">
                <input v-model="emailForm.next" type="email" placeholder="新邮箱地址"
                  class="flex-1 px-3 py-2.5 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] focus:border-accent/50 text-sm text-[var(--text)] outline-none" />
                <button @click="run('emailSend', sendEmailCode)" :disabled="busy.emailSend || !emailForm.next.trim()"
                  class="px-4 py-2.5 rounded-xl bg-accent hover:bg-accent-strong text-white text-sm font-medium transition-all disabled:opacity-50">
                  <Loader2 v-if="busy.emailSend" class="w-4 h-4 animate-spin inline" />
                  <template v-else>发送验证码</template>
                </button>
              </div>

              <div v-else class="space-y-3">
                <div class="flex items-start gap-2 text-xs rounded-xl px-3 py-2.5 bg-[var(--surface-2)] border border-[var(--border)]">
                  <Info class="w-4 h-4 shrink-0 mt-0.5 text-[var(--text-faint)]" />
                  <span class="text-[var(--text-dim)]">
                    验证码已发往 <b class="text-[var(--text)]">{{ emailForm.next }}</b>。
                    <template v-if="demoCode">
                      当前未配置邮件服务，<b class="text-amber-500">演示模式</b>验证码：<b class="text-accent tracking-widest">{{ demoCode }}</b>
                    </template>
                  </span>
                </div>
                <div class="flex flex-col sm:flex-row gap-2">
                  <input v-model="emailForm.code" inputmode="numeric" maxlength="6" placeholder="6 位验证码"
                    class="flex-1 px-3 py-2.5 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] focus:border-accent/50 text-sm tracking-widest text-[var(--text)] outline-none" />
                  <button @click="run('emailConfirm', confirmEmail)" :disabled="busy.emailConfirm || emailForm.code.length !== 6"
                    class="px-4 py-2.5 rounded-xl bg-accent hover:bg-accent-strong text-white text-sm font-medium transition-all disabled:opacity-50">
                    <Loader2 v-if="busy.emailConfirm" class="w-4 h-4 animate-spin inline" />
                    <template v-else>确认换绑</template>
                  </button>
                  <button @click="resetEmailFlow"
                    class="px-3 py-2.5 rounded-xl text-sm text-[var(--text-dim)] hover:bg-[var(--surface-2)] transition-colors">取消</button>
                </div>
              </div>
              <p class="mt-2 text-[11px] text-[var(--text-faint)]">
                换绑需要向新邮箱发送验证码，并在成功后通知旧邮箱；只单向验证等于账号随时可被劫持
              </p>
            </section>

            <section class="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-5">
              <h2 class="text-sm font-semibold mb-1 flex items-center gap-2"><Phone class="w-4 h-4" /> 手机号</h2>
              <p class="text-xs text-[var(--text-faint)] mb-3">
                <template v-if="view?.user.phone">
                  当前：<span class="text-[var(--text-dim)]">{{ view.user.phone }}</span>
                  <span v-if="view.user.phone_verified" class="ml-2 text-[11px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400">已验证</span>
                  <span v-else class="ml-2 text-[11px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500">未验证</span>
                </template>
                <template v-else>尚未绑定手机号</template>
              </p>
              <div class="flex flex-col sm:flex-row gap-2">
                <input v-model="phoneForm" inputmode="numeric" maxlength="11" placeholder="中国大陆手机号"
                  class="flex-1 px-3 py-2.5 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] focus:border-accent/50 text-sm text-[var(--text)] outline-none" />
                <button @click="run('phone', savePhone)" :disabled="busy.phone || !phoneDirty"
                  class="px-4 py-2.5 rounded-xl bg-accent hover:bg-accent-strong text-white text-sm font-medium transition-all disabled:opacity-50">
                  <Loader2 v-if="busy.phone" class="w-4 h-4 animate-spin inline" />
                  <template v-else>保存</template>
                </button>
              </div>
              <p class="mt-2 text-[11px] text-amber-500 flex items-start gap-1">
                <Info class="w-3 h-3 shrink-0 mt-0.5" />
                短信通道尚未接入，手机号只作记录、不会标记为已验证，也不会用于登录或找回密码
              </p>
            </section>
          </template>

          <!-- ══ 登录设备 ══ -->
          <template v-if="active === 'devices'">
            <section class="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-5">
              <div class="flex items-center justify-between mb-4">
                <div>
                  <h2 class="text-sm font-semibold mb-1">当前登录的设备</h2>
                  <p class="text-xs text-[var(--text-faint)]">发现不认识的设备，立即下线并修改密码</p>
                </div>
                <button @click="killAll" :disabled="busy.killAll"
                  class="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm text-accent-red hover:bg-red-500/10 border border-red-500/30 transition-colors disabled:opacity-50">
                  <LogOut class="w-4 h-4" /> 全部退出
                </button>
              </div>

              <div class="space-y-2">
                <div v-for="s in sessions" :key="s.id"
                  class="flex items-center gap-3 px-3.5 py-3 rounded-xl bg-[var(--surface-2)] border border-[var(--border)]">
                  <Monitor class="w-4.5 h-4.5 text-[var(--text-faint)] shrink-0" />
                  <div class="flex-1 min-w-0">
                    <div class="text-sm text-[var(--text)] flex items-center gap-2">
                      {{ s.device }} · {{ s.os }}
                      <span v-if="s.current" class="text-[10px] px-1.5 py-0.5 rounded bg-accent/15 text-accent">当前设备</span>
                    </div>
                    <div class="text-[11px] text-[var(--text-faint)] truncate">
                      {{ s.ip || 'IP 未知' }} · 最近活跃 {{ acct.relativeTime(s.last_seen_at) }}
                    </div>
                  </div>
                  <button v-if="!s.current" @click="kick(s.id)" :disabled="busy[`kick:${s.id}`]"
                    class="text-xs px-2.5 py-1.5 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50">
                    下线
                  </button>
                </div>
                <p v-if="!sessions.length" class="text-sm text-[var(--text-faint)] py-6 text-center">暂无登录记录</p>
              </div>
            </section>
          </template>

          <!-- ══ 数据与隐私 ══ -->
          <template v-if="active === 'privacy'">
            <section class="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-5">
              <h2 class="text-sm font-semibold mb-1 flex items-center gap-2"><Download class="w-4 h-4" /> 导出我的数据</h2>
              <p class="text-xs text-[var(--text-faint)] mb-4">下载账号资料、游戏库、评论与登录记录的 JSON 副本</p>
              <button @click="doExport" :disabled="busy.export"
                class="flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] hover:border-accent/40 text-sm text-[var(--text)] transition-colors disabled:opacity-50">
                <Loader2 v-if="busy.export" class="w-4 h-4 animate-spin" />
                <Download v-else class="w-4 h-4" /> 导出 JSON
              </button>
            </section>

            <section class="rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-5">
              <h2 class="text-sm font-semibold mb-1 flex items-center gap-2"><Clock class="w-4 h-4" /> 最近的安全操作</h2>
              <p class="text-xs text-[var(--text-faint)] mb-4">只显示你自己的操作，管理员的操作请在后台查看</p>
              <div class="space-y-1.5">
                <div v-for="a in audit" :key="a.id" class="flex items-start gap-3 px-3 py-2.5 rounded-xl hover:bg-[var(--surface-2)] transition-colors">
                  <span class="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0"
                    :class="a.result === 'ok' ? 'bg-emerald-400' : 'bg-red-400'"></span>
                  <div class="flex-1 min-w-0">
                    <div class="text-sm text-[var(--text)]">
                      {{ acct.ACTION_LABELS[a.action] || a.action }}
                      <span v-if="a.result !== 'ok'" class="text-[10px] ml-1 text-red-400">失败</span>
                    </div>
                    <div v-if="auditText(a)" class="text-[11px] text-[var(--text-faint)] truncate">{{ auditText(a) }}</div>
                  </div>
                  <span class="text-[11px] text-[var(--text-faint)] shrink-0">{{ acct.relativeTime(a.created_at) }}</span>
                </div>
                <p v-if="!audit.length" class="text-sm text-[var(--text-faint)] py-6 text-center">暂无记录</p>
              </div>
            </section>

            <section class="rounded-2xl bg-red-500/5 border border-red-500/30 p-5">
              <h2 class="text-sm font-semibold mb-1 text-red-400 flex items-center gap-2"><Trash2 class="w-4 h-4" /> 注销账号</h2>
              <p class="text-xs text-[var(--text-dim)] mb-4">
                注销后个人资料立即匿名化，账号无法再登录，且不可恢复。你发布的评论与收藏会保留为「已注销用户」。
              </p>
              <button @click="dangerOpen = true"
                class="px-4 py-2 rounded-xl border border-red-500/40 text-red-400 text-sm hover:bg-red-500/10 transition-colors">
                我要注销账号
              </button>
            </section>
          </template>
        </div>
      </div>
    </div>

    <!-- 注销确认弹层 -->
    <div v-if="dangerOpen" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" @click.self="dangerOpen = false">
      <div class="w-full max-w-md rounded-2xl bg-[var(--surface)] border border-[var(--border)] p-5">
        <div class="flex items-start justify-between mb-3">
          <h3 class="text-base font-semibold text-red-400">确认注销账号</h3>
          <button @click="dangerOpen = false" class="text-[var(--text-faint)] hover:text-[var(--text)]"><X class="w-4 h-4" /></button>
        </div>
        <p class="text-xs text-[var(--text-dim)] mb-4">
          资料会被匿名化、所有设备下线、账号无法再登录。此操作不可撤销。
        </p>
        <label class="text-xs text-[var(--text-dim)]">输入密码确认身份</label>
        <input type="password" v-model="danger.password" placeholder="当前密码"
          class="mt-1.5 w-full px-3 py-2.5 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] focus:border-red-500/50 text-sm text-[var(--text)] outline-none" />
        <label class="flex items-start gap-2 mt-3 cursor-pointer">
          <input type="checkbox" v-model="danger.ack" class="mt-0.5 w-4 h-4 accent-red-500" />
          <span class="text-xs text-[var(--text-dim)]">我已了解注销后无法恢复</span>
        </label>
        <div class="flex justify-end gap-2 mt-5">
          <button @click="dangerOpen = false" class="px-4 py-2 rounded-xl text-sm text-[var(--text-dim)] hover:bg-[var(--surface-2)] transition-colors">取消</button>
          <button @click="doDelete" :disabled="busy.delete || !danger.ack || !danger.password"
            class="px-4 py-2 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors disabled:opacity-50">
            <Loader2 v-if="busy.delete" class="w-4 h-4 animate-spin inline" />
            <template v-else>确认注销</template>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
