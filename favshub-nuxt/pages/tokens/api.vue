<template>
  <div>
    <TokenDealsBoard
      fixed-category="token"
      title="免费 API / 模型"
      subtitle="各家大模型与推理服务的免费额度情报：注册赠送、每日签到、限时试用金，都在这一页。"
      :intro="INTRO"
      :faq="FAQ"
      faq-title="免费 API 常见问题"
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
const pageUrl = `${_base}/tokens/api`

const pageTitle = '免费 API / 模型 — 大模型免费额度领取与避坑'
const pageDesc = '汇总各家大模型与推理服务的免费 API 额度：写清额度口径、领取门槛（是否实名/绑卡）、有效期与最近核验时间，并说明额度用尽后会不会自动扣费。'
const pageKw = '免费API,免费大模型额度,免费Token,API额度领取,大模型试用'

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
    { property: 'og:image:alt', content: '免费 API / 模型额度汇总' },
    { name: 'twitter:card', content: 'summary' },
    { name: 'twitter:title', content: pageTitle },
    { name: 'twitter:description', content: pageDesc },
    { name: 'twitter:image', content: `${_base}/images/og-cover-tokens.png` },
  ],
  link: [
    { rel: 'canonical', href: pageUrl },
  ],
})

const INTRO = '这一页只收「能拿到手的 API 额度」：注册即送、签到刷新、限时试用金都算。每条都会写清额度的口径、领取门槛和最近一次核验时间——免费额度的政策改得快，动手前先看一眼核实日期。'

const FAQ = [
  {
    q: '免费额度到底怎么算？',
    a: '各家规则不一样，常见三种：注册一次性赠送（用完即止）、按天或按小时刷新（例如每日若干次调用）、以及活动期内的限时试用金。卡片上的「免费额度」写的就是这一条的口径，详情页还有更细的限制条款。',
  },
  {
    q: '领取需要实名认证或绑定银行卡吗？',
    a: '看服务商。国内平台多数要手机号，部分要求实名认证；海外平台有的要绑卡做验证（哪怕不扣费），也有只认 GitHub 或 Google 登录的。列表里的「领取条件」和详情页会尽量标出来，没标注的一律以官网为准。',
  },
  {
    q: '额度用完了会不会自动扣费？',
    a: '这是最需要留神的一条。纯赠送额度通常用完就停，但如果你自己填了付款方式并开通了按量付费，超出部分就可能直接计费。稳妥做法是：只领额度、不开通按量付费；平台强制绑卡时，用带额度上限的卡或用完即解绑。',
  },
  {
    q: '免费额度一般能维持多久？',
    a: '从「发完即止」到「长期有效」都有。一次性赠送的通常跟着账号走、不设截止；活动型额度往往有明确期限，过期不补。卡片上的有效期与核实状态能帮你判断——很久没被核实的条目，建议先看看社区投票再投入时间。',
  },
]
</script>
