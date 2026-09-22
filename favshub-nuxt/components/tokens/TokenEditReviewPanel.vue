<template>
  <Teleport to="body">
    <div class="tde-backdrop" @click.self="close">
      <div class="tde-modal" role="dialog" aria-modal="true" aria-label="待我审核的修改建议">
        <header class="tde-head">
          <div class="tde-head-copy">
            <h2 class="tde-title">
              <i class="ri-inbox-unarchive-line"></i>
              待我审核
              <span v-if="edits.length" class="tre-count">{{ edits.length }}</span>
            </h2>
            <p class="tde-sub">{{ scopeHint }}</p>
          </div>
          <button type="button" class="tde-close" title="关闭" @click="close">
            <i class="ri-close-line"></i>
          </button>
        </header>

        <div class="tde-body">
          <div v-if="loading" class="tre-state">
            <i class="ri-loader-4-line spin"></i>
            <p>加载中...</p>
          </div>

          <div v-else-if="loadError" class="tre-state">
            <i class="ri-error-warning-line"></i>
            <p>{{ loadError }}</p>
            <button type="button" class="tde-btn ghost" @click="load">重试</button>
          </div>

          <div v-else-if="edits.length === 0" class="tre-state">
            <i class="ri-inbox-line"></i>
            <p>暂无待审核的修改建议</p>
            <span>别人对你发布的通告提交修改后，会出现在这里</span>
          </div>

          <ul v-else class="tre-list">
            <li v-for="e in edits" :key="e.id" class="tre-item">
              <div class="tre-item-head">
                <div class="tre-deal">
                  <span class="tre-provider">{{ e.deal.provider }}</span>
                  <a
                    :href="`/tokens?deal=${e.deal_id}`"
                    class="tre-title"
                    title="查看通告详情"
                    @click.prevent="openDeal(e.deal_id)"
                  >{{ e.deal.title }}</a>
                </div>
                <span class="tre-time">{{ formatTime(e.created_at) }}</span>
              </div>

              <div class="tre-meta">
                <span class="tre-author"><i class="ri-user-line"></i> {{ e.proposer }}</span>
                <span v-if="e.comment" class="tre-comment">「{{ e.comment }}」</span>
              </div>

              <p v-if="e.is_noop" class="tre-noop">该建议与当前内容已无差异，可直接驳回。</p>
              <ul v-else class="tre-diff">
                <li v-for="c in e.diff" :key="c.field" class="tre-diff-item">
                  <span class="diff-label">{{ c.label }}</span>
                  <span class="diff-from">{{ displayFieldValue(c.field, c.from) }}</span>
                  <i class="ri-arrow-right-line diff-arrow"></i>
                  <span class="diff-to">{{ displayFieldValue(c.field, c.to) }}</span>
                </li>
              </ul>

              <div class="tre-actions">
                <button
                  type="button"
                  class="tde-btn primary"
                  :disabled="busy || e.is_noop"
                  @click="review(e, 'approve')"
                >
                  <i class="ri-check-line"></i> 通过
                </button>
                <button
                  type="button"
                  class="tde-btn danger"
                  :disabled="busy"
                  @click="openReject(e)"
                >
                  <i class="ri-close-line"></i> 驳回
                </button>
              </div>

              <!-- 行内驳回理由 -->
              <div v-if="rejectTarget?.id === e.id" class="tre-reject">
                <textarea
                  v-model="rejectReason"
                  rows="2"
                  maxlength="200"
                  placeholder="说明驳回理由，便于对方改进（选填）"
                ></textarea>
                <div class="tre-reject-actions">
                  <button type="button" class="tde-btn ghost" @click="rejectTarget = null">取消</button>
                  <button type="button" class="tde-btn danger" :disabled="busy" @click="confirmReject">
                    确认驳回
                  </button>
                </div>
              </div>
            </li>
          </ul>
        </div>

        <footer class="tde-foot">
          <span v-if="!loading && edits.length" class="tre-foot-hint">
            通过后修改会立即写入通告
          </span>
          <span v-else class="tre-foot-hint"></span>
          <button type="button" class="tde-btn ghost" @click="close">关闭</button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
/**
 * 待我审核的修改建议面板。
 *
 * 管理员 → 全部用户的待审建议；普通用户 → 自己发布的通告上、他人提交的待审建议。
 * 通过 = 把建议内容写入通告；驳回 = 标记为已驳回（可附理由）。
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'

interface IFieldDiff {
  field: string
  label: string
  from: any
  to: any
}

interface IReviewableEdit {
  id: string
  deal_id: string
  proposer: string
  comment: string
  created_at: number
  diff: IFieldDiff[]
  is_noop?: boolean
  deal: { id: string; provider: string; title: string; status: string }
}

const props = defineProps<{ open?: boolean }>()
const emit = defineEmits<{
  close: []
  /** 审核完成后通知父级刷新计数 */
  reviewed: []
  /** 请求打开某条通告的详情 */
  openDeal: [dealId: string]
}>()

const authStore = useAuthStore()

const edits = ref<IReviewableEdit[]>([])
const loading = ref(true)
const loadError = ref('')
const busy = ref(false)
const rejectTarget = ref<IReviewableEdit | null>(null)
const rejectReason = ref('')

const REGION_LABELS: Record<string, string> = { cn: '国内直连', global: '海外（需代理）' }
const SOURCE_LABELS: Record<string, string> = {
  official: '官方直营',
  relay: '中转站',
  community: '社区转发',
}

const scopeHint = computed(() => (authStore.isAdmin
  ? '你是管理员，这里汇总全部用户提交的待审修改建议。'
  : '这里汇总他人对你发布的通告提交、等待你审核的修改建议。'))

function formatTime(ts: number) {
  if (!ts) return ''
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const res = await $fetch<{ edits: IReviewableEdit[]; total: number; scope: string }>(
      '/api/token-deal-edits',
      { credentials: 'include' },
    )
    // 聚合列表不带 is_noop（diff 为空即视为无差异）
    edits.value = (res.edits || []).map(e => ({ ...e, is_noop: !e.diff || e.diff.length === 0 }))
  } catch (err: any) {
    loadError.value = err?.data?.error || '加载失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

function close() {
  emit('close')
}

function openDeal(dealId: string) {
  emit('openDeal', dealId)
}

function openReject(target: IReviewableEdit) {
  rejectTarget.value = target
  rejectReason.value = ''
}

async function review(target: IReviewableEdit, action: 'approve' | 'reject', reason = '') {
  if (busy.value) return
  busy.value = true
  try {
    await $fetch(`/api/token-deal-edits/${target.id}/review`, {
      method: 'POST',
      body: { action, reason },
      credentials: 'include',
    })
    // 本地移除已处理项，避免整表重载
    edits.value = edits.value.filter(e => e.id !== target.id)
    emit('reviewed')
  } catch (err: any) {
    loadError.value = err?.data?.error || '操作失败'
  } finally {
    busy.value = false
  }
}

async function confirmReject() {
  if (!rejectTarget.value) return
  const target = rejectTarget.value
  const reason = rejectReason.value.trim()
  rejectTarget.value = null
  rejectReason.value = ''
  await review(target, 'reject', reason)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}

let prevOverflow = ''

onMounted(() => {
  prevOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  document.addEventListener('keydown', onKeydown)
  load()
})

onUnmounted(() => {
  document.body.style.overflow = prevOverflow
  document.removeEventListener('keydown', onKeydown)
})
</script>

<style scoped>
/* 复用 TokenDealEditor 的弹窗骨架样式名，保持三弹窗视觉一致 */
.tde-backdrop {
  position: fixed;
  inset: 0;
  /* 高于移动端底部导航（9998）与详情弹窗（10050），低于编辑弹窗（10060） */
  z-index: 10055;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--overlay);
  backdrop-filter: var(--backdrop-blur);
  animation: tre-fade 0.18s ease-out;
}
@keyframes tre-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
.tde-modal {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 680px;
  max-height: 88vh;
  background: var(--surface-raised);
  border: 0.5px solid var(--border);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-xl);
  overflow: hidden;
  animation: tre-rise 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes tre-rise {
  from { opacity: 0; transform: translateY(12px) scale(0.99); }
  to { opacity: 1; transform: none; }
}

.tde-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px;
  border-bottom: 0.5px solid var(--divider);
}
.tde-title {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}
.tde-title i { font-size: 17px; color: var(--primary); }
.tre-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 6px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-inverse);
  background: var(--danger);
}
.tde-sub {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--text-tertiary);
}
.tde-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  border: none;
  border-radius: 8px;
  background: none;
  color: var(--text-tertiary);
  font-size: 17px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.tde-close:hover { background: var(--surface-hover); color: var(--text-primary); }

.tde-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 18px;
}

.tre-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 32px 0;
  color: var(--text-tertiary);
  text-align: center;
}
.tre-state i { font-size: 26px; }
.tre-state p { margin: 0; font-size: 13px; color: var(--text-secondary); }
.tre-state span { font-size: 12px; }
.spin { animation: tre-spin 1s linear infinite; }
@keyframes tre-spin { to { transform: rotate(360deg); } }

.tre-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.tre-item {
  padding: 12px 14px;
  border: 0.5px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
}
.tre-item-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 6px;
}
.tre-deal {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.tre-provider {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--primary);
  letter-spacing: 0.01em;
}
.tre-title {
  font-size: 13.5px;
  font-weight: 500;
  color: var(--text-primary);
  text-decoration: none;
  word-break: break-all;
}
.tre-title:hover { color: var(--primary); text-decoration: underline; }
.tre-time { flex-shrink: 0; font-size: 11.5px; color: var(--text-tertiary); }

.tre-meta {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}
.tre-author {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text-secondary);
}
.tre-author i { color: var(--primary); font-size: 12px; }
.tre-comment {
  font-size: 12px;
  color: var(--text-tertiary);
  line-height: 1.5;
  word-break: break-all;
}

.tre-diff {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.tre-diff-item {
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
.tre-noop {
  margin: 0;
  font-size: 12px;
  color: var(--text-tertiary);
  font-style: italic;
}

.tre-actions { display: flex; gap: 8px; margin-top: 10px; }

.tre-reject {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 0.5px dashed var(--border);
}
.tre-reject textarea {
  width: 100%;
  padding: 8px 11px;
  font-size: 12.5px;
  font-family: inherit;
  line-height: 1.5;
  color: var(--text-primary);
  background: var(--surface-raised);
  border: 0.5px solid var(--border);
  border-radius: var(--radius-md);
  outline: none;
  resize: vertical;
}
.tre-reject textarea:focus { border-color: var(--border-focus); }
.tre-reject textarea::placeholder { color: var(--text-tertiary); }
.tre-reject-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }

.tde-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 18px;
  border-top: 0.5px solid var(--divider);
  background: var(--surface-raised);
}
.tre-foot-hint { font-size: 11.5px; color: var(--text-tertiary); }

.tde-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 7px 16px;
  border-radius: var(--radius-md);
  border: 0.5px solid var(--border);
  background: var(--surface-raised);
  color: var(--text-secondary);
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.tde-btn:hover:not(:disabled) { background: var(--surface-hover); color: var(--text-primary); }
.tde-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.tde-btn.primary {
  background: var(--primary);
  border-color: var(--primary);
  color: var(--text-inverse);
}
.tde-btn.primary:hover:not(:disabled) { background: var(--primary-hover); border-color: var(--primary-hover); }
.tde-btn.danger { color: var(--danger); border-color: rgba(239, 68, 68, 0.3); }
.tde-btn.danger:hover:not(:disabled) { background: rgba(239, 68, 68, 0.08); color: var(--danger); }

@media (max-width: 640px) {
  .tde-backdrop { padding: 0; align-items: flex-end; }
  .tde-modal {
    max-width: none;
    max-height: 92vh;
    border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  }
  .tde-foot { padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px)); }
}
</style>
