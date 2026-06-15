import { defineStore } from 'pinia'
import { useAuthStore } from '~/stores/auth'

/** Common default settings matching the legacy FavsHubSettings.DEFAULTS */
const SETTINGS_DEFAULTS: Record<string, any> = {
  // Theme
  theme: 'auto',
  // Floating ball
  enableFloatingBall: false,
  // Link open behaviour
  openInNewTab: true,
  sidepanelOpenInNewTab: false,
  sidepanelOpenInSidepanel: true,
  // Bookmark card dimensions
  bookmarkWidth: 210,
  bookmarkCardHeight: 50,
  bookmarkContainerWidth: 90,
  // Layout toggles
  showSearchBox: true,
  showWelcomeMessage: true,
  showFooter: true,
  // Search suggestions
  showSearchSuggestions: true,
  showHistorySuggestions: true,
  showBookmarkSuggestions: true,
  showPromptSuggestions: true,
  openSearchInNewTab: true,
  // Quick-access links
  showHistoryLink: true,
  showDownloadsLink: true,
  showPasswordsLink: true,
  showExtensionsLink: true,
  // Search engine preferences
  enabledSearchEngines: [],
  selectedSearchEngine: '',
  customSearchEngines: [],
  // Background
  selectedBackground: '',
  solidBackground: '',
  useDefaultBackground: '',
  // Welcome message text
  welcomeMessage: '',
  // Background type shorthand
  backgroundType: 'none',
}

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    settings: {} as Record<string, any>,
    isLoading: false,
    _persistTimer: null as ReturnType<typeof setTimeout> | null,
  }),

  getters: {
    /** All default values (read-only reference) */
    defaults: () => SETTINGS_DEFAULTS,

    theme: (state) => state.settings.theme ?? SETTINGS_DEFAULTS.theme,
    bookmarkWidth: (state) => state.settings.bookmarkWidth ?? SETTINGS_DEFAULTS.bookmarkWidth,
  },

  actions: {
    // ── Fetch from backend ─────────────────────────────────────

    async fetchSettings(token?: string) {
      this.isLoading = true
      try {
        const headers: Record<string, string> = {}
        if (token) headers.Authorization = `Bearer ${token}`
        const res = await $fetch<{ data: Record<string, any> }>('/api/settings', { headers })
        this.settings = { ...SETTINGS_DEFAULTS, ...res.data }
      } finally {
        this.isLoading = false
      }
    },

    // ── Read / write single settings ───────────────────────────

    /**
     * Read a single setting with optional fallback.
     * Resolution order: in-memory value -> defaults -> defaultValue argument.
     */
    get(key: string, defaultValue?: any): any {
      if (this.settings[key] !== undefined) return this.settings[key]
      if (SETTINGS_DEFAULTS[key] !== undefined) return SETTINGS_DEFAULTS[key]
      return defaultValue
    },

    /**
     * Write a single setting. Updates in-memory immediately and
     * schedules a debounced persist to the backend.
     */
    set(key: string, value: any) {
      this.settings[key] = value
      this._schedulePersist()
    },

    /**
     * Write multiple settings at once. Updates in-memory immediately and
     * schedules a single debounced persist to the backend.
     */
    setMany(data: Record<string, any>) {
      Object.assign(this.settings, data)
      this._schedulePersist()
    },

    // ── Backend persistence (debounced) ────────────────────────

    /**
     * Schedule a debounced write to the backend (300 ms).
     * Repeated calls within the window reset the timer so only
     * one request is sent after the user stops changing settings.
     */
    _schedulePersist() {
      if (this._persistTimer) clearTimeout(this._persistTimer)
      this._persistTimer = setTimeout(() => {
        this._persistTimer = null
        this._persistToBackend()
      }, 300)
    },

    /**
     * Immediately persist current settings to the backend.
     * Skipped for guest users (no token).
     */
    async _persistToBackend() {
      try {
        const auth = useAuthStore()
        if (!auth.token) return
        // 过滤系统级字段，只发送用户个人设置
        const SYSTEM_ONLY_KEYS = ['siteTitle', 'siteDescription', 'siteKeywords', 'promptproTitle', 'promptproDescription', 'promptproKeywords', 'title', 'description', 'keywords', 'allow_registration']
        const userData: Record<string, any> = {}
        for (const [k, v] of Object.entries(this.settings)) {
          if (!SYSTEM_ONLY_KEYS.includes(k)) userData[k] = v
        }
        const res = await $fetch<{ data: Record<string, any> }>('/api/settings', {
          method: 'PUT',
          headers: { Authorization: `Bearer ${auth.token}` },
          body: { data: userData },
        })
        // 合并服务器响应，保留系统设置不被覆盖
        this.settings = { ...this.settings, ...res.data }
      } catch {
        // Silently ignore — next set() call will retry
      }
    },

    /**
     * Full overwrite — used by admin or when loading a backup.
     */
    async updateSettings(data: Record<string, any>, token: string) {
      const res = await $fetch<{ data: Record<string, any> }>('/api/settings', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
        body: { data },
      })
      this.settings = res.data
    },
  },
})
