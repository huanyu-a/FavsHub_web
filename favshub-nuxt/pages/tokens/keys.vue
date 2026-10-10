<template>
  <div>
    <header class="tokens-header">
      <div class="tokens-header-inner">
        <div class="tokens-header-left">
          <NuxtLink to="/" class="tokens-header-logo" title="返回主页">
            <img src="/images/logo.svg" alt="Logo" class="tokens-header-logo-img">
          </NuxtLink>
          <h1 class="tokens-header-title"><i class="ri-key-2-line"></i> 福利 Key</h1>
        </div>
        <nav class="tokens-header-nav">
          <NuxtLink to="/" class="tokens-header-link" title="主页">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
            <span>主页</span>
          </NuxtLink>
          <NuxtLink to="/collections" class="tokens-header-link">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/><path d="M8 7h6"/><path d="M8 11h8"/></svg>
            <span>精选集</span>
          </NuxtLink>
          <!-- 反向互链：福利 Key → 白嫖通告，与 /tokens 页头 tab 双向闭环 -->
          <NuxtLink to="/tokens" class="tokens-header-link">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="13" rx="2"/><path d="M12 8v13"/><path d="M19 12v3"/><path d="M5 12v3"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/></svg>
            <span>白嫖通告</span>
          </NuxtLink>
          <NuxtLink to="/tokens/keys" class="tokens-header-link active">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
            <span>福利 Key</span>
          </NuxtLink>
          <NuxtLink to="/prompts" class="tokens-header-link">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/></svg>
            <span>提示词</span>
          </NuxtLink>
          <!-- 评测看板是服务器上的独立静态页（非 Nuxt 路由）→ 用原生 a 触发整页加载，避免 router 匹配失败 -->
          <a href="/tokens/eval/" class="tokens-header-link" title="Nexus 模型评测看板">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>
            <span>评测看板</span>
          </a>
        </nav>
      </div>
    </header>

    <div class="tokens-page">
      <!-- ① 免责声明条：D12 原文逐字（07 §8.5 第 4 条），常驻第一视觉位，不可关闭 -->
      <div class="keys-disclaimer" role="note">
        <i class="ri-error-warning-line"></i>
        <span>内容来自第三方论坛公开帖，仅供测试，如有侵权请联系删除</span>
      </div>

      <!-- 错误态：不渲染任何部分数据，防半截页面误导 -->
      <div v-if="error" class="keys-error" role="alert">
        <i class="ri-error-warning-line"></i>
        <p>数据加载失败，请稍后刷新</p>
        <button type="button" @click="refresh()">重试</button>
      </div>

      <template v-else>
        <!-- ⓪ Hero：价值主张 + 新鲜度承诺（营销位；免责声明仍在其上方保持第一视觉位） -->
        <section class="keys-hero">
          <div class="keys-hero-text">
            <h2 class="keys-hero-title"><i class="ri-key-2-line"></i> 免费 API Key，探活即用</h2>
            <p class="keys-hero-sub">
              爬虫每 3 小时抓取论坛公开帖并自动探测有效性——当前收录 <b>{{ pagination.total }}</b> 条，
              探测确认有效 <b>{{ validCount }}</b> 条。一键复制，填入任意 OpenAI 兼容客户端即可使用。
            </p>
          </div>
          <div class="keys-hero-badge" title="爬虫定时任务每 3 小时运行一轮">
            <span class="keys-hero-dot"></span> 每 3 小时自动探测
          </div>
        </section>

        <!-- ⓪.5 三步上手（转化引导：拿到 key 后立刻知道怎么用） -->
        <ol class="keys-howto">
          <li><span class="keys-howto-step">1</span> 复制 Key</li>
          <li><span class="keys-howto-step">2</span> 复制 API 地址</li>
          <li><span class="keys-howto-step">3</span> 填入 Cherry Studio / NextChat 等 OpenAI 兼容客户端</li>
        </ol>

        <!-- ② 统计条：总数 / 有效 / 未验证来自 verdict_counts（已展示口径全集），附数据截至 -->
        <div class="keys-stats">
          <span class="keys-stat">共 <b>{{ pagination.total }}</b> 条</span>
          <span class="keys-sep">·</span>
          <span class="keys-stat is-valid">有效 <b>{{ validCount }}</b></span>
          <span class="keys-sep">·</span>
          <span class="keys-stat is-unknown-stat">待验证 <b>{{ unknownCount }}</b></span>
          <span v-if="lastUpdatedText" class="keys-updated">数据截至 {{ lastUpdatedText }}</span>
        </div>

        <!-- ②.5 状态图例：解释「未知/待验证」≠失效，降低用户把灰徽标误读为坏 key 的概率 -->
        <div class="keys-legend" role="note">
          <i class="ri-information-line"></i>
          <span><b>有效</b>＝探测确认可用 · <b>受限/额度</b>＝可用但有条件 · <b>待验证</b>＝尚未探出结果（不代表失效）</span>
        </div>

        <!-- ③ 筛选器：状态下拉（计数后缀，dead 殿后标红）+ 厂商输入（300ms debounce） -->
        <div class="keys-filterbar">
          <label class="keys-filter-select">
            <span class="sr-only">状态筛选</span>
            <select v-model="verdict">
              <option value="">全部状态</option>
              <option
                v-for="opt in VERDICT_OPTIONS"
                :key="opt.value"
                :value="opt.value"
                :class="{ 'is-dead-opt': opt.danger }"
              >
                {{ opt.danger ? '● ' : '' }}{{ opt.label }} · {{ verdictCounts[opt.value] || 0 }}
              </option>
            </select>
          </label>
          <label class="keys-filter-search">
            <i class="ri-search-line"></i>
            <input v-model="providerInput" type="text" placeholder="按厂商筛选，如 OpenRouter" @input="debouncedProvider">
          </label>
        </div>

        <!-- 加载状态：骨架屏 -->
        <div v-if="loading" class="keys-grid" aria-hidden="true">
          <div v-for="i in 6" :key="i" class="keys-skeleton">
            <div class="sk-row">
              <div class="sk sk-avatar"></div>
              <div class="sk sk-line w-45"></div>
              <div class="sk sk-badge"></div>
            </div>
            <div class="sk sk-masked"></div>
            <div class="sk-row">
              <div class="sk sk-badge"></div>
              <div class="sk sk-badge"></div>
            </div>
            <div class="sk sk-line w-55 sk-foot"></div>
          </div>
        </div>

        <!-- 空状态：无数据 / 筛选无结果 双文案 -->
        <div v-else-if="keys.length === 0" class="keys-empty">
          <i class="ri-inbox-line"></i>
          <p>{{ hasFilter ? '没有符合条件的记录' : '暂无福利 Key 记录' }}</p>
          <span>{{ hasFilter ? '试试放宽筛选条件' : '爬虫每 3 小时抓取一轮，敬请期待' }}</span>
        </div>

        <!-- ④ 卡片列表：B 类 key 卡（完整 key 可复制）/ C 类指引卡 -->
        <div v-else class="keys-grid">
          <TokenKeyCard
            v-for="k in keys"
            :key="k.id"
            :key-row="k"
            :my-vote="myVotes[k.id] || null"
          />
        </div>

        <!-- ⑤ 分页 -->
        <div v-if="pagination.totalPages > 1" class="pagination">
          <button :disabled="pagination.page <= 1" @click="prevPage">上一页</button>
          <span class="page-info">{{ pagination.page }} / {{ pagination.totalPages }}</span>
          <button :disabled="pagination.page >= pagination.totalPages" @click="nextPage">下一页</button>
        </div>
      </template>

      <BackToTop />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import TokenKeyCard from '~/components/tokens/TokenKeyCard.vue'
import BackToTop from '~/components/BackToTop.vue'

definePageMeta({ layout: 'default' })

// 与 components/tokens/TokenKeyCard.vue 各自维护同构接口（照 index.vue / TokenDealCard.vue 的既有惯例）；
// 字段 = F3 GET /api/token-keys 白名单（docs/08 §4.2 + 2026-10-08 增量 key_plain/post_time），
// 敏感列（key_encrypted/key_hash）根本不在响应里
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
  copy_count: number
  /** 可用性投票计数（站点本地维护，key-votes.ts 事务内重算）；非敏感 */
  vote_up: number
  vote_down: number
}

interface IPagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

interface IKeysResponse {
  keys: ITokenKeyRow[]
  pagination: IPagination
  verdict_counts: Record<string, number>
}

const _keysBase = (useRuntimeConfig().public.baseUrl as string) || 'https://hao.bx9y.com.cn'
const keysBaseUrl = computed(() => `${_keysBase}/tokens/keys`)

const keysTitle = '福利 Key — 免费 API Key 时效看板'
const keysDesc = '来自第三方论坛公开帖的免费 API Key 时效看板：Key 一键复制（页面不直接显示明文）、原帖时间可溯、厂商与状态筛选、有效性探测实时更新，失效 Key 自动清理，回帖领取指引一页看全。'
const keysKw = '免费API Key,福利Key,免费大模型API,API白嫖,Key复制,额度查询'

useHead({
  title: keysTitle,
  meta: [
    { name: 'description', content: keysDesc },
    { name: 'keywords', content: keysKw },
    { property: 'og:site_name', content: 'FavsHub' },
    { property: 'og:title', content: keysTitle },
    { property: 'og:description', content: keysDesc },
    { property: 'og:type', content: 'website' },
    { property: 'og:url', content: keysBaseUrl },
    { property: 'og:locale', content: 'zh_CN' },
    { name: 'twitter:card', content: 'summary' },
    { name: 'twitter:title', content: keysTitle },
    { name: 'twitter:description', content: keysDesc },
  ],
  link: [
    { rel: 'canonical', href: keysBaseUrl },
  ],
})

const verdict = ref('')
const providerInput = ref('')
const provider = ref('')
const page = ref(1)
const limit = 24

let providerTimeout: ReturnType<typeof setTimeout>

// 服务端预取 + 客户端复用，避免 SSR 空白闪烁（照 index.vue:268-273）
const { data, refresh, pending, error } = await useFetch<IKeysResponse>('/api/token-keys', {
  query: { page, limit, verdict, provider },
  server: true,
  lazy: false,
  getCachedData: (key, nuxtApp) => nuxtApp.payload?.data?.[key],
})

const loading = computed(() => pending.value)
const keys = computed(() => data.value?.keys || [])
const pagination = computed(() => data.value?.pagination || { page: 1, limit, total: 0, totalPages: 1 })
const verdictCounts = computed(() => data.value?.verdict_counts || {})
const validCount = computed(() => verdictCounts.value.valid || 0)
const unknownCount = computed(() => verdictCounts.value.unknown || 0)
const hasFilter = computed(() => !!(verdict.value || provider.value))

// ── 可用性投票（2026-10-10）────────────────────────────────────
// 列表接口走 CDN 公开缓存（public, max-age=300）且与登录态零相关，不含 my_vote；
// 卡片高亮由这里在挂载后批量补拉一次（每页一条请求），避免 per-user 数据污染
// 共享缓存（对照 copy 端点「按需下发明文」的同款思路）。
const myVotes = ref<Record<string, 'up' | 'down'>>({})

async function loadMyVotes() {
  const ids = keys.value.map((k) => k.id).filter(Boolean)
  if (!ids.length) {
    myVotes.value = {}
    return
  }
  try {
    const res = await $fetch<{ votes: Record<string, 'up' | 'down'> }>('/api/token-keys/my-votes', {
      query: { ids: ids.join(',') },
      credentials: 'include',
    })
    myVotes.value = res?.votes || {}
  } catch {
    // 补拉失败不影响浏览：卡片按「未投」渲染，投票后仍能正确回显
    myVotes.value = {}
  }
}

// 仅客户端：SSR 阶段无 cookie 语义差异可言，且挂载后拉取可与页面数据解耦
onMounted(loadMyVotes)
// 翻页 / 筛选导致列表变化后重拉（useFetch 的 query 变化 → data 变化）
watch(keys, () => { loadMyVotes() })

/** 数据截至：行内最大 last_probe_at，无探测数据时取最早 first_seen_at（docs/08 §3.2 ②） */
const lastUpdatedText = computed(() => {
  let maxProbe = 0
  let minSeen = 0
  for (const r of keys.value) {
    if (r.last_probe_at && r.last_probe_at > maxProbe) maxProbe = r.last_probe_at
    if (r.first_seen_at && (minSeen === 0 || r.first_seen_at < minSeen)) minSeen = r.first_seen_at
  }
  return formatTs(maxProbe || minSeen)
})

// token_keys 时间戳为秒级，页面渲染 ×1000；统一 UTC+8 纯算术（与
// TokenKeyCard.formatTs 同步），避免 SSR/客户端时区差异的 hydration mismatch
function formatTs(ts: number | null | undefined): string {
  if (!ts || ts <= 0) return ''
  const d = new Date(ts * 1000 + 8 * 3600 * 1000)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
}

// 状态下拉：dead 已被服务端恒定清理（不返回、不入统计），故不提供该选项；
// 计数后缀取 verdict_counts 已展示口径
const VERDICT_OPTIONS: Array<{ value: string; label: string; danger?: boolean }> = [
  { value: 'valid', label: '有效(valid)' },
  { value: 'limited', label: '受限可用(limited)' },
  { value: 'quota', label: '额度受限(quota)' },
  { value: 'unknown', label: '未知(unknown)' },
  { value: 'restricted', label: '受限(restricted)' },
  { value: 'blocked_by_waf', label: 'WAF 拦截(blocked_by_waf)' },
  { value: 'endpoint_unsupported', label: '端点不支持(endpoint_unsupported)' },
  { value: 'tls_invalid', label: 'TLS 异常(tls_invalid)' },
]

/** 厂商输入 300ms debounce，归一后触发重新请求（照 index.vue:280-283） */
function debouncedProvider() {
  clearTimeout(providerTimeout)
  providerTimeout = setTimeout(() => {
    provider.value = providerInput.value.trim()
    page.value = 1
  }, 300)
}

function prevPage() {
  if (page.value > 1) page.value--
}

function nextPage() {
  if (page.value < pagination.value.totalPages) page.value++
}

// 翻页 / 筛选变化自动重新请求（照 index.vue:338；provider 经 debounce 改写后同批触发一次）
watch([page, verdict, provider], () => refresh())

onUnmounted(() => {
  clearTimeout(providerTimeout)
})
</script>

<style scoped>
.tokens-header {
  width: 100%;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 100;
}
.tokens-header-inner {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 24px;
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: nowrap;
  white-space: nowrap;
}
.tokens-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}
.tokens-header-logo {
  display: flex;
  align-items: center;
  text-decoration: none;
  border-radius: 6px;
  transition: opacity 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}
.tokens-header-logo:hover { opacity: 0.7; }
.tokens-header-logo:active { opacity: 0.6; }
.tokens-header-logo:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
.tokens-header-logo-img {
  width: 26px;
  height: 26px;
  flex-shrink: 0;
}
.tokens-header-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: -0.01em;
}
.tokens-header-title i {
  font-size: 15px;
  color: var(--primary);
  margin-right: 2px;
}
.tokens-header-nav {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-wrap: nowrap;
}
.tokens-header-link {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 10px;
  border-radius: 6px;
  text-decoration: none;
  color: var(--text-tertiary);
  font-size: 13px;
  font-weight: 500;
  transition: background 0.18s cubic-bezier(0.22, 1, 0.36, 1), color 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}
.tokens-header-link svg {
  width: 15px;
  height: 15px;
  opacity: 0.7;
}
.tokens-header-link:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}
.tokens-header-link:hover svg { opacity: 1; }
.tokens-header-link:active { background: var(--surface-active); }
.tokens-header-link:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
.tokens-header-link.active {
  color: var(--primary);
  background: var(--primary-light);
}
.tokens-header-link.active svg { opacity: 1; }

.tokens-page {
  max-width: 1200px;
  margin: 0 auto;
  padding: 24px;
}

/* ── ① 免责声明条：warning 软底，风格对齐 TokenDealCard q-low/q-bottom 徽标语法 ── */
.keys-disclaimer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--warning) 12%, transparent);
  color: var(--warning);
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 16px;
}
.keys-disclaimer i {
  font-size: 16px;
  flex-shrink: 0;
}

/* ── ⓪ Hero：价值主张 + 新鲜度承诺（营销位） ── */
.keys-hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px 20px;
  flex-wrap: wrap;
  background: var(--surface-raised);
  border: 0.5px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 18px 22px;
  margin-bottom: 12px;
}
.keys-hero-text {
  flex: 1 1 320px;
  min-width: 0;
}
.keys-hero-title {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0 0 6px;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--text-primary);
}
.keys-hero-title i {
  color: var(--primary);
  font-size: 19px;
}
.keys-hero-sub {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  max-width: 640px;
  color: var(--text-secondary);
}
.keys-hero-sub b {
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}
.keys-hero-badge {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--success);
  background: color-mix(in srgb, var(--success) 10%, transparent);
  border: 0.5px solid color-mix(in srgb, var(--success) 32%, transparent);
  padding: 6px 12px;
  border-radius: 999px;
  white-space: nowrap;
}
.keys-hero-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--success);
  animation: keys-pulse 2.4s ease-in-out infinite;
}
@keyframes keys-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.8); }
}
/* 尊重 prefers-reduced-motion：脉冲点静止但保留颜色语义 */
@media (prefers-reduced-motion: reduce) {
  .keys-hero-dot { animation: none; }
}

/* ── ⓪.5 三步上手 ── */
.keys-howto {
  display: flex;
  align-items: center;
  gap: 8px 22px;
  flex-wrap: wrap;
  list-style: none;
  margin: 0 0 14px;
  padding: 0;
  font-size: 12.5px;
  color: var(--text-secondary);
}
.keys-howto li {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}
.keys-howto-step {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 700;
  color: var(--primary);
  background: var(--primary-light);
}

/* ── ② 统计条 ── */
.keys-stats {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 10px 14px;
  background: var(--surface-raised);
  border: 0.5px solid var(--border);
  border-radius: 10px;
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 12px;
}
.keys-stat b {
  font-weight: 600;
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}
.keys-stat.is-valid b { color: var(--success); }
.keys-stat.is-unknown-stat b { color: var(--text-primary); }
.keys-sep { color: var(--text-tertiary); }
.keys-updated {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}

/* ── ②.5 状态图例：一行说明各徽标语义，降低「未知」被误读为失效的概率 ── */
.keys-legend {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 0 0;
  font-size: 12px;
  color: var(--text-tertiary);
  line-height: 1.5;
}
.keys-legend i { font-size: 14px; flex-shrink: 0; }
.keys-legend b { color: var(--text-secondary); font-weight: 500; }

/* ── ③ 筛选器（状态 + 厂商，内联控件不复用 TokenFilterBar——其三 v-model 语义不合） ── */
.keys-filterbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 12px 0;
  border-bottom: 0.5px solid var(--divider);
  margin-bottom: 16px;
}
.keys-filter-select select {
  font-size: 12px;
  padding: 6px 12px;
  border-radius: 10px;
  border: 0.5px solid var(--border);
  background: var(--surface-raised);
  color: var(--text-secondary);
  cursor: pointer;
  transition: border-color 0.18s cubic-bezier(0.22, 1, 0.36, 1), color 0.18s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}
.keys-filter-select select:hover {
  color: var(--text-primary);
  border-color: var(--border-focus);
}
.keys-filter-select select:focus {
  outline: none;
  border-color: var(--border-focus);
  box-shadow: 0 0 0 3px var(--primary-light);
}
/* dead 选项殿后标红：原生 option 着色为渐进增强，基础态以「●」前缀保证可见 */
.keys-filter-select select option.is-dead-opt {
  color: var(--danger);
  font-weight: 600;
}
.keys-filter-search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  border: 0.5px solid var(--border);
  border-radius: 10px;
  background: var(--surface);
  flex: 0 1 280px;
  min-width: 200px;
  transition: border-color 0.18s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}
.keys-filter-search:focus-within {
  border-color: var(--border-focus);
  box-shadow: 0 0 0 3px var(--primary-light);
}
.keys-filter-search i {
  color: var(--text-tertiary);
  font-size: 15px;
}
.keys-filter-search input {
  border: none;
  background: none;
  outline: none;
  font-size: 13px;
  width: 100%;
  color: var(--text-primary);
}
.keys-filter-search input::placeholder { color: var(--text-tertiary); }
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

/* ── ④ 卡片网格（照 .tokens-grid index.vue:629-633） ──
   min(300px, 100%) 防窄屏下最小列宽撑破容器；子项 min-width:0 防内容
   （长 URL / 长 masked 串）把 grid item 撑出屏幕（移动端适配关键） */
.keys-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(300px, 100%), 1fr));
  gap: 16px;
  margin-bottom: 28px;
}
.keys-grid > * {
  min-width: 0;
}

/* ── 加载态骨架屏（结构照 index.vue:74-89） ── */
.keys-skeleton {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  background: var(--surface-raised);
  border: 0.5px solid var(--border);
  border-radius: 14px;
}
.sk {
  border-radius: 6px;
  background: linear-gradient(90deg, var(--surface-sunken) 25%, var(--surface-hover) 50%, var(--surface-sunken) 75%);
  background-size: 200% 100%;
  animation: keys-sk-shimmer 1.4s ease-in-out infinite;
}
.sk-row { display: flex; align-items: center; gap: 8px; }
.sk-avatar { width: 28px; height: 28px; border-radius: 6px; }
.sk-line { height: 12px; }
.sk-line.w-45 { width: 45%; }
.sk-line.w-55 { width: 55%; }
.sk-badge { width: 64px; height: 20px; border-radius: 6px; }
.sk-masked { height: 40px; border-radius: 10px; }
.sk-foot { margin-top: 2px; }
@keyframes keys-sk-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* ── 空态 / 错误态 ── */
.keys-empty,
.keys-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 64px 20px;
  color: var(--text-tertiary);
  background: var(--surface-raised);
  border: 1px dashed var(--border);
  border-radius: 14px;
  margin-bottom: 28px;
}
.keys-empty i,
.keys-error i {
  font-size: 36px;
  margin-bottom: 8px;
}
.keys-empty p,
.keys-error p {
  font-size: 14px;
  font-weight: 500;
  margin: 0;
  color: var(--text-secondary);
}
.keys-empty span {
  font-size: 12px;
  margin-top: 4px;
}
.keys-error i { color: var(--danger); }
.keys-error button {
  margin-top: 14px;
  padding: 7px 18px;
  border: 0.5px solid var(--border);
  border-radius: 10px;
  background: var(--surface-raised);
  font-size: 13px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: color 0.18s cubic-bezier(0.22, 1, 0.36, 1), background 0.18s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}
.keys-error button:hover {
  color: var(--primary);
  border-color: var(--border-focus);
  background: var(--surface-hover);
}
.keys-error button:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}

/* ── ⑤ 分页（照 index.vue:699-734） ── */
.pagination {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
}
.pagination button {
  padding: 8px 16px;
  border: 0.5px solid var(--border);
  border-radius: 10px;
  background: var(--surface-raised);
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  font-size: 13px;
  color: var(--text-secondary);
  transition: color 0.18s cubic-bezier(0.22, 1, 0.36, 1), background 0.18s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}
.pagination button:not(:disabled):hover {
  color: var(--primary);
  background: var(--surface-hover);
  box-shadow: var(--shadow-md);
}
.pagination button:not(:disabled):active { background: var(--surface-active); }
.pagination button:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
.pagination button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.page-info {
  font-size: 12px;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

/* ── 移动端适配（断点与 index.vue:756-801 一致） ── */
@media (max-width: 1024px) {
  .tokens-page {
    padding: 72px 16px 96px;
  }
}
@media (max-width: 768px) {
  .tokens-header {
    display: none;
  }
  .tokens-page {
    padding: 68px 12px 96px;
  }
  .keys-grid {
    grid-template-columns: 1fr;
  }
  .keys-updated {
    margin-left: 0;
  }
  .keys-legend {
    flex-wrap: wrap;
  }
  .keys-hero {
    padding: 14px 16px;
  }
  .keys-hero-title { font-size: 16px; }
  .keys-howto {
    flex-direction: column;
    align-items: flex-start;
    gap: 7px;
  }
}
@media (max-width: 480px) {
  .tokens-page {
    padding: 60px 10px 96px;
  }
  .tokens-header-title {
    font-size: 14px;
  }
}
</style>
