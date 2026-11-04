<template>
  <div>
    <TokenDealsBoard
      fixed-category="client"
      title="客户端额度"
      subtitle="桌面 / 移动端 AI 客户端自带的免费额度：注册积分、每日签到、拉新奖励、训练营任务。"
      :intro="INTRO"
      :faq="FAQ"
      faq-title="客户端额度常见问题"
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
const pageUrl = `${_base}/tokens/client`

const pageTitle = '客户端额度 — 免费 AI 客户端注册积分 / 签到 / 拉新奖励汇总'
const pageDesc = '汇总各家 AI 客户端（桌面端、手机端、IDE 插件）的免费额度：注册即送积分、每日签到、拉新奖励与训练营任务，标注积分怎么算、多久刷新、有没有上限。'
const pageKw = '客户端额度,免费AI客户端,注册送积分,每日签到,拉新奖励,训练营积分'

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
    { property: 'og:image:alt', content: 'AI 客户端免费额度汇总' },
    { name: 'twitter:card', content: 'summary' },
    { name: 'twitter:title', content: pageTitle },
    { name: 'twitter:description', content: pageDesc },
    { name: 'twitter:image', content: `${_base}/images/og-cover-tokens.png` },
  ],
  link: [
    { rel: 'canonical', href: pageUrl },
  ],
})

const INTRO = '这一类收的是「装在电脑或手机上的 AI 客户端」自带的免费额度 —— 和 API 侧按调用量计费不同，客户端通常用「积分」结算：注册送一笔、每天签到再送、拉一个好友送更多，少数还有训练营任务。积分怎么算、有没有上限、会不会过期，卡片上都会写明。'

const FAQ = [
  {
    q: '「客户端额度」和「免费 API」有什么区别？',
    a: 'API 额度给你的是可以直接调用的接口凭证，按请求数或 token 数计费，适合接进自己的程序；客户端额度通常只能在它自家的桌面端、手机端或 IDE 插件里用，以积分形式发放，用来抵扣对话次数或模型调用。两者不通用，挑之前先想清楚你要「接到代码里」还是「自己在客户端里用」。',
  },
  {
    q: '积分怎么算？能换多少实际用量？',
    a: '各家用不同的兑换比例，卡片上的「免费额度」写的就是它自己的口径（例如「5000 积分」「每人 10000 积分」）。真实能换多少次对话，得看客户端里每个模型消耗多少积分 —— 这一点通常要在官方页面或客户端内确认，站内标注的是公告口径。',
  },
  {
    q: '拉新奖励有上限吗？',
    a: '大多数有。常见的写法是「每邀请 1 人得 X 积分，最多 N 人」，超过部分不再计。卡片里如果写了上限就是官方明确给出的，没写则说明官方未标注，实际以客户端内的到账记录为准。',
  },
  {
    q: '积分会过期吗？签到断了会不会清零？',
    a: '两种规则都有。部分平台积分有效期为自然年或若干个月，到期未用完作废；签到的连续天数奖励则可能因为断签重置。这类规则变动频繁，领取前建议先看卡片上的「最近核实」日期，太久没更新的条目要留个心眼。',
  },
]
</script>