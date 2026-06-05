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
      this.applyTheme()
    },

    /**
     * Resolve the current theme value and apply it to the document.
     *
     * - 'light' / 'dark' — applied directly
     * - 'auto' — reads `prefers-color-scheme` from the browser
     *
     * Also listens for OS-level theme changes when in 'auto' mode so the
     * page updates without a reload.
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
      document.body.setAttribute('data-theme', effective)
    },

    /**
     * Call once during app init to:
     * 1. Read the persisted theme from settings store
     * 2. Apply it to the DOM
     * 3. Start listening for OS-level theme changes (auto mode only)
     */
    initTheme() {
      if (import.meta.server) return

      // Sync with persisted settings
      const settings = useSettingsStore()
      this.theme = (settings.get('theme') as 'light' | 'dark' | 'auto') || 'auto'
      this.applyTheme()

      // React to OS-level scheme changes when the user preference is 'auto'
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (this.theme === 'auto') {
          this.applyTheme()
        }
      })
    },
  },
})
