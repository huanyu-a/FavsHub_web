<template>
  <div>
    <!--
      模块页头：与 components/tokens/TokenDealsBoard.vue 的 .tokens-header 是同一份
      静态标记（本仓既有惯例：pages/tokens/keys.vue 也自持一份）。
      改动页头请两边一起改，避免两处导航漂移。
    -->
    <header class="tokens-header">
      <div class="tokens-header-inner">
        <div class="tokens-header-left">
          <NuxtLink to="/" class="tokens-header-logo" title="返回主页">
            <img src="/images/logo.svg" alt="FavsHub" class="tokens-header-logo-img">
          </NuxtLink>
          <span class="tokens-header-title"><i class="ri-gift-2-line"></i> Token 白嫖通告</span>
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
          <NuxtLink to="/tokens" class="tokens-header-link">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="13" rx="2"/><path d="M12 8v13"/><path d="M19 12v3"/><path d="M5 12v3"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/></svg>
            <span>白嫖通告</span>
          </NuxtLink>
          <!-- 精选对比（2026-11-04）：顶部导航不再列出 —— 该功能已并入 /tokens 页底部，
               本页仅作为老链接/外链/搜索收录的落点保留。 -->
          <NuxtLink to="/tokens/keys" class="tokens-header-link" title="福利 Key">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
            <span>福利 Key</span>
          </NuxtLink>
          <NuxtLink to="/prompts" class="tokens-header-link">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/></svg>
            <span>提示词</span>
          </NuxtLink>
          <a href="/tokens/eval/" class="tokens-header-link" title="Nexus 模型评测看板">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>
            <span>评测看板</span>
          </a>
        </nav>
      </div>
    </header>

    <div class="tokens-page">
      <section class="cmp-hero">
        <h1 class="cmp-title">精选对比</h1>
        <p class="cmp-sub">
          把几条值得优先考虑的免费资源放在一张表里逐项对照：能给多少额度、领取要什么条件、有哪些限制、有效期到什么时候、最近一次核实是哪天。
        </p>
        <p class="cmp-note">
          「最近核实」是站点人工确认「此时此刻仍然可用」的日期，超过阈值未核实的会标为待复核。
          具体规则以官方页面为准。
        </p>
        <NuxtLink to="/tokens" class="cmp-back">
          <i class="ri-arrow-left-line"></i> 返回通告列表
        </NuxtLink>
      </section>

      <!-- 表格本体已抽到 components/tokens/TokenCompareTable.vue（2026-11-04）：
           用户要求把「精选对比」并入 /tokens 页，抽出组件后两处共用同一份实现，
           避免页头/样式/口径漂移。本页仍保留独立路由，作为老链接与搜索收录的落点。 -->
      <TokenCompareTable :deals="featuredDeals" :pending="pending" />

      <BackToTop />
    </div>

    <SiteFooter />
  </div>
</template>

<script setup lang="ts">
import BackToTop from '~/components/BackToTop.vue'
import SiteFooter from '~/components/common/SiteFooter.vue'
import TokenCompareTable, { type IFeaturedDeal } from '~/components/tokens/TokenCompareTable.vue'

definePageMeta({ layout: 'default' })

const _base = (useRuntimeConfig().public.baseUrl as string) || 'https://hao.bx9y.com.cn'
const pageUrl = `${_base}/tokens/compare`

const pageTitle = '精选对比 — 免费 AI 额度 / 服务器 / 域名逐项对照'
const pageDesc = '把值得优先考虑的免费资源放在一张表里对照：额度、领取条件、限制条款、有效期与最近核实日期，一眼看清哪条更适合自己。'
const pageKw = '免费额度对比,免费API对比,免费服务器对比,白嫖资源对比'

useHead({
  title: pageTitle,
  meta: [
    { name: 'description', content: pageDesc },
    { name: 'keywords', content: pageKw },
    { property: 'og:site_name', content: 'FavsHub' },
    { property: 'og:title', content: pageTitle },
    { property: 'og:description', content: pageDesc },
    { property: 'og:type', content: 'website' },
    { property: 'og:url', content: pageUrl },
    { property: 'og:locale', content: 'zh_CN' },
    { property: 'og:image', content: `${_base}/images/og-cover-tokens.png` },
    { property: 'og:image:secure_url', content: `${_base}/images/og-cover-tokens.png` },
    { property: 'og:image:alt', content: '精选免费资源对比表' },
    { name: 'twitter:card', content: 'summary' },
    { name: 'twitter:title', content: pageTitle },
    { name: 'twitter:description', content: pageDesc },
    { name: 'twitter:image', content: `${_base}/images/og-cover-tokens.png` },
  ],
  link: [
    { rel: 'canonical', href: pageUrl },
  ],
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

/* ── 页头 ── */
.cmp-hero {
  background: var(--surface-raised);
  border: 0.5px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 20px 24px;
  margin-bottom: 20px;
}
/* 返回列表（2026-11-04）：用户反馈「无法回到 /tokens」，
   这里除了顶部导航与页脚，再给一个紧跟本页标题的显式出口 */
.cmp-back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 12px;
  padding: 5px 11px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-muted);
  font-size: 13px;
  text-decoration: none;
  transition: color .15s, border-color .15s;
}
.cmp-back:hover { color: var(--primary); border-color: var(--primary); }
.cmp-back:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
.cmp-title {
  margin: 0 0 6px;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--text-primary);
}
.cmp-sub {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  max-width: 760px;
  color: var(--text-secondary);
}
.cmp-note {
  margin: 10px 0 0;
  font-size: 12px;
  line-height: 1.6;
  max-width: 760px;
  color: var(--text-tertiary);
}


/* 长文本行内截断（2026-11-04）：
   limits 单条上限 2000 字，一页 100 条就是几百 KB —— 全铺进单元格会把表格撑爆，
   移动端尤其难看。这里限行 + 省略号，全文交给单元格的 title 属性（见模板）。 */




.sk {
  height: 14px;
  border-radius: 6px;
  background: linear-gradient(90deg, var(--surface-sunken) 25%, var(--surface-hover) 50%, var(--surface-sunken) 75%);
  background-size: 200% 100%;
  animation: cmp-sk-shimmer 1.4s ease-in-out infinite;
}
@keyframes cmp-sk-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}



@media (max-width: 1024px) {
  .tokens-page {
    padding: 72px 16px 96px;
  }
}


@media (max-width: 480px) {
  .tokens-page {
    padding: 60px 10px 96px;
  }
}
</style>
