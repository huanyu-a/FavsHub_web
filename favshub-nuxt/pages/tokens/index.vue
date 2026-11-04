<template>
  <div>
    <TokenDealsBoard
      intro="白嫖资源最怕的不是「领不到」，而是「早失效了还挂在列表里」。这里按 API 额度、免费服务器、免费域名分门别类，每条都标出额度、领取门槛和最近一次核验时间，失效的会被社区投票压下去。"
    >
      <!-- 分类导航卡：三个分类各有独立落地页（可被搜索引擎单独收录） -->
      <template #after-hero>
        <nav class="cat-nav" aria-label="白嫖分类导航">
          <NuxtLink
            v-for="c in CATEGORY_CARDS"
            :key="c.to"
            :to="c.to"
            class="cat-card"
          >
            <span class="cat-card-top">
              <i :class="c.icon"></i>
              <span class="cat-card-name">{{ c.name }}</span>
              <span class="cat-card-count">{{ countOf(c.category) }} 条</span>
            </span>
            <span class="cat-card-desc">{{ c.desc }}</span>
          </NuxtLink>
        </nav>
      </template>
    </TokenDealsBoard>

    <!-- ── 精选对比（2026-11-04 从独立页并入本页）─────────────────────────
         用户要求「compare 应放置到 tokens 页」：原先 /tokens/compare 是一个平级独立页，
         用户看完列表想横向比价还要跳走一次，且它在导航里占了一个和「白嫖通告」同级的入口，
         层级过高。

         现在：本页底部内嵌对比表，「精选对比」不再是顶层导航项。
         /tokens/compare 路由**保留**（老链接、外链、已收录页面都指向它），
         但导航不再突出它 —— 直接删会 404，属于不能做的事。

         数据独立请求：featured=1 只有十几条，与主列表的筛选/分页无关，
         挂在 Board 的筛选里反而会被「分类=API」这类条件误筛掉。 -->
    <section v-if="featuredDeals.length" class="idx-compare">
      <div class="idx-compare-head">
        <h2 class="idx-compare-title">
          <i class="ri-table-line" aria-hidden="true"></i> 精选对比
        </h2>
        <p class="idx-compare-sub">
          值得优先考虑的这几条，放在一张表里逐项对照：额度、领取条件、限制、有效期与最近核实。
        </p>
        <NuxtLink to="/tokens/compare" class="idx-compare-more">
          单独打开对比页 <i class="ri-arrow-right-line" aria-hidden="true"></i>
        </NuxtLink>
      </div>
      <TokenCompareTable :deals="featuredDeals" :pending="featuredPending" />
    </section>

    <BackToTop />
    <SiteFooter />
  </div>
</template>

<script setup lang="ts">
import TokenDealsBoard from '~/components/tokens/TokenDealsBoard.vue'
import { DEAL_CATEGORY_CARDS } from '~/utils/deal-categories'
import TokenCompareTable, { type IFeaturedDeal } from '~/components/tokens/TokenCompareTable.vue'
import BackToTop from '~/components/BackToTop.vue'
import SiteFooter from '~/components/common/SiteFooter.vue'

definePageMeta({ layout: 'default' })

const _tokensBase = (useRuntimeConfig().public.baseUrl as string) || 'https://hao.bx9y.com.cn'
const tokensBaseUrl = computed(() => `${_tokensBase}/tokens`)

const tokensTitle = 'Token 白嫖通告 — 免费 AI 额度时效情报'
const tokensDesc = '社区众包的免费 AI Token 额度通告板：实时投票标记可用与失效，五档品质分级、来源标签、一键导入书签库。'
const tokensKw = '免费API,免费Token,AI额度白嫖,免费大模型,API中转,额度失效'
// 分享封面：本页用自己的 Token 主题封面（1200x630），覆盖 layouts/default.vue 的全站默认图
const tokensOgImage = `${_tokensBase}/images/og-cover-tokens.png`
// 图片 alt 必须描述这张图本身，不能沿用全站 siteTitle（那描述的是首页封面）
const tokensOgImageAlt = 'Token 白嫖通告：哪家在发免费 Token、哪家已失效，一眼看清'

useHead({
  title: tokensTitle,
  meta: [
    { name: 'description', content: tokensDesc },
    { name: 'keywords', content: tokensKw },
    { property: 'og:site_name', content: 'FavsHub' },
    { property: 'og:title', content: tokensTitle },
    { property: 'og:description', content: tokensDesc },
    { property: 'og:type', content: 'website' },
    { property: 'og:url', content: tokensBaseUrl },
    { property: 'og:locale', content: 'zh_CN' },
    { property: 'og:image', content: tokensOgImage },
    { property: 'og:image:secure_url', content: tokensOgImage },
    { property: 'og:image:alt', content: tokensOgImageAlt },
    { name: 'twitter:card', content: 'summary' },
    { name: 'twitter:title', content: tokensTitle },
    { name: 'twitter:description', content: tokensDesc },
    { name: 'twitter:image', content: tokensOgImage },
    { name: 'twitter:image:alt', content: tokensOgImageAlt },
  ],
  link: [
    { rel: 'canonical', href: tokensBaseUrl },
  ],
})

/**
 * 分类导航卡 —— 直接取真源，不再手抄一份。
 *
 * 这里原先手列 4 张卡，而 `client` 就漏过一次：服务端 `DEAL_CATEGORIES` 早有 4 类，
 * 筛选栏/编辑器/卡片/详情页的副本也都有 client，**唯独首页导航卡只列了 3 类** ——
 * 于是 4 条客户端额度通告在首页没有任何入口，用户只能在「全部」里翻到。
 * 现在顺序、路由、图标、文案全部派生自 `~/utils/deal-categories`。
 */
const CATEGORY_CARDS = DEAL_CATEGORY_CARDS

/**
 * 各分类条数。
 *
 * 用 `limit=1` 只取分页里的 `total`：列表数据本身由 TokenDealsBoard 自己请求，
 * 这里再拉全量就重复了。三次请求并行，任一分类失败只影响它自己的数字（显示 —），
 * 不拖垮整页。
 */
const { data: categoryCounts } = await useAsyncData<Record<string, number>>(
  'tokens-category-counts',
  async () => {
    const results = await Promise.all(
      CATEGORY_CARDS.map(async (card) => {
        try {
          const res = await $fetch<{ pagination?: { total?: number } }>('/api/token-deals', {
            query: { limit: 1, category: card.category },
          })
          return [card.category, Number(res?.pagination?.total ?? 0)] as const
        } catch {
          return [card.category, -1] as const
        }
      }),
    )
    return Object.fromEntries(results)
  },
  { server: true, lazy: false },
)

/**
 * 精选对比数据（2026-11-04 并入本页）。
 *
 * 独立于 Board 的列表请求：`featured=1` 是十几条精选，与主列表的分类/搜索/分页
 * 完全无关；混进 Board 的 query 会被「分类=API」这类筛选条件误伤。
 *
 * `server: true` 让首屏 SSR 就带上表格，避免对比区先空着再蹦出来（CLS）。
 * 请求失败时 `featuredDeals` 为空 → 整块 v-if 不渲染，不留破图。
 */
const { data: featuredData, pending: featuredPending } = await useFetch<{ deals: IFeaturedDeal[] }>(
  '/api/token-deals',
  {
    query: { featured: 1, limit: 50, page: 1 },
    server: true,
    lazy: false,
    // 与 /tokens/compare 共用同一个 payload key（Nuxt 默认按 url+query 生成，
    // 两处 query 不同所以不会冲突）；这里显式给 key，便于将来做缓存预热
    key: 'tokens-featured-deals',
  },
)
const featuredDeals = computed(() => featuredData.value?.deals || [])

/** -1（请求失败）显示成 —，避免把「查不到」误报成「0 条」 */
function countOf(category: string): string {
  const n = categoryCounts.value?.[category]
  if (typeof n !== 'number' || n < 0) return '—'
  return String(n)
}
</script>

<style scoped>
/* ── 精选对比区块（2026-11-04 从 /tokens/compare 并入）──
   包在 .tokens-page 之外：Table 有自己的 max-width 需求，
   这里只负责与上方列表的间距和标题层级。 */
.idx-compare {
  max-width: 1200px;
  margin: 0 auto;
  padding: 8px 24px 56px;
}
.idx-compare-head { margin-bottom: 14px; }
.idx-compare-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 4px;
  font-size: 19px;
  font-weight: 700;
  color: var(--text);
}
.idx-compare-title i { color: var(--primary); }
.idx-compare-sub {
  margin: 0 0 8px;
  font-size: 13.5px;
  line-height: 1.6;
  color: var(--text-muted);
  max-width: 62ch;
}
.idx-compare-more {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 13px;
  color: var(--primary);
  text-decoration: none;
}
.idx-compare-more:hover { text-decoration: underline; }
.idx-compare-more:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
  border-radius: 3px;
}

@media (max-width: 768px) {
  .idx-compare { padding: 8px 16px 40px; }
}

/* ── 分类导航卡：三张并排，窄屏堆叠 ── */
.cat-nav {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;
  margin: 16px 0 4px;
}

.cat-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 16px;
  background: var(--surface-raised);
  border: 0.5px solid var(--border);
  border-radius: 12px;
  text-decoration: none;
  color: inherit;
  transition: border-color 0.18s cubic-bezier(0.22, 1, 0.36, 1), background 0.18s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}
.cat-card:hover {
  border-color: var(--border-focus);
  background: var(--surface-hover);
  box-shadow: var(--shadow-sm);
}
.cat-card:active { background: var(--surface-active); }
.cat-card:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}

.cat-card-top {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.cat-card-top i {
  font-size: 16px;
  color: var(--primary);
  flex-shrink: 0;
}
.cat-card-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cat-card-count {
  margin-left: auto;
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  padding: 1px 7px;
  border-radius: 999px;
  color: var(--primary);
  background: var(--primary-light);
  font-variant-numeric: tabular-nums;
}
.cat-card-desc {
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-tertiary);
}

@media (max-width: 768px) {
  .cat-nav {
    grid-template-columns: 1fr;
    gap: 10px;
    margin-top: 12px;
  }
  .cat-card {
    padding: 12px 14px;
  }
}
</style>