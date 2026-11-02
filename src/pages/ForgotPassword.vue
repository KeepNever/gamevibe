<script setup lang="ts">
import { ref, computed } from 'vue'
import { RouterLink } from 'vue-router'
import { Gamepad2, Mail, ArrowLeft, Loader2, AlertCircle, CheckCircle2, Copy } from 'lucide-vue-next'
import { api, ApiError } from '@/lib/api'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const email = ref('')
const loading = ref(false)
const error = ref('')
const submitted = ref(false)
const delivery = ref<'mail' | 'inline' | ''>('')
const resetUrl = ref('')
const note = ref('')
const found = ref<boolean | null>(null)
const copied = ref(false)

const emailError = computed(() => {
  if (!email.value.trim()) return ''
  return EMAIL_RE.test(email.value.trim()) ? '' : '邮箱格式不正确'
})

/** 后端可能返回完整 URL，这里统一转成站内路径供 RouterLink 使用 */
const resetPath = computed(() => {
  if (!resetUrl.value) return ''
  try {
    const u = new URL(resetUrl.value, window.location.origin)
    return u.pathname + u.search
  } catch {
    return resetUrl.value
  }
})

async function submit() {
  error.value = ''
  if (!EMAIL_RE.test(email.value.trim())) {
    error.value = '请填写正确的邮箱'
    return
  }
  loading.value = true
  try {
    const res = await api.post('/auth/forgot-password', { email: email.value.trim() })
    const d = await res.json()
    submitted.value = true
    delivery.value = d.delivery || ''
    resetUrl.value = d.resetUrl || ''
    note.value = d.note || ''
    found.value = typeof d.found === 'boolean' ? d.found : null
  } catch (err: any) {
    error.value =
      err instanceof ApiError ? err.message : '提交失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(new URL(resetPath.value, window.location.origin).toString())
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  } catch {
    /* 剪贴板不可用时忽略 */
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-[var(--bg)] px-4 py-10">
    <div class="w-full max-w-sm">
      <RouterLink
        to="/login"
        class="inline-flex items-center gap-1.5 text-sm text-[var(--text-faint)] hover:text-[var(--text)] transition-colors mb-6"
      >
        <ArrowLeft class="w-4 h-4" />
        返回登录
      </RouterLink>

      <div class="flex items-center gap-3 mb-8 justify-center">
        <div
          class="w-12 h-12 rounded-2xl bg-gradient-to-br from-accent-strong to-accent-blue flex items-center justify-center shadow-lg shadow-accent/20"
        >
          <Gamepad2 class="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 class="text-2xl font-display font-bold text-[var(--text)]">找回密码</h1>
          <p class="text-sm text-[var(--text-faint)]">我们帮你重置账号密码</p>
        </div>
      </div>

      <!-- 提交成功后的结果区 -->
      <div
        v-if="submitted"
        class="space-y-4 bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6"
      >
        <div class="flex items-start gap-2.5">
          <CheckCircle2 class="w-5 h-5 text-accent-green shrink-0 mt-0.5" />
          <div class="text-sm text-[var(--text)] leading-relaxed">
            <p v-if="delivery === 'mail'">重置链接已发送到 <b>{{ email }}</b>，30 分钟内有效。</p>
            <p v-else-if="found === true">已为该账号生成重置链接。</p>
            <p v-else-if="found === false">该邮箱尚未注册。</p>
            <p v-else>如果该邮箱已注册，你会在邮箱中收到重置链接。</p>
          </div>
        </div>

        <!-- 演示模式：链接直接给出 -->
        <div
          v-if="delivery === 'inline' && resetPath"
          class="rounded-xl bg-[var(--surface-2)] border border-[var(--border)] p-3 space-y-2"
        >
          <p class="text-xs text-amber-500 flex items-center gap-1.5">
            <AlertCircle class="w-3.5 h-3.5" />
            演示模式：未配置邮件服务，链接直接显示在此
          </p>
          <RouterLink
            :to="resetPath"
            class="block text-xs text-accent hover:underline break-all leading-relaxed"
          >
            {{ resetPath }}
          </RouterLink>
          <button
            type="button"
            class="inline-flex items-center gap-1.5 text-xs text-[var(--text-dim)] hover:text-[var(--text)] transition-colors"
            @click="copyLink"
          >
            <Copy class="w-3.5 h-3.5" />
            {{ copied ? '已复制' : '复制链接' }}
          </button>
        </div>

        <p v-if="note" class="text-xs text-[var(--text-faint)] leading-relaxed">{{ note }}</p>

        <RouterLink
          :to="resetPath || '/login'"
          class="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-accent hover:bg-accent-strong text-white font-medium transition-all"
        >
          继续重置密码
        </RouterLink>
      </div>

      <!-- 表单 -->
      <form
        v-else
        @submit.prevent="submit"
        class="space-y-4 bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6"
      >
        <p class="text-sm text-[var(--text-dim)] leading-relaxed">
          输入注册时使用的邮箱，我们会生成一条重置链接。链接 30 分钟内有效，且只能使用一次。
        </p>

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
              placeholder="you@example.com"
              class="flex-1 bg-transparent text-sm text-[var(--text)] outline-none"
            />
          </div>
          <p v-if="emailError" class="mt-1.5 text-xs text-red-400">{{ emailError }}</p>
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
          :disabled="loading"
          class="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-accent hover:bg-accent-strong text-white font-medium transition-all disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <Loader2 v-if="loading" class="w-4 h-4 animate-spin" />
          <template v-else>获取重置链接</template>
        </button>
      </form>
    </div>
  </div>
</template>
