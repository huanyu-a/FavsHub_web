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
        <div class="label">总计（在架）</div>
      </div>
      <div class="stat-card">
        <div class="value red">{{ counts.invalid_total }}</div>
        <div class="label">已失效</div>
      </div>
    </div>

    <div v-if="message" :class="['message', messageType]">{{ message }}</div>

    <!-- Tab 切换 -->
    <div class="tab-nav">
      <button :class="{ active: tab === 'deals' && status === 'pending' }" @click="switchStatus('pending')">
        待审核<span v-if="counts.pending" class="tab-badge">{{ counts.pending }}</span>
      </button>
      <button :class="{ active: tab === 'deals' && status === 'approved' && verifyFilter !== 'stale' }" @click="switchStatus('approved')">已通过</button>
      <button :class="{ active: tab === 'deals' && status === 'rejected' }" @click="switchStatus('rejected')">已驳回</button>
      <button :class="{ active: tab === 'deals' && status === 'all' }" @click="switchStatus('all')">全部</button>
      <button
        :class="{ active: tab === 'deals' && verifyFilter === 'stale' }"
        title="只看超过核验阈值（默认 30 天）没有人工核验的在架通告"
        @click="switchVerifyStale()"
      >
        待核验<span v-if="counts.stale" class="tab-badge">{{ counts.stale }}</span>
      </button>
      <button :class="{ active: tab === 'invalid' }" @click="switchTab('invalid')">
        已失效<span v-if="counts.invalid_total" class="tab-badge">{{ counts.invalid_total }}</span>
      </button>
      <button :class="{ active: tab === 'edits' }" @click="switchTab('edits')">
        修改建议<span v-if="editTotal" class="tab-badge">{{ editTotal }}</span>
      </button>
    </div>

    <!-- ── 修改建议 Tab：管理员可审所有用户的提案 ── -->
    <div v-if="tab === 'edits'" class="card">
      <div class="card-header">
        <h3>待审核的修改建议</h3>
        <button class="btn btn-ghost btn-sm" :disabled="editsLoading" @click="loadEdits">刷新</button>
      </div>

      <div v-if="editsLoading" class="empty-state">加载中...</div>
      <div v-else-if="edits.length === 0" class="empty-state">暂无待审核的修改建议</div>

      <div v-else class="edit-list">
        <div v-for="e in edits" :key="e.id" class="edit-row">
          <div class="edit-row-head">
            <div class="edit-deal">
              <span class="edit-provider">{{ e.deal.provider }}</span>
              <span class="edit-deal-title">{{ e.deal.title }}</span>
              <span v-if="e.deal.status !== 'approved'" class="badge" :class="statusBadgeClass(e.deal.status)">
                {{ STATUS_LABELS[e.deal.status] || e.deal.status }}
              </span>
            </div>
            <span class="edit-time">{{ formatTime(e.created_at) }}</span>
          </div>

          <div class="edit-meta">
            <span class="edit-author"><i class="ri-user-line"></i> {{ e.proposer }}</span>
            <span v-if="e.comment" class="edit-comment">「{{ e.comment }}」</span>
          </div>

          <ul v-if="e.diff && e.diff.length" class="edit-diff">
            <li v-for="c in e.diff" :key="c.field" class="edit-diff-item">
              <span class="diff-label">{{ c.label }}</span>
              <span class="diff-from">{{ displayFieldValue(c.field, c.from) }}</span>
              <i class="ri-arrow-right-line diff-arrow"></i>
              <span class="diff-to">{{ displayFieldValue(c.field, c.to) }}</span>
            </li>
          </ul>
          <p v-else class="edit-noop">该建议与当前内容已无差异，可直接驳回。</p>

          <div class="edit-actions">
            <button
              class="btn btn-primary btn-sm"
              :disabled="editsBusy || !e.diff || !e.diff.length"
              @click="reviewEdit(e, 'approve')"
            >
              通过
            </button>
            <button class="btn btn-danger btn-sm" :disabled="editsBusy" @click="openEditReject(e)">驳回</button>
          </div>

          <div v-if="editRejectTarget?.id === e.id" class="edit-reject-box">
            <textarea
              v-model="editRejectReason"
              rows="2"
              maxlength="200"
              placeholder="说明驳回理由，便于对方改进（选填）"
            ></textarea>
            <div class="edit-reject-actions">
              <button class="btn btn-ghost btn-sm" @click="editRejectTarget = null">取消</button>
              <button class="btn btn-danger btn-sm" :disabled="editsBusy" @click="confirmEditReject">
                确认驳回
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── 已失效 Tab：被删除 / 判定失效 / 已过期（对外一律不可见，仅管理员可见） ── -->
    <div v-else-if="tab === 'invalid'" class="card">
      <div class="card-header">
        <h3>已失效通告</h3>
        <div style="display: flex; align-items: center; gap: 12px;">
          <div class="lifecycle-filter">
            <button
              v-for="opt in LIFECYCLE_FILTERS"
              :key="opt.value"
              :class="{ active: lifecycleFilter === opt.value }"
              @click="setLifecycleFilter(opt.value)"
            >
              {{ opt.label }} {{ lifecycleCount(opt.value) }}
            </button>
          </div>
          <button class="btn btn-ghost btn-sm" :disabled="invalidLoading" @click="loadInvalid">刷新</button>
        </div>
      </div>

      <p class="card-hint">
        此处条目对前台列表、详情直达链接、AI 通道与分享卡片一律不可见。
        「恢复」后按原审核状态重新上架；「彻底删除」不可恢复，仅在数据长期无人认领时使用。
      </p>

      <div v-if="invalidLoading" class="empty-state">加载中...</div>
      <div v-else-if="invalidDeals.length === 0" class="empty-state">
        {{ lifecycleFilter === 'all' ? '暂无已失效通告' : '该分类下暂无条目' }}
      </div>

      <table v-else>
        <thead>
          <tr>
            <th style="width: 150px;">服务商</th>
            <th>标题</th>
            <th style="width: 120px;">失效类型</th>
            <th style="width: 150px;">失效 / 删除时间</th>
            <th style="width: 110px;">社区反馈</th>
            <th style="width: 100px;">发布者</th>
            <th style="width: 210px;">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in invalidDeals" :key="d.id">
            <td>
              <span class="provider-name">{{ d.provider }}</span>
              <span class="badge" :class="statusBadgeClass(d.status)">{{ STATUS_LABELS[d.status] || d.status }}</span>
            </td>
            <td>
              <div class="cell-title">{{ d.title }}</div>
              <div class="cell-sub">{{ d.quota || '—' }}<template v-if="d.expires_at"> · 有效期至 {{ formatTime(d.expires_at) }}</template></div>
            </td>
            <td>
              <span class="lifecycle-tag" :class="'lc-' + d.lifecycle">{{ LIFECYCLE_LABELS[d.lifecycle] }}</span>
              <div v-if="d.invalid_reason_label" class="cell-sub">{{ d.invalid_reason_label }}</div>
            </td>
            <td>
              {{ formatTime(d.invalid_at || d.deleted_at || d.expires_at || d.updated_at) }}
              <div v-if="d.deleted_at && d.deleted_by" class="cell-sub">操作者 #{{ d.deleted_by }}</div>
            </td>
            <td>
              <div class="cell-votes">
                <span class="vote-up"><i class="ri-thumb-up-line"></i>{{ d.vote_up }}</span>
                <span class="vote-down"><i class="ri-thumb-down-line"></i>{{ d.vote_down }}</span>
              </div>
              <div class="cell-sub">{{ ratingText(d) }}</div>
            </td>
            <td>
              <span v-if="d.user_id === 0" class="guest-tag">游客</span>
              {{ d.nickname || d.username || '-' }}
            </td>
            <td class="actions">
              <template v-if="d.lifecycle === 'deleted'">
                <button class="btn btn-primary btn-sm" :disabled="lifecycleBusy" @click="restoreItem(d, 'restore_delete')">恢复</button>
                <button class="btn btn-danger btn-sm" :disabled="lifecycleBusy" @click="purgeItem(d)">彻底删除</button>
              </template>
              <template v-else-if="d.lifecycle === 'invalid'">
                <button class="btn btn-primary btn-sm" :disabled="lifecycleBusy" @click="restoreItem(d, 'restore_invalid')">撤销失效</button>
                <button class="btn btn-ghost btn-sm" :disabled="lifecycleBusy" @click="restoreItem(d, 'set_permanent')">设为永久</button>
                <button class="btn btn-ghost btn-sm" @click="openEdit(d)">编辑</button>
              </template>
              <template v-else>
                <button class="btn btn-primary btn-sm" :disabled="lifecycleBusy" @click="restoreItem(d, 'extend')">续期 30 天</button>
                <button class="btn btn-ghost btn-sm" :disabled="lifecycleBusy" @click="restoreItem(d, 'set_permanent')">设为永久</button>
                <button class="btn btn-danger btn-sm" :disabled="lifecycleBusy" @click="markInvalid(d)">标记失效</button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>

      <div v-if="invalidTotalPages > 1" class="pagination">
        <button :disabled="invalidPage <= 1" @click="invalidPage--; loadInvalid()">上一页</button>
        <span>第 {{ invalidPage }} / {{ invalidTotalPages }} 页（共 {{ invalidTotal }} 条）</span>
        <button :disabled="invalidPage >= invalidTotalPages" @click="invalidPage++; loadInvalid()">下一页</button>
      </div>
    </div>

    <!-- ── 通告队列（默认 Tab） ── -->
    <div v-else-if="tab === 'deals'" class="card">
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
            <th style="width: 130px;">核验</th>
            <th style="width: 110px;">社区反馈</th>
            <th style="width: 100px;">发布者</th>
            <th style="width: 120px;">提交时间</th>
            <th style="width: 300px;">操作</th>
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
              <span v-if="d.category && d.category !== 'token'" class="badge" style="margin-left: 4px; font-size: 11px;">{{ categoryLabel(d.category) }}</span>
              <div class="cell-sub">{{ regionLabel(d.region) }} · {{ sourceLabel(d.source_tag) }}</div>
            </td>
            <td>
              <div class="cell-quota">{{ d.quota || '-' }}</div>
              <div v-if="d.expires_at" class="cell-sub" :class="{ 'is-warn': d.is_expired }">
                {{ d.is_expired ? '已过期' : expiryText(d.expires_at) }}
              </div>
            </td>
            <td>
              <div class="cell-sub" :class="{ 'is-warn': isStaleVerify(d) }">{{ verifyText(d) }}</div>
              <div v-if="d.verify_note" class="cell-sub" :title="d.verify_note">{{ d.verify_note }}</div>
            </td>
            <td>
              <div class="cell-votes">
                <span class="vote-up"><i class="ri-thumb-up-line"></i>{{ d.vote_up }}</span>
                <span class="vote-down"><i class="ri-thumb-down-line"></i>{{ d.vote_down }}</span>
              </div>
              <div class="cell-sub">{{ ratingText(d) }}</div>
            </td>
            <td>
              <span v-if="d.user_id === 0" class="guest-tag" title="游客发布（无需登录），同样经管理员审核">游客</span>
              {{ d.nickname || d.username || '-' }}
            </td>
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
                <button class="btn btn-ghost btn-sm" title="记录一次人工核验" @click="openVerify(d)">核验</button>
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

    <!-- 人工核验弹窗 -->
    <Teleport to="body">
      <div v-if="verifyTarget" class="modal-overlay active" @click.self="verifyTarget = null">
        <div class="modal">
          <div class="modal-header">
            <h3>人工核验</h3>
            <button class="modal-close" @click="verifyTarget = null">&times;</button>
          </div>
          <div class="modal-body">
            <p class="hint">
              「{{ verifyTarget.provider }} · {{ verifyTarget.title }}」<br>
              核验 = 站点确认「此刻仍可用」，只更新时间轴，不会推送订阅者；
              判定失效才会让订阅者收到「下架」。<br>
              只想留一条观察记录、不代表已核实可用 → 用「仅备注」。
            </p>
            <div class="fg">
              <label>核验备注（可选）</label>
              <textarea
                v-model="verifyNote"
                rows="3"
                maxlength="200"
                placeholder="如：注册实测通过，额度到账 / 领取页 502"
              ></textarea>
              <small>{{ verifyNote.length }} / 200</small>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" @click="verifyTarget = null">取消</button>
            <button class="btn btn-primary" :disabled="submitting" @click="confirmVerify('alive')">
              {{ submitting ? '提交中...' : '核验可用' }}
            </button>
            <button class="btn btn-ghost" :disabled="submitting" @click="confirmVerify('note')">仅备注</button>
            <button class="btn btn-danger" :disabled="submitting" @click="confirmVerify('dead')">判定失效</button>
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
/** 待核验筛选：只影响「已通过」队列，与 status 正交 */
const verifyFilter = ref<'all' | 'stale'>('all')
const verifyTarget = ref<any>(null)
const verifyNote = ref('')
const deals = ref<any[]>([])
const counts = reactive({
  pending: 0, approved: 0, rejected: 0, all: 0,
  // 已失效三维（互斥）+ 合计，见 admin/token-deals/index.get.ts
  expired: 0, invalid: 0, deleted: 0, invalid_total: 0,
  // 待核验：在架且超过阈值没人工核验（阈值由 deal_verify_stale_days 控制，默认 30 天）
  stale: 0,
})
const loading = ref(false)
const submitting = ref(false)
const page = ref(1)
const pageSize = 20
const total = ref(0)
const searchQuery = ref('')

// ── 修改建议 Tab ──
const tab = ref<'deals' | 'edits' | 'invalid'>('deals')
const edits = ref<any[]>([])
const editTotal = ref(0)
const editsLoading = ref(false)
const editsBusy = ref(false)
const editRejectTarget = ref<any>(null)
const editRejectReason = ref('')

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)))
const pageList = computed(() => {
  const out: number[] = []
  for (let i = Math.max(1, page.value - 2); i <= Math.min(totalPages.value, page.value + 2); i++) out.push(i)
  return out
})

const tabTitle = computed(() => verifyFilter.value === 'stale' ? '待核验通告（默认 30 天未核验）' : ({
  pending: '待审核通告',
  approved: '已通过通告',
  rejected: '已驳回通告',
  all: '全部通告',
}[status.value]))

const emptyText = computed(() => verifyFilter.value === 'stale' ? '全部通告都核验过了，很干净' : ({
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
    if (verifyFilter.value !== 'all') params.append('verify', verifyFilter.value)

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
  tab.value = 'deals'
  status.value = next
  verifyFilter.value = 'all'
  page.value = 1
  loadDeals()
}

/** 待核验 tab：只看在架（已通过）且超过阈值没核验的通告 */
function switchVerifyStale() {
  tab.value = 'deals'
  status.value = 'approved'
  verifyFilter.value = 'stale'
  page.value = 1
  loadDeals()
}

/** 距上次人工核验的天数；-1 = 从未核验 */
function verifyDays(d: any): number {
  const at = Number(d?.verified_at || 0)
  if (!at) return -1
  return Math.max(0, Math.floor((Date.now() - at) / 86400000))
}
function verifyText(d: any): string {
  const days = verifyDays(d)
  if (days < 0) return '从未核验'
  if (days <= 0) return '今日已核验'
  return `${days} 天前核验`
}
/**
 * 是否待复核：直接吃服务端按 `deal_verify_stale_days` 判定的 `verify_stale`，
 * 前端不再自己算阈值（否则改了配置就有两套口径）。
 */
function isStaleVerify(d: any): boolean {
  if (typeof d?.verify_stale === 'boolean') return d.verify_stale
  const days = verifyDays(d)
  return days < 0 || days > 30
}

function openVerify(d: any) {
  verifyTarget.value = d
  verifyNote.value = ''
}

async function confirmVerify(action: 'alive' | 'dead' | 'note') {
  if (!verifyTarget.value) return
  submitting.value = true
  try {
    const r = await $fetch<any>(`/api/admin/token-deals/${verifyTarget.value.id}/verify`, {
      ...getAuthOpts(),
      method: 'POST',
      body: { action, note: verifyNote.value },
    })
    showMessage(r?.message || '已记录核验', 'success')
    verifyTarget.value = null
    await loadDeals()
  } catch (e: any) {
    showMessage('核验失败：' + (e?.data?.error || e?.message || '未知错误'), 'error')
  } finally {
    submitting.value = false
  }
}

function switchTab(next: 'deals' | 'edits' | 'invalid') {
  tab.value = next
  // 「待核验」只是审核队列的子视图，切到别的面板必须清掉，避免残留隐式筛选
  if (next !== 'deals') verifyFilter.value = 'all'
  if (next === 'edits') loadEdits()
  else if (next === 'invalid') loadInvalid()
  else loadDeals()
}

// ── 已失效面板（被删除 / 判定失效 / 已过期）────────────────
type LifecycleFilter = 'all' | 'expired' | 'invalid' | 'deleted'

const LIFECYCLE_FILTERS: { value: LifecycleFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'expired', label: '已过期' },
  { value: 'invalid', label: '判定失效' },
  { value: 'deleted', label: '已删除' },
]
const LIFECYCLE_LABELS: Record<string, string> = {
  expired: '已过期',
  invalid: '判定失效',
  deleted: '已删除',
  live: '正常',
}

const invalidDeals = ref<any[]>([])
const invalidLoading = ref(false)
const invalidPage = ref(1)
const invalidTotal = ref(0)
const lifecycleFilter = ref<LifecycleFilter>('all')
const lifecycleBusy = ref(false)
const invalidPageSize = 20

const invalidTotalPages = computed(() => Math.max(1, Math.ceil(invalidTotal.value / invalidPageSize)))

function lifecycleCount(v: LifecycleFilter): number {
  if (v === 'all') return counts.invalid_total
  if (v === 'expired') return counts.expired
  if (v === 'invalid') return counts.invalid
  return counts.deleted
}

function setLifecycleFilter(v: LifecycleFilter) {
  lifecycleFilter.value = v
  invalidPage.value = 1
  loadInvalid()
}

async function loadInvalid() {
  invalidLoading.value = true
  try {
    const params = new URLSearchParams({
      view: 'invalid',
      lifecycle: lifecycleFilter.value,
      page: String(invalidPage.value),
      limit: String(invalidPageSize),
    })
    if (searchQuery.value) params.append('search', searchQuery.value)

    const r = await $fetch<any>(`/api/admin/token-deals?${params}`, getAuthOpts())
    invalidDeals.value = r.deals || []
    invalidTotal.value = r.pagination?.total || 0
    if (r.counts) Object.assign(counts, r.counts)
  } catch (e: any) {
    showMessage('加载已失效通告失败：' + (e?.data?.error || e?.message || '未知错误'), 'error')
    invalidDeals.value = []
    invalidTotal.value = 0
  } finally {
    invalidLoading.value = false
  }
}

/** 恢复 / 续期 / 改永久 / 撤销失效 —— 统一走 restore 端点 */
async function restoreItem(d: any, action: 'restore_delete' | 'restore_invalid' | 'extend' | 'set_permanent') {
  if (!import.meta.client || lifecycleBusy.value) return
  if (action === 'extend') {
    const ok = confirm(`将「${d.title}」的有效期延长 30 天，并重新对外展示？`)
    if (!ok) return
  }
  lifecycleBusy.value = true
  try {
    const body: any = { action }
    if (action === 'extend') body.expires_at = Date.now() + 30 * 24 * 60 * 60 * 1000
    const r = await $fetch<any>(`/api/admin/token-deals/${d.id}/restore`, {
      method: 'POST',
      body,
      ...getAuthOpts(),
    })
    showMessage((r?.changes || []).join('；') || '已处理')
    await loadInvalid()
  } catch (e: any) {
    showMessage('操作失败：' + (e?.data?.error || e?.message || '未知错误'), 'error')
  } finally {
    lifecycleBusy.value = false
  }
}

/** 手动标记失效（下架但保留数据，可撤销） */
async function markInvalid(d: any) {
  if (!import.meta.client || lifecycleBusy.value) return
  if (!confirm(`将「${d.title}」标记为失效并从公开列表下架？（可撤销，不会删除数据）`)) return
  lifecycleBusy.value = true
  try {
    const r = await $fetch<any>(`/api/admin/token-deals/${d.id}/restore`, {
      method: 'POST',
      body: { action: 'mark_invalid', reason: 'manual' },
      ...getAuthOpts(),
    })
    showMessage((r?.changes || []).join('；') || '已标记失效')
    await loadInvalid()
  } catch (e: any) {
    showMessage('操作失败：' + (e?.data?.error || e?.message || '未知错误'), 'error')
  } finally {
    lifecycleBusy.value = false
  }
}

/** 彻底删除（物理）—— 二次确认，文案强调不可恢复 */
async function purgeItem(d: any) {
  if (!import.meta.client || lifecycleBusy.value) return
  const typed = prompt(
    `彻底删除不可恢复，将连同投票 / 评测 / 修改建议一并清除。\n确认请回复「${d.provider}」（服务商名）：`,
  )
  if (typed !== d.provider) {
    if (typed !== null) showMessage('服务商名不匹配，已取消', 'error')
    return
  }
  lifecycleBusy.value = true
  try {
    await $fetch(`/api/admin/token-deals/${d.id}/purge`, {
      method: 'DELETE',
      body: { confirm: true },
      ...getAuthOpts(),
    })
    showMessage('已彻底删除')
    await loadInvalid()
  } catch (e: any) {
    showMessage('操作失败：' + (e?.data?.error || e?.message || '未知错误'), 'error')
  } finally {
    lifecycleBusy.value = false
  }
}

// ── 修改建议 ──────────────────────────────────────────────
/** 管理员视角：列出全部用户的待审修改建议 */
async function loadEdits() {
  editsLoading.value = true
  try {
    const r = await $fetch<any>('/api/token-deal-edits?limit=100', getAuthOpts())
    edits.value = r.edits || []
    editTotal.value = r.total || 0
  } catch (e: any) {
    showMessage('加载修改建议失败：' + (e?.data?.error || e?.message || '未知错误'), 'error')
    edits.value = []
    editTotal.value = 0
  } finally {
    editsLoading.value = false
  }
}

/** 待审建议数量 —— 用于 Tab 角标（进页面时静默拉一次） */
async function loadEditCount() {
  try {
    const r = await $fetch<any>('/api/token-deal-edits?limit=1', getAuthOpts())
    editTotal.value = r.total || 0
  } catch {
    editTotal.value = 0
  }
}

function displayFieldValue(field: string, value: any): string {
  if (value === null || value === undefined || value === '') return '（空）'
  if (field === 'models') return Array.isArray(value) && value.length ? value.join('、') : '（空）'
  if (field === 'region') return REGION_LABELS[value] || String(value)
  if (field === 'source_tag') return SOURCE_LABELS[value] || String(value)
  if (field === 'expires_at') {
    const ts = Number(value)
    if (!Number.isFinite(ts)) return String(value)
    return new Date(ts).toLocaleDateString('zh-CN')
  }
  return String(value)
}

function openEditReject(target: any) {
  editRejectTarget.value = target
  editRejectReason.value = ''
}

async function reviewEdit(target: any, action: 'approve' | 'reject', reason = '') {
  if (editsBusy.value) return
  editsBusy.value = true
  try {
    const res = await $fetch<any>(`/api/token-deal-edits/${target.id}/review`, {
      method: 'POST',
      body: { action, reason },
      ...getAuthOpts(),
    })
    showMessage(res?.message || (action === 'approve' ? '已通过并写入通告' : '已驳回'))
    edits.value = edits.value.filter((e: any) => e.id !== target.id)
    editTotal.value = Math.max(0, editTotal.value - 1)
    // 通告内容可能已变，回到列表 Tab 时数据要刷新
    loadDeals()
  } catch (e: any) {
    showMessage('操作失败：' + (e?.data?.error || e?.message || '未知错误'), 'error')
  } finally {
    editsBusy.value = false
  }
}

async function confirmEditReject() {
  if (!editRejectTarget.value) return
  const target = editRejectTarget.value
  const reason = editRejectReason.value.trim()
  editRejectTarget.value = null
  editRejectReason.value = ''
  await reviewEdit(target, 'reject', reason)
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

function categoryLabel(cat?: string) {
  if (cat === 'cloud') return '云服务器'
  if (cat === 'client') return '客户端额度'
  return 'API 额度'
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
  if (tab.value === 'invalid') loadInvalid()
  else loadDeals()
}

async function removeDeal(d: any) {
  if (!import.meta.client) return
  if (!confirm(`确定删除通告「${d.provider} · ${d.title}」？\n删除后前台立即不可见，投票与评测会保留，可在「已失效」Tab 恢复。`)) return
  try {
    await $fetch(`/api/token-deals/${d.id}`, { method: 'DELETE', ...getAuthOpts() })
    showMessage('已删除（可在「已失效」Tab 恢复）')
    if (tab.value === 'invalid') await loadInvalid()
    else await loadDeals()
  } catch (e: any) {
    showMessage('删除失败：' + (e?.data?.error || e?.message || '未知错误'), 'error')
  }
}

onMounted(() => {
  loadDeals()
  loadEditCount()
})

onBeforeUnmount(() => {
  if (messageTimer) clearTimeout(messageTimer)
  if (searchTimer) clearTimeout(searchTimer)
})
</script>

<style scoped>
/* ── 已失效面板 ───────────────────────────────────── */
.lifecycle-filter {
  display: inline-flex;
  gap: 4px;
  padding: 3px;
  border-radius: 8px;
  background: var(--bg-hover);
}
.lifecycle-filter button {
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.lifecycle-filter button:hover {
  color: var(--text-primary);
}
.lifecycle-filter button.active {
  background: var(--bg-card);
  color: var(--text-primary);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}
.lifecycle-tag {
  display: inline-block;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 18px;
  font-weight: 500;
}
.lifecycle-tag.lc-expired {
  background: rgba(245, 158, 11, 0.14);
  color: #b45309;
}
.lifecycle-tag.lc-invalid {
  background: rgba(239, 68, 68, 0.14);
  color: #b91c1c;
}
.lifecycle-tag.lc-deleted {
  background: var(--bg-hover);
  color: var(--text-secondary);
}
.card-hint {
  margin: 0 0 12px;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--bg-hover);
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.6;
}

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
/* 游客发布标识（user_id=0 的通告） */
.guest-tag {
  display: inline-block;
  margin-right: 5px;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.5;
  vertical-align: 1px;
  color: var(--text-secondary);
  background: var(--surface-sunken);
  border: 0.5px solid var(--border);
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
  font-size: 12px;
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
  font-size: 12px;
  color: var(--text-tertiary);
}
.cell-sub.is-warn { color: var(--warning); }
.cell-quota {
  font-size: 13px;
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
  font-size: 13px;
}
.vote-up { color: var(--success); }
.vote-down { color: var(--danger); }

.quality-tag {
  display: inline-block;
  padding: 1px 7px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
}
.quality-tag.q-top,
.quality-tag.q-high { background: var(--primary-light); color: var(--primary); }
.quality-tag.q-mid { background: var(--surface-sunken); color: var(--text-secondary); }
.quality-tag.q-low,
.quality-tag.q-bottom { background: color-mix(in srgb, var(--warning) 12%, transparent); color: var(--warning); }

/* ── 修改建议 Tab ── */
.edit-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
}
.edit-row {
  padding: 12px 14px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface-sunken);
}
.edit-row-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 6px;
}
.edit-deal {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
  min-width: 0;
}
.edit-provider {
  font-size: 12px;
  font-weight: 600;
  color: var(--primary);
}
.edit-deal-title {
  font-size: 13px;
  color: var(--text-primary);
  word-break: break-all;
}
.edit-time {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--text-tertiary);
}
.edit-meta {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}
.edit-author {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text-secondary);
}
.edit-author i { color: var(--primary); font-size: 12px; }
.edit-comment {
  font-size: 12px;
  color: var(--text-tertiary);
  word-break: break-all;
}
.edit-diff {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.edit-diff-item {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 5px;
  font-size: 12px;
  line-height: 1.5;
}
.diff-label { flex-shrink: 0; min-width: 62px; color: var(--text-tertiary); }
.diff-from { color: var(--text-tertiary); text-decoration: line-through; word-break: break-all; }
.diff-arrow { color: var(--text-tertiary); font-size: 13px; flex-shrink: 0; }
.diff-to { color: var(--text-primary); font-weight: 500; word-break: break-all; }
.edit-noop {
  margin: 0;
  font-size: 12px;
  color: var(--text-tertiary);
  font-style: italic;
}
.edit-actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}
.edit-reject-box {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--border);
}
.edit-reject-box textarea {
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
  transition: border-color 120ms cubic-bezier(0.22, 1, 0.36, 1);
}
.edit-reject-box textarea:focus { border-color: var(--border-focus); }
.edit-reject-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}

/* ── 游客评测 Tab ── */
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
  vertical-align: middle;
}
.guest-avatar.has-img { background: transparent; }
.guest-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
.guest-rating {
  display: inline-flex;
  gap: 1px;
  font-size: 11px;
  color: var(--warning);
  vertical-align: middle;
}
.guest-content {
  margin: 8px 0 0;
  padding: 10px 12px;
  border-radius: 6px;
  background: var(--surface-sunken);
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-secondary);
  white-space: pre-wrap;
}
</style>
