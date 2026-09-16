<template>
  <div class="admin-page">
    <header class="page-header">
      <h1>Token 白嫖通告管理</h1>
      <p>审核社区提交的免费额度通告，维护品质分级与置顶位</p>
    </header>

    <!-- 统计面板 -->
    <div class="stats-grid">
      <div class="stat-card">
        <div class="value orange">{{ counts.pending }}</div>
        <div class="label">待审核</div>
      </div>
      <div class="stat-card">
        <div class="value green">{{ counts.approved }}</div>
        <div class="label">已通过</div>
      </div>
      <div class="stat-card">
        <div class="value">{{ counts.rejected }}</div>
        <div class="label">已驳回</div>
      </div>
      <div class="stat-card">
        <div class="value blue">{{ counts.all }}</div>
        <div class="label">总计</div>
      </div>
    </div>

    <div v-if="message" :class="['message', messageType]">{{ message }}</div>

    <!-- Tab 切换 -->
    <div class="tab-nav">
      <button :class="{ active: status === 'pending' }" @click="switchStatus('pending')">
        待审核<span v-if="counts.pending" class="tab-badge">{{ counts.pending }}</span>
      </button>
      <button :class="{ active: status === 'approved' }" @click="switchStatus('approved')">已通过</button>
      <button :class="{ active: status === 'rejected' }" @click="switchStatus('rejected')">已驳回</button>
      <button :class="{ active: status === 'all' }" @click="switchStatus('all')">全部</button>
    </div>

    <div class="card">
      <div class="card-header">
        <h3>{{ tabTitle }}</h3>
        <div style="display: flex; align-items: center; gap: 12px;">
          <input
            v-model="searchQuery"
            type="text"
            placeholder="搜索服务商或标题..."
            class="search-input"
            @input="debouncedSearch"
          >
          <button class="btn btn-ghost btn-sm" :disabled="loading" @click="loadDeals">刷新</button>
        </div>
      </div>

      <div v-if="loading" class="empty-state">加载中...</div>
      <div v-else-if="deals.length === 0" class="empty-state">{{ emptyText }}</div>

      <table v-else>
        <thead>
          <tr>
            <th style="width: 150px;">服务商</th>
            <th>标题</th>
            <th style="width: 110px;">分级 / 来源</th>
            <th style="width: 140px;">免费额度</th>
            <th style="width: 110px;">社区反馈</th>
            <th style="width: 100px;">发布者</th>
            <th style="width: 120px;">提交时间</th>
            <th style="width: 240px;">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in deals" :key="d.id">
            <td>
              <div class="cell-provider">
                <i v-if="d.pinned" class="ri-pushpin-2-fill pin-icon" title="已置顶"></i>
                <span class="provider-name">{{ d.provider }}</span>
              </div>
              <span v-if="d.status !== 'approved'" class="badge" :class="statusBadgeClass(d.status)">
                {{ STATUS_LABELS[d.status] || d.status }}
              </span>
            </td>
            <td>
              <div class="cell-title">{{ d.title }}</div>
              <a :href="d.url" target="_blank" rel="noopener noreferrer" class="cell-url">{{ d.url }}</a>
            </td>
            <td>
              <span class="quality-tag" :class="qualityClass(d.quality)">{{ d.quality }}</span>
              <div class="cell-sub">{{ regionLabel(d.region) }} · {{ sourceLabel(d.source_tag) }}</div>
            </td>
            <td>
              <div class="cell-quota">{{ d.quota || '-' }}</div>
              <div v-if="d.expires_at" class="cell-sub" :class="{ 'is-warn': d.is_expired }">
                {{ d.is_expired ? '已过期' : expiryText(d.expires_at) }}
              </div>
            </td>
            <td>
              <div class="cell-votes">
                <span class="vote-up"><i class="ri-thumb-up-line"></i>{{ d.vote_up }}</span>
                <span class="vote-down"><i class="ri-thumb-down-line"></i>{{ d.vote_down }}</span>
              </div>
              <div class="cell-sub">{{ ratingText(d) }}</div>
            </td>
            <td>{{ d.nickname || d.username || '-' }}</td>
            <td>{{ formatTime(d.created_at) }}</td>
            <td class="actions">
              <template v-if="d.status === 'pending'">
                <button class="btn btn-primary btn-sm" @click="review(d, 'approve')">通过</button>
                <button class="btn btn-danger btn-sm" @click="openReject(d)">驳回</button>
              </template>
              <template v-else-if="d.status === 'rejected'">
                <button class="btn btn-primary btn-sm" @click="review(d, 'approve')">通过</button>
                <button class="btn btn-ghost btn-sm" title="查看驳回原因" @click="showRejectReason(d)">原因</button>
              </template>
              <template v-else>
                <button class="btn btn-ghost btn-sm" @click="togglePin(d)">
                  {{ d.pinned ? '取消置顶' : '置顶' }}
                </button>
                <button class="btn btn-ghost btn-sm" @click="openEdit(d)">编辑</button>
                <button class="btn btn-danger btn-sm" @click="removeDeal(d)">删除</button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>

      <div v-if="totalPages > 1" class="pagination">
        <button :disabled="page <= 1" @click="page--; loadDeals()">上一页</button>
        <button v-for="n in pageList" :key="n" :class="{ active: n === page }" @click="page = n; loadDeals()">{{ n }}</button>
        <button :disabled="page >= totalPages" @click="page++; loadDeals()">下一页</button>
      </div>
    </div>

    <!-- 驳回原因弹窗 -->
    <Teleport to="body">
      <div v-if="rejectTarget" class="modal-overlay active" @click.self="rejectTarget = null">
        <div class="modal">
          <div class="modal-header">
            <h3>驳回通告</h3>
            <button class="modal-close" @click="rejectTarget = null">&times;</button>
          </div>
          <div class="modal-body">
            <p class="hint">
              即将驳回「{{ rejectTarget.provider }} · {{ rejectTarget.title }}」。
              驳回原因会展示给发布者，请说明具体问题。
            </p>
            <div class="fg">
              <label>驳回原因</label>
              <textarea
                v-model="rejectReason"
                rows="3"
                maxlength="200"
                placeholder="如：领取地址无法访问 / 额度信息与实际不符 / 与已有通告重复"
              ></textarea>
              <small>{{ rejectReason.length }} / 200</small>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" @click="rejectTarget = null">取消</button>
            <button class="btn btn-danger" :disabled="submitting" @click="confirmReject">
              {{ submitting ? '提交中...' : '确认驳回' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 编辑弹窗（复用前台编辑器） -->
    <TokenDealEditor
      v-if="editVisible"
      :deal="editingDeal"
      @close="editVisible = false"
      @saved="onEdited"
    />
  </div>
</template>

<script setup lang="ts">
import TokenDealEditor from '~/components/tokens/TokenDealEditor.vue'

definePageMeta({ middleware: 'admin', layout: 'admin' })
useHead({ title: '白嫖通告管理' })

const authStore = useAuthStore()

function getAuthHeaders(): Record<string, string> {
  return authStore.token && authStore.token !== 'cookie_auth'
    ? { Authorization: `Bearer ${authStore.token}` }
    : {}
}
function getAuthOpts(): Record<string, any> {
  return { headers: getAuthHeaders(), credentials: 'include' as const }
}

const STATUS_LABELS: Record<string, string> = {
  pending: '待审核',
  approved: '已通过',
  rejected: '已驳回',
}
const REGION_LABELS: Record<string, string> = { cn: '国内直连', global: '海外' }
const SOURCE_LABELS: Record<string, string> = {
  official: '官方直营',
  relay: '中转站',
  community: '社区转发',
}

const status = ref<'pending' | 'approved' | 'rejected' | 'all'>('pending')
const deals = ref<any[]>([])
const counts = reactive({ pending: 0, approved: 0, rejected: 0, all: 0 })
const loading = ref(false)
const submitting = ref(false)
const page = ref(1)
const pageSize = 20
const total = ref(0)
const searchQuery = ref('')

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)))
const pageList = computed(() => {
  const out: number[] = []
  for (let i = Math.max(1, page.value - 2); i <= Math.min(totalPages.value, page.value + 2); i++) out.push(i)
  return out
})

const tabTitle = computed(() => ({
  pending: '待审核通告',
  approved: '已通过通告',
  rejected: '已驳回通告',
  all: '全部通告',
}[status.value]))

const emptyText = computed(() => ({
  pending: '暂无待审核通告',
  approved: '暂无已通过通告',
  rejected: '暂无已驳回通告',
  all: '暂无通告',
}[status.value]))

// 消息通知
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
let messageTimer: ReturnType<typeof setTimeout> | null = null

function showMessage(msg: string, type: 'success' | 'error' = 'success') {
  if (messageTimer) clearTimeout(messageTimer)
  message.value = msg
  messageType.value = type
  messageTimer = setTimeout(() => { message.value = '' }, 3000)
}

let loadingGuard = false
async function loadDeals() {
  if (loadingGuard) return
  loadingGuard = true
  loading.value = true
  try {
    const params = new URLSearchParams({
      status: status.value,
      page: String(page.value),
      limit: String(pageSize),
    })
    if (searchQuery.value) params.append('search', searchQuery.value)

    const r = await $fetch<any>(`/api/admin/token-deals?${params}`, getAuthOpts())
    deals.value = r.deals || []
    total.value = r.pagination?.total || 0
    if (r.counts) Object.assign(counts, r.counts)
  } catch (e: any) {
    showMessage('加载失败：' + (e?.data?.error || e?.message || '未知错误'), 'error')
    deals.value = []
  } finally {
    loading.value = false
    loadingGuard = false
  }
}

let searchTimer: ReturnType<typeof setTimeout> | null = null
function debouncedSearch() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => { page.value = 1; loadDeals() }, 300)
}

function switchStatus(next: typeof status.value) {
  status.value = next
  page.value = 1
  loadDeals()
}

// ── 展示辅助 ──────────────────────────────────────────────
function statusBadgeClass(s: string) {
  if (s === 'pending') return 'badge-pending'
  if (s === 'rejected') return 'badge-locked'
  return 'badge-public'
}

function qualityClass(q?: string) {
  const map: Record<string, string> = {
    上上品: 'q-top',
    上品: 'q-high',
    中品: 'q-mid',
    下品: 'q-low',
    下下品: 'q-bottom',
  }
  return map[q || '中品'] || 'q-mid'
}

function regionLabel(r?: string) {
  return REGION_LABELS[r || 'cn'] || '国内直连'
}

function sourceLabel(s?: string) {
  return SOURCE_LABELS[s || 'official'] || '官方直营'
}

function formatTime(ts?: number) {
  if (!ts) return '-'
  return new Date(ts).toLocaleString('zh-CN', { hour12: false })
}

function expiryText(ts: number) {
  const diff = ts - Date.now()
  if (diff <= 0) return '已过期'
  const days = Math.ceil(diff / 86400000)
  return days <= 30 ? `${days} 天后到期` : new Date(ts).toLocaleDateString('zh-CN')
}

function ratingText(d: any) {
  if (!d.rating_count) return '暂无评测'
  return `评分 ${(d.rating_sum / d.rating_count).toFixed(1)}（${d.rating_count}）`
}

// ── 审核 ──────────────────────────────────────────────────
async function review(d: any, action: 'approve' | 'reject', reason = '') {
  submitting.value = true
  try {
    await $fetch(`/api/admin/token-deals/${d.id}/review`, {
      method: 'POST',
      ...getAuthOpts(),
      body: { action, reason },
    })
    showMessage(action === 'approve' ? '已通过审核' : '已驳回')
    await loadDeals()
  } catch (e: any) {
    showMessage('操作失败：' + (e?.data?.error || e?.message || '未知错误'), 'error')
  } finally {
    submitting.value = false
  }
}

const rejectTarget = ref<any>(null)
const rejectReason = ref('')

function openReject(d: any) {
  rejectTarget.value = d
  rejectReason.value = ''
}

async function confirmReject() {
  if (!rejectTarget.value) return
  if (!rejectReason.value.trim()) {
    showMessage('请填写驳回原因', 'error')
    return
  }
  const target = rejectTarget.value
  await review(target, 'reject', rejectReason.value.trim())
  rejectTarget.value = null
}

function showRejectReason(d: any) {
  if (import.meta.client) {
    alert(`驳回原因：\n${d.reject_reason || '未填写'}`)
  }
}

// ── 置顶 / 编辑 / 删除 ────────────────────────────────────
async function togglePin(d: any) {
  try {
    const r = await $fetch<{ pinned: number }>(`/api/token-deals/${d.id}/pin`, {
      method: 'POST',
      ...getAuthOpts(),
      body: { pinned: !d.pinned },
    })
    d.pinned = r.pinned
    showMessage(r.pinned ? '已置顶' : '已取消置顶')
    await loadDeals()
  } catch (e: any) {
    showMessage('操作失败：' + (e?.data?.error || e?.message || '未知错误'), 'error')
  }
}

const editVisible = ref(false)
const editingDeal = ref<any>(null)

function openEdit(d: any) {
  editingDeal.value = d
  editVisible.value = true
}

function onEdited() {
  editVisible.value = false
  editingDeal.value = null
  loadDeals()
}

async function removeDeal(d: any) {
  if (!import.meta.client) return
  if (!confirm(`确定删除通告「${d.provider} · ${d.title}」？\n将同时删除其投票与评测记录，操作不可恢复。`)) return
  try {
    await $fetch(`/api/token-deals/${d.id}`, { method: 'DELETE', ...getAuthOpts() })
    showMessage('已删除')
    await loadDeals()
  } catch (e: any) {
    showMessage('删除失败：' + (e?.data?.error || e?.message || '未知错误'), 'error')
  }
}

onMounted(() => {
  loadDeals()
})

onBeforeUnmount(() => {
  if (messageTimer) clearTimeout(messageTimer)
  if (searchTimer) clearTimeout(searchTimer)
})
</script>

<style scoped>
.tab-badge {
  display: inline-block;
  margin-left: 6px;
  padding: 0 6px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 16px;
  background: var(--danger);
  color: #fff;
}

.cell-provider {
  display: flex;
  align-items: center;
  gap: 5px;
  font-weight: 500;
}
.provider-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pin-icon {
  font-size: 12px;
  color: var(--primary);
  flex-shrink: 0;
}

.cell-title {
  font-size: 13px;
  color: var(--text-primary);
  margin-bottom: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.cell-url {
  display: block;
  font-size: 11.5px;
  color: var(--text-tertiary);
  text-decoration: none;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cell-url:hover { color: var(--primary); text-decoration: underline; }

.cell-sub {
  margin-top: 3px;
  font-size: 11.5px;
  color: var(--text-tertiary);
}
.cell-sub.is-warn { color: var(--warning); }
.cell-quota {
  font-size: 12.5px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.cell-votes {
  display: flex;
  gap: 10px;
  font-size: 12.5px;
}
.vote-up { color: var(--success); }
.vote-down { color: var(--danger); }

.quality-tag {
  display: inline-block;
  padding: 1px 7px;
  border-radius: 6px;
  font-size: 11.5px;
  font-weight: 500;
}
.quality-tag.q-top,
.quality-tag.q-high { background: var(--primary-light); color: var(--primary); }
.quality-tag.q-mid { background: var(--surface-sunken); color: var(--text-secondary); }
.quality-tag.q-low,
.quality-tag.q-bottom { background: rgba(245, 158, 11, 0.12); color: var(--warning); }
</style>
