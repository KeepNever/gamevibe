<script setup lang="ts">
import { ref } from 'vue'
import { useRouter, RouterLink } from 'vue-router'
import { Gamepad2, Mail, Lock, ArrowRight, Loader2 } from 'lucide-vue-next'
import { useAuthStore } from '@/stores/authStore'

const auth = useAuthStore()
const router = useRouter()
const email = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

async function submit() {
  error.value = ''
  loading.value = true
  try {
    await auth.login(email.value, password.value)
    router.push('/')
  } catch (err: any) {
    error.value = err?.message || '登录失败'
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
          <p class="text-sm text-[var(--text-faint)]">登录你的账号</p>
        </div>
      </div>

      <form @submit.prevent="submit" class="space-y-4 bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6">
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
        <div>
          <label class="text-sm text-[var(--text-dim)]">密码</label>
          <div class="mt-1.5 flex items-center gap-2 px-3 py-2.5 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] focus-within:border-accent/50">
            <Lock class="w-4 h-4 text-[var(--text-faint)]" />
            <input
              type="password"
              required
              v-model="password"
              placeholder="••••••"
              class="flex-1 bg-transparent text-sm text-[var(--text)] outline-none"
            />
          </div>
        </div>

        <div v-if="error" class="text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2">{{ error }}</div>

        <button
          type="submit"
          :disabled="loading"
          class="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-accent hover:bg-accent-strong text-white font-medium transition-all disabled:opacity-60"
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
