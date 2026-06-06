<template>
  <div :data-guest="isGuest" :data-admin="isAdmin" :data-theme="theme" class="app-shell">
    <slot />
  </div>
</template>

<script setup lang="ts">
const { isGuest, isAdmin } = useAuth()
const uiStore = useUIStore()

const theme = computed(() => uiStore.theme)

// 全局资源
useHead({
  link: [
    { rel: 'stylesheet', href: '/vendor/remixicon.css' },
  ],
  // 同步脚本：在页面渲染前从 localStorage 恢复 auth 状态到 <html> 属性
  // 消除 SSR 渲染的 data-guest="true" 导致的 UI 闪烁
  script: [
    {
      innerHTML: `(function(){var t=localStorage.getItem('favshub_token');if(t){document.documentElement.setAttribute('data-guest','false');try{var p=JSON.parse(atob(t.split('.')[1]));if(p.isAdmin)document.documentElement.setAttribute('data-admin','true')}catch(e){}}})()`,
    },
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
/* ================================================================
   GLOBAL STYLES — 这些规则需要跨组件生效，不使用 scoped
   ================================================================ */

/* ── Reset ──────────────────────────────────────────────────── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
body { background: #f5f5f7; color: #333; }

.app-shell { min-height: 100vh; }

/* ── Auth-dependent visibility ───────────────────────────────── */
.client-only-guest { display: none !important; }
.client-only-user  { display: flex; }
.client-only-admin  { display: none !important; }

html[data-guest="true"] .client-only-guest { display: flex !important; }
html[data-guest="true"] .client-only-user  { display: none !important; }
html[data-admin="true"] .client-only-admin  { display: flex !important; }

/* ── Sidebar dark mode ──────────────────────────────────────── */
[data-theme="dark"] .sidebar           { background: #1e1e1e; border-right-color: #333; }
[data-theme="dark"] .sidebar-brand-title { color: #eee; }
[data-theme="dark"] .sidebar-hub-link    { color: #ccc; }
[data-theme="dark"] .sidebar-hub-link:hover { background: rgba(255,255,255,0.06); }
[data-theme="dark"] .sidebar-hub-link.active { background: #1a3a5c; color: #64b5f6; }
[data-theme="dark"] .folder-item        { color: #ccc; }
[data-theme="dark"] .folder-item:hover  { background: rgba(255,255,255,0.06); }
[data-theme="dark"] .folder-item.active { background: #1a3a5c; color: #64b5f6; }
[data-theme="dark"] .sidebar-bottom     { border-top-color: #333; }
[data-theme="dark"] .sidebar-top        { border-bottom-color: #333; }
[data-theme="dark"] .sidebar-toolbar-icon,
[data-theme="dark"] .sidebar-theme-btn  { color: #aaa; }

/* ── BookmarkCard dark mode ─────────────────────────────────── */
[data-theme="dark"] .bookmark-card:hover { background: rgba(255,255,255,0.08); }
[data-theme="dark"] .bookmark-title     { color: #ddd; }
[data-theme="dark"] .bookmark-icon-text { background: rgba(74,144,217,0.2); }

/* hide edit/delete buttons for guests */
html[data-guest="true"] .bookmark-actions { display: none !important; }

/* ── BookmarkGrid dark mode / guest ─────────────────────────── */
[data-theme="dark"] .add-bookmark-card { border-color: #444; }

/* hide add-bookmark card for guests */
html[data-guest="true"] .add-bookmark-card { display: none !important; }

/* ── BookmarkContextMenu dark mode ──────────────────────────── */
[data-theme="dark"] .context-menu          { background: #2a2a2a; border-color: #444; color: #ddd; }
[data-theme="dark"] .context-menu-header   { color: #999; }
[data-theme="dark"] .context-menu-divider  { background: #444; }
[data-theme="dark"] .context-menu-item     { color: #ddd; }
[data-theme="dark"] .context-menu-item:hover { background: #333; }
[data-theme="dark"] .context-menu-item i   { color: #aaa; }

/* ── SearchBar dark mode ────────────────────────────────────── */
[data-theme="dark"] .search-input-wrapper { background: #2a2a2a; border-color: #444; }
[data-theme="dark"] .search-input         { color: #eee; }

/* ── SearchEngineDropdown dark mode ─────────────────────────── */
[data-theme="dark"] .engine-dropdown      { background: #2a2a2a; border-color: #444; }
[data-theme="dark"] .engine-item:hover    { background: #333; }

/* ── SearchSuggestions dark mode ────────────────────────────── */
[data-theme="dark"] .suggestions-dropdown   { background: #2a2a2a; border-color: #444; }
[data-theme="dark"] .suggestion-item:hover  { background: #333; }

/* ── WelcomeMessage dark mode ───────────────────────────────── */
[data-theme="dark"] .welcome-text { color: #eee; }

/* ── Admin pages dark mode ──────────────────────────────────── */
[data-theme="dark"] .page-title,
[data-theme="dark"] .section-title { color: #eee; }
[data-theme="dark"] .stat-card,
[data-theme="dark"] .nav-card      { background: #1e1e1e; border-color: #333; }
[data-theme="dark"] .stat-value    { color: #64b5f6; }
[data-theme="dark"] .nav-label     { color: #ccc; }
</style>
