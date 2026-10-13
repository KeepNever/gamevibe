<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import { Gamepad2, Mail, Lock, User as UserIcon, ArrowRight, Loader2, AlertCircle } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/authStore'

const PASSWORD_RULES = [
  { label: '至少 8 个字符', test: (pw: string) => pw.length >= 8 },
  { label: '包含英文字母', test: (pw: string) => /[a-zA-Z]/.test(pw) },
  { label: '包含数字', test: (pw: string) => /[0-9]/.test(pw) },
] as const

const auth = useAuthStore()
const router = useRouter()
const username = ref('')
const email = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

const pwRules = computed(() => PASSWORD_RULES.map((r) => ({ ...r, ok: r.test(password.value) })))
const allPwOk = computed(() => password.value.length > 0 && pwRules.value.every((r) => r.ok))

async function submit() {
  error.value = ''
  if (!allPwOk.value) {
    error.value = '密码不符合要求，请检查下方规则'
    return
  }
  loading.value = true
  try {
    await auth.register(username.value, email.value, password.value)
    router.push('/')
  } catch (err: any) {
    error.value = err?.message || '注册失败，请稍后重试'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-[var(--bg)] px-4">
    <div class="w-full max-w-sm">
      <div class="flex items-center gap-3 mb-8 justify-center">
        <div class="w-12 h-12 rounded-2xl bg-gradient-to-br from-accent-strong to-accent-blue flex items-center justify-center shadow-lg shadow-accent/20">
          <Gamepad2 class="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 class="text-2xl font-display font-bold text-[var(--text)]">GameVibe</h1>
          <p class="text-sm text-[var(--text-faint)]">创建你的账号</p>
        </div>
      </div>

      <form @submit.prevent="submit" class="space-y-4 bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6">
        <!-- 用户名 -->
        <div>
          <label class="text-sm text-[var(--text-dim)]">用户名</label>
          <div class="mt-1.5 flex items-center gap-2 px-3 py-2.5 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] focus-within:border-accent/50">
            <UserIcon class="w-4 h-4 text-[var(--text-faint)]" />
            <input
              type="text"
              required
              v-model="username"
              placeholder="玩家名"
              class="flex-1 bg-transparent text-sm text-[var(--text)] outline-none"
            />
          </div>
        </div>

        <!-- 邮箱 -->
        <div>
          <label class="text-sm text-[var(--text-dim)]">邮箱</label>
          <div class="mt-1.5 flex items-center gap-2 px-3 py-2.5 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] focus-within:border-accent/50">
            <Mail class="w-4 h-4 text-[var(--text-faint)]" />
            <input
              type="email"
              required
              v-model="email"
              placeholder="you@example.com"
              class="flex-1 bg-transparent text-sm text-[var(--text)] outline-none"
            />
          </div>
        </div>

        <!-- 密码 + 规则提示 -->
        <div>
          <label class="text-sm text-[var(--text-dim)]">密码</label>
          <div class="mt-1.5 flex items-center gap-2 px-3 py-2.5 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] focus-within:border-accent/50">
            <Lock class="w-4 h-4 text-[var(--text-faint)]" />
            <input
              type="password"
              required
              minlength="8"
              v-model="password"
              placeholder="至少 8 位，含字母和数字"
              class="flex-1 bg-transparent text-sm text-[var(--text)] outline-none"
            />
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

        <!-- 错误提示 -->
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
      </form>

      <p class="text-center text-sm text-[var(--text-faint)] mt-4">
        已有账号？<RouterLink to="/login" class="text-accent hover:underline">去登录</RouterLink>
      </p>
    </div>
  </div>
</template>
