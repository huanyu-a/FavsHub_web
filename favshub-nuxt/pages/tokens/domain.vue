<template>
  <div>
    <TokenDealsBoard
      fixed-category="domain"
      title="免费域名"
      subtitle="免费二级域名、公益顶级域与 DDNS 动态域名：给自建服务一个稳定好记的入口。"
      :intro="INTRO"
      :faq="FAQ"
      faq-title="免费域名常见问题"
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
const pageUrl = `${_base}/tokens/domain`

const pageTitle = '免费域名 — 免费二级域名 / 顶级域 / DDNS 领取攻略'
const pageDesc = '汇总免费域名渠道：公益顶级域、免费二级域名与 DDNS 动态域名，标注能否自管解析与修改 NS、申请审核要多久、以及免费域名突然失效的风险。'
const pageKw = '免费域名,免费二级域名,免费顶级域,DDNS,免费DNS'

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
    { property: 'og:image:alt', content: '免费域名渠道汇总' },
    { name: 'twitter:card', content: 'summary' },
    { name: 'twitter:title', content: pageTitle },
    { name: 'twitter:description', content: pageDesc },
    { name: 'twitter:image', content: `${_base}/images/og-cover-tokens.png` },
  ],
  link: [
    { rel: 'canonical', href: pageUrl },
  ],
})

const INTRO = '免费域名大致分三类：别人顶级域下发的免费二级域名、公益项目放出的真顶级域，以及给家宽自建服务用的 DDNS。这一页把三类都收进来，标注能不能自管解析、要不要走审核，以及最近一次核实的日期。'

const FAQ = [
  {
    q: '免费域名有哪几种？有什么区别？',
    a: '一是免费二级 / 子域名，挂在他人的顶级域下面，最好申请、数量最多；二是公益项目放出的真顶级域，可以独立解析，体验最接近花钱买的域名；三是 DDNS 动态域名，专门用来把会变的家庭宽带 IP 稳定映射成一个域名。卡片上会写明属于哪一类。',
  },
  {
    q: '能不能绑到自己的网站或服务器上？',
    a: '可以。常见两种做法：把 NS 整体托管到 Cloudflare 之类的解析商，或者直接在面板里添加 A / CNAME 记录，指向你的服务器 IP、GitHub Pages 等。需要注意，有些服务只允许在它自己的面板里改记录、不允许修改 NS，卡片上会标注。',
  },
  {
    q: '免费域名靠谱吗？会不会突然就没了？',
    a: '存在这个风险，这是免费域名的固有代价。运营时间很长的老牌服务相对稳；公益项目则取决于运营方，政策调整或滥用回收都可能发生。用来做重要业务时，建议自备一个便宜的付费顶级域做兜底，免费域名只当额外入口。',
  },
  {
    q: '申请要等多久？',
    a: '差别很大。自动化程度高的平台注册即生效；走代码仓库合并请求审核的通常一两天；纯人工审核的老牌服务慢的话可能几天到几周。急用就优先挑注册即生效的那种，不在乎等待再选老牌服务。',
  },
]
</script>
