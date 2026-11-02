<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRoute, useRouter, RouterLink } from 'vue-router'
import {
  Gamepad2,
  Lock,
  Eye,
  EyeOff,
  Loader2,
  AlertCircle,
  CheckCircle2,
  ArrowRight,
} from 'lucide-vue-next'
import { api, ApiError } from '@/lib/api'

const RULES = [
  { label: '至少 8 个字符', test: (pw: string) => pw.length >= 8 },
  { label: '包含英文字母', test: (pw: string) => /[a-zA-Z]/.test(pw) },
  { label: '包含数字', test: (pw: string) => /[0-9]/.test(pw) },
] as const

const route = useRoute()
const router = useRouter()

const token = computed(() => (typeof route.query.token === 'string' ? route.query.token : ''))
const password = ref('')
const confirm = ref('')
const show = ref(false)
const loading = ref(false)
const error = ref('')
const done = ref(false)

const rules = computed(() => RULES.map((r) => ({ ...r, ok: r.test(password.value) })))
const allOk = computed(() => password.value.length > 0 && rules.value.every((r) => r.ok))
const mismatch = computed(() => confirm.value.length > 0 && confirm.value !== password.value)
const canSubmit = computed(() => allOk.value && !mismatch.value && confirm.value.length > 0)

async function submit() {
  error.value = ''
  if (!canSubmit.value) {
    error.value = mismatch.value ? '两次输入的密码不一致' : '密码不符合要求'
    return
  }
  loading.value = true
  try {
    await api.post('/auth/reset-password', { token: token.value, password: password.value })
    done.value = true
    setTimeout(() => router.replace('/login'), 2600)
  } catch (err: any) {
    error.value = err instanceof ApiError ? err.message : '重置失败，请重新申请链接'
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
          <h1 class="text-2xl font-display font-bold text-[var(--text)]">设置新密码</h1>
          <p class="text-sm text-[var(--text-faint)]">重置后所有旧密码立即失效</p>
        </div>
      </div>

      <!-- 令牌缺失 -->
      <div
        v-if="!token"
        class="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 space-y-4"
      >
        <div class="flex items-start gap-2 text-sm text-red-400">
          <AlertCircle class="w-4 h-4 shrink-0 mt-0.5" />
          <span>这个重置链接不完整，缺少令牌。</span>
        </div>
        <RouterLink
          to="/forgot-password"
          class="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-accent hover:bg-accent-strong text-white font-medium transition-all"
        >
          重新获取链接
        </RouterLink>
      </div>

      <!-- 成功态 -->
      <div
        v-else-if="done"
        class="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 space-y-4 text-center"
      >
        <CheckCircle2 class="w-10 h-10 text-accent-green mx-auto" />
        <div>
          <p class="text-sm text-[var(--text)] font-medium">密码已重置</p>
          <p class="text-xs text-[var(--text-faint)] mt-1">正在跳转到登录页…</p>
        </div>
        <RouterLink
          to="/login"
          class="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-accent hover:bg-accent-strong text-white font-medium transition-all"
        >
          立即登录 <ArrowRight class="w-4 h-4" />
        </RouterLink>
      </div>

      <!-- 表单 -->
      <form
        v-else
        @submit.prevent="submit"
        class="space-y-4 bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6"
      >
        <div>
          <label class="text-sm text-[var(--text-dim)]">新密码</label>
          <div
            class="mt-1.5 flex items-center gap-2 px-3 py-2.5 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] focus-within:border-accent/50"
          >
            <Lock class="w-4 h-4 text-[var(--text-faint)] shrink-0" />
            <input
              :type="show ? 'text' : 'password'"
              autocomplete="new-password"
              v-model="password"
              placeholder="至少 8 位，含字母和数字"
              class="flex-1 bg-transparent text-sm text-[var(--text)] outline-none"
            />
            <button
              type="button"
              class="text-[var(--text-faint)] hover:text-[var(--text)] transition-colors"
              :title="show ? '隐藏密码' : '显示密码'"
              @click="show = !show"
            >
              <EyeOff v-if="show" class="w-4 h-4" />
              <Eye v-else class="w-4 h-4" />
            </button>
          </div>
          <div v-if="password.length > 0" class="mt-2 grid gap-1">
            <div
              v-for="r in rules"
              :key="r.label"
              class="flex items-center gap-1.5 text-xs"
              :class="r.ok ? 'text-accent-green' : 'text-[var(--text-faint)]'"
            >
              <span :class="r.ok ? '' : 'opacity-50'">{{ r.ok ? '✓' : '○' }}</span>
              {{ r.label }}
            </div>
          </div>
        </div>

        <div>
          <label class="text-sm text-[var(--text-dim)]">确认新密码</label>
          <div
            class="mt-1.5 flex items-center gap-2 px-3 py-2.5 rounded-xl bg-[var(--surface-2)] border transition-colors"
            :class="
              mismatch ? 'border-red-500/60' : 'border-[var(--border)] focus-within:border-accent/50'
            "
          >
            <Lock class="w-4 h-4 text-[var(--text-faint)] shrink-0" />
            <input
              :type="show ? 'text' : 'password'"
              autocomplete="new-password"
              v-model="confirm"
              placeholder="再输入一次"
              class="flex-1 bg-transparent text-sm text-[var(--text)] outline-none"
            />
          </div>
          <p v-if="mismatch" class="mt-1.5 text-xs text-red-400">两次输入的密码不一致</p>
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
          :disabled="loading || !canSubmit"
          class="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-accent hover:bg-accent-strong text-white font-medium transition-all disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <Loader2 v-if="loading" class="w-4 h-4 animate-spin" />
          <template v-else>确认重置</template>
        </button>

        <p class="text-center text-xs text-[var(--text-faint)]">
          链接失效了？<RouterLink to="/forgot-password" class="text-accent hover:underline">重新获取</RouterLink>
        </p>
      </form>
    </div>
  </div>
</template>
