<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter, useRoute, RouterLink } from 'vue-router'
import {
  Gamepad2,
  Mail,
  Lock,
  User as UserIcon,
  ArrowRight,
  Loader2,
  AlertCircle,
  Info,
  Eye,
  EyeOff,
} from 'lucide-vue-next'
import { useAuthStore } from '@/stores/authStore'

const PASSWORD_RULES = [
  { label: '至少 8 个字符', test: (pw: string) => pw.length >= 8 },
  { label: '包含英文字母', test: (pw: string) => /[a-zA-Z]/.test(pw) },
  { label: '包含数字', test: (pw: string) => /[0-9]/.test(pw) },
] as const

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const USERNAME_RE = /^[a-zA-Z0-9_\u4e00-\u9fa5]+$/

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

const username = ref('')
const email = ref('')
const password = ref('')
const showPassword = ref(false)
const error = ref('')
const loading = ref(false)
const touched = ref({ username: false, email: false })

const redirectTo = computed(() => {
  const r = route.query.redirect
  return typeof r === 'string' && r.startsWith('/') && !r.startsWith('//') ? r : '/'
})

const pwRules = computed(() => PASSWORD_RULES.map((r) => ({ ...r, ok: r.test(password.value) })))
const allPwOk = computed(() => password.value.length > 0 && pwRules.value.every((r) => r.ok))

const usernameError = computed(() => {
  if (!touched.value.username) return ''
  const v = username.value.trim()
  if (!v) return '请填写用户名'
  if (v.length < 2 || v.length > 24) return '用户名需 2-24 个字符'
  if (!USERNAME_RE.test(v)) return '只能包含字母、数字、下划线、中文'
  return ''
})

const emailError = computed(() => {
  if (!touched.value.email) return ''
  if (!email.value.trim()) return '请填写邮箱'
  if (!EMAIL_RE.test(email.value.trim())) return '邮箱格式不正确'
  return ''
})

// ── Turnstile 人机验证：服务端开了才渲染，token 随注册提交 ──
// 状态机：idle（服务端未开启）→ loading（组件加载中）→ ready（可交互）
//        → failed（网络原因加载失败，可重试）。只有 ready 才真正启用。
const captchaState = ref<'idle' | 'loading' | 'ready' | 'failed'>('idle')
const captchaSiteKey = ref('')
const captchaToken = ref('')
const captchaWidgetId = ref<string | null>(null)
const captchaEl = ref<HTMLElement | null>(null)
const captchaReady = computed(() => captchaState.value === 'ready' && !!captchaToken.value)

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string
      reset: (id?: string) => void
      remove: (id: string) => void
    }
  }
}

function loadTurnstileScript(timeoutMs = 12000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.turnstile) return resolve()
    // 挂了就换新标签重试，旧标签不再触发回调
    document.querySelectorAll('script[data-turnstile]').forEach((n) => n.remove())
    const sc = document.createElement('script')
    sc.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    sc.async = true
    sc.dataset.turnstile = '1'
    const timer = setTimeout(() => reject(new Error('验证组件加载超时')), timeoutMs)
    sc.onload = () => {
      clearTimeout(timer)
      resolve()
    }
    sc.onerror = () => {
      clearTimeout(timer)
      reject(new Error('验证组件加载失败'))
    }
    document.head.appendChild(sc)
  })
}

async function initCaptcha() {
  try {
    const res = await fetch('/api/auth/captcha-config')
    const cfg = await res.json()
    if (!cfg.enabled) return
    captchaState.value = 'loading'
    captchaSiteKey.value = cfg.siteKey
    await loadTurnstileScript()
    if (!captchaEl.value) throw new Error('容器未挂载')
    // 重渲染前清掉旧实例（重试场景）
    if (captchaWidgetId.value !== null) {
      try {
        window.turnstile!.remove(captchaWidgetId.value)
      } catch {
        /* 旧实例可能已失效 */
      }
      captchaWidgetId.value = null
    }
    captchaWidgetId.value = window.turnstile!.render(captchaEl.value, {
      sitekey: captchaSiteKey.value,
      callback: (t: string) => (captchaToken.value = t),
      'expired-callback': () => (captchaToken.value = ''),
      'error-callback': () => (captchaState.value = 'failed'),
      theme: 'dark',
    })
    captchaState.value = 'ready'
  } catch {
    captchaState.value = 'failed'
  }
}

function retryCaptcha() {
  captchaState.value = 'loading'
  captchaToken.value = ''
  initCaptcha()
}

onMounted(() => {
  initCaptcha()
})

const canSubmit = computed(
  () => !usernameError.value.replace('请填写', '') && allPwOk.value && !loading.value,
)

async function submit() {
  touched.value.username = true
  touched.value.email = true
  error.value = ''
  if (usernameError.value || emailError.value || !allPwOk.value) {
    error.value = '请检查表单内容'
    return
  }
  loading.value = true
  try {
    if (captchaState.value === 'failed') {
      error.value = '人机验证组件未能加载（多为网络原因），请点「重试」或刷新页面'
      loading.value = false
      return
    }
    if (captchaState.value === 'loading') {
      error.value = '人机验证加载中，请稍候一两秒再提交'
      loading.value = false
      return
    }
    if (captchaState.value === 'ready' && !captchaToken.value) {
      error.value = '请先完成人机验证'
      loading.value = false
      return
    }
    await auth.register(username.value.trim(), email.value.trim(), password.value, captchaToken.value || undefined)
    captchaToken.value = ''
    if (captchaState.value === 'ready' && window.turnstile && captchaWidgetId.value !== null) {
      window.turnstile.reset(captchaWidgetId.value)
    }
    await router.replace(redirectTo.value)
  } catch (err: any) {
    error.value = err?.message || '注册失败，请稍后重试'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-[var(--bg)] px-4 py-10">
    <div class="w-full max-w-sm">
      <div class="flex items-center gap-3 mb-8 justify-center">
        <div
          class="w-12 h-12 rounded-2xl bg-gradient-to-br from-accent-strong to-accent-blue flex items-center justify-center shadow-lg shadow-accent/20"
        >
          <Gamepad2 class="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 class="text-2xl font-display font-bold text-[var(--text)]">GameVibe</h1>
          <p class="text-sm text-[var(--text-faint)]">创建你的账号</p>
        </div>
      </div>

      <form
        @submit.prevent="submit"
        class="space-y-4 bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6"
      >
        <!-- 用户名 -->
        <div>
          <label class="text-sm text-[var(--text-dim)]">用户名</label>
          <div
            class="mt-1.5 flex items-center gap-2 px-3 py-2.5 rounded-xl bg-[var(--surface-2)] border transition-colors"
            :class="
              usernameError
                ? 'border-red-500/60'
                : 'border-[var(--border)] focus-within:border-accent/50'
            "
          >
            <UserIcon class="w-4 h-4 text-[var(--text-faint)] shrink-0" />
            <input
              type="text"
              autocomplete="username"
              v-model="username"
              @blur="touched.username = true"
              placeholder="玩家名"
              class="flex-1 bg-transparent text-sm text-[var(--text)] outline-none"
            />
          </div>
          <p v-if="usernameError" class="mt-1.5 text-xs text-red-400">{{ usernameError }}</p>
        </div>

        <!-- 邮箱 -->
        <div>
          <label class="text-sm text-[var(--text-dim)]">邮箱</label>
          <div
            class="mt-1.5 flex items-center gap-2 px-3 py-2.5 rounded-xl bg-[var(--surface-2)] border transition-colors"
            :class="
              emailError ? 'border-red-500/60' : 'border-[var(--border)] focus-within:border-accent/50'
            "
          >
            <Mail class="w-4 h-4 text-[var(--text-faint)] shrink-0" />
            <input
              type="email"
              autocomplete="email"
              v-model="email"
              @blur="touched.email = true"
              placeholder="you@example.com"
              class="flex-1 bg-transparent text-sm text-[var(--text)] outline-none"
            />
          </div>
          <p v-if="emailError" class="mt-1.5 text-xs text-red-400">{{ emailError }}</p>
        </div>

        <!-- 密码 + 规则提示 -->
        <div>
          <label class="text-sm text-[var(--text-dim)]">密码</label>
          <div
            class="mt-1.5 flex items-center gap-2 px-3 py-2.5 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] focus-within:border-accent/50"
          >
            <Lock class="w-4 h-4 text-[var(--text-faint)] shrink-0" />
            <input
              :type="showPassword ? 'text' : 'password'"
              autocomplete="new-password"
              v-model="password"
              placeholder="至少 8 位，含字母和数字"
              class="flex-1 bg-transparent text-sm text-[var(--text)] outline-none"
            />
            <button
              type="button"
              class="text-[var(--text-faint)] hover:text-[var(--text)] transition-colors"
              :title="showPassword ? '隐藏密码' : '显示密码'"
              @click="showPassword = !showPassword"
            >
              <EyeOff v-if="showPassword" class="w-4 h-4" />
              <Eye v-else class="w-4 h-4" />
            </button>
          </div>

          <div v-if="password.length > 0" class="mt-2 grid gap-1">
            <div
              v-for="r in pwRules"
              :key="r.label"
              class="flex items-center gap-1.5 text-xs"
              :class="r.ok ? 'text-accent-green' : 'text-[var(--text-faint)]'"
            >
              <span :class="r.ok ? '' : 'opacity-50'">{{ r.ok ? '✓' : '○' }}</span>
              {{ r.label }}
            </div>
          </div>
        </div>

        <!-- Turnstile 人机验证（服务端开启时出现）：容器渲染期间必须可见，失败才隐藏 -->
        <div v-if="captchaState !== 'idle'" class="min-h-[70px] flex flex-col items-center justify-center gap-1.5">
          <div v-if="captchaState === 'loading'" class="flex items-center gap-2 text-xs text-[var(--text-faint)]">
            <Loader2 class="w-3.5 h-3.5 animate-spin" />
            正在加载人机验证组件…
          </div>
          <div v-else-if="captchaState === 'failed'" class="flex flex-col items-center gap-1.5 text-center">
            <span class="text-xs text-amber-400/90">人机验证组件加载失败（多为网络原因）</span>
            <button
              type="button"
              @click="retryCaptcha"
              class="px-3 py-1 rounded-lg text-xs bg-[var(--surface-2)] border border-[var(--border)] hover:border-accent/40 transition-colors"
            >
              重试
            </button>
          </div>
          <div v-show="captchaState !== 'failed'" ref="captchaEl" class="flex justify-center min-h-[65px]"></div>
        </div>

        <div
          v-if="error"
          class="flex items-start gap-2 text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2.5"
        >
          <AlertCircle class="w-4 h-4 shrink-0 mt-0.5" />
          <span>{{ error }}</span>
        </div>

        <button
          type="submit"
          :disabled="loading || !allPwOk"
          class="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-accent hover:bg-accent-strong text-white font-medium transition-all disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <Loader2 v-if="loading" class="w-4 h-4 animate-spin" />
          <template v-else>注册 <ArrowRight class="w-4 h-4" /></template>
        </button>

        <p class="text-center text-xs text-[var(--text-faint)]">
          注册即表示同意本平台的使用条款与隐私说明
        </p>

        <!-- 演示站如实告知：沙箱数据库在每次发布时被本地快照覆盖，账号不会长期保留 -->
        <div
          class="flex items-start gap-2 text-[11px] leading-relaxed text-amber-400/90 bg-amber-500/10 rounded-lg px-3 py-2"
        >
          <Info class="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>这是演示站点：账号数据会在站点更新后重置，请不要使用你在其他地方的常用密码。</span>
        </div>
      </form>

      <p class="text-center text-sm text-[var(--text-faint)] mt-4">
        已有账号？<RouterLink to="/login" class="text-accent hover:underline">去登录</RouterLink>
      </p>
    </div>
  </div>
</template>
