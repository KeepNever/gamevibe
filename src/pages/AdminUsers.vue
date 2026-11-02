<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import {
  Search,
  Users,
  ShieldCheck,
  UserX,
  MessageSquare,
  Loader2,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  CheckCircle2,
  Ban,
  Shield,
} from 'lucide-vue-next'
import { api, ApiError } from '@/lib/api'
import { useAuthStore } from '@/stores/authStore'

interface AdminUser {
  id: string
  username: string
  email: string
  display_name: string | null
  status: string
  created_at: number
  roles: string[]
}

interface RoleDef {
  id: string
  key: string
  name: string
  level: number
  permissions: string[]
}

interface PermDef {
  key: string
  name: string
  group_name: string
  description: string
}

const auth = useAuthStore()

const overview = ref<{ users: number; disabled: number; admins: number; reviews: number } | null>(
  null,
)
const users = ref<AdminUser[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const q = ref('')
const loading = ref(false)
const error = ref('')
const notice = ref('')
const busyId = ref('')

const roles = ref<RoleDef[]>([])
const permissions = ref<PermDef[]>([])
const showMatrix = ref(false)

const canManage = computed(() => auth.hasPermission('user.manage'))
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)))
const myLevel = computed(() => auth.maxLevel)

/** 角色等级：用于前端事先隐藏「改不动」的行，避免点了才报错 */
function levelOf(keys: string[]): number {
  return keys.reduce((m, k) => Math.max(m, roles.value.find((r) => r.key === k)?.level ?? 0), 0)
}

function canActOn(u: AdminUser): boolean {
  return canManage.value && u.id !== auth.user?.id && levelOf(u.roles) < myLevel.value
}

async function loadOverview() {
  try {
    const res = await api.get('/admin/overview')
    overview.value = await res.json()
  } catch {
    /* 概览失败不阻塞主表格 */
  }
}

async function loadUsers() {
  loading.value = true
  error.value = ''
  try {
    const params = new URLSearchParams({ page: String(page.value), pageSize: String(pageSize) })
    if (q.value.trim()) params.set('q', q.value.trim())
    const res = await api.get(`/admin/users?${params}`)
    const d = await res.json()
    users.value = d.users ?? []
    total.value = d.total ?? 0
  } catch (err: any) {
    error.value = err instanceof ApiError ? err.message : '加载失败'
  } finally {
    loading.value = false
  }
}

async function loadMeta() {
  try {
    const res = await api.get('/admin/roles')
    const d = await res.json()
    roles.value = d.roles ?? []
    permissions.value = d.permissions ?? []
  } catch {
    /* 角色矩阵是附加信息，失败可忽略 */
  }
}

function flash(msg: string) {
  notice.value = msg
  setTimeout(() => (notice.value = ''), 2600)
}

async function changeRole(u: AdminUser, roleKey: string) {
  busyId.value = u.id
  error.value = ''
  try {
    await api.patch(`/admin/users/${u.id}/role`, { role: roleKey })
    flash(`已将「${u.username}」设为 ${roleKey}`)
    await Promise.all([loadUsers(), loadOverview()])
  } catch (err: any) {
    error.value = err instanceof ApiError ? err.message : '修改角色失败'
  } finally {
    busyId.value = ''
  }
}

async function toggleStatus(u: AdminUser) {
  const next = u.status === 'disabled' ? 'active' : 'disabled'
  busyId.value = u.id
  error.value = ''
  try {
    await api.patch(`/admin/users/${u.id}/status`, { status: next })
    flash(next === 'disabled' ? `已停用「${u.username}」` : `已恢复「${u.username}」`)
    await Promise.all([loadUsers(), loadOverview()])
  } catch (err: any) {
    error.value = err instanceof ApiError ? err.message : '修改状态失败'
  } finally {
    busyId.value = ''
  }
}

function search() {
  page.value = 1
  loadUsers()
}

function go(p: number) {
  page.value = Math.min(totalPages.value, Math.max(1, p))
  loadUsers()
}

function fmt(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const permGroups = computed(() => {
  const map = new Map<string, PermDef[]>()
  for (const p of permissions.value) {
    if (!map.has(p.group_name)) map.set(p.group_name, [])
    map.get(p.group_name)!.push(p)
  }
  return [...map.entries()]
})

onMounted(() => {
  loadOverview()
  loadUsers()
  loadMeta()
})
</script>

<template>
  <div class="max-w-6xl mx-auto px-4 py-8">
    <div class="flex items-start justify-between gap-4 mb-6">
      <div>
        <h1 class="text-2xl font-display font-bold text-[var(--text)]">用户与权限</h1>
        <p class="text-sm text-[var(--text-faint)] mt-1">
          基于角色的访问控制（RBAC）· 当前身份：
          <span class="text-[var(--text-dim)]">{{ auth.roles.map((r) => r.name).join(' / ') }}</span>
        </p>
      </div>
      <button
        class="text-xs px-3 py-2 rounded-lg border border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--text)] transition-colors"
        @click="showMatrix = !showMatrix"
      >
        {{ showMatrix ? '隐藏' : '查看' }}角色矩阵
      </button>
    </div>

    <!-- 概览 -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
      <div class="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
        <div class="flex items-center gap-2 text-[var(--text-faint)] text-xs">
          <Users class="w-4 h-4" /> 注册用户
        </div>
        <p class="text-2xl font-bold text-[var(--text)] mt-2">{{ overview?.users ?? '—' }}</p>
      </div>
      <div class="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
        <div class="flex items-center gap-2 text-[var(--text-faint)] text-xs">
          <ShieldCheck class="w-4 h-4" /> 管理员
        </div>
        <p class="text-2xl font-bold text-[var(--text)] mt-2">{{ overview?.admins ?? '—' }}</p>
      </div>
      <div class="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
        <div class="flex items-center gap-2 text-[var(--text-faint)] text-xs">
          <UserX class="w-4 h-4" /> 已停用
        </div>
        <p class="text-2xl font-bold text-[var(--text)] mt-2">{{ overview?.disabled ?? '—' }}</p>
      </div>
      <div class="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
        <div class="flex items-center gap-2 text-[var(--text-faint)] text-xs">
          <MessageSquare class="w-4 h-4" /> 评论总数
        </div>
        <p class="text-2xl font-bold text-[var(--text)] mt-2">{{ overview?.reviews ?? '—' }}</p>
      </div>
    </div>

    <!-- 角色矩阵 -->
    <div
      v-if="showMatrix"
      class="mb-6 bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 space-y-4"
    >
      <div class="grid sm:grid-cols-3 gap-3">
        <div
          v-for="r in roles"
          :key="r.key"
          class="rounded-lg bg-[var(--surface-2)] border border-[var(--border)] p-3"
        >
          <div class="flex items-center gap-2">
            <Shield class="w-4 h-4 text-accent" />
            <span class="text-sm font-medium text-[var(--text)]">{{ r.name }}</span>
            <span class="text-[10px] px-1.5 py-0.5 rounded bg-[var(--surface)] text-[var(--text-faint)]">
              Lv.{{ r.level }}
            </span>
          </div>
          <p class="text-xs text-[var(--text-faint)] mt-2">
            {{ r.permissions.length }} 项权限
          </p>
        </div>
      </div>

      <div class="space-y-3">
        <div v-for="[group, items] in permGroups" :key="group">
          <p class="text-xs font-medium text-[var(--text-dim)] mb-2">{{ group }}</p>
          <div class="grid sm:grid-cols-2 gap-1.5">
            <div
              v-for="p in items"
              :key="p.key"
              class="flex items-start gap-2 text-xs text-[var(--text-faint)]"
            >
              <code class="text-[10px] px-1.5 py-0.5 rounded bg-[var(--surface-2)] shrink-0">{{
                p.key
              }}</code>
              <span>{{ p.name }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 搜索 -->
    <div class="flex items-center gap-2 mb-4">
      <div
        class="flex items-center gap-2 px-3 py-2 rounded-xl bg-[var(--surface-2)] border border-[var(--border)] focus-within:border-accent/50 flex-1 max-w-sm"
      >
        <Search class="w-4 h-4 text-[var(--text-faint)]" />
        <input
          v-model="q"
          @keyup.enter="search"
          placeholder="搜索用户名 / 邮箱"
          class="flex-1 bg-transparent text-sm text-[var(--text)] outline-none"
        />
      </div>
      <button
        class="px-3 py-2 rounded-xl bg-accent hover:bg-accent-strong text-white text-sm transition-colors"
        @click="search"
      >
        搜索
      </button>
      <span class="text-xs text-[var(--text-faint)] ml-auto">共 {{ total }} 人</span>
    </div>

    <div
      v-if="error"
      class="mb-4 flex items-start gap-2 text-xs text-red-400 bg-red-500/10 rounded-lg px-3 py-2.5"
    >
      <AlertCircle class="w-4 h-4 shrink-0 mt-0.5" />
      <span>{{ error }}</span>
    </div>
    <div
      v-if="notice"
      class="mb-4 flex items-center gap-2 text-xs text-accent-green bg-accent-green/10 rounded-lg px-3 py-2.5"
    >
      <CheckCircle2 class="w-4 h-4 shrink-0" />
      <span>{{ notice }}</span>
    </div>

    <!-- 列表 -->
    <div class="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
      <div v-if="loading" class="flex items-center justify-center gap-2 py-16 text-sm text-[var(--text-faint)]">
        <Loader2 class="w-4 h-4 animate-spin" /> 加载中…
      </div>

      <div v-else-if="!users.length" class="py-16 text-center text-sm text-[var(--text-faint)]">
        没有匹配的用户
      </div>

      <div v-else class="divide-y divide-[var(--border)]">
        <div
          v-for="u in users"
          :key="u.id"
          class="flex flex-col sm:flex-row sm:items-center gap-3 p-4 hover:bg-[var(--surface-2)]/50 transition-colors"
        >
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-sm font-medium text-[var(--text)] truncate">{{ u.username }}</span>
              <span
                v-for="r in u.roles"
                :key="r"
                class="text-[10px] px-1.5 py-0.5 rounded"
                :class="
                  r === 'admin'
                    ? 'bg-accent/15 text-accent'
                    : r === 'moderator'
                      ? 'bg-amber-500/15 text-amber-500'
                      : 'bg-[var(--surface-2)] text-[var(--text-faint)]'
                "
              >
                {{ roles.find((x) => x.key === r)?.name || r }}
              </span>
              <span
                v-if="u.status === 'disabled'"
                class="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-400"
              >
                已停用
              </span>
              <span v-if="u.id === auth.user?.id" class="text-[10px] text-[var(--text-faint)]">（你）</span>
            </div>
            <p class="text-xs text-[var(--text-faint)] mt-0.5 truncate">
              {{ u.email }} · 注册于 {{ fmt(u.created_at) }}
            </p>
          </div>

          <div class="flex items-center gap-2 shrink-0">
            <select
              :value="u.roles[0] || 'user'"
              :disabled="!canActOn(u) || busyId === u.id"
              class="text-xs px-2 py-1.5 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text-dim)] disabled:opacity-40"
              @change="changeRole(u, ($event.target as HTMLSelectElement).value)"
            >
              <option v-for="r in roles" :key="r.key" :value="r.key">{{ r.name }}</option>
            </select>

            <button
              :disabled="!canActOn(u) || busyId === u.id"
              class="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border transition-colors disabled:opacity-40"
              :class="
                u.status === 'disabled'
                  ? 'border-accent-green/40 text-accent-green hover:bg-accent-green/10'
                  : 'border-red-500/40 text-red-400 hover:bg-red-500/10'
              "
              @click="toggleStatus(u)"
            >
              <CheckCircle2 v-if="u.status === 'disabled'" class="w-3.5 h-3.5" />
              <Ban v-else class="w-3.5 h-3.5" />
              {{ u.status === 'disabled' ? '恢复' : '停用' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 分页 -->
    <div v-if="totalPages > 1" class="flex items-center justify-center gap-2 mt-5">
      <button
        class="p-2 rounded-lg border border-[var(--border)] text-[var(--text-dim)] disabled:opacity-40"
        :disabled="page <= 1"
        @click="go(page - 1)"
      >
        <ChevronLeft class="w-4 h-4" />
      </button>
      <span class="text-xs text-[var(--text-faint)]">{{ page }} / {{ totalPages }}</span>
      <button
        class="p-2 rounded-lg border border-[var(--border)] text-[var(--text-dim)] disabled:opacity-40"
        :disabled="page >= totalPages"
        @click="go(page + 1)"
      >
        <ChevronRight class="w-4 h-4" />
      </button>
    </div>

    <p class="text-xs text-[var(--text-faint)] mt-6 leading-relaxed">
      规则：不能修改自己的角色或停用自己；不能操作与自己同级或更高权限的用户。
      角色变更立即生效，被改动者无需重新登录即可获得新权限（权限在每次请求时实时校验）。
    </p>
  </div>
</template>
