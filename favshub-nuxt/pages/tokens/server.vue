<template>
  <div>
    <TokenDealsBoard
      fixed-category="cloud"
      title="免费服务器 / VPS"
      subtitle="免费云主机、PaaS 与 Serverless 免费档：能真正跑起一个小站、一个 Bot 的都在这一页。"
      :intro="INTRO"
      :faq="FAQ"
      faq-title="免费服务器常见问题"
    />
    <BackToTop />
    <SiteFooter />
  </div>
</template>

<script setup lang="ts">
import TokenDealsBoard from '~/components/tokens/TokenDealsBoard.vue'
import BackToTop from '~/components/BackToTop.vue'
import SiteFooter from '~/components/common/SiteFooter.vue'

definePageMeta({ layout: 'default' })

const _base = (useRuntimeConfig().public.baseUrl as string) || 'https://hao.bx9y.com.cn'
const pageUrl = `${_base}/tokens/server`

const pageTitle = '免费服务器 / VPS — 免费云主机与 PaaS 免费档汇总'
const pageDesc = '汇总免费云服务器、PaaS 与 Serverless 免费档：写清配置、领取条件（要不要绑卡/实名）、有效期与回收规则，并说明免费机器能挂什么、闲置会不会被回收。'
const pageKw = '免费服务器,免费VPS,免费云主机,免费PaaS,Serverless免费额度'

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
    { property: 'og:image:alt', content: '免费服务器 / VPS 汇总' },
    { name: 'twitter:card', content: 'summary' },
    { name: 'twitter:title', content: pageTitle },
    { name: 'twitter:description', content: pageDesc },
    { name: 'twitter:image', content: `${_base}/images/og-cover-tokens.png` },
  ],
  link: [
    { rel: 'canonical', href: pageUrl },
  ],
})

const INTRO = '免费服务器分两类：一类是长期存在的免费档（只要不超配额就能一直用），一类是有明确期限的试用。这一页两种都收，标注配置、领取条件、有效期，以及最容易踩的坑——闲置回收。'

const FAQ = [
  {
    q: '免费服务器和「免费试用」有什么区别？',
    a: '试用一般有明确期限（7 天、30 天不等），到点资源回收；免费档（Free Tier）通常是长期存在的产品档位，只要不超配额就能一直用，代价是可能有休眠、限速或闲置限制。本页两类都收，卡片上会写明属于哪一类。',
  },
  {
    q: '申请需要绑定信用卡吗？',
    a: '部分海外平台要求绑卡做身份验证，即使不产生扣费。国内平台多用手机号加实名。卡片上的「领取条件」会尽量标注；确实需要绑卡时，建议用带额度上限的卡，并在用完、注销后解绑。',
  },
  {
    q: '免费机器能拿来挂正经服务吗？',
    a: '要看条款。多数免费档禁止挖矿、代理翻墙、批量刷量和成人内容，但允许放个人博客、小工具站、聊天机器人这类低流量用途。被判定滥用通常直接封号且不申诉，所以先读一遍服务条款再部署。',
  },
  {
    q: '长期不用会被回收吗？',
    a: '会，这是免费服务器最常见的「突然就没了」。常见规则是连续若干天没有流量、或不手动点续期就停机回收，有的平台甚至要求每几天登录面板续期一次。别把唯一一份数据放在免费机器上，重要内容自己留备份。',
  },
]
</script>
