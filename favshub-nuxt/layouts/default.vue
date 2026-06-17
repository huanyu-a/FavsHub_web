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

// Apply mobile-drawer-open class to sidebar when drawer is open
if (import.meta.client) {
  watch(drawerOpen, (open) => {
    const sidebar = document.querySelector('aside.custom-width, aside.sidebar')
    if (sidebar) {
      if (open) sidebar.classList.add('mobile-drawer-open')
      else sidebar.classList.remove('mobile-drawer-open')
    }
  })

  // Close drawer on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawerOpen.value) {
      drawerOpen.value = false
    }
  })
}

// 全局资源：直接复用旧框架 CSS，保证主题样式 100% 一致
const { data: tdk } = await useFetch('/api/tdk', {
  server: true,
  lazy: false,
  getCachedData: (key, nuxtApp) => {
    // 客户端导航时复用已缓存的 TDK，避免重复请求
    return nuxtApp.payload?.data?.[key] || undefined
  },
})

useHead({
  link: [
    { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
    { rel: 'stylesheet', href: '/css/main-bundle.css?v=20260617' },
    { rel: 'stylesheet', href: '/css/mobile-responsive.css?v=20260616' },
    { rel: 'stylesheet', href: '/vendor/remixicon.css' },
  ],
  titleTemplate: (title) => {
    const siteTitle = tdk.value?.siteTitle || 'FavsHub - 智能书签工作台'
    return title ? `${title} - FavsHub` : siteTitle
  },
  meta: [
    { name: 'description', content: computed(() => tdk.value?.siteDescription || '') },
    { name: 'keywords', content: computed(() => tdk.value?.siteKeywords || '') },
  ],
})

// 应用主题到 DOM（响应 store 变化）
if (import.meta.client) {
  // 响应 TDK 变化，更新页面标题（titleTemplate 在 useHead 中非响应式）
  watch(() => tdk.value?.siteTitle, (newTitle) => {
    if (newTitle) {
      const current = document.title
      const pagePart = current.includes(' - ') ? current.split(' - ')[0] : ''
      document.title = pagePart ? `${pagePart} - FavsHub` : newTitle
    }
  })

  // 主题监听（应用 DOM + 系统偏好 + settings 同步 + 背景渐变）
  // 集中在 composables/useTheme.ts，修复 hydrate 阶段 FOUC（信任 SSR 注入，不覆盖）
  initThemeWatchers()
}
</script>

