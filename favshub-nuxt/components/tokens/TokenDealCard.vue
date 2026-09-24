<template>
  <article
    class="deal-card"
    :class="{ 'is-pinned': deal.pinned, 'is-expired': deal.is_expired }"
    @click="$emit('open', deal)"
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
          <p class="deal-meta">{{ regionLabel }} · {{ sourceLabel }}</p>
        </div>
      </div>
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

    <div v-if="deal.quota" class="deal-quota">
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
  </article>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { fallbackProxyIcon } from '~/utils/favicon'

interface TokenDeal {
  id: string
  provider: string
  title: string
  url: string
  quota?: string
  models?: string[]
  region?: string
  quality?: string
  source_tag?: string
  expires_at?: number | null
  pinned?: number
  is_expired?: boolean
  vote_up?: number
  vote_down?: number
  rating_sum?: number
  rating_count?: number
}

const props = defineProps<{ deal: TokenDeal }>()
defineEmits<{ open: [deal: TokenDeal] }>()

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
  padding: 14px 16px;
  background: var(--surface-raised);
  border: 0.5px solid var(--border);
  border-radius: var(--radius-lg);
  cursor: pointer;
  transition: border-color 0.18s, background 0.18s, transform 0.18s, box-shadow 0.18s;
}
.deal-card:hover {
  border-color: var(--border-focus);
  background: var(--surface-hover);
  transform: translateY(-2px);
  box-shadow: 0 10px 24px -10px var(--shadow-color);
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
  width: 26px;
  height: 26px;
  border-radius: 7px;
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
}

.deal-quality {
  flex-shrink: 0;
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 6px;
  font-weight: 500;
}
.q-top {
  background: linear-gradient(135deg, var(--primary), color-mix(in srgb, var(--primary) 72%, var(--primary-dark)));
  color: var(--text-inverse);
  font-weight: 600;
  box-shadow: 0 2px 6px -1px color-mix(in srgb, var(--primary) 45%, transparent);
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
  background: rgba(245, 158, 11, 0.12);
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
  background: rgba(245, 158, 11, 0.12);
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

.deal-quota {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 12px;
  border-radius: var(--radius-md);
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
</style>
