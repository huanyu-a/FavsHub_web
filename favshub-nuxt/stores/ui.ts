import { defineStore } from 'pinia'
import { useSettingsStore } from '~/stores/settings'

export const useUIStore = defineStore('ui', {
  state: () => ({
    sidebarOpen: true,
    theme: 'auto' as 'light' | 'dark' | 'auto',
  }),

  actions: {
    toggleSidebar() {
      this.sidebarOpen = !this.sidebarOpen
    },

    setTheme(t: 'light' | 'dark' | 'auto') {
      this.theme = t
      // 镜像到 localStorage，供 layouts/default.vue 的首屏同步脚本读取，消除主题闪烁
      if (import.meta.client) {
        try { localStorage.setItem('favshub_theme', t) } catch {}
      }
      // 同步到后端设置（登录用户）
      try { useSettingsStore().set('theme', t) } catch {}
      this.applyTheme()
    },

    /**
     * Resolve the current theme value and apply it to the document.
     *
     * - 'light' / 'dark' — applied directly
     * - 'auto' — reads `prefers-color-scheme` from the browser
     *
     * 约定：只设置 documentElement（<html>），不设置 <body>。
     * CSS 中 [data-theme="dark"] body 等后代选择器通过 html 属性命中。
     */
    applyTheme() {
      if (import.meta.server) return

      let effective: 'light' | 'dark' = 'light'

      if (this.theme === 'auto') {
        effective = window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
      } else {
        effective = this.theme
      }

      document.documentElement.setAttribute('data-theme', effective)
    },
  },
})
