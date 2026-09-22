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

          <!-- 我的修改建议状态 -->
          <section v-if="myEdit" class="tdd-section tdd-edit-mine">
            <h4 class="section-title"><i class="ri-lightbulb-line"></i> 我的修改建议</h4>
            <p class="edit-mine-hint">
              已于 {{ formatTime(myEdit.created_at) }} 提交 {{ myEdit.diff.length }} 项修改，等待审核。
            </p>
            <ul class="edit-diff-list">
              <li v-for="c in myEdit.diff" :key="c.field" class="edit-diff-item">
                <span class="diff-label">{{ c.label }}</span>
                <span class="diff-from">{{ displayFieldValue(c.field, c.from) }}</span>
                <i class="ri-arrow-right-line diff-arrow"></i>
                <span class="diff-to">{{ displayFieldValue(c.field, c.to) }}</span>
              </li>
            </ul>
            <p v-if="myEdit.comment" class="edit-mine-comment">
              <i class="ri-chat-quote-line"></i> {{ myEdit.comment }}
            </p>
            <div class="edit-mine-actions">
              <button type="button" class="tdd-btn ghost tiny" :disabled="editBusy" @click="openProposal">
                <i class="ri-edit-line"></i> 继续修改
              </button>
              <button type="button" class="tdd-btn danger tiny" :disabled="editBusy" @click="withdrawMyEdit">
                <i class="ri-close-line"></i> 撤回建议
              </button>
            </div>
          </section>

          <!-- 待我审核的修改建议 -->
          <section v-if="deal.can_review && pendingEdits.length" class="tdd-section tdd-edit-review">
            <h4 class="section-title">
              <i class="ri-inbox-unarchive-line"></i> 待审核的修改建议
              <span class="review-count">{{ pendingEdits.length }}</span>
            </h4>
            <ul class="review-list-edit">
              <li v-for="e in pendingEdits" :key="e.id" class="review-edit-item">
                <div class="review-edit-head">
                  <span class="review-edit-author">
                    <i class="ri-user-line"></i> {{ e.proposer }}
                  </span>
                  <span class="review-edit-time">{{ formatTime(e.created_at) }}</span>
                </div>
                <p v-if="e.comment" class="review-edit-comment">{{ e.comment }}</p>
                <p v-if="e.is_noop" class="review-edit-noop">
                  该建议与当前内容已无差异，可直接驳回。
                </p>
                <ul v-else class="edit-diff-list">
                  <li v-for="c in e.diff" :key="c.field" class="edit-diff-item">
                    <span class="diff-label">{{ c.label }}</span>
                    <span class="diff-from">{{ displayFieldValue(c.field, c.from) }}</span>
                    <i class="ri-arrow-right-line diff-arrow"></i>
                    <span class="diff-to">{{ displayFieldValue(c.field, c.to) }}</span>
                  </li>
                </ul>
                <div class="review-edit-actions">
                  <button
                    type="button"
                    class="tdd-btn primary tiny"
                    :disabled="editBusy || e.is_noop"
                    @click="reviewEdit(e, 'approve')"
                  >
                    <i class="ri-check-line"></i> 通过
                  </button>
                  <button
                    type="button"
                    class="tdd-btn danger tiny"
                    :disabled="editBusy"
                    @click="rejectTarget = e"
                  >
                    <i class="ri-close-line"></i> 驳回
                  </button>
                </div>
              </li>
            </ul>
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
              无需登录也能评测 —— 填个昵称即可参与（评测经审核后公开并计入评分）。
            </p>
          </section>

          <!-- 游客评测：无需登录 -->
          <section v-if="!authStore.isLoggedIn" class="tdd-section">
            <h4 class="section-title">
              <i class="ri-chat-smile-2-line"></i> 游客评测（无需登录）
            </h4>

            <!-- 已有待审评测 → 回显状态 -->
            <div v-if="myGuestReview" class="guest-status">
              <div class="guest-status-head">
                <span class="guest-badge" :class="myGuestReview.status">
                  {{ myGuestReview.status === 'pending' ? '审核中' : '已驳回' }}
                </span>
                <span class="guest-status-nick">{{ myGuestReview.nickname }}</span>
                <span class="guest-stars">
                  <i
                    v-for="n in 5"
                    :key="n"
                    :class="n <= myGuestReview.rating ? 'ri-star-fill' : 'ri-star-line'"
                  ></i>
                </span>
              </div>
              <p class="guest-status-content">{{ myGuestReview.content }}</p>
              <p v-if="myGuestReview.status === 'pending'" class="guest-status-tip">
                评测已提交，等待作者或管理员审核。通过后会公开显示并计入评分。
              </p>
              <p v-else class="guest-status-tip err">
                未通过审核<template v-if="myGuestReview.reject_reason">：{{ myGuestReview.reject_reason }}</template>。
                你可以修改后重新提交。
              </p>
              <div class="guest-status-actions">
                <button
                  v-if="myGuestReview.status === 'pending'"
                  type="button"
                  class="tdd-btn ghost"
                  :disabled="guestSubmitting"
                  @click="withdrawGuestReview"
                >
                  撤回评测
                </button>
                <button
                  v-else
                  type="button"
                  class="tdd-btn ghost"
                  @click="guestFormOpen = true"
                >
                  重新提交
                </button>
              </div>
            </div>

            <!-- 未提交 / 被驳回后重填 -->
            <template v-else>
              <button
                v-if="!guestFormOpen"
                type="button"
                class="tdd-btn primary guest-open-btn"
                @click="openGuestForm"
              >
                <i class="ri-chat-smile-2-line"></i> 写一条游客评测
              </button>

              <div v-else class="review-form guest-form">
                <div class="guest-row">
                  <label class="guest-field">
                    <span class="guest-label">昵称 <em>*</em></span>
                    <input
                      v-model="guestNickname"
                      type="text"
                      class="guest-input"
                      :maxlength="24"
                      placeholder="展示用的名字"
                    >
                  </label>
                  <label class="guest-field">
                    <span class="guest-label">QQ 号（可选，用于头像）</span>
                    <input
                      v-model="guestQQ"
                      type="text"
                      class="guest-input"
                      inputmode="numeric"
                      :maxlength="11"
                      placeholder="填了才显示 QQ 头像"
                    >
                  </label>
                </div>
                <p class="guest-privacy-tip">
                  <i class="ri-shield-check-line"></i>
                  QQ 号仅用于服务端获取头像，加密存储、不会公开展示，页面源码中也看不到。
                </p>
                <div v-if="guestAvatarPreview" class="guest-avatar-preview">
                  <img :src="guestAvatarPreview" alt="头像预览" @error="guestAvatarBroken = true">
                  <span>头像预览</span>
                </div>

                <div class="star-input">
                  <button
                    v-for="n in 5"
                    :key="n"
                    type="button"
                    class="star-btn"
                    :class="{ active: n <= guestRating }"
                    :title="`${n} 星`"
                    @click="guestRating = n"
                  >
                    <i :class="n <= guestRating ? 'ri-star-fill' : 'ri-star-line'"></i>
                  </button>
                  <span class="star-text">{{ RATING_TEXTS[guestRating] || '' }}</span>
                </div>

                <textarea
                  v-model="guestContent"
                  class="review-input"
                  rows="3"
                  :maxlength="1000"
                  placeholder="说说实际体验：延迟、稳定性、额度是否到账、有没有隐藏门槛..."
                ></textarea>

                <!-- 人机校验 -->
                <div class="guest-challenge">
                  <span class="guest-label">人机校验 <em>*</em></span>
                  <template v-if="challenge.question">
                    <span class="challenge-q">{{ challenge.question }}</span>
                    <input
                      v-model="challengeAnswer"
                      type="text"
                      class="guest-input challenge-input"
                      inputmode="numeric"
                      placeholder="答案"
                    >
                    <button type="button" class="challenge-refresh" title="换一题" @click="loadChallenge">
                      <i class="ri-refresh-line"></i>
                    </button>
                  </template>
                  <button v-else type="button" class="tdd-btn ghost" @click="loadChallenge">
                    加载校验题
                  </button>
                </div>

                <div class="review-actions">
                  <span class="char-count">{{ guestContent.length }} / 1000</span>
                  <button
                    type="button"
                    class="tdd-btn ghost"
                    @click="guestFormOpen = false"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    class="tdd-btn primary"
                    :disabled="guestSubmitting"
                    @click="submitGuestReview"
                  >
                    {{ guestSubmitting ? '提交中...' : '提交评测' }}
                  </button>
                </div>
              </div>
            </template>
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
                  <span class="review-avatar" :class="{ 'has-img': r.avatar }">
                    <img
                      v-if="r.avatar && !brokenAvatars.has(String(r.id))"
                      :src="r.avatar"
                      :alt="r.author"
                      loading="lazy"
                      @error="markAvatarBroken(r.id)"
                    >
                    <template v-else>{{ initialOf(r.author) }}</template>
                  </span>
                  <span class="review-author">{{ r.author }}</span>
                  <span v-if="r.source === 'guest'" class="review-tag" title="游客评测">游客</span>
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
            <!-- 非作者也能改：走建议通道，由作者或管理员审核 -->
            <button
              v-if="deal.status === 'approved' && !deal.can_edit && !myEdit"
              type="button"
              class="tdd-btn ghost"
              title="发现信息有误？提交修改建议"
              @click="openProposal"
            >
              <i class="ri-lightbulb-line"></i> 建议修改
            </button>
            <button v-if="deal.can_edit" type="button" class="tdd-btn ghost" @click="$emit('edit', deal)">
              <i class="ri-edit-line"></i> 编辑
            </button>
            <button v-if="deal.can_edit" type="button" class="tdd-btn danger" :disabled="deleting" @click="removeDeal">
              <i class="ri-delete-bin-line"></i> {{ deleting ? '删除中...' : '删除' }}
            </button>
          </div>
        </footer>

        <!-- 建议修改面板 -->
        <TokenDealEditor
          v-if="proposalOpen && deal"
          :deal="deal"
          proposal
          @close="proposalOpen = false"
          @saved="onProposalSaved"
        />

        <!-- 驳回修改建议弹窗 -->
        <Teleport to="body">
          <div v-if="rejectTarget" class="tdd-reject-backdrop" @click.self="rejectTarget = null">
            <div class="tdd-reject-modal">
              <h3 class="reject-title">驳回修改建议</h3>
              <p class="reject-sub">
                来自「{{ rejectTarget.proposer }}」的 {{ rejectTarget.diff.length }} 项修改将不予采纳。
              </p>
              <textarea
                v-model="rejectReason"
                rows="3"
                maxlength="200"
                placeholder="说明驳回理由，便于对方改进（选填）"
              ></textarea>
              <span class="reject-hint">{{ rejectReason.length }} / 200</span>
              <div class="reject-actions">
                <button type="button" class="tdd-btn ghost" @click="rejectTarget = null">取消</button>
                <button
                  type="button"
                  class="tdd-btn danger"
                  :disabled="editBusy"
                  @click="confirmReject"
                >
                  <i class="ri-close-line"></i> 确认驳回
                </button>
              </div>
            </div>
          </div>
        </Teleport>

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
import TokenDealEditor from '~/components/tokens/TokenDealEditor.vue'

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

/** 单条字段差异 */
interface IFieldDiff {
  field: string
  label: string
  from: any
  to: any
}

/** 修改建议 */
interface IDealEdit {
  id: string
  deal_id: string
  user_id: number
  proposer: string
  comment: string
  status: string
  reject_reason?: string
  payload: Record<string, any>
  diff: IFieldDiff[]
  is_noop: boolean
  created_at: number
  updated_at: number
}

/** 详情端点附带的建议摘要 */
interface IEditsSummary {
  can_review: boolean
  pending_edit_count: number
  my_edit: IDealEdit | null
  is_author: boolean
}

interface IReview {
  id: string | number
  rating: number
  content: string
  created_at: number
  updated_at: number | null
  author: string
  /** 头像 URL（/avatar/<加密令牌>.jpg）；未填 QQ 号时为 null → 回退首字母色块 */
  avatar?: string | null
  /** user = 登录用户评测；guest = 游客评测（已通过审核） */
  source?: 'user' | 'guest'
}

/** 当前访客自己的待审游客评测（按 IP+UA 指纹识别，未登录也能回显） */
interface IGuestReview {
  id: string
  nickname: string
  rating: number
  content: string
  status: string
  reject_reason?: string
  avatar?: string | null
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

// ── 修改建议 ──
const myEdit = ref<IDealEdit | null>(null)
const pendingEdits = ref<IDealEdit[]>([])
const proposalOpen = ref(false)
const editBusy = ref(false)
const rejectTarget = ref<IDealEdit | null>(null)
const rejectReason = ref('')

const formRating = ref(5)
const formContent = ref('')

// ── 游客评测（无需登录）──
const myGuestReview = ref<IGuestReview | null>(null)
const guestFormOpen = ref(false)
const guestNickname = ref('')
const guestQQ = ref('')
const guestRating = ref(5)
const guestContent = ref('')
const guestSubmitting = ref(false)
const challenge = ref<{ question: string; token: string }>({ question: '', token: '' })
const challengeAnswer = ref('')
/** 头像预览：本地拼 QQ 头像直链仅用于即时预览，提交后走服务端代理（QQ 号不外露） */
const guestAvatarBroken = ref(false)
const guestAvatarPreview = computed(() => {
  const qq = guestQQ.value.trim()
  if (!/^[1-9]\d{4,10}$/.test(qq) || guestAvatarBroken.value) return null
  return `https://q2.qlogo.cn/headimg_dl?dst_uin=${qq}&spec=100`
})

/** 头像加载失败的评测 id 集合 → 回退首字母色块（QQ 头像接口对无效号会返回默认图，但网络失败仍需兜底） */
const brokenAvatars = ref<Set<string>>(new Set())
function markAvatarBroken(id: string | number) {
  brokenAvatars.value.add(String(id))
}
function initialOf(name: string) {
  return (name || '?')[0].toUpperCase()
}

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

/** diff 展示用：把枚举值与时间戳渲染成人话 */
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
    const data = await $fetch<{
      deal: ITokenDeal
      edits: IEditsSummary | null
      guest_review: IGuestReview | null
      my_vote: string | null
      my_review: any
    }>(
      `/api/token-deals/${props.dealId}`,
      { credentials: 'include' },
    )
    deal.value = data.deal
    myVote.value = data.my_vote
    myReview.value = data.my_review
    myEdit.value = data.edits?.my_edit ?? null
    myGuestReview.value = data.guest_review ?? null
    // 回填游客表单：被驳回后重填时预填上次内容，减少重复输入
    if (data.guest_review && data.guest_review.status === 'rejected') {
      guestNickname.value = data.guest_review.nickname || ''
      guestRating.value = data.guest_review.rating || 5
      guestContent.value = data.guest_review.content || ''
    }
    if (data.my_review) {
      formRating.value = data.my_review.rating
      formContent.value = data.my_review.content
    }
    // 审核人需要提案明细 → 单独拉一次列表（详情端点只给摘要）
    if (data.edits?.can_review && data.edits.pending_edit_count > 0) {
      await loadPendingEdits()
    } else {
      pendingEdits.value = []
    }
  } catch (err: any) {
    loadError.value = err?.data?.error || '加载失败，请稍后重试'
  } finally {
    loading.value = false
  }
}

/** 拉取本通告的待审提案（仅作者/管理员有权限，其他人拿到的是空/自己的） */
async function loadPendingEdits() {
  try {
    const res = await $fetch<{ edits: IDealEdit[]; can_review: boolean }>(
      `/api/token-deals/${props.dealId}/edits`,
      { query: { status: 'pending' }, credentials: 'include' },
    )
    pendingEdits.value = res.can_review ? res.edits : []
  } catch {
    pendingEdits.value = []
  }
}

// ── 游客评测 ──────────────────────────────────────────────────

/** 打开游客评测表单：顺带拉一道人机校验题 */
function openGuestForm() {
  guestFormOpen.value = true
  guestAvatarBroken.value = false
  if (!challenge.value.question) loadChallenge()
}

/** 获取人机校验题（答案在服务端签名令牌里，前端只拿到题目） */
async function loadChallenge() {
  challengeAnswer.value = ''
  try {
    const res = await $fetch<{ question: string; token: string }>(
      `/api/token-deals/${props.dealId}/guest-review-challenge`,
      { credentials: 'include' },
    )
    challenge.value = { question: res.question, token: res.token }
  } catch (err: any) {
    challenge.value = { question: '', token: '' }
    toast(err?.data?.error || '校验题加载失败', 'err')
  }
}

async function submitGuestReview() {
  if (guestSubmitting.value) return
  const nickname = guestNickname.value.trim()
  if (!nickname) {
    toast('请填写昵称', 'err')
    return
  }
  if (!guestContent.value.trim()) {
    toast('请填写评测内容', 'err')
    return
  }
  if (!challenge.value.token) {
    toast('请先加载并完成人机校验', 'err')
    return
  }
  if (!challengeAnswer.value.trim()) {
    toast('请填写人机校验答案', 'err')
    return
  }
  const qq = guestQQ.value.trim()
  if (qq && !/^[1-9]\d{4,10}$/.test(qq)) {
    toast('QQ 号格式不正确（5-11 位数字）', 'err')
    return
  }

  guestSubmitting.value = true
  try {
    const res = await $fetch<{ review: IGuestReview; message?: string }>(
      `/api/token-deals/${props.dealId}/guest-reviews`,
      {
        method: 'POST',
        credentials: 'include',
        body: {
          nickname,
          qq,
          rating: guestRating.value,
          content: guestContent.value.trim(),
          challenge_token: challenge.value.token,
          challenge_answer: Number(challengeAnswer.value.trim()),
        },
      },
    )
    myGuestReview.value = res.review
    guestFormOpen.value = false
    guestContent.value = ''
    challenge.value = { question: '', token: '' }
    challengeAnswer.value = ''
    toast(res.message || '评测已提交，等待审核')
    // 若该访客此前已有通过的评测，本次是覆盖提交 → 列表内容会变
    await loadReviews(true)
  } catch (err: any) {
    toast(err?.data?.error || '提交失败', 'err')
    // 校验题是一次性的（答题即消耗），失败后换一题避免重复提交同一答案
    if (String(err?.data?.error || '').includes('校验')) loadChallenge()
  } finally {
    guestSubmitting.value = false
  }
}

async function withdrawGuestReview() {
  if (!myGuestReview.value || guestSubmitting.value) return
  guestSubmitting.value = true
  try {
    await $fetch(`/api/token-deals/${props.dealId}/guest-reviews/${myGuestReview.value.id}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    myGuestReview.value = null
    toast('已撤回评测')
  } catch (err: any) {
    toast(err?.data?.error || '撤回失败', 'err')
  } finally {
    guestSubmitting.value = false
  }
}

/** 打开建议修改面板：未登录先提示 */
function openProposal() {
  if (!authStore.isLoggedIn) {
    toast('请先登录后再提交修改建议', 'err')
    return
  }
  proposalOpen.value = true
}

function onProposalSaved(text: string) {
  proposalOpen.value = false
  toast(text || '修改建议已提交，等待审核')
  loadDeal()
  emit('changed')
}

/** 撤回自己提交的建议 */
async function withdrawMyEdit() {
  if (!myEdit.value || editBusy.value) return
  editBusy.value = true
  try {
    await $fetch(`/api/token-deal-edits/${myEdit.value.id}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    myEdit.value = null
    toast('已撤回修改建议')
    emit('changed')
  } catch (err: any) {
    toast(err?.data?.error || '撤回失败', 'err')
  } finally {
    editBusy.value = false
  }
}

/** 审核提案：通过 */
async function reviewEdit(target: IDealEdit, action: 'approve' | 'reject', reason = '') {
  if (editBusy.value) return
  editBusy.value = true
  try {
    const res = await $fetch<{ message?: string; deal_status?: string }>(
      `/api/token-deal-edits/${target.id}/review`,
      { method: 'POST', body: { action, reason }, credentials: 'include' },
    )
    toast(res?.message || (action === 'approve' ? '已通过' : '已驳回'))
    await loadDeal()
    await loadReviews(true)
    emit('changed')
  } catch (err: any) {
    toast(err?.data?.error || '操作失败', 'err')
  } finally {
    editBusy.value = false
  }
}

async function confirmReject() {
  if (!rejectTarget.value) return
  const target = rejectTarget.value
  const reason = rejectReason.value.trim()
  rejectTarget.value = null
  rejectReason.value = ''
  await reviewEdit(target, 'reject', reason)
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
  /* 必须高于移动端底部导航（.mobile-bottom-nav = 9998）：
     移动端本弹窗是贴底 sheet，层级低于底栏时底部按钮会被底栏压住，
     且底栏会浮在遮罩之上仍可点击。同层另见 ShareSheet 10070 / Editor 10060。 */
  z-index: 10050;
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
/* 头像：有图走 <img>，无图/加载失败回退昵称首字母色块 */
.review-avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--primary);
  color: var(--text-inverse);
  font-size: 11px;
  font-weight: 600;
  overflow: hidden;
}
.review-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.review-author { font-size: 12.5px; font-weight: 500; color: var(--text-primary); }
/* 游客标识：与登录用户评测区分 */
.review-tag {
  font-size: 10px;
  line-height: 1;
  padding: 2px 5px;
  border-radius: 4px;
  background: var(--surface-raised);
  border: 1px solid var(--border);
  color: var(--text-tertiary);
}
.review-stars { display: flex; gap: 1px; font-size: 11px; color: var(--warning); }
.review-time { margin-left: auto; font-size: 11px; color: var(--text-tertiary); }

/* ── 游客评测 ── */
.guest-open-btn { width: 100%; justify-content: center; }
.guest-form { gap: 10px; }
.guest-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.guest-field {
  flex: 1 1 160px;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.guest-label {
  font-size: 11.5px;
  color: var(--text-secondary);
}
.guest-label em {
  font-style: normal;
  color: var(--danger);
}
.guest-input {
  width: 100%;
  padding: 7px 10px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  background: var(--surface-sunken);
  color: var(--text-primary);
  font-size: 12.5px;
  font-family: inherit;
}
.guest-input:focus {
  outline: none;
  border-color: var(--border-focus);
}
.guest-privacy-tip {
  margin: 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-tertiary);
  display: flex;
  align-items: flex-start;
  gap: 4px;
}
.guest-privacy-tip i { margin-top: 1px; }
.guest-avatar-preview {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
  color: var(--text-tertiary);
}
.guest-avatar-preview img {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  object-fit: cover;
  border: 1px solid var(--border);
}
.guest-challenge {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 8px 10px;
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
}
.challenge-q {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: 0.5px;
}
.challenge-input {
  width: 72px;
  flex: 0 0 auto;
  text-align: center;
}
.challenge-refresh {
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  font-size: 14px;
  padding: 4px;
  border-radius: 6px;
}
.challenge-refresh:hover { color: var(--primary); background: var(--surface-hover); }

/* 已有待审评测的状态回显 */
.guest-status {
  padding: 10px 12px;
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.guest-status-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.guest-badge {
  font-size: 10.5px;
  line-height: 1;
  padding: 3px 6px;
  border-radius: 4px;
  background: var(--warning-bg, var(--surface-raised));
  color: var(--text-secondary);
  border: 1px solid var(--border);
}
.guest-badge.rejected {
  color: var(--danger);
  border-color: var(--danger);
}
.guest-status-nick { font-size: 12.5px; font-weight: 500; color: var(--text-primary); }
.guest-stars { display: flex; gap: 1px; font-size: 11px; color: var(--warning); }
.guest-status-content {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--text-secondary);
  white-space: pre-wrap;
}
.guest-status-tip {
  margin: 0;
  font-size: 11.5px;
  color: var(--text-tertiary);
}
.guest-status-tip.err { color: var(--danger); }
.guest-status-actions { display: flex; gap: 8px; }

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

/* ── 修改建议 ── */
.tdd-edit-mine {
  padding: 12px;
  border-radius: var(--radius-md);
  background: var(--primary-light);
  border: 0.5px solid var(--border);
}
.edit-mine-hint {
  margin: 0 0 8px;
  font-size: 12.5px;
  color: var(--text-secondary);
}
.edit-mine-comment {
  display: flex;
  align-items: flex-start;
  gap: 5px;
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
}
.edit-mine-comment i { color: var(--primary); flex-shrink: 0; margin-top: 1px; }
.edit-mine-actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}

.edit-diff-list {
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
.diff-label {
  flex-shrink: 0;
  min-width: 62px;
  color: var(--text-tertiary);
}
.diff-from {
  color: var(--text-tertiary);
  text-decoration: line-through;
  word-break: break-all;
}
.diff-arrow { color: var(--text-tertiary); font-size: 13px; flex-shrink: 0; }
.diff-to {
  color: var(--text-primary);
  font-weight: 500;
  word-break: break-all;
}

.tdd-edit-review .section-title { display: flex; align-items: center; gap: 6px; }
.review-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 17px;
  height: 17px;
  padding: 0 5px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-inverse);
  background: var(--danger);
}
.review-list-edit {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.review-edit-item {
  padding: 10px 12px;
  border: 0.5px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
}
.review-edit-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 7px;
}
.review-edit-author {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--text-primary);
}
.review-edit-author i { color: var(--primary); font-size: 13px; }
.review-edit-time { font-size: 11.5px; color: var(--text-tertiary); }
.review-edit-comment {
  margin: 0 0 7px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);
}
.review-edit-noop {
  margin: 0 0 7px;
  font-size: 12px;
  color: var(--text-tertiary);
  font-style: italic;
}
.review-edit-actions {
  display: flex;
  gap: 8px;
  margin-top: 9px;
}

/* ── 驳回修改建议弹窗（须高于详情弹窗 10050）── */
.tdd-reject-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10080;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: var(--overlay);
  backdrop-filter: var(--backdrop-blur);
}
.tdd-reject-modal {
  width: 100%;
  max-width: 420px;
  padding: 18px;
  border-radius: var(--radius-xl);
  background: var(--surface-raised);
  border: 0.5px solid var(--border);
  box-shadow: var(--shadow-xl);
}
.reject-title {
  margin: 0 0 6px;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}
.reject-sub {
  margin: 0 0 12px;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--text-secondary);
}
.tdd-reject-modal textarea {
  width: 100%;
  padding: 8px 11px;
  font-size: 13px;
  font-family: inherit;
  line-height: 1.5;
  color: var(--text-primary);
  background: var(--surface-raised);
  border: 0.5px solid var(--border);
  border-radius: var(--radius-md);
  outline: none;
  resize: vertical;
}
.tdd-reject-modal textarea:focus { border-color: var(--border-focus); }
.tdd-reject-modal textarea::placeholder { color: var(--text-tertiary); }
.reject-hint {
  display: block;
  margin-top: 4px;
  font-size: 11.5px;
  color: var(--text-tertiary);
}
.reject-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 14px;
}

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
  .tdd-foot { flex-direction: column; align-items: stretch; padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px)); }
  .tdd-foot-left, .tdd-foot-right { width: 100%; }
  .tdd-foot-left .tdd-btn, .tdd-foot-right .tdd-btn { flex: 1; justify-content: center; }
}
</style>
