<template>
  <a
    class="deal-card"
    :class="{ 'is-pinned': deal.pinned, 'is-expired': deal.is_expired }"
    :href="detailHref"
    :aria-label="`${deal.provider}：${deal.title}`"
    @click="onOpenClick"
  >
    <header class="deal-head">
      <div class="deal-brand">
        <img
          v-if="icon && !iconFailed"
          :src="icon"
          class="deal-icon"
          loading="lazy"
          alt=""
          @error="iconFailed = true"
        >
        <span v-else class="deal-icon deal-icon-fallback">{{ initial }}</span>
        <div class="deal-brand-text">
          <h3 class="deal-provider">
            {{ deal.provider }}
            <i v-if="deal.pinned" class="ri-pushpin-2-fill pin-mark" title="已置顶"></i>
          </h3>
          <p class="deal-meta">
            <span>{{ regionLabel }} · {{ sourceLabel }}</span>
            <span
              v-if="verifyBadge"
              class="deal-verify"
              :class="verifyClass"
              :title="verifyTitle"
            >{{ verifyBadge }}</span>
          </p>
        </div>
      </div>
      <span v-if="categoryLabel" class="deal-category" :class="categoryClass">{{ categoryLabel }}</span>
      <span class="deal-quality" :class="qualityClass">{{ deal.quality }}</span>
    </header>

    <div
      class="deal-nexus"
      :class="{ 'is-none': !deal.nexus, 'is-off': deal.nexus && !deal.nexus.enabled }"
    >
      <template v-if="deal.nexus">
        <span class="nexus-tag">
          <i class="ri-pulse-line"></i>{{ deal.nexus.enabled ? 'Nexus 实测' : 'Nexus 已禁用' }}
        </span>
        <template v-if="deal.nexus.enabled && deal.nexus.eval_total > 0">
          <span class="nexus-stat" :title="`${deal.nexus.eval_ok}/${deal.nexus.eval_total} 次探测成功`">
            <i class="ri-signal-tower-line"></i>{{ nexusRate }}
          </span>
          <span v-if="deal.nexus.eval_avg_ms > 0" class="nexus-stat" :title="`平均耗时 ${deal.nexus.eval_avg_ms} ms`">
            <i class="ri-timer-flash-line"></i>{{ nexusSpeed }}
          </span>
        </template>
      </template>
      <span v-else class="nexus-tag">
        <i class="ri-link-unlink-m"></i>未接入 Nexus
      </span>
    </div>

    <h4 class="deal-title">{{ deal.title }}</h4>

    <!--
      一句话摘要（2026-11-04）：`summary` 非空用它，否则回落 `quota`（Lead 确认的契约）。

      回落时**不再重复渲染**下方的「免费额度」块 —— 那个块在 `quota` 非空时必然渲染，
      同一个值会在同一张卡上印两遍（摘要行 + 额度块），读起来像 bug。
      所以额度块的渲染条件带上 `!summaryFallsBackToQuota`：信息一个字不少，
      只是旧数据（无 summary）改用摘要行的样式呈现额度。
    -->
    <p v-if="summaryText" class="deal-summary" :title="summaryText">{{ summaryText }}</p>

    <div v-if="deal.quota && !summaryFallsBackToQuota" class="deal-quota">
      <span class="quota-label">免费额度</span>
      <span class="quota-value">{{ deal.quota }}</span>
    </div>

    <div v-if="visibleModels.length" class="deal-models">
      <span v-for="m in visibleModels" :key="m" class="model-chip">{{ m }}</span>
      <span v-if="restModelCount > 0" class="model-chip is-more">+{{ restModelCount }}</span>
    </div>

    <footer class="deal-foot">
      <div class="deal-stats">
        <span class="stat is-up" title="还能用"><i class="ri-thumb-up-line"></i>{{ deal.vote_up }}</span>
        <span class="stat is-down" title="已失效"><i class="ri-thumb-down-line"></i>{{ deal.vote_down }}</span>
        <span v-if="average !== null" class="stat is-rating" :title="`综合评分（${deal.rating_count} 人）`">
          <i class="ri-star-fill"></i>{{ average }}
        </span>
        <span v-else class="stat is-empty">暂无评测</span>
      </div>
      <span v-if="expiryText" class="deal-expiry" :class="{ 'is-warn': expiryWarn }">{{ expiryText }}</span>
    </footer>
  </a>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { fallbackProxyIcon } from '~/utils/favicon'

interface TokenDeal {
  id: string
  provider: string
  title: string
  // 人工核验时间轴（2026-10-20）
  verified_at?: number
  verify_age_days?: number
  verify_stale?: boolean
  verify_note?: string
  url: string
  quota?: string
  /** 一句话摘要（2026-11-04，服务端新增列）；旧数据缺失 → 不渲染摘要行 */
  summary?: string
  models?: string[]
  region?: string
  quality?: string
  source_tag?: string
  category?: string
  expires_at?: number | null
  pinned?: number
  is_expired?: boolean
  /** 1 = 进「精选对比」（仅管理员可写，公开侧只读） */
  featured?: number
  vote_up?: number
  vote_down?: number
  rating_sum?: number
  rating_count?: number
}

const props = defineProps<{ deal: TokenDeal }>()
const emit = defineEmits<{ open: [deal: TokenDeal] }>()

/**
 * 详情页的伪静态地址 —— 卡片渲染成真 `<a href>`，让爬虫有一条站内普通链接
 * 能发现 `/tokens/<id>.html`（没有它，新地址只能靠外链被发现）。
 */
const detailHref = computed(() => `/tokens/${encodeURIComponent(props.deal.id)}.html`)

/**
 * 普通左键点击 → 阻止跳转、就地打开详情弹窗（保持列表状态与原有交互）。
 * 带修饰键或中键的点击不拦截，交给浏览器在新标签页打开落地页。
 */
function onOpenClick(e: MouseEvent) {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
  e.preventDefault()
  emit('open', props.deal)
}

/**
 * 日期格式化（2026-11-04）
 *
 * 核实日期会进入 SSR 输出，而 `toLocaleDateString()` 依赖运行环境的本地时区 ——
 * 服务端（服务器时区）与浏览器（用户时区）可能算出**不同的日期**，hydration 时
 * 文本对不上（dev 报 Hydration text content mismatch，生产静默跳变一次）。
 * 站点面向中文用户，固定 Asia/Shanghai：绝大多数访客看到的日期不变，
 * 且服务端/客户端结果恒定一致。与 TokenDealDetail.vue 的 formatTime 同一口径。
 */
const SITE_TIME_ZONE = 'Asia/Shanghai'
const DEAL_DATE_FMT = new Intl.DateTimeFormat('zh-CN', {
  timeZone: SITE_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
})

/** 毫秒时间戳 → `YYYY-MM-DD`（固定时区）；非法值返回空串 */
function formatDealDate(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return ''
  const parts = DEAL_DATE_FMT.formatToParts(new Date(ts))
  const get = (type: string) => parts.find(p => p.type === type)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

const REGION_LABELS: Record<string, string> = { cn: '国内直连', global: '海外' }
const SOURCE_LABELS: Record<string, string> = {
  official: '官方直营',
  relay: '中转站',
  community: '社区转发',
}

const iconFailed = ref(false)

const icon = computed(() => fallbackProxyIcon('', props.deal.url) || '')
const initial = computed(() => (props.deal.provider || '?').trim().charAt(0).toUpperCase())
const regionLabel = computed(() => REGION_LABELS[props.deal.region || 'cn'] || '国内直连')
const sourceLabel = computed(() => SOURCE_LABELS[props.deal.source_tag || 'official'] || '官方直营')
// 分类徽标：API 额度是默认分类，不挂标；其余三类各有一句人话 + 一个配色 class
const CATEGORY_LABELS: Record<string, string> = {
  cloud: '免费云服务器',
  domain: '免费域名',
  client: '客户端额度',
}
const categoryLabel = computed(() => CATEGORY_LABELS[props.deal.category || ''] || '')
/** 配色只用 tokens.css 既有变量派生（--primary / --accent-purple / --accent-blue），不新增变量 */
const categoryClass = computed(() => {
  const c = props.deal.category
  if (c === 'cloud') return 'category-cloud'
  if (c === 'domain') return 'category-domain'
  if (c === 'client') return 'category-client'
  return ''
})

const qualityClass = computed(() => {
  const map: Record<string, string> = {
    上上品: 'q-top',
    上品: 'q-high',
    中品: 'q-mid',
    下品: 'q-low',
    下下品: 'q-bottom',
  }
  return map[props.deal.quality || '中品'] || 'q-mid'
})

/** Nexus 探测成功率，形如 8/10 */
const nexusRate = computed(() => {
  const n = props.deal.nexus
  if (!n || !n.eval_total) return ''
  return `${n.eval_ok}/${n.eval_total}`
})

/** Nexus 平均耗时，≥1s 用秒显示 */
const nexusSpeed = computed(() => {
  const ms = props.deal.nexus?.eval_avg_ms || 0
  if (ms <= 0) return ''
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
})

const visibleModels = computed(() => (props.deal.models || []).slice(0, 3))
const restModelCount = computed(() => Math.max(0, (props.deal.models || []).length - 3))

const average = computed(() => {
  const count = props.deal.rating_count || 0
  if (count <= 0) return null
  return Number(((props.deal.rating_sum || 0) / count).toFixed(1))
})

const expiryText = computed(() => {
  const ts = props.deal.expires_at
  if (!ts) return ''
  const diff = ts - Date.now()
  if (diff <= 0) return '已过期'
  const days = Math.ceil(diff / 86400000)
  return days <= 30 ? `${days} 天后到期` : ''
})

// 人工核验：最近一次「站点确认仍可用」的时间；待复核只提示，不代表已失效
/**
 * 核实状态徽标（2026-11-04，对齐对标站列表的「规则已核实 / 待复核」）
 *  - verify_stale                → 「待复核」（黄）
 *  - verified_at > 0 && !stale   → 「已核实 YYYY-MM-DD」（绿）
 *  - 其余（从未核验且服务端未判 stale）→ 不显示
 */
const verifyBadge = computed(() => {
  if (props.deal.verify_stale) return '待复核'
  const ts = Number(props.deal.verified_at || 0)
  if (Number.isFinite(ts) && ts > 0) return `已核实 ${formatDealDate(ts)}`
  return ''
})
const verifyClass = computed(() => (props.deal.verify_stale ? 'is-warn' : 'is-ok'))
const verifyTitle = computed(() => {
  const note = String(props.deal.verify_note || '').trim()
  const days = Number(props.deal.verify_age_days ?? -1)
  const ageText = !Number.isFinite(days) || days < 0
    ? '从未人工核验'
    : (days <= 0 ? '今天刚核验过' : `${days} 天前核验`)
  const head = props.deal.verify_stale
    ? `待复核：${ageText}，已超过核验阈值（默认 30 天）。这只是新鲜度提示，不代表已失效，建议结合社区投票判断`
    : `已核实：${ageText}，站点人工确认过仍可用`
  return note ? `${head}｜核验备注：${note}` : head
})

/**
 * 摘要文本：`summary` 非空用它，否则回落 `quota`（Lead 2026-11-04 确认的契约）。
 * 两者都为空 -> 空串 -> 整行不渲染（旧数据不会出现空白行）。
 */
const summaryText = computed(() => {
  const s = String(props.deal.summary || '').trim()
  return s || String(props.deal.quota || '').trim()
})

/**
 * 摘要行是否正在用 `quota` 兜底。
 * 为 true 时抑制下方「免费额度」块，避免同一个值在同一张卡上出现两次。
 */
const summaryFallsBackToQuota = computed(
  () => !String(props.deal.summary || '').trim() && !!summaryText.value,
)

const expiryWarn = computed(() => {
  const ts = props.deal.expires_at
  if (!ts) return false
  const diff = ts - Date.now()
  return diff > 0 && diff <= 3 * 86400000
})
</script>

<style scoped>
.deal-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  background: var(--surface-raised);
  border: 0.5px solid var(--border);
  border-radius: 14px;
  cursor: pointer;
  /* 根元素是 <a>：清掉浏览器默认链接色与下划线，保持原有卡片视觉 */
  color: inherit;
  text-decoration: none;
  transition: border-color 0.18s cubic-bezier(0.22, 1, 0.36, 1), background 0.18s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}
.deal-card:hover {
  border-color: var(--border-focus);
  background: var(--surface-hover);
  box-shadow: var(--shadow-md);
}
.deal-card:active {
  background: var(--surface-active);
  box-shadow: var(--shadow-sm);
}
.deal-card:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
.deal-card.is-pinned {
  border-color: color-mix(in srgb, var(--primary) 55%, var(--border));
  background: linear-gradient(160deg, color-mix(in srgb, var(--primary) 6%, var(--surface-raised)), var(--surface-raised) 55%);
}
.deal-card.is-expired {
  opacity: 0.6;
}

.deal-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}
.deal-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.deal-icon {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  object-fit: contain;
  flex-shrink: 0;
  background: var(--surface-sunken);
  box-shadow: inset 0 0 0 1px var(--border);
}
.deal-icon-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: var(--text-secondary);
}
.deal-brand-text {
  min-width: 0;
}
.deal-provider {
  margin: 0;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pin-mark {
  font-size: 11px;
  color: var(--primary);
  margin-left: 2px;
}
.deal-meta {
  margin: 0;
  font-size: 12px;
  color: var(--text-tertiary);
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.deal-category {
  flex-shrink: 0;
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 6px;
  font-weight: 600;
  /* 与站点主题同源：背景走 --primary-light，文字走 --primary */
  background: var(--primary-light);
  color: var(--primary);
}
.deal-category.category-client {
  background: color-mix(in srgb, #06b6d4 15%, transparent);
  color: #0891b2;
}
/* 免费云服务器 / 免费域名：配色同样从既有 CSS 变量派生，不新增变量 */
.deal-category.category-cloud {
  background: color-mix(in srgb, var(--accent-purple) 15%, transparent);
  color: var(--accent-purple);
}
.deal-category.category-domain {
  background: color-mix(in srgb, var(--accent-blue) 15%, transparent);
  color: var(--accent-blue);
}
.deal-quality {
  flex-shrink: 0;
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 6px;
  font-weight: 500;
}
.q-top {
  background: var(--primary);
  color: var(--text-inverse);
  font-weight: 600;
}
.q-high {
  background: var(--primary-light);
  color: var(--primary);
  font-weight: 600;
}
.q-mid {
  background: var(--surface-sunken);
  color: var(--text-secondary);
}
.q-low,
.q-bottom {
  background: color-mix(in srgb, var(--warning) 12%, transparent);
  color: var(--warning);
}

/* ── Nexus 接入状态条 ── */
.deal-nexus {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12px;
}
.nexus-tag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 7px;
  border-radius: 6px;
  font-weight: 500;
  background: var(--primary-light);
  color: var(--primary);
}
.nexus-tag i {
  font-size: 12px;
}
.deal-nexus.is-off .nexus-tag {
  background: color-mix(in srgb, var(--warning) 12%, transparent);
  color: var(--warning);
}
.deal-nexus.is-none .nexus-tag {
  background: var(--surface-sunken);
  color: var(--text-tertiary);
  font-weight: 400;
}
.nexus-stat {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}
.nexus-stat i {
  font-size: 12px;
  color: var(--text-tertiary);
}

.deal-title {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
  line-height: 1.5;
  color: var(--text-primary);
}

/* ── 一句话摘要：最多 2 行，超出省略 ── */
.deal-summary {
  margin: 0;
  font-size: 12px;
  line-height: 1.55;
  color: var(--text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.deal-quota {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 12px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--primary) 6%, var(--surface-sunken));
  border-left: 3px solid color-mix(in srgb, var(--primary) 75%, transparent);
}
.quota-label {
  font-size: 12px;
  color: var(--text-tertiary);
}
.quota-value {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
}

.deal-models {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.model-chip {
  font-size: 12px;
  padding: 2px 7px;
  border-radius: 6px;
  background: var(--surface-sunken);
  color: var(--text-secondary);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.model-chip.is-more {
  color: var(--text-tertiary);
}

.deal-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 10px;
  border-top: 0.5px solid var(--divider);
}
.deal-stats {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
}
.stat {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.stat.is-up {
  color: var(--success);
}
.stat.is-down {
  color: var(--danger);
}
.stat.is-rating {
  color: var(--warning);
}
.stat.is-empty {
  color: var(--text-tertiary);
}
.deal-expiry {
  font-size: 12px;
  color: var(--text-tertiary);
}
.deal-expiry.is-warn {
  color: var(--warning);
}
/* ── 核实状态徽标（已核实 / 待复核） ── */
.deal-verify {
  display: inline-flex;
  align-items: center;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.5;
  padding: 1px 6px;
  border-radius: 999px;
  white-space: nowrap;
}
.deal-verify.is-ok {
  color: var(--success);
  background: var(--success-soft);
}
.deal-verify.is-warn {
  color: var(--warning);
  background: var(--warning-soft);
}
</style>
