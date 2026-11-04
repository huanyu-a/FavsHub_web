<template>
  <div class="ppd-root">
    <header class="ppd-header">
      <div class="ppd-header-inner">
        <div class="ppd-header-left">
          <NuxtLink to="/" class="ppd-logo" title="返回主页">
            <img src="/images/logo.svg" alt="FavsHub" class="ppd-logo-img">
          </NuxtLink>
          <nav class="ppd-breadcrumb">
            <NuxtLink to="/prompts" class="ppd-crumb-link">PromptPro 提示词库</NuxtLink>
            <span class="ppd-crumb-sep">/</span>
            <span class="ppd-crumb-current">{{ prompt ? prompt.title : '提示词详情' }}</span>
          </nav>
        </div>
        <NuxtLink to="/prompts" class="ppd-back">
          <i class="ri-arrow-left-line"></i> 返回提示词库
        </NuxtLink>
      </div>
    </header>

    <main class="ppd-main">
      <div v-if="loadError" class="ppd-state">
        <i class="ri-error-warning-line"></i>
        <p>{{ loadError }}</p>
        <div class="ppd-state-actions">
          <button type="button" class="btn btn-primary" @click="refresh()">重试</button>
          <NuxtLink to="/prompts" class="btn btn-secondary">返回提示词库</NuxtLink>
        </div>
      </div>

      <article v-else-if="prompt" class="ppd-card">
        <h1 class="ppd-title">{{ prompt.title }}</h1>

        <div class="detail-meta">
          <span v-if="prompt.current_version" class="meta-item">
            <i class="ri-git-commit-line"></i>
            <span>v{{ prompt.current_version }}</span>
          </span>
          <span v-if="prompt.tags && prompt.tags.length" class="meta-item">
            <i class="ri-price-tag-3-line"></i>
            <span>
              <span v-for="tag in prompt.tags" :key="tag.id" class="detail-tag">{{ tag.name }}</span>
            </span>
          </span>
          <span v-if="prompt.updated_at" class="meta-item">
            <i class="ri-time-line"></i>
            <span>{{ formatTime(prompt.updated_at) }}</span>
          </span>
          <span v-if="prompt.usage_count" class="meta-item">
            <i class="ri-line-chart-line"></i>
            <span>被复制 {{ prompt.usage_count }} 次</span>
          </span>
        </div>

        <div class="prompt-detail">
          <div v-if="prompt.description" class="detail-description">
            <h4>描述</h4>
            <p>{{ prompt.description }}</p>
          </div>

          <div class="detail-content">
            <h4>内容</h4>
            <pre>{{ prompt.content }}</pre>
          </div>
        </div>

        <div class="ppd-foot">
          <button type="button" class="btn btn-primary" @click="copyContent">
            <i :class="copied ? 'ri-check-line' : 'ri-file-copy-line'"></i>
            {{ copied ? '已复制' : '复制内容' }}
          </button>
          <NuxtLink to="/prompts" class="btn btn-secondary">在提示词库中打开</NuxtLink>
        </div>
      </article>

      <SiteFooter />
    </main>
  </div>
</template>

<script setup lang="ts">
import SiteFooter from '~/components/common/SiteFooter.vue'
import { copyText } from '~/utils/clipboard'

/**
 * /prompts/<promptId>.html —— 提示词详情的伪静态落地页
 *
 * 与旧的 `/prompts?prompt_id=<id>` 的区别同 tokens：旧形态下详情模态框在
 * `<ClientOnly>` 里、内容由 onMounted 之后的 $fetch 拉取，SSR HTML 里没有正文；
 * 这里在服务端就把 /api/prompts/:id 取好并渲染出标题、描述与内容。
 *
 * 可见性沿用接口口径（管理员公开的提示词游客可读；自己的提示词需登录），
 * 因此 SSR 取数必须带上浏览器 cookie —— 见下方 useRequestFetch 说明。
 */
definePageMeta({ layout: 'default' })

interface PromptTag { id: number; name: string; color?: string }
interface Prompt {
  id: string
  title: string
  description?: string
  content: string
  current_version?: string
  usage_count?: number
  created_at?: number
  updated_at?: number
  tags?: PromptTag[]
}

const route = useRoute()
const siteBaseUrl = (useRuntimeConfig().public.baseUrl as string) || 'https://hao.bx9y.com.cn'
/** 路由参数已由 `[\w-]+` 正则限定；这里再兜一层去掉可能的 .html 后缀（防御式） */
const promptId = computed(() => decodeURIComponent(String(route.params.id ?? '')).replace(/\.html$/i, ''))

// 服务端渲染取数：走 useRequestFetch()（= event.$fetch），把入站请求头
// （cookie / user-agent）代理给内部 API —— 提示词的可见性判定依赖登录态，
// 不转发 cookie 会把「自己的私有提示词」渲染成 403，登录用户直接看到错误页。
const requestFetch = useRequestFetch()

const { data, error, refresh } = await useAsyncData(
  () => `prompt-detail:${promptId.value}`,
  () => requestFetch<{ prompt: Prompt }>(`/api/prompts/${encodeURIComponent(promptId.value)}`),
  { server: true, lazy: false },
)

const prompt = computed(() => data.value?.prompt ?? null)

const statusCode = computed(() => Number((error.value as any)?.statusCode || (error.value as any)?.status || 0))

/** 服务端如实返回 4xx（不存在 / 无权访问），避免软 404 被收录；客户端导航走内联错误态 */
if (import.meta.server && statusCode.value >= 400 && statusCode.value < 500) {
  throw createError({
    statusCode: statusCode.value,
    // 用 message 而非 statusMessage（h3 对 statusMessage 有 sanitize 计划）
    message: statusCode.value === 403 ? '无权访问此提示词' : '提示词不存在',
    data: { error: (error.value as any)?.data?.error || '提示词不存在' },
  })
}

const loadError = computed(() => {
  if (!error.value) return ''
  if (statusCode.value === 403) return '无权访问此提示词（可能属于他人，或需要登录）'
  if (statusCode.value === 404) return '提示词不存在或已被删除'
  return (error.value as any)?.data?.error || '加载失败，请稍后重试'
})

const metaDescription = computed(() => {
  const p = prompt.value
  if (!p) return 'PromptPro —— AI 提示词管理与分享平台'
  const text = String(p.description || p.content || '').replace(/\s+/g, ' ').trim()
  return text.slice(0, 150)
})

const pageTitle = computed(() => (prompt.value ? `${prompt.value.title} — PromptPro 提示词` : 'PromptPro 提示词详情'))

const canonicalUrl = computed(() => `${siteBaseUrl}/prompts/${encodeURIComponent(promptId.value)}.html`)

useHead({
  title: pageTitle,
  meta: [
    { name: 'description', content: metaDescription },
    { property: 'og:type', content: 'article' },
    { property: 'og:title', content: pageTitle },
    { property: 'og:description', content: metaDescription },
    { property: 'og:url', content: canonicalUrl },
    { name: 'twitter:card', content: 'summary' },
    { name: 'twitter:title', content: pageTitle },
    { name: 'twitter:description', content: metaDescription },
  ],
  link: [
    { rel: 'stylesheet', href: '/css/promptpro-bundle.css?v=20260830b' },
    { rel: 'canonical', href: canonicalUrl },
  ],
})

const copied = ref(false)

async function copyContent() {
  const content = prompt.value?.content || ''
  if (!content) return
  try {
    // 共用工具：http 下 navigator.clipboard 不存在，原写法会抛错被 catch 吞掉
    if (!(await copyText(content))) throw new Error('copy failed')
    copied.value = true
    setTimeout(() => { copied.value = false }, 1500)
    // 使用量上报与提示词库里的复制行为保持一致（失败不打扰用户）
    $fetch(`/api/prompts/${encodeURIComponent(promptId.value)}/usage`, { method: 'POST' }).catch(() => {})
  } catch {
    /* 剪贴板不可用（非 https / 无权限）时静默：用户可手动选择复制 */
  }
}

/**
 * 绝对日期按站点固定时区格式化为 `YYYY-MM-DD`（prompts.created_at/updated_at 是毫秒时间戳）。
 * 本页是 SSR 页面：必须固定时区，否则服务端与浏览器可能算出不同日期 → hydration 文本不一致。
 * 与 components/tokens/TokenDealDetail.vue 里的同名 helper 同一口径。
 */
const SITE_TIME_ZONE = 'Asia/Shanghai'
const DATE_FMT = new Intl.DateTimeFormat('zh-CN', {
  timeZone: SITE_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
})

function formatTime(ts?: number) {
  if (!ts) return ''
  const parts = DATE_FMT.formatToParts(new Date(ts))
  const get = (type: string) => parts.find(p => p.type === type)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')}`
}
</script>

<style scoped>
.ppd-root {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}
.ppd-header {
  width: 100%;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 100;
}
.ppd-header-inner {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 24px;
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.ppd-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.ppd-logo {
  display: flex;
  align-items: center;
  border-radius: 6px;
  transition: opacity 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}
.ppd-logo:hover { opacity: 0.7; }
.ppd-logo-img { width: 26px; height: 26px; flex-shrink: 0; }
.ppd-breadcrumb {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: 13px;
}
.ppd-crumb-link {
  color: var(--text-tertiary);
  text-decoration: none;
  white-space: nowrap;
  transition: color 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}
.ppd-crumb-link:hover { color: var(--primary); }
.ppd-crumb-sep { color: var(--text-tertiary); opacity: 0.6; }
.ppd-crumb-current {
  color: var(--text-primary);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ppd-back {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-tertiary);
  text-decoration: none;
  white-space: nowrap;
  transition: background 0.18s cubic-bezier(0.22, 1, 0.36, 1), color 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}
.ppd-back:hover { background: var(--surface-hover); color: var(--text-primary); }
.ppd-back:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }

.ppd-main {
  flex: 1;
  width: 100%;
  max-width: 860px;
  margin: 0 auto;
  padding: 24px 16px 32px;
}
.ppd-card {
  background: var(--surface-raised);
  border: 0.5px solid var(--border);
  border-radius: 14px;
  box-shadow: var(--shadow-sm, 0 1px 2px rgba(0, 0, 0, 0.04));
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.ppd-title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  line-height: 1.35;
  color: var(--text-primary);
  word-break: break-word;
}
.ppd-foot {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding-top: 4px;
  border-top: 0.5px solid var(--divider);
  margin-top: 4px;
  padding-top: 16px;
}
.ppd-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 64px 16px;
  color: var(--text-secondary);
  text-align: center;
}
.ppd-state i { font-size: 28px; color: var(--text-tertiary); }
.ppd-state p { margin: 0; }
.ppd-state-actions { display: flex; gap: 10px; margin-top: 6px; }

@media (max-width: 640px) {
  .ppd-header-inner { padding: 0 14px; }
  .ppd-main { padding: 16px 12px 24px; }
  .ppd-card { padding: 16px; }
}
</style>
