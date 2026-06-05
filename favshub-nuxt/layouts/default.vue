<template>
  <div :data-guest="isGuest" :data-admin="isAdmin" :data-theme="theme" class="app-shell">
    <slot />
  </div>
</template>

<script setup lang="ts">
const { isGuest, isAdmin } = useAuth()
const uiStore = useUIStore()

const theme = computed(() => uiStore.theme)

// 全局 CSS
useHead({
  link: [
    { rel: 'stylesheet', href: '/vendor/remixicon.css' },
    { rel: 'stylesheet', href: '/css/main-bundle.css' },
    { rel: 'stylesheet', href: '/css/index-sidebar-fix.css' },
    { rel: 'stylesheet', href: '/css/mobile-responsive.css' },
  ],
  titleTemplate: (title) => title ? `${title} - FavsHub` : 'FavsHub - 智能书签工作台',
})

// 应用主题到 DOM
if (import.meta.client) {
  watch(() => uiStore.theme, (t) => {
    if (t === 'auto') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light')
    } else {
      document.documentElement.setAttribute('data-theme', t)
    }
  }, { immediate: true })

  // 监听系统主题变化
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (uiStore.theme === 'auto') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light')
    }
  })
}
</script>

<style>
.app-shell {
  min-height: 100vh;
}
</style>
