<template>
  <div :data-guest="isGuest" :data-admin="isAdmin" class="app-shell">
    <slot />
    <MobileHeader />
    <MobileOverlay />
    <MobileBottomNav />
  </div>
</template>

<script setup lang="ts">
const { isGuest, isAdmin } = useAuth()
const uiStore = useUIStore()
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
useHead({
  link: [
    { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
    { rel: 'stylesheet', href: '/css/main-bundle.css' },
    { rel: 'stylesheet', href: '/css/index-sidebar-fix.css' },
    { rel: 'stylesheet', href: '/css/mobile-responsive.css' },
    { rel: 'stylesheet', href: '/vendor/remixicon.css' },
  ],
  // 同步脚本：渲染前从 localStorage 恢复 auth 状态 + 主题到 <html>，消除 SSR 闪烁
  script: [
    {
      innerHTML: `(function(){try{var t=localStorage.getItem('favshub_token')||localStorage.getItem('fh_local_favshub_token');var d=document.documentElement;if(t){d.setAttribute('data-guest','false');try{var p=JSON.parse(atob(t.split('.')[1]));if(p.isAdmin)d.setAttribute('data-admin','true')}catch(e){}}else{d.setAttribute('data-guest','true')}var th=localStorage.getItem('favshub_theme')||'light';if(th==='auto'){th=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}d.setAttribute('data-theme',th);var bg=localStorage.getItem('favshub_bg')||'gradient-background-7';d.classList.add(bg)}catch(e){}})()`,
    },
  ],
  titleTemplate: (title) => title ? `${title} - FavsHub` : 'FavsHub - 智能书签工作台',
})

// 应用主题到 DOM（响应 store 变化）
if (import.meta.client) {
  watch(() => uiStore.theme, (t) => {
    if (t === 'auto') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light')
    } else {
      document.documentElement.setAttribute('data-theme', t)
    }
  }, { immediate: true })

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (uiStore.theme === 'auto') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light')
    }
  })

  // 响应背景设置变化，更新 <html> 类名和 localStorage
  const settingsStore = useSettingsStore()
  watch(() => settingsStore.get('theme'), (t: string) => {
    if (t && t !== uiStore.theme) {
      uiStore.theme = t as 'light' | 'dark' | 'auto'
    }
  })
  watch(() => settingsStore.get('selectedBackground'), (bg: string) => {
    const html = document.documentElement
    // 移除旧的 gradient-background-* 类
    const oldClasses = Array.from(html.classList).filter(c => c.startsWith('gradient-background'))
    if (oldClasses.length) html.classList.remove(...oldClasses)
    // 应用新类名
    if (bg && bg.startsWith('gradient-background')) {
      html.classList.add(bg)
      localStorage.setItem('favshub_bg', bg)
    } else {
      localStorage.removeItem('favshub_bg')
    }
  }, { immediate: true })
}
</script>

<style>
/* ================================================================
   仅保留跨组件的「登录态可见性」辅助类。
   其余主题样式（含暗色模式）全部由旧框架 CSS (main-bundle.css) 提供。
   注意：禁止使用 :global()，Nuxt/Vite 会错误编译导致整页隐藏。
   ================================================================ */
.app-shell { min-height: 100vh; }

/* 默认：游客可见控件隐藏，登录控件显示（避免 SSR 闪烁） */
.client-only-guest { display: none !important; }
.client-only-user  { display: inline-flex; }
.client-only-admin { display: none !important; }

html[data-guest="true"] .client-only-guest { display: inline-flex !important; }
html[data-guest="true"] .client-only-user  { display: none !important; }
html[data-admin="true"] .client-only-admin { display: inline-flex !important; }
</style>
