<template>
  <div class="admin-page">
    <header class="page-header">
      <h1>游客评测</h1>
      <p>管理全部游客匿名评测：翻查四态（待审 / 已通过 / 已拒绝 / 已删）、按通告定位、管理员处置并留痕</p>
    </header>

    <!-- 状态统计：与 Tab 徽章同源（服务端 counts），不本地累加 -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="value orange">{{ counts.pending || 0 }}</div>
        <div class="label">待审核</div>
      </div>
      <div class="stat-card">
        <div class="value green">{{ counts.approved || 0 }}</div>
        <div class="label">已通过</div>
      </div>
      <div class="stat-card">
        <div class="value">{{ counts.rejected || 0 }}</div>
        <div class="label">已拒绝</div>
      </div>
      <div class="stat-card">
        <div class="value red">{{ counts.deleted || 0 }}</div>
        <div class="label">已删除（软删）</div>
      </div>
      <div class="stat-card">
        <div class="value blue">{{ counts.all || 0 }}</div>
        <div class="label">全部</div>
      </div>
    </div>

    <div v-if="message" :class="['message', messageType]">{{ message }}</div>

    <!-- Tab：四态 + 全部 -->
    <div class="tab-nav">
      <button :class="{ active: status === 'all' }" @click="switchStatus('all')">全部</button>
      <button :class="{ active: status === 'pending' }" @click="switchStatus('pending')">
        待审核<span v-if="counts.pending" class="tab-badge">{{ counts.pending }}</span>
      </button>
      <button :class="{ active: status === 'approved' }" @click="switchStatus('approved')">已通过</button>
      <button :class="{ active: status === 'rejected' }" @click="switchStatus('rejected')">已拒绝</button>
      <button :class="{ active: status === 'deleted' }" @click="switchStatus('deleted')">
        已删除<span v-if="counts.deleted" class="tab-badge">{{ counts.deleted }}</span>
      </button>
    </div>

    <!-- 筛选条 -->
    <div class="filter-bar">
      <input
        v-model="keyword"
        type="text"
        class="search-input"
        placeholder="搜索评测内容 / 游客名 / 通告 ID / 评测 ID"
        maxlength="120"
        @keyup.enter="applyFilters"
      >
      <input
        v-model="dealId"
        type="text"
        class="search-input deal-input"
        placeholder="按通告 ID 精确筛选"
        maxlength="80"
        @keyup.enter="applyFilters"
      >
      <button class="btn btn-primary btn-sm" :disabled="loading" @click="applyFilters">筛选</button>
      <button class="btn btn-ghost btn-sm" :disabled="loading" @click="resetFilters">重置</button>
      <button class="btn btn-ghost btn-sm" :disabled="loading" @click="loadReviews">刷新</button>
      <span class="info">共 {{ total }} 条 · 第 {{ page }} / {{ totalPages }} 页</span>
    </div>

    <div v-if="forbidden" class="card">
      <div class="empty-state">
        <i class="ri-lock-line"></i>
        当前账号没有管理员权限，无法访问该列表。
      </div>
    </div>

    <div v-else class="card">
      <div v-if="loading" class="empty-state">加载中...</div>
      <div v-else-if="reviews.length === 0" class="empty-state">没有符合条件的游客评测</div>

      <div v-else class="review-list">
        <div v-for="r in reviews" :key="r.id" class="review-row" :class="{ 'is-deleted': r.display_status === 'deleted' }">
          <div class="review-row-head">
            <div class="review-who">
              <span class="guest-avatar" :class="{ 'has-img': r.avatar && !brokenAvatars.has(r.id) }">
                <img
                  v-if="r.avatar && !brokenAvatars.has(r.id)"
                  :src="r.avatar"
                  :alt="r.nickname"
                  @error="brokenAvatars.add(r.id)"
                >
                <template v-else>{{ (r.nickname || '?')[0].toUpperCase() }}</template>
              </span>
              <span class="review-nickname">{{ r.nickname }}</span>
              <span v-if="r.is_user" class="badge badge-user" title="由登录用户提交（仅标识，不下发账号 id）">登录用户</span>
              <span class="guest-rating">
                <i v-for="n in 5" :key="n" :class="n <= r.rating ? 'ri-star-fill' : 'ri-star-line'"></i>
              </span>
            </div>
            <div class="review-head-right">
              <span :class="['badge', statusBadgeClass(r.display_status)]">{{ statusLabel(r.display_status) }}</span>
              <span class="review-time">{{ formatTime(r.created_at) }}</span>
            </div>
          </div>

          <div class="review-deal">
            <i class="ri-gift-2-line"></i>
            <template v-if="r.deal && r.deal.title">
              <NuxtLink :to="`/tokens/${r.deal_id}.html`" target="_blank" rel="noopener" class="deal-link">
                {{ r.deal.provider ? `${r.deal.provider} · ` : '' }}{{ r.deal.title }}
              </NuxtLink>
              <span v-if="r.deal.deleted" class="badge badge-locked">通告已删除</span>
            </template>
            <span v-else class="deal-missing">通告不存在（{{ r.deal_id }}）</span>
            <span class="review-rid" :title="`评测 ID：${r.id}`">#{{ r.id }}</span>
          </div>

          <p class="review-content">{{ r.content }}</p>

          <p v-if="r.reject_reason" class="review-reason">
            <i class="ri-information-line"></i> 理由：{{ r.reject_reason }}
          </p>
          <p v-if="r.deleted_at" class="review-reason">
            <i class="ri-delete-bin-line"></i> 已软删除于 {{ formatTime(r.deleted_at) }}（库内行仍保留，可恢复）
          </p>

          <div class="review-actions">
            <button
              v-if="r.display_status === 'pending'"
              class="btn btn-primary btn-sm"
              :disabled="busy === r.id"
              @click="act(r, 'approve')"
            >
              通过
            </button>
            <button
              v-if="r.display_status === 'pending'"
              class="btn btn-ghost btn-sm"
              :disabled="busy === r.id"
              @click="openReason(r, 'reject')"
            >
              拒绝
            </button>
            <button
              v-if="r.display_status !== 'deleted'"
              class="btn btn-danger btn-sm"
              :disabled="busy === r.id"
              @click="openReason(r, 'delete')"
            >
              删除
            </button>
            <button
              v-if="r.display_status === 'deleted'"
              class="btn btn-ghost btn-sm"
              :disabled="busy === r.id"
              @click="act(r, 'restore')"
            >
              恢复
            </button>
            <button class="btn btn-ghost btn-sm" :disabled="historyLoading === r.id" @click="openHistory(r)">
              处置记录
            </button>
          </div>

          <!-- 处置理由（删除 / 拒绝共用）-->
          <div v-if="reasonTarget?.id === r.id" class="reason-box">
            <textarea
              v-model="reasonText"
              rows="2"
              maxlength="200"
              :placeholder="reasonAction === 'delete' ? '删除理由（选填，会记入处置记录）' : '拒绝理由（选填，会展示给游客）'"
            ></textarea>
            <div class="reason-actions">
              <span class="reason-hint">{{ reasonAction === 'delete' ? '软删除：评测从公开侧消失，库内保留可恢复' : '' }}</span>
              <button class="btn btn-ghost btn-sm" @click="reasonTarget = null">取消</button>
              <button
                :class="['btn', reasonAction === 'delete' ? 'btn-danger' : 'btn-primary', 'btn-sm']"
                :disabled="busy === r.id"
                @click="confirmReason"
              >
                确认{{ reasonAction === 'delete' ? '删除' : '拒绝' }}
              </button>
            </div>
          </div>

          <!-- 处置记录（该条评测的审计轨迹，按需展开）-->
          <div v-if="historyTarget?.id === r.id" class="history-box">
            <div class="history-head">
              <strong>处置记录</strong>
              <button class="btn btn-ghost btn-sm" @click="historyTarget = null">收起</button>
            </div>
            <div v-if="historyLoading === r.id" class="history-empty">加载中...</div>
            <div v-else-if="history.length === 0" class="history-empty">暂无处置记录</div>
            <ul v-else class="history-list">
              <li v-for="h in history" :key="h.id" class="history-item">
                <span :class="['badge', actionBadgeClass(h.action)]">{{ h.action_label }}</span>
                <span class="history-actor">{{ h.actor_name || `#${h.actor_id}` }}</span>
                <span class="history-state">{{ h.from_status || '-' }} → {{ h.to_status || '-' }}</span>
                <span class="history-time">{{ formatTime(h.created_at) }}</span>
                <span v-if="h.reason" class="history-reason">理由：{{ h.reason }}</span>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <!-- 分页 -->
      <div v-if="!loading && totalPages > 1" class="pagination">
        <button :disabled="page <= 1" @click="goPage(page - 1)">上一页</button>
        <button v-for="p in pageNumbers" :key="p" :class="{ active: p === page }" @click="goPage(p)">{{ p }}</button>
        <button :disabled="page >= totalPages" @click="goPage(page + 1)">下一页</button>
      </div>
    </div>

    <BackToTop />
  </div>
</template>

<script setup lang="ts">
import BackToTop from '~/components/BackToTop.vue'

definePageMeta({ middleware: 'admin', layout: 'admin' })
useHead({ title: '游客评测管理' })

const authStore = useAuthStore()

function getAuthHeaders(): Record<string, string> {
  return authStore.token && authStore.token !== 'cookie_auth'
    ? { Authorization: `Bearer ${authStore.token}` }
    : {}
}
function getAuthOpts(): Record<string, any> {
  return { headers: getAuthHeaders(), credentials: 'include' as const }
}

interface AdminDealInfo {
  id: string
  provider: string | null
  title: string | null
  status: string | null
  deleted: boolean
}
interface AdminGuestReview {
  id: string
  deal_id: string
  nickname: string
  rating: number
  content: string
  status: string
  display_status: string
  is_user: boolean
  avatar: string | null
  reject_reason: string
  deleted_at: number | null
  deleted_by: number | null
  created_at: number | null
  updated_at: number | null
  deal?: AdminDealInfo
}
interface AdminActionRecord {
  id: number
  review_id: string
  action: string
  action_label: string
  from_status: string
  to_status: string
  reason: string
  actor_id: number | null
  actor_name: string
  created_at: number
}

const STATUS_LABELS: Record<string, string> = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已拒绝',
  deleted: '已删除',
}

const reviews = ref<AdminGuestReview[]>([])
const counts = reactive<Record<string, number>>({ all: 0, pending: 0, approved: 0, rejected: 0, deleted: 0 })
const total = ref(0)
const page = ref(1)
const limit = ref(20)
const status = ref('all')
const keyword = ref('')
const dealId = ref('')
const loading = ref(false)
const forbidden = ref(false)

const message = ref('')
const messageType = ref<'success' | 'error'>('success')
let messageTimer: ReturnType<typeof setTimeout> | null = null
function showMessage(msg: string, type: 'success' | 'error' = 'success') {
  if (messageTimer) clearTimeout(messageTimer)
  message.value = msg
  messageType.value = type
  messageTimer = setTimeout(() => { message.value = '' }, 3500)
}

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / limit.value)))
const pageNumbers = computed(() => {
  const out: number[] = []
  const start = Math.max(1, page.value - 2)
  const end = Math.min(totalPages.value, start + 4)
  for (let i = start; i <= end; i++) out.push(i)
  return out
})

const brokenAvatars = reactive(new Set<string>())

async function loadReviews() {
  if (loading.value) return
  loading.value = true
  forbidden.value = false
  try {
    const params = new URLSearchParams()
    params.set('page', String(page.value))
    params.set('limit', String(limit.value))
    params.set('status', status.value)
    if (keyword.value.trim()) params.set('keyword', keyword.value.trim())
    if (dealId.value.trim()) params.set('deal_id', dealId.value.trim())
    const res = await $fetch<any>(`/api/admin/guest-reviews?${params.toString()}`, getAuthOpts())
    reviews.value = res.reviews || []
    total.value = res.total || 0
    if (res.counts) {
      for (const k of Object.keys(counts)) counts[k] = Number(res.counts[k] || 0)
    }
  } catch (e: any) {
    const code = Number(e?.statusCode || e?.status || e?.response?.status || 0)
    reviews.value = []
    total.value = 0
    if (code === 403) {
      forbidden.value = true
    } else if (code === 401) {
      showMessage('登录已失效，请重新登录', 'error')
    } else {
      showMessage('加载失败：' + (e?.data?.error || e?.message || '未知错误'), 'error')
    }
  } finally {
    loading.value = false
  }
}

function switchStatus(next: string) {
  if (status.value === next) return
  status.value = next
  page.value = 1
  loadReviews()
}
function applyFilters() {
  page.value = 1
  loadReviews()
}
function resetFilters() {
  keyword.value = ''
  dealId.value = ''
  status.value = 'all'
  page.value = 1
  loadReviews()
}
function goPage(next: number) {
  if (next < 1 || next > totalPages.value || next === page.value) return
  page.value = next
  loadReviews()
}

// ── 处置 ──────────────────────────────────────────────────
const busy = ref('')
const reasonTarget = ref<AdminGuestReview | null>(null)
const reasonAction = ref<'delete' | 'reject'>('delete')
const reasonText = ref('')

function openReason(target: AdminGuestReview, action: 'delete' | 'reject') {
  reasonTarget.value = target
  reasonAction.value = action
  reasonText.value = ''
}
async function confirmReason() {
  const target = reasonTarget.value
  if (!target) return
  const action = reasonAction.value
  const reason = reasonText.value.trim()
  reasonTarget.value = null
  reasonText.value = ''
  await act(target, action, reason)
}

/** 统一处置入口：approve / reject 走 action 端点；delete 走 REST DELETE（同一实现） */
async function act(target: AdminGuestReview, action: 'approve' | 'reject' | 'delete' | 'restore', reason = '') {
  if (busy.value) return
  busy.value = target.id
  try {
    const res = action === 'delete'
      ? await $fetch<any>(`/api/admin/guest-reviews/${encodeURIComponent(target.id)}`, {
        method: 'DELETE',
        body: reason ? { reason } : undefined,
        ...getAuthOpts(),
      })
      : await $fetch<any>(`/api/admin/guest-reviews/${encodeURIComponent(target.id)}/action`, {
        method: 'POST',
        body: { action, reason },
        ...getAuthOpts(),
      })
    showMessage(res?.message || '操作成功')
    if (historyTarget.value?.id === target.id) loadHistory(target)
    await loadReviews()
  } catch (e: any) {
    const code = Number(e?.statusCode || e?.status || 0)
    if (code === 403) showMessage('无管理员权限，操作被拒绝', 'error')
    else showMessage('操作失败：' + (e?.data?.error || e?.message || '未知错误'), 'error')
  } finally {
    busy.value = ''
  }
}

// ── 处置记录 ──────────────────────────────────────────────
const historyTarget = ref<AdminGuestReview | null>(null)
const history = ref<AdminActionRecord[]>([])
const historyLoading = ref('')

async function openHistory(target: AdminGuestReview) {
  if (historyTarget.value?.id === target.id) {
    historyTarget.value = null
    return
  }
  historyTarget.value = target
  await loadHistory(target)
}
async function loadHistory(target: AdminGuestReview) {
  historyLoading.value = target.id
  history.value = []
  try {
    const res = await $fetch<any>(
      `/api/admin/guest-reviews/audit?id=${encodeURIComponent(target.id)}&limit=50`,
      getAuthOpts(),
    )
    history.value = res.actions || []
    if (res.auto_refresh) await loadReviews()
  } catch (e: any) {
    showMessage('加载处置记录失败：' + (e?.data?.error || e?.message || '未知错误'), 'error')
  } finally {
    historyLoading.value = ''
  }
}

// ── 展示辅助 ──────────────────────────────────────────────
function statusLabel(s: string) {
  return STATUS_LABELS[s] || s
}
function statusBadgeClass(s: string) {
  if (s === 'pending') return 'badge-pending'
  if (s === 'approved') return 'badge-public'
  if (s === 'rejected') return 'badge-private'
  return 'badge-locked' // deleted
}
function actionBadgeClass(action: string) {
  if (action === 'approve') return 'badge-public'
  if (action === 'delete') return 'badge-locked'
  if (action === 'restore') return 'badge-admin'
  return 'badge-private'
}
function formatTime(ts?: number | null) {
  if (!ts) return '-'
  return new Date(Number(ts)).toLocaleString('zh-CN', { hour12: false })
}

onMounted(loadReviews)
</script>

<style scoped>
.review-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
}
.review-row {
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface-sunken);
}
/* 已软删除的行整体淡化，但保留可读性（管理员还要看内容才决定是否恢复） */
.review-row.is-deleted { opacity: 0.72; border-style: dashed; }
.review-row-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 6px;
}
.review-who {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}
.review-nickname { font-size: 13px; font-weight: 600; color: var(--text-primary); }
.review-head-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.review-time { font-size: 12px; color: var(--text-tertiary); }
.review-deal {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 4px;
}
.deal-link { color: var(--primary); text-decoration: none; word-break: break-all; }
.deal-link:hover { text-decoration: underline; }
.deal-missing { color: var(--text-tertiary); }
.review-rid { margin-left: auto; font-size: 11px; color: var(--text-tertiary); font-family: ui-monospace, monospace; }
.review-content {
  margin: 8px 0 0;
  padding: 10px 12px;
  border-radius: 6px;
  background: var(--surface-raised);
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
}
.review-reason { margin: 6px 0 0; font-size: 12px; color: var(--text-tertiary); }
.guest-avatar {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--primary);
  color: var(--text-inverse);
  font-size: 10px;
  font-weight: 600;
  overflow: hidden;
}
.guest-avatar.has-img { background: transparent; }
.guest-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
.guest-rating { display: inline-flex; gap: 1px; font-size: 11px; color: var(--warning); }
.review-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.reason-box {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--border);
}
.reason-box textarea {
  width: 100%;
  padding: 8px 12px;
  font-size: 13px;
  font-family: inherit;
  line-height: 1.5;
  color: var(--text-primary);
  background: var(--surface-raised);
  border: 1px solid var(--border);
  border-radius: 6px;
  outline: none;
  resize: vertical;
}
.reason-box textarea:focus { border-color: var(--primary); }
.reason-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 8px; }
.reason-hint { margin-right: auto; font-size: 11px; color: var(--text-tertiary); }
.history-box {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--border);
}
.history-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.history-head strong { font-size: 12px; color: var(--text-secondary); }
.history-empty { font-size: 12px; color: var(--text-tertiary); }
.history-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.history-item { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; font-size: 12px; color: var(--text-secondary); }
.history-actor { font-weight: 600; color: var(--text-primary); }
.history-state { font-family: ui-monospace, monospace; color: var(--text-tertiary); }
.history-time { margin-left: auto; color: var(--text-tertiary); }
.history-reason { flex-basis: 100%; color: var(--text-tertiary); }
.deal-input { max-width: 240px; }

/* Tab 上的数字角标（与 token-deals 页 .tab-badge 同款，admin.css 未全局定义） */
.tab-badge {
  display: inline-block;
  margin-left: 6px;
  padding: 0 6px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 16px;
  background: var(--danger);
  color: var(--text-inverse);
}
</style>