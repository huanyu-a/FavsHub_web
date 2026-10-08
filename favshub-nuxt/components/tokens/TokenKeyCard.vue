<template>
  <article class="keys-card" :class="{ 'is-dead': isDead }">
    <!-- 头：厂商首字母 fallback 块 + 名称 + 来源徽标（SOURCE_META 语义，照 local_server.py:85-89） -->
    <header class="keys-head">
      <div class="keys-brand">
        <span class="keys-icon-fallback">{{ initial }}</span>
        <h3 class="keys-provider" :title="providerName">{{ providerName }}</h3>
      </div>
      <span class="keys-src" :class="sourceMeta.cls">{{ sourceMeta.label }}</span>
    </header>

    <!-- B 类主体：脱敏形态等宽块 + 复制按钮（2026-10-08 二次调整：完整 key
         绝不明文渲染进 DOM，只经复制按钮进入剪贴板） -->
    <div v-if="!isGuide" class="keys-key">
      <i class="ri-key-2-line"></i>
      <code class="keys-key-value" :title="props.keyRow.key_masked">{{ displayKey || '••••••••' }}</code>
      <button
        v-if="copyable"
        type="button"
        class="keys-copy"
        :class="{ 'is-done': copied }"
        :title="copied ? '已复制完整 Key' : '复制完整 Key'"
        @click="copyKey"
      >
        <i :class="copied ? 'ri-check-line' : 'ri-file-copy-line'"></i>
      </button>
    </div>

    <!-- C 类主体：回帖解锁指引块（无 key 行不出 key_masked / 置信） -->
    <div v-else class="keys-guide">
      <i class="ri-lock-2-line"></i>
      <span>key 需在原帖回复后可见，点击下方链接去论坛回复领取</span>
    </div>

    <!-- B 类：API 地址（存在才渲染）+ models chips 前 3 + N（照 local_server.py:1076-1083）。
         base_url 有时把 key 写进路径/query（URL 即 key），展示时同样遮蔽 key 段 -->
    <div v-if="!isGuide && props.keyRow.base_url" class="keys-baseurl">
      <span class="keys-baseurl-label">API 地址</span>
      <span class="keys-baseurl-value">{{ displayBaseUrl }}</span>
    </div>
    <div v-if="!isGuide && visibleModels.length" class="keys-models">
      <span v-for="m in visibleModels" :key="m" class="keys-chip">{{ m }}</span>
      <span v-if="restModelCount > 0" class="keys-chip is-more">+{{ restModelCount }}</span>
    </div>

    <!-- B 类徽标行：verdict（07 F6 色语义）+ confidence（仅 B 类，照 local_server.py:1033-1037 的 C 类豁免） -->
    <div v-if="!isGuide" class="keys-badges">
      <span class="keys-badge" :class="verdictMeta.cls">{{ verdictMeta.label }}</span>
      <span class="keys-badge" :class="confidenceMeta.cls">{{ confidenceMeta.label }}</span>
    </div>

    <footer class="keys-foot">
      <a
        v-if="safeSourceUrl"
        class="keys-source"
        :href="safeSourceUrl"
        target="_blank"
        rel="noopener noreferrer nofollow"
        :title="props.keyRow.source_title || '查看原帖'"
      >
        <i class="ri-external-link-line"></i>原帖
      </a>
      <span v-if="postTimeText" class="keys-time" title="原帖发帖时间">
        <i class="ri-calendar-line"></i>{{ postTimeText }}
      </span>
      <span v-if="!isGuide && timeText" class="keys-time">
        <i class="ri-time-line"></i>{{ timeText }}
      </span>

      <!-- C 类：主按钮「去论坛回复领取」（与原帖同一 source_url，按钮强化 CTA） -->
      <a
        v-if="isGuide && safeSourceUrl"
        class="keys-cta"
        :href="safeSourceUrl"
        target="_blank"
        rel="noopener noreferrer nofollow"
      >
        <i class="ri-chat-3-line"></i>去论坛回复领取
      </a>

      <!-- B 类：主按钮「复制完整 Key」（明文仅进剪贴板，不在页面渲染） -->
      <button
        v-else-if="!isGuide && copyable"
        type="button"
        class="keys-copy-main"
        :class="{ 'is-done': copied }"
        @click="copyKey"
      >
        <i :class="copied ? 'ri-check-line' : 'ri-file-copy-line'"></i>
        {{ copied ? '已复制' : '复制 Key' }}
      </button>
    </footer>
  </article>
</template>

<script setup lang="ts">
import { computed, ref, onUnmounted } from 'vue'

interface ITokenKeyRow {
  id: string
  key_masked: string
  verdict: string
  confidence: string
  provider: string
  base_url: string
  models: string[]
  source: string
  source_id: string
  source_tid: number | null
  source_url: string
  source_title: string
  first_seen_at: number | null
  last_probe_at: number | null
  post_time: string
}

const props = defineProps<{
  keyRow: ITokenKeyRow
}>()

/** C 类（回帖指引）行没有 key，主体与脚部整体换形 */
const isGuide = computed(() => props.keyRow.source === 'reply_visible_guide')
/** dead 整卡置灰（07 F6；先例 TokenDealCard.vue is-expired / local_server.py is-dead） */
const isDead = computed(() => props.keyRow.verdict === 'dead')

/** 卡面展示：压缩脱敏形态（前 6 + … + 后 4）—— 完整 masked 串过长会撑破
    移动端卡片；title 里保留完整形态。明文绝不渲染进 DOM / SSR payload。 */
const displayKey = computed(() => {
  const m = props.keyRow.key_masked || ''
  if (!m) return ''
  if (m.length <= 18) return m
  return `${m.slice(0, 6)}…${m.slice(-4)}`
})

/** API 地址展示：遮蔽嵌在路径 / query 里的 key 段（如 https://x.site/sk-xxx），
    只留前 6 + … + 后 4，规则与卡面 masked 一致；不含 key 形态的 URL 原样显示 */
const KEY_LIKE_RE = /\b[A-Za-z0-9_\-]*(?:sk-|gsk_|xai-|fw_|hf_|pplx-|nvapi-|csk-|r8_)[A-Za-z0-9_\-]{8,}/g
const displayBaseUrl = computed(() => {
  const u = props.keyRow.base_url || ''
  return u.replace(KEY_LIKE_RE, (m) => (m.length <= 18 ? m : `${m.slice(0, 6)}…${m.slice(-4)}`))
})
/** 可复制：凡有脱敏形态的 B 类行都可复制（明文由 copy 端点按需下发） */
const copyable = computed(() => !!props.keyRow.key_masked)

/** 复制状态反馈（1.6s 后复位）；clipboard API 不可用时降级 execCommand */
const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | undefined
async function copyKey() {
  if (copied.value) return
  let text = ''
  try {
    // 完整明文只在点击瞬间经 GET /api/token-keys/:id/copy 获取，不进任何渲染状态
    const res = await $fetch<{ key_plain: string }>(`/api/token-keys/${props.keyRow.id}/copy`)
    text = res?.key_plain || ''
  } catch {
    return
  }
  if (!text) return
  let ok = false
  try {
    await navigator.clipboard.writeText(text)
    ok = true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      ok = document.execCommand('copy')
      document.body.removeChild(ta)
    } catch {
      ok = false
    }
  }
  if (ok) {
    copied.value = true
    clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => { copied.value = false }, 1600)
  }
}

/** 名称兜底链：provider → 帖标题 → 未知来源（local_server.py:91-94 无 provider 时兜底命名的先例） */
const providerName = computed(() => {
  return props.keyRow.provider?.trim() || props.keyRow.source_title?.trim() || '未知来源'
})
// 厂商首字母 fallback：**必须码点感知**取首字符 —— provider 名可能以 emoji
// （代理对）开头，charAt(0) 会截出孤立代理：SSR 侧 UTF-8 编码成 U+FFFD，
// 客户端保留半个代理对 → hydration mismatch（2026-10-08 实测修复）
const initial = computed(() => {
  const name = providerName.value || '?'
  return ([...name][0] || '?').toUpperCase()
})

// 来源徽标：post 绿 / aggregator_leak 灰 / reply_visible_guide 蓝（07 §3.2 ④ 表）
const SOURCE_META: Record<string, { label: string; cls: string }> = {
  post: { label: '帖子直提取', cls: 'src-ok' },
  aggregator_leak: { label: '聚合源泄漏', cls: 'src-muted' },
  reply_visible_guide: { label: '回帖解锁指引', cls: 'src-info' },
}
const sourceMeta = computed(() => {
  return SOURCE_META[props.keyRow.source] || { label: props.keyRow.source || '未知来源', cls: 'src-muted' }
})

// verdict 徽标：07 F6 权威口径 —— valid 绿 / quota·limited 黄 / dead 红且整卡置灰 / unknown·restricted 灰；
// 07 未点名的 blocked_by_waf·endpoint_unsupported 沿用 local_server.py:64-75 语义
const VERDICT_META: Record<string, { label: string; cls: string }> = {
  valid: { label: '有效', cls: 'is-ok' },
  limited: { label: '受限可用', cls: 'is-warn' },
  quota: { label: '额度受限', cls: 'is-warn' },
  restricted: { label: '受限', cls: 'is-muted' },
  blocked_by_waf: { label: 'WAF 拦截', cls: 'is-warn' },
  endpoint_unsupported: { label: '端点不支持', cls: 'is-muted' },
  dead: { label: '失效', cls: 'is-bad' },
  unknown: { label: '未知', cls: 'is-muted' },
}
const verdictMeta = computed(() => {
  return VERDICT_META[props.keyRow.verdict] || { label: props.keyRow.verdict || '未知', cls: 'is-muted' }
})

// confidence 徽标（(key, base_url) 配对置信度，仅 B 类）：high 绿 / medium 黄 / low 灰
const CONFIDENCE_META: Record<string, { label: string; cls: string }> = {
  high: { label: '置信 · 高', cls: 'is-ok' },
  medium: { label: '置信 · 中', cls: 'is-warn' },
  low: { label: '置信 · 低', cls: 'is-muted' },
}
const confidenceMeta = computed(() => {
  return CONFIDENCE_META[props.keyRow.confidence] || CONFIDENCE_META.low
})

const modelList = computed(() => {
  const models = props.keyRow.models
  return Array.isArray(models) ? models.filter((m) => typeof m === 'string' && m.length > 0) : []
})
const visibleModels = computed(() => modelList.value.slice(0, 3))
const restModelCount = computed(() => Math.max(0, modelList.value.length - 3))

/** 原帖链接只放行 http(s)，避免异常数据把 href 变成 javascript: 等危险协议 */
const safeSourceUrl = computed(() => {
  const url = props.keyRow.source_url || ''
  return /^https?:\/\//i.test(url) ? url : ''
})

// token_keys 时间戳为秒级（沿爬虫语义，07 §4.3），页面渲染 ×1000。
// 统一按 UTC+8（站点受众时区）用纯 UTC 算术格式化 —— getFullYear/getHours
// 这类本地时区方法在 SSR（服务器时区）与客户端（用户时区）会差 8 小时，
// 造成 hydration mismatch（2026-10-08 实测修复）。
function formatTs(ts: number | null | undefined): string {
  if (!ts || ts <= 0) return ''
  const d = new Date(ts * 1000 + 8 * 3600 * 1000)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
}

const timeText = computed(() => {
  const seen = formatTs(props.keyRow.first_seen_at)
  const probed = formatTs(props.keyRow.last_probe_at)
  if (seen && probed) return `收录 ${seen} · 探测 ${probed}`
  if (seen) return `收录 ${seen}`
  return probed ? `探测 ${probed}` : ''
})

/** 原帖发帖时间：采集端原文字符串，展示时把 ISO（lastmod 兜底路径）规整为同形 */
const postTimeText = computed(() => {
  const raw = String(props.keyRow.post_time || '').trim()
  if (!raw) return ''
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/)
  return `原帖 ${m ? `${m[1]} ${m[2]}` : raw}`
})

onUnmounted(() => clearTimeout(copiedTimer))
</script>

<style scoped>
.keys-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  background: var(--surface-raised);
  border: 0.5px solid var(--border);
  border-radius: 14px;
  min-width: 0; /* grid/flex 子项防内容撑破（移动端适配） */
  max-width: 100%;
}
/* dead 整卡置灰标红：先例 local_server.py:509 .deal-card.is-dead 与 TokenDealCard.vue:202-204 is-expired */
.keys-card.is-dead {
  opacity: 0.6;
}

/* ── 头：厂商块 + 来源徽标 ── */
.keys-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}
.keys-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.keys-icon-fallback {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: var(--text-secondary);
  background: var(--surface-sunken);
  box-shadow: inset 0 0 0 1px var(--border);
  flex-shrink: 0;
}
.keys-provider {
  margin: 0;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.keys-src {
  flex-shrink: 0;
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 6px;
  font-weight: 500;
}
.src-ok {
  background: color-mix(in srgb, var(--success) 12%, transparent);
  color: var(--success);
}
.src-muted {
  background: var(--surface-sunken);
  color: var(--text-tertiary);
}
.src-info {
  background: var(--primary-light);
  color: var(--primary);
}

/* ── B 类：完整 key 等宽块（明文公开可复制；无明文回退脱敏形态） ── */
.keys-key {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 9px 12px;
  border-radius: 10px;
  background: var(--surface-sunken);
  border: 0.5px solid var(--border);
}
.keys-key i {
  color: var(--text-tertiary);
  font-size: 14px;
  flex-shrink: 0;
  margin-top: 1px;
}
.keys-key-value {
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: 13px;
  color: var(--text-primary);
  word-break: break-all;
  min-width: 0;
  flex: 1;
}
.keys-copy {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 7px;
  border: 0.5px solid var(--border);
  background: var(--surface-raised);
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 14px;
  transition: background 0.18s cubic-bezier(0.22, 1, 0.36, 1), color 0.18s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}
.keys-copy:hover {
  color: var(--primary);
  border-color: var(--primary);
  background: var(--primary-light);
}
.keys-copy.is-done {
  color: var(--success);
  border-color: var(--success);
}
.keys-copy:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}

/* ── C 类：回帖解锁指引块（风格对齐 TokenDealCard 的 deal-quota 软底语法） ── */
.keys-guide {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--primary) 6%, var(--surface-sunken));
  border-left: 3px solid color-mix(in srgb, var(--primary) 75%, transparent);
  font-size: 13px;
  line-height: 1.55;
  color: var(--text-secondary);
}
.keys-guide i {
  color: var(--primary);
  font-size: 15px;
  margin-top: 1px;
}

/* ── B 类：API 地址 + models chips ── */
.keys-baseurl {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  min-width: 0;
  flex-wrap: wrap;
}
.keys-baseurl-label {
  color: var(--text-tertiary);
  flex-shrink: 0;
}
.keys-baseurl-value {
  color: var(--text-secondary);
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}
.keys-models {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.keys-chip {
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
.keys-chip.is-more {
  color: var(--text-tertiary);
}

/* ── 徽标行：verdict + confidence ── */
.keys-badges {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.keys-badge {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 6px;
  font-weight: 500;
}
.is-ok {
  background: color-mix(in srgb, var(--success) 12%, transparent);
  color: var(--success);
}
.is-warn {
  background: color-mix(in srgb, var(--warning) 12%, transparent);
  color: var(--warning);
}
.is-bad {
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  color: var(--danger);
}
.is-muted {
  background: var(--surface-sunken);
  color: var(--text-tertiary);
}

/* ── 脚：原帖链接 + 时间 + 揭示按钮 / 领取 CTA ── */
.keys-foot {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding-top: 10px;
  border-top: 0.5px solid var(--divider);
  margin-top: auto;
}
.keys-source {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 12px;
  color: var(--text-tertiary);
  text-decoration: none;
  transition: color 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}
.keys-source:hover { color: var(--primary); }
.keys-source i { font-size: 13px; }
.keys-time {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 12px;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}
.keys-time i { font-size: 13px; }

/* C 类主按钮：主色实底，风格对齐 index.vue 的 .hero-publish */
.keys-cta {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 7px 14px;
  border-radius: 10px;
  border: 0.5px solid var(--primary);
  background: var(--primary);
  color: var(--text-inverse);
  font-size: 12px;
  font-weight: 600;
  text-decoration: none;
  transition: background 0.18s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.18s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}
.keys-cta:hover {
  background: var(--primary-hover);
  border-color: var(--primary-hover);
  box-shadow: var(--shadow-sm);
}
.keys-cta:active { background: var(--primary-dark); border-color: var(--primary-dark); }
.keys-cta:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}

/* B 类复制主按钮：主色实底 CTA（对齐 C 类 keys-cta 等位） */
.keys-copy-main {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 7px 14px;
  border-radius: 10px;
  border: 0.5px solid var(--primary);
  background: var(--primary);
  color: var(--text-inverse);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.18s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.18s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}
.keys-copy-main:hover {
  background: var(--primary-hover);
  border-color: var(--primary-hover);
  box-shadow: var(--shadow-sm);
}
.keys-copy-main:active { background: var(--primary-dark); border-color: var(--primary-dark); }
.keys-copy-main.is-done {
  background: color-mix(in srgb, var(--success) 90%, transparent);
  border-color: var(--success);
}
.keys-copy-main:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
.keys-copy-main i { font-size: 13px; }

/* ── 移动端：主按钮整行、时间行可换行（768px 与 keys 页断点一致） ── */
@media (max-width: 480px) {
  .keys-copy-main,
  .keys-cta {
    width: 100%;
    justify-content: center;
    margin-left: 0;
    margin-top: 2px;
  }
  .keys-foot {
    gap: 8px;
  }
}
</style>
