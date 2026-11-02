<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter, useRoute, RouterLink } from 'vue-router'
import {
  Gamepad2,
  Mail,
  Lock,
  Eye,
  EyeOff,
  ArrowRight,
  Loader2,
  AlertCircle,
  ArrowLeft,
} from 'lucide-vue-next'
import { useAuthStore } from '@/stores/authStore'
import { ApiError } from '@/lib/api'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const email = ref('')
const password = ref('')
const remember = ref(true)
const showPassword = ref(false)
const error = ref('')
const loading = ref(false)
const touched = ref({ email: false, password: false })
const capsLock = ref(false)

/** 登录成功后回到原来的页面；仅接受站内路径，防止被当成开放跳转 */
const redirectTo = computed(() => {
  const r = route.query.redirect
  return typeof r === 'string' && r.startsWith('/') && !r.startsWith('//') ? r : '/'
})

const emailError = computed(() => {
  if (!touched.value.email) return ''
  if (!email.value.trim()) return '请填写邮箱'
  if (!EMAIL_RE.test(email.value.trim())) return '邮箱格式不正确'
  return ''
})

const passwordError = computed(() => {
  if (!touched.value.password) return ''
  if (!password.value) return '请填写密码'
  return ''
})

const canSubmit = computed(() => {
  return EMAIL_RE.test(email.value.trim()) && password.value.length > 0 && !loading.value
})

function detectCapsLock(e: KeyboardEvent) {
  capsLock.value = e.getModifierState?.('CapsLock') ?? false
}

async function submit() {
  touched.value.email = true
  touched.value.password = true
  error.value = ''
  if (!canSubmit.value) return

  loading.value = true
  try {
    await auth.login(email.value.trim(), password.value, remember.value)
    await router.replace(redirectTo.value)
  } catch (err: any) {
    if (err instanceof ApiError && err.status === 429) {
      error.value = err.message
    } else if (err instanceof ApiError && err.remaining !== undefined && err.remaining > 0) {
      error.value = `${err.message}（还可尝试 ${err.remaining} 次）`
    } else {
      error.value = err?.message || '登录失败，请稍后重试'
    }
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-[var(--bg)] px-4 py-10">
    <div class="w-full max-w-sm">
      <!-- 返回入口：从受保护页面被带到此处时给条退路 -->
      <RouterLink
        v-if="redirectTo !== '/'"
        to="/"
        class="inline-flex items-center gap-1.5 text-sm text-[var(--text-faint)] hover:text-[var(--text)] transition-colors mb-6"
      >
        <ArrowLeft class="w-4 h-4" />
        先随便逛逛
      </RouterLink>

      <div class="flex items-center gap-3 mb-8 justify-center">
        <div
          class="w-12 h-12 rounded-2xl bg-gradient-to-br from-accent-strong to-accent-blue flex items-center justify-center shadow-lg shadow-accent/20"
        >
          <Gamepad2 class="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 class="text-2xl font-display font-bold text-[var(--text)]">GameVibe</h1>
          <p class="text-sm text-[var(--text-faint)]">登录你的账号</p>
        </div>
      </div>

      <div
        v-if="redirectTo !== '/'"
        class="mb-4 text-xs text-[var(--text-dim)] bg-[var(--surface-2)] border border-[var(--border)] rounded-xl px-3 py-2.5"
      >
        登录后将返回你刚才访问的页面
      </div>

      <form
        @submit.prevent="submit"
        class="space-y-4 bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6"
      >
        <!-- 邮箱 -->
        <div>
          <label class="text-sm text-[var(--text-dim)]">邮箱</label>
          <div
            class="mt-1.5 flex items-center gap-2 px-3 py-2.5 rounded-xl bg-[var(--surface-2)] border transition-colors"
            :class="
              emailError
                ? 'border-red-500/60'
                : 'border-[var(--border)] focus-within:border-accent/50'
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

        <!-- 密码 -->
        <div>
          <div class="flex items-center justify-between">
            <label class="text-sm text-[var(--text-dim)]">密码</label>
            <RouterLink
              to="/forgot-password"
              class="text-xs text-[var(--text-faint)] hover:text-accent transition-colors"
            >
              忘记密码？
            </RouterLink>
          </div>
          <div
            class="mt-1.5 flex items-center gap-2 px-3 py-2.5 rounded-xl bg-[var(--surface-2)] border transition-colors"
            :class="
              passwordError
                ? 'border-red-500/60'
                : 'border-[var(--border)] focus-within:border-accent/50'
            "
          >
            <Lock class="w-4 h-4 text-[var(--text-faint)] shrink-0" />
            <input
              :type="showPassword ? 'text' : 'password'"
              autocomplete="current-password"
              v-model="password"
              @blur="touched.password = true"
              @keyup="detectCapsLock"
              placeholder="••••••••"
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
          <p v-if="passwordError" class="mt-1.5 text-xs text-red-400">{{ passwordError }}</p>
          <p v-else-if="capsLock" class="mt-1.5 text-xs text-amber-500">大写锁定已开启</p>
        </div>

        <!-- 记住我 -->
        <label class="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            v-model="remember"
            class="w-4 h-4 rounded border-[var(--border)] accent-[var(--accent-strong)]"
          />
          <span class="text-sm text-[var(--text-dim)]">记住我（30 天内免登录）</span>
        </label>

        <div
          v-if="error"
          class="flex items-start gap-2 text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2.5"
        >
          <AlertCircle class="w-4 h-4 shrink-0 mt-0.5" />
          <span>{{ error }}</span>
        </div>

        <button
          type="submit"
          :disabled="loading"
          class="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-accent hover:bg-accent-strong text-white font-medium transition-all disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <Loader2 v-if="loading" class="w-4 h-4 animate-spin" />
          <template v-else>登录 <ArrowRight class="w-4 h-4" /></template>
        </button>
      </form>

      <p class="text-center text-sm text-[var(--text-faint)] mt-4">
        还没有账号？<RouterLink to="/register" class="text-accent hover:underline">立即注册</RouterLink>
      </p>
    </div>
  </div>
</template>
