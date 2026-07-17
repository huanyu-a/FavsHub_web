import { defineStore } from 'pinia'
import { useAuthStore } from '~/stores/auth'

/** 系统级配置字段名 — 仅管理员可写入，普通用户 set() 时自动过滤 */
const SYSTEM_ONLY_KEYS = [
  'siteTitle', 'siteDescription', 'siteKeywords',
  'promptproTitle', 'promptproDescription', 'promptproKeywords',
  'title', 'description', 'keywords',
  'allow_registration',
  'backup_enabled', 'backup_hour', 'backup_minute', 'backup_keep_copies',
  'favicon_source_url', 'favicon_size', 'favicon_download_timeout', 'favicon_max_redirects',
  'jwt_token_expiry', 'cookie_max_age',
  'rate_limit_login_max', 'rate_limit_login_window',
  'rate_limit_register_max', 'rate_limit_register_window',
  'min_password_length',
  'max_bookmarks_per_sync', 'bookmarks_query_limit',
]

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
  // Background (theme-bg-* naming; old gradient-background-* auto-migrated)
  selectedBackground: 'theme-bg-7',
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
        if (token && token !== 'cookie_auth') headers.Authorization = `Bearer ${token}`
        const res = await $fetch<{ data: Record<string, any> }>('/api/settings', { headers, credentials: 'include' })
        this.settings = { ...SETTINGS_DEFAULTS, ...res.data }
        // 显式应用背景（useTheme watcher 可能因对象替换不触发）
        if (import.meta.client) {
          this._applyBackground()
        }
      } finally {
        this.isLoading = false
      }
    },

    /** 将旧 gradient-background-N 值迁移为 theme-bg-N */
    _normalizeBg(bg: string): string {
      if (!bg) return ''
      const m = bg.match(/^gradient-background-(\d+)$/)
      if (m) return `theme-bg-${m[1]}`
      return bg
    },

    /** 将 selectedBackground 同步到 <html> class
     *  新主题体系：浅色主题在浅色模式生效，深色主题在深色模式生效
     *  CSS 选择器 html[data-theme="..."].theme-bg-xxx 负责模式匹配 */
    _applyBackground() {
      if (import.meta.server) return
      const rawBg = this.settings.selectedBackground || SETTINGS_DEFAULTS.selectedBackground
      const bg = this._normalizeBg(rawBg)
      const html = document.documentElement
      // 清除所有旧 gradient-background-* 和新 theme-bg-* 类
      const oldClasses = Array.from(html.classList).filter(c =>
        c.startsWith('gradient-background') || c.startsWith('theme-bg-')
      )
      if (oldClasses.length) html.classList.remove(...oldClasses)

      if (bg && bg.startsWith('theme-bg-')) {
        html.classList.add(bg)
        try { localStorage.setItem('favshub_bg', bg) } catch {}
      } else {
        try { localStorage.removeItem('favshub_bg') } catch {}
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

    /**
     * Write multiple settings and persist immediately (no debounce).
     */
    async setManyNow(data: Record<string, any>) {
      Object.assign(this.settings, data)
      if (import.meta.client) this._applyBackground()
      await this._persistToBackend()
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
        const userData: Record<string, any> = {}
        for (const [k, v] of Object.entries(this.settings)) {
          if (!SYSTEM_ONLY_KEYS.includes(k)) userData[k] = v
        }
        const headers: Record<string, string> = {}
        if (auth.token && auth.token !== 'cookie_auth') {
          headers.Authorization = `Bearer ${auth.token}`
        }
        const res = await $fetch<{ data: Record<string, any> }>('/api/settings', {
          method: 'PUT',
          headers,
          body: { data: userData },
          credentials: 'include',
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
    async updateSettings(data: Record<string, any>, token?: string) {
      const headers: Record<string, string> = {}
      if (token && token !== 'cookie_auth') {
        headers.Authorization = `Bearer ${token}`
      }
      const res = await $fetch<{ data: Record<string, any> }>('/api/settings', {
        method: 'PUT',
        headers,
        body: { data },
        credentials: 'include',
      })
      this.settings = res.data
    },
  },
})
