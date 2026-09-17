<template>
  <div :data-guest="isGuest" :data-admin="isAdmin" class="app-shell">
    <slot />
    <FloatingNav />
    <MobileHeader />
    <MobileOverlay />
    <MobileBottomNav />
  </div>
</template>

<script setup lang="ts">
const { isGuest, isAdmin } = useAuth()
const { initThemeWatchers } = useTheme()
const { isMobile, drawerOpen } = useMobile()
const route = useRoute()

// 具名 keydown 处理器（frontend #3）：Escape 关闭移动端抽屉。
// 具名函数保证 onBeforeUnmount 能用同一引用移除监听，避免匿名函数引用不匹配。
function onGlobalKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && drawerOpen.value) {
    drawerOpen.value = false
  }
}

// 客户端 DOM 初始化（frontend #9）：移入 onMounted，避免 setup 顶层直接操作 DOM，
// 防止 SSR/客户端求值顺序不同导致 hydration mismatch
onMounted(() => {
  // 检测 Chrome 侧边栏模式（?context=side_panel）
  if (route.query.context === 'side_panel') {
    document.body.classList.add('is-sidepanel')
    // 也给 Nuxt 的 sidebar-container 加上 class，触发对应 CSS 规则
    const nuxtSidebar = document.getElementById('sidebar-container')
    if (nuxtSidebar) nuxtSidebar.classList.add('is-sidepanel')
  }

  // Apply mobile-drawer-open class to sidebar when drawer is open
  watch(drawerOpen, (open) => {
    const sidebar = document.querySelector('aside.custom-width, aside.sidebar')
    if (sidebar) {
      if (open) sidebar.classList.add('mobile-drawer-open')
      else sidebar.classList.remove('mobile-drawer-open')
    }
  }, { immediate: true })

  // Close drawer on Escape
  document.addEventListener('keydown', onGlobalKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onGlobalKeydown)
})

// 全局资源：直接复用旧框架 CSS，保证主题样式 100% 一致
const { data: tdk } = await useFetch('/api/tdk', {
  server: true,
  lazy: false,
  getCachedData: (key, nuxtApp) => {
    // 客户端导航时复用已缓存的 TDK，避免重复请求
    return nuxtApp.payload?.data?.[key] || undefined
  },
})

const siteBaseUrl = (useRuntimeConfig().public.baseUrl as string) || 'https://hao.bx9y.com.cn'
const canonicalUrl = computed(() => `${siteBaseUrl}${route.path}`)
const siteTitle = computed(() => tdk.value?.siteTitle || 'FavsHub-网址导航与智能书签管理工作台')
const siteDescription = computed(() => tdk.value?.siteDescription || '')
const siteKeywords = computed(() => tdk.value?.siteKeywords || '')
// 社交平台必须拿到绝对地址的分享图（1200x630，public/images/og-cover.png）
const ogImageUrl = `${siteBaseUrl}/images/og-cover.png`

useHead({
  link: [
    { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
    { rel: 'icon', type: 'image/png', sizes: '512x512', href: '/favicon.png' },
    { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' },
    { rel: 'stylesheet', href: '/css/tokens.css?v=20260830' },
    { rel: 'stylesheet', href: '/css/themes.css?v=20260828' },
    { rel: 'stylesheet', href: '/css/main-bundle.css?v=20260917' },
    { rel: 'stylesheet', href: '/css/mobile-responsive.css?v=20260830c' },
    { rel: 'stylesheet', href: '/vendor/remixicon.css' },
    // Canonical URL: 基于当前路由，防止重复内容
    { rel: 'canonical', href: canonicalUrl },
  ],
  titleTemplate: (title) => {
    return title ? `${title}_FavsHub` : siteTitle.value
  },
  meta: [
    { name: 'description', content: siteDescription },
    { name: 'keywords', content: siteKeywords },
    // Open Graph（全局默认值，页面级 useHead 可覆盖）
    { property: 'og:site_name', content: 'FavsHub' },
    { property: 'og:type', content: 'website' },
    { property: 'og:title', content: siteTitle },
    { property: 'og:description', content: siteDescription },
    { property: 'og:locale', content: 'zh_CN' },
    { property: 'og:url', content: canonicalUrl },
    { property: 'og:image', content: ogImageUrl },
    { property: 'og:image:secure_url', content: ogImageUrl },
    { property: 'og:image:type', content: 'image/png' },
    { property: 'og:image:width', content: '1200' },
    { property: 'og:image:height', content: '630' },
    { property: 'og:image:alt', content: siteTitle },
    // Twitter Card（全局默认）：大图卡片需要 twitter:image
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: siteTitle },
    { name: 'twitter:description', content: siteDescription },
    { name: 'twitter:image', content: ogImageUrl },
    { name: 'twitter:image:alt', content: siteTitle },
  ],
})

// 应用主题到 DOM（响应 store 变化）
if (import.meta.client) {
  // 响应 TDK 变化，更新页面标题（titleTemplate 在 useHead 中非响应式）
  watch(() => tdk.value?.siteTitle, (newTitle) => {
    if (newTitle) {
      const current = document.title
      const pagePart = current.includes('_') ? current.split('_')[0] : ''
      document.title = pagePart ? `${pagePart}_FavsHub` : newTitle
    }
  })

  // 主题监听（应用 DOM + 系统偏好 + settings 同步 + 背景渐变）
  // 集中在 composables/useTheme.ts，修复 hydrate 阶段 FOUC（信任 SSR 注入，不覆盖）
  initThemeWatchers()
}
</script>

