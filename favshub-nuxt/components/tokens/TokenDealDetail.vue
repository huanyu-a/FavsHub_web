<template>
  <Teleport to="body">
    <div class="tdd-backdrop" @click.self="onBackdrop">
      <div class="tdd-modal" role="dialog" aria-modal="true" :aria-label="deal?.title || '通告详情'">
        <!-- 头部 -->
        <header class="tdd-head">
          <div class="tdd-head-main">
            <img
              v-if="icon && !iconFailed"
              :src="icon"
              class="tdd-icon"
              alt=""
              @error="iconFailed = true"
            >
            <span v-else class="tdd-icon tdd-icon-fallback">{{ initial }}</span>
            <div class="tdd-head-copy">
              <h2 class="tdd-provider">
                {{ deal?.provider || '加载中' }}
                <i v-if="deal?.pinned" class="ri-pushpin-2-fill tdd-pin" title="已置顶"></i>
              </h2>
              <p class="tdd-meta">
                <span>{{ regionLabel }}</span>
                <span class="tdd-dot">·</span>
                <span>{{ sourceLabel }}</span>
                <span class="tdd-dot">·</span>
                <span :class="{ 'is-warn': deal?.is_expired }">{{ expiryText }}</span>
              </p>
            </div>
          </div>
          <div class="tdd-head-side">
            <span v-if="deal" class="tdd-quality" :class="qualityClass">{{ deal.quality }}</span>
            <button type="button" class="tdd-close" title="关闭" @click="close">
              <i class="ri-close-line"></i>
            </button>
          </div>
        </header>

        <!-- 加载 / 错误 -->
        <div v-if="loading" class="tdd-state">
          <i class="ri-loader-4-line spin"></i>
          <p>加载中...</p>
        </div>
        <div v-else-if="loadError" class="tdd-state">
          <i class="ri-error-warning-line"></i>
          <p>{{ loadError }}</p>
          <button type="button" class="tdd-btn ghost" @click="loadDeal">重试</button>
        </div>

        <div v-else-if="deal" class="tdd-body">
          <!-- 审核状态提示 -->
          <div v-if="deal.status !== 'approved'" class="tdd-status" :class="`is-${deal.status}`">
            <i :class="deal.status === 'pending' ? 'ri-time-line' : 'ri-close-circle-line'"></i>
            <div>
              <strong>{{ deal.status === 'pending' ? '待审核' : '未通过审核' }}</strong>
              <p v-if="deal.status === 'pending'">该通告仅你与管理员可见，通过审核后将公开展示。</p>
              <p v-else>{{ deal.reject_reason || '未提供驳回原因' }}</p>
            </div>
          </div>

          <h3 class="tdd-title">{{ deal.title }}</h3>

          <!-- 关键信息 -->
          <div class="tdd-facts">
            <div class="tdd-fact">
              <span class="fact-label">免费额度</span>
              <span class="fact-value">{{ deal.quota || '未说明' }}</span>
            </div>
            <div class="tdd-fact">
              <span class="fact-label">有效期</span>
              <span class="fact-value">{{ expiryText }}</span>
            </div>
            <div class="tdd-fact">
              <span class="fact-label">发布者</span>
              <span class="fact-value">{{ deal.nickname || deal.username || '匿名' }}</span>
            </div>
          </div>

          <!-- 接入信息 -->
          <section class="tdd-section">
            <h4 class="section-title"><i class="ri-link"></i> 接入信息</h4>
            <div class="tdd-row">
              <span class="row-label">领取地址</span>
              <a :href="deal.url" target="_blank" rel="noopener noreferrer" class="row-link">{{ deal.url }}</a>
            </div>
            <div v-if="deal.call_url" class="tdd-row">
              <span class="row-label">API 地址</span>
              <code class="row-code">{{ deal.call_url }}</code>
              <button type="button" class="tdd-btn tiny" @click="copy(deal.call_url)">复制</button>
            </div>
          </section>

          <!-- 支持模型 -->
          <section v-if="deal.models && deal.models.length" class="tdd-section">
            <h4 class="section-title"><i class="ri-cpu-line"></i> 支持模型</h4>
            <div class="tdd-models">
              <span v-for="m in deal.models" :key="m" class="model-chip">{{ m }}</span>
            </div>
          </section>

          <!-- 备注 -->
          <section v-if="deal.note" class="tdd-section">
            <h4 class="section-title"><i class="ri-sticky-note-line"></i> 备注</h4>
            <p class="tdd-note">{{ deal.note }}</p>
          </section>

          <!-- 社区健康度 -->
          <section class="tdd-section">
            <h4 class="section-title"><i class="ri-pulse-line"></i> 社区健康度</h4>
            <div class="tdd-health">
              <button
                type="button"
                class="vote-btn is-up"
                :class="{ active: myVote === 'up' }"
                :disabled="voting"
                @click="vote('up')"
              >
                <i class="ri-thumb-up-line"></i>
                <span class="vote-label">还能用</span>
                <span class="vote-count">{{ deal.vote_up }}</span>
              </button>
              <button
                type="button"
                class="vote-btn is-down"
                :class="{ active: myVote === 'down' }"
                :disabled="voting"
                @click="vote('down')"
              >
                <i class="ri-thumb-down-line"></i>
                <span class="vote-label">已失效</span>
                <span class="vote-count">{{ deal.vote_down }}</span>
              </button>
              <div class="health-rating">
                <div class="rating-score">
                  <span class="score-num">{{ average ?? '—' }}</span>
                  <span class="score-max">/ 5</span>
                </div>
                <div class="rating-stars">
                  <i
                    v-for="n in 5"
                    :key="n"
                    :class="n <= Math.round(average || 0) ? 'ri-star-fill' : 'ri-star-line'"
                  ></i>
                </div>
                <span class="rating-count">{{ deal.rating_count }} 人评测</span>
              </div>
            </div>
            <div v-if="deal.rating_count > 0" class="tdd-distribution">
              <div v-for="n in [5, 4, 3, 2, 1]" :key="n" class="dist-row">
                <span class="dist-label">{{ n }} 星</span>
                <span class="dist-bar"><span class="dist-fill" :style="{ width: distPercent(n) }"></span></span>
                <span class="dist-count">{{ distribution[n] || 0 }}</span>
              </div>
            </div>
            <p v-if="!authStore.isLoggedIn" class="tdd-hint">
              登录后可投票与评测，你的反馈会实时更新这条通告的可信度。
            </p>
          </section>

          <!-- 我的评测 -->
          <section v-if="authStore.isLoggedIn" class="tdd-section">
            <h4 class="section-title">
              <i class="ri-chat-3-line"></i> {{ myReview ? '修改我的评测' : '写下我的评测' }}
            </h4>
            <div class="review-form">
              <div class="star-input">
                <button
                  v-for="n in 5"
                  :key="n"
                  type="button"
                  class="star-btn"
                  :class="{ active: n <= formRating }"
                  :title="`${n} 星`"
                  @click="formRating = n"
                >
                  <i :class="n <= formRating ? 'ri-star-fill' : 'ri-star-line'"></i>
                </button>
                <span class="star-text">{{ ratingText }}</span>
              </div>
              <textarea
                v-model="formContent"
                class="review-input"
                rows="3"
                :maxlength="1000"
                placeholder="说说实际体验：延迟、稳定性、额度是否到账、有没有隐藏门槛..."
              ></textarea>
              <div class="review-actions">
                <span class="char-count">{{ formContent.length }} / 1000</span>
                <button type="button" class="tdd-btn primary" :disabled="submitting" @click="submitReview">
                  {{ submitting ? '提交中...' : (myReview ? '更新评测' : '提交评测') }}
                </button>
              </div>
            </div>
          </section>

          <!-- 评测列表 -->
          <section class="tdd-section">
            <h4 class="section-title"><i class="ri-list-check"></i> 社区评测（{{ reviewTotal }}）</h4>
            <div v-if="reviewsLoading" class="tdd-state small">
              <i class="ri-loader-4-line spin"></i>
            </div>
            <p v-else-if="reviews.length === 0" class="tdd-empty">还没有人评测，来写第一条吧。</p>
            <ul v-else class="review-list">
              <li v-for="r in reviews" :key="r.id" class="review-item">
                <div class="review-head">
                  <span class="review-author">{{ r.author }}</span>
                  <span class="review-stars">
                    <i
                      v-for="n in 5"
                      :key="n"
                      :class="n <= r.rating ? 'ri-star-fill' : 'ri-star-line'"
                    ></i>
                  </span>
                  <span class="review-time">{{ formatTime(r.updated_at || r.created_at) }}</span>
                </div>
                <p class="review-content">{{ r.content }}</p>
              </li>
            </ul>
            <button
              v-if="reviewPage < reviewPagination.totalPages"
              type="button"
              class="tdd-btn ghost more-btn"
              :disabled="reviewsLoading"
              @click="loadMoreReviews"
            >
              加载更多评测
            </button>
          </section>
        </div>

        <!-- 底部操作 -->
        <footer v-if="deal" class="tdd-foot">
          <div class="tdd-foot-left">
            <button type="button" class="tdd-btn primary" :disabled="importing" @click="importDeal">
              <i class="ri-bookmark-line"></i>
              {{ importing ? '导入中...' : '导入我的书签' }}
            </button>
            <a :href="deal.url" target="_blank" rel="noopener noreferrer" class="tdd-btn ghost">
              <i class="ri-external-link-line"></i> 前往领取
            </a>
            <button
              v-if="deal.status === 'approved'"
              type="button"
              class="tdd-btn ghost"
              title="生成 3:4 信息卡分享"
              @click="shareOpen = true"
            >
              <i class="ri-share-line"></i> 分享
            </button>
          </div>
          <div class="tdd-foot-right">
            <button v-if="deal.can_edit" type="button" class="tdd-btn ghost" @click="$emit('edit', deal)">
              <i class="ri-edit-line"></i> 编辑
            </button>
            <button v-if="deal.can_edit" type="button" class="tdd-btn danger" :disabled="deleting" @click="removeDeal">
              <i class="ri-delete-bin-line"></i> {{ deleting ? '删除中...' : '删除' }}
            </button>
          </div>
        </footer>

        <!-- 分享面板 -->
        <TokenShareSheet v-if="shareOpen && deal" :deal="deal" @close="shareOpen = false" />

        <!-- 轻提示 -->
        <Transition name="toast">
          <div v-if="message" class="tdd-toast" :class="messageType">{{ message }}</div>
        </Transition>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { fallbackProxyIcon } from '~/utils/favicon'
import TokenShareSheet from '~/components/tokens/TokenShareSheet.vue'

interface ITokenDeal {
  id: string
  provider: string
  title: string
  url: string
  call_url?: string
  quota?: string
  models?: string[]
  region?: string
  quality?: string
  source_tag?: string
  expires_at?: number | null
  pinned?: number
  note?: string
  status?: string
  reject_reason?: string
  username?: string
  nickname?: string
  is_expired?: boolean
  is_owner?: boolean
  can_edit?: boolean
  can_moderate?: boolean
  vote_up?: number
  vote_down?: number
  rating_sum?: number
  rating_count?: number
  nexus?: {
    enabled: boolean
    eval_ok: number
    eval_total: number
    eval_avg_ms: number
  } | null
}

interface IReview {
  id: number
  rating: number
  content: string
  created_at: number
  updated_at: number | null
  author: string
}

const props = defineProps<{ dealId: string }>()
const emit = defineEmits<{
  close: []
  edit: [deal: ITokenDeal]
  changed: []
}>()

const authStore = useAuthStore()

const REGION_LABELS: Record<string, string> = { cn: '国内直连', global: '海外' }
const SOURCE_LABELS: Record<string, string> = {
  official: '官方直营',
  relay: '中转站',
  community: '社区转发',
}
const RATING_TEXTS: Record<number, string> = {
  1: '很差',
  2: '较差',
  3: '一般',
  4: '不错',
  5: '很好',
}

const deal = ref<ITokenDeal | null>(null)
const loading = ref(true)
const loadError = ref('')

const myVote = ref<string | null>(null)
const myReview = ref<{ rating: number; content: string } | null>(null)
const voting = ref(false)
const deleting = ref(false)
const importing = ref(false)
const submitting = ref(false)
const shareOpen = ref(false)

const formRating = ref(5)
const formContent = ref('')

const reviews = ref<IReview[]>([])
const distribution = ref<Record<number, number>>({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 })
const reviewPage = ref(1)
const reviewsLoading = ref(false)
const reviewTotal = ref(0)
const reviewPagination = ref({ page: 1, limit: 20, total: 0, totalPages: 1 })

const iconFailed = ref(false)
const message = ref('')
const messageType = ref<'ok' | 'err'>('ok')
let messageTimer: ReturnType<typeof setTimeout> | null = null

const icon = computed(() => (deal.value ? fallbackProxyIcon('', deal.value.url) || '' : ''))
const initial = computed(() => (deal.value?.provider || '?').trim().charAt(0).toUpperCase())
const regionLabel = computed(() => REGION_LABELS[deal.value?.region || 'cn'] || '国内直连')
const sourceLabel = computed(() => SOURCE_LABELS[deal.value?.source_tag || 'official'] || '官方直营')

const qualityClass = computed(() => {
  const map: Record<string, string> = {
    上上品: 'q-top',
    上品: 'q-high',
    中品: 'q-mid',
    下品: 'q-low',
    下下品: 'q-bottom',
  }
  return map[deal.value?.quality || '中品'] || 'q-mid'
})

const average = computed(() => {
  const d = deal.value
  if (!d || !d.rating_count) return null
  return Number(((d.rating_sum || 0) / d.rating_count).toFixed(1))
})

const expiryText = computed(() => {
  const ts = deal.value?.expires_at
  if (!ts) return '永久有效'
  const diff = ts - Date.now()
  if (diff <= 0) return '已过期'
  const days = Math.ceil(diff / 86400000)
  if (days <= 1) return '今天到期'
  if (days <= 30) return `${days} 天后到期`
  return new Date(ts).toLocaleDateString('zh-CN')
})

const ratingText = computed(() => RATING_TEXTS[formRating.value] || '')

function distPercent(n: number) {
  const total = deal.value?.rating_count || 0
  if (!total) return '0%'
  return `${Math.round(((distribution.value[n] || 0) / total) * 100)}%`
}

function formatTime(ts: number) {
  if (!ts) return ''
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function toast(text: string, type: 'ok' | 'err' = 'ok') {
  message.value = text
  messageType.value = type
  if (messageTimer) clearTimeout(messageTimer)
  messageTimer = setTimeout(() => { message.value = '' }, 2600)
}

function close() {
  emit('close')
}

function onBackdrop() {
  close()
}

async function loadDeal() {
  loading.value = true
  loadError.value = ''
  try {
    const data = await $fetch<{ deal: ITokenDeal; my_vote: string | null; my_review: any }>(
      `/api/token-deals/${props.dealId}`,
      { credentials: 'include' },
    )
    deal.value = data.deal
    myVote.value = data.my_vote
    myReview.value = data.my_review
    if (data.my_review) {
      formRating.value = data.my_review.rating
      formContent.value = data.my_review.content
    }
  } catch (err: any) {
    loadError.value = err?.data?.error || '加载失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

async function loadReviews(reset = false) {
  if (reviewsLoading.value) return
  reviewsLoading.value = true
  try {
    const targetPage = reset ? 1 : reviewPage.value
    const data = await $fetch<{
      reviews: IReview[]
      distribution: Record<number, number>
      pagination: { page: number; limit: number; total: number; totalPages: number }
    }>(`/api/token-deals/${props.dealId}/reviews`, {
      query: { page: targetPage, limit: 20 },
      credentials: 'include',
    })
    reviews.value = reset ? data.reviews : [...reviews.value, ...data.reviews]
    distribution.value = { ...distribution.value, ...data.distribution }
    reviewPagination.value = data.pagination
    reviewTotal.value = data.pagination.total
    reviewPage.value = targetPage
  } catch {
    /* 评测列表加载失败不阻断主流程 */
  } finally {
    reviewsLoading.value = false
  }
}

function loadMoreReviews() {
  reviewPage.value += 1
  loadReviews(false)
}

async function vote(direction: 'up' | 'down') {
  if (!authStore.isLoggedIn) {
    toast('请先登录后再投票', 'err')
    return
  }
  if (!deal.value || voting.value) return
  voting.value = true
  try {
    const res = await $fetch<{ my_vote: string | null; vote_up: number; vote_down: number }>(
      `/api/token-deals/${props.dealId}/vote`,
      { method: 'POST', body: { vote: direction }, credentials: 'include' },
    )
    myVote.value = res.my_vote
    deal.value.vote_up = res.vote_up
    deal.value.vote_down = res.vote_down
    emit('changed')
  } catch (err: any) {
    toast(err?.data?.error || '投票失败', 'err')
  } finally {
    voting.value = false
  }
}

async function submitReview() {
  if (!formContent.value.trim()) {
    toast('请填写评测内容', 'err')
    return
  }
  submitting.value = true
  try {
    const res = await $fetch<{ rating_sum: number; rating_count: number; average: number | null }>(
      `/api/token-deals/${props.dealId}/reviews`,
      {
        method: 'POST',
        body: { rating: formRating.value, content: formContent.value.trim() },
        credentials: 'include',
      },
    )
    if (deal.value) {
      deal.value.rating_sum = res.rating_sum
      deal.value.rating_count = res.rating_count
    }
    myReview.value = { rating: formRating.value, content: formContent.value.trim() }
    toast('评测已提交')
    await loadReviews(true)
    emit('changed')
  } catch (err: any) {
    toast(err?.data?.error || '提交失败', 'err')
  } finally {
    submitting.value = false
  }
}

async function importDeal() {
  if (!authStore.isLoggedIn) {
    toast('请先登录后再导入', 'err')
    return
  }
  importing.value = true
  try {
    const res = await $fetch<{ skipped: boolean; message: string }>(
      `/api/token-deals/${props.dealId}/import`,
      { method: 'POST', credentials: 'include' },
    )
    toast(res.message || '已导入')
  } catch (err: any) {
    toast(err?.data?.error || '导入失败', 'err')
  } finally {
    importing.value = false
  }
}

async function removeDeal() {
  if (!import.meta.client) return
  if (!confirm(`确定删除通告「${deal.value?.title}」？该操作不可撤销。`)) return
  deleting.value = true
  try {
    await $fetch(`/api/token-deals/${props.dealId}`, { method: 'DELETE', credentials: 'include' })
    emit('changed')
    close()
  } catch (err: any) {
    toast(err?.data?.error || '删除失败', 'err')
  } finally {
    deleting.value = false
  }
}

async function copy(text?: string) {
  if (!text || !import.meta.client) return
  try {
    await navigator.clipboard.writeText(text)
    toast('已复制到剪贴板')
  } catch {
    toast('复制失败，请手动选择', 'err')
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}

let prevOverflow = ''

onMounted(() => {
  prevOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  document.addEventListener('keydown', onKeydown)
  loadDeal()
  loadReviews(true)
})

onUnmounted(() => {
  document.body.style.overflow = prevOverflow
  document.removeEventListener('keydown', onKeydown)
  if (messageTimer) clearTimeout(messageTimer)
})
</script>

<style scoped>
.tdd-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--overlay);
  backdrop-filter: var(--backdrop-blur);
  animation: tdd-fade 0.18s ease-out;
}
@keyframes tdd-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
.tdd-modal {
  position: relative;
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
  animation: tdd-rise 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes tdd-rise {
  from { opacity: 0; transform: translateY(12px) scale(0.99); }
  to { opacity: 1; transform: none; }
}

/* ── 头部 ── */
.tdd-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px;
  border-bottom: 0.5px solid var(--divider);
}
.tdd-head-main {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.tdd-icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  object-fit: contain;
  flex-shrink: 0;
  background: var(--surface-sunken);
}
.tdd-icon-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  color: var(--text-secondary);
}
.tdd-head-copy { min-width: 0; }
.tdd-provider {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tdd-pin {
  font-size: 12px;
  color: var(--primary);
  margin-left: 2px;
}
.tdd-meta {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--text-tertiary);
}
.tdd-meta .is-warn { color: var(--warning); }
.tdd-dot { margin: 0 5px; }
.tdd-head-side {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.tdd-quality {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 6px;
  font-weight: 500;
}
.q-top, .q-high { background: var(--primary-light); color: var(--primary); }
.q-mid { background: var(--surface-sunken); color: var(--text-secondary); }
.q-low, .q-bottom { background: rgba(245, 158, 11, 0.12); color: var(--warning); }
.tdd-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 8px;
  background: none;
  color: var(--text-tertiary);
  font-size: 17px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.tdd-close:hover { background: var(--surface-hover); color: var(--text-primary); }

/* ── 主体 ── */
.tdd-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 18px;
}
.tdd-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 56px 20px;
  color: var(--text-tertiary);
  font-size: 13px;
}
.tdd-state.small { padding: 18px; }
.tdd-state i { font-size: 22px; }
.tdd-state p { margin: 0; }
.spin { animation: tdd-spin 1s linear infinite; }
@keyframes tdd-spin { to { transform: rotate(360deg); } }

.tdd-status {
  display: flex;
  gap: 10px;
  padding: 10px 12px;
  margin-bottom: 14px;
  border-radius: var(--radius-md);
  font-size: 12.5px;
  line-height: 1.55;
}
.tdd-status i { font-size: 16px; flex-shrink: 0; margin-top: 1px; }
.tdd-status strong { display: block; margin-bottom: 2px; font-size: 13px; }
.tdd-status p { margin: 0; }
.tdd-status.is-pending { background: rgba(245, 158, 11, 0.1); color: var(--warning); }
.tdd-status.is-rejected { background: rgba(239, 68, 68, 0.1); color: var(--danger); }

.tdd-title {
  margin: 0 0 14px;
  font-size: 17px;
  font-weight: 600;
  line-height: 1.5;
  color: var(--text-primary);
}

.tdd-facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 10px;
  margin-bottom: 18px;
}
.tdd-fact {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
}
.fact-label { font-size: 11.5px; color: var(--text-tertiary); }
.fact-value { font-size: 13px; color: var(--text-primary); }

.tdd-section { margin-bottom: 18px; }
.section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 10px;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
}
.section-title i { font-size: 15px; color: var(--text-tertiary); }

.tdd-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 0;
  font-size: 12.5px;
  border-bottom: 0.5px solid var(--divider);
}
.tdd-row:last-child { border-bottom: none; }
.row-label { flex-shrink: 0; width: 66px; color: var(--text-tertiary); }
.row-link {
  flex: 1;
  min-width: 0;
  color: var(--primary);
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row-link:hover { text-decoration: underline; }
.row-code {
  flex: 1;
  min-width: 0;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--surface-sunken);
  padding: 3px 7px;
  border-radius: var(--radius-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tdd-models { display: flex; flex-wrap: wrap; gap: 6px; }
.model-chip {
  font-size: 12px;
  padding: 3px 8px;
  border-radius: 6px;
  background: var(--surface-sunken);
  color: var(--text-secondary);
}
.tdd-note {
  margin: 0;
  font-size: 13px;
  line-height: 1.65;
  color: var(--text-secondary);
  white-space: pre-wrap;
}

/* ── 健康度 ── */
.tdd-health {
  display: grid;
  grid-template-columns: 1fr 1fr 1.2fr;
  gap: 10px;
  align-items: stretch;
}
.vote-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  padding: 12px 8px;
  border-radius: var(--radius-md);
  border: 0.5px solid var(--border);
  background: var(--surface-raised);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.vote-btn i { font-size: 18px; }
.vote-label { font-size: 12px; color: var(--text-tertiary); }
.vote-count { font-size: 15px; font-weight: 600; color: var(--text-primary); }
.vote-btn.is-up i { color: var(--success); }
.vote-btn.is-down i { color: var(--danger); }
.vote-btn.is-up.active { border-color: var(--success); background: rgba(16, 185, 129, 0.08); }
.vote-btn.is-down.active { border-color: var(--danger); background: rgba(239, 68, 68, 0.08); }
.vote-btn:hover:not(:disabled) { background: var(--surface-hover); }
.vote-btn:disabled { opacity: 0.6; cursor: not-allowed; }

.health-rating {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 12px 8px;
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
}
.rating-score { display: flex; align-items: baseline; gap: 2px; }
.score-num { font-size: 20px; font-weight: 700; color: var(--text-primary); }
.score-max { font-size: 11px; color: var(--text-tertiary); }
.rating-stars { display: flex; gap: 1px; font-size: 11px; color: var(--warning); }
.rating-count { font-size: 11px; color: var(--text-tertiary); }

.tdd-distribution {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 10px;
}
.dist-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
  color: var(--text-tertiary);
}
.dist-label { width: 30px; flex-shrink: 0; }
.dist-bar {
  flex: 1;
  height: 5px;
  border-radius: 3px;
  background: var(--surface-sunken);
  overflow: hidden;
}
.dist-fill {
  display: block;
  height: 100%;
  border-radius: 3px;
  background: var(--warning);
  transition: width 0.25s;
}
.dist-count { width: 26px; text-align: right; font-variant-numeric: tabular-nums; }
.tdd-hint {
  margin: 10px 0 0;
  font-size: 12px;
  color: var(--text-tertiary);
}

/* ── 评测表单 ── */
.review-form { display: flex; flex-direction: column; gap: 8px; }
.star-input { display: flex; align-items: center; gap: 3px; }
.star-btn {
  border: none;
  background: none;
  padding: 2px;
  font-size: 18px;
  line-height: 1;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: color 0.12s, transform 0.12s;
}
.star-btn:hover { transform: scale(1.1); }
.star-btn.active { color: var(--warning); }
.star-text { margin-left: 6px; font-size: 12px; color: var(--text-tertiary); }
.review-input {
  width: 100%;
  resize: vertical;
  padding: 9px 11px;
  font-size: 13px;
  font-family: inherit;
  line-height: 1.6;
  color: var(--text-primary);
  background: var(--surface-raised);
  border: 0.5px solid var(--border);
  border-radius: var(--radius-md);
  outline: none;
}
.review-input:focus { border-color: var(--border-focus); }
.review-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.char-count { font-size: 11.5px; color: var(--text-tertiary); }

/* ── 评测列表 ── */
.review-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.review-item {
  padding: 10px 12px;
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
}
.review-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 5px;
}
.review-author { font-size: 12.5px; font-weight: 500; color: var(--text-primary); }
.review-stars { display: flex; gap: 1px; font-size: 11px; color: var(--warning); }
.review-time { margin-left: auto; font-size: 11px; color: var(--text-tertiary); }
.review-content {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--text-secondary);
  white-space: pre-wrap;
}
.tdd-empty {
  margin: 0;
  padding: 16px;
  text-align: center;
  font-size: 12.5px;
  color: var(--text-tertiary);
}
.more-btn { margin-top: 12px; width: 100%; justify-content: center; }

/* ── 底部 ── */
.tdd-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 18px;
  border-top: 0.5px solid var(--divider);
  background: var(--surface-raised);
  flex-wrap: wrap;
}
.tdd-foot-left,
.tdd-foot-right { display: flex; align-items: center; gap: 8px; }

.tdd-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 7px 14px;
  border-radius: var(--radius-md);
  border: 0.5px solid var(--border);
  background: var(--surface-raised);
  color: var(--text-secondary);
  font-size: 12.5px;
  font-weight: 500;
  text-decoration: none;
  cursor: pointer;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.tdd-btn:hover:not(:disabled) { background: var(--surface-hover); color: var(--text-primary); }
.tdd-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.tdd-btn.primary {
  background: var(--primary);
  border-color: var(--primary);
  color: var(--text-inverse);
}
.tdd-btn.primary:hover:not(:disabled) { background: var(--primary-hover); border-color: var(--primary-hover); }
.tdd-btn.danger { color: var(--danger); border-color: rgba(239, 68, 68, 0.3); }
.tdd-btn.danger:hover:not(:disabled) { background: rgba(239, 68, 68, 0.08); color: var(--danger); }
.tdd-btn.tiny { padding: 3px 8px; font-size: 11.5px; }

/* ── 轻提示 ── */
.tdd-toast {
  position: absolute;
  left: 50%;
  bottom: 70px;
  transform: translateX(-50%);
  padding: 8px 16px;
  border-radius: var(--radius-md);
  font-size: 12.5px;
  color: var(--text-inverse);
  background: var(--text-primary);
  box-shadow: var(--shadow-lg);
  white-space: nowrap;
}
.tdd-toast.err { background: var(--danger); }
.toast-enter-active,
.toast-leave-active { transition: opacity 0.2s, transform 0.2s; }
.toast-enter-from,
.toast-leave-to { opacity: 0; transform: translateX(-50%) translateY(6px); }

/* ── 移动端 ── */
@media (max-width: 640px) {
  .tdd-backdrop { padding: 0; align-items: flex-end; }
  .tdd-modal {
    max-width: none;
    max-height: 92vh;
    border-radius: var(--radius-xl) var(--radius-xl) 0 0;
  }
  .tdd-health { grid-template-columns: 1fr 1fr; }
  .health-rating { grid-column: 1 / -1; }
  .tdd-foot { flex-direction: column; align-items: stretch; }
  .tdd-foot-left, .tdd-foot-right { width: 100%; }
  .tdd-foot-left .tdd-btn, .tdd-foot-right .tdd-btn { flex: 1; justify-content: center; }
}
</style>
