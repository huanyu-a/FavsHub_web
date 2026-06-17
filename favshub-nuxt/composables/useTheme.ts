import { useUIStore } from '~/stores/ui'
import { useSettingsStore } from '~/stores/settings'
import { useAuthStore } from '~/stores/auth'
import { onScopeDispose } from 'vue'

type Theme = 'light' | 'dark' | 'auto'
type EffectiveTheme = 'light' | 'dark'

/**
 * 主题管理 composable
 *
 * 集中处理主题应用、持久化、系统偏好监听。
 * 替代 layouts/default.vue 和 layouts/admin.vue 中的内联 watcher 逻辑。
 *
 * 核心约定：
 * - data-theme 属性只设在 documentElement（<html>），不设在 <body>
 * - store.theme 存原始偏好（含 auto），DOM 上的 data-theme 是解析后的值（light/dark）
 * - hydrate 时从 DOM/localStorage 反向同步 store（信任 SSR 注入，避免 FOUC）
 */
export function useTheme() {
  const uiStore = useUIStore()
  const settingsStore = useSettingsStore()
  const authStore = useAuthStore()

  /** 解析主题为实际生效值（auto → 根据系统偏好） */
  function resolveTheme(t: Theme): EffectiveTheme {
    if (t === 'auto') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    return t
  }

  /** 应用当前 store 主题到 DOM */
  function applyTheme() {
    if (import.meta.server) return
    const effective = resolveTheme(uiStore.theme)
    document.documentElement.setAttribute('data-theme', effective)
  }

  /** 设置主题（完整流程：store + localStorage + 后端 + DOM） */
  function setTheme(t: Theme) {
    uiStore.setTheme(t)
  }

  /** 三态循环切换：light → dark → auto → light */
  function cycleTheme() {
    const order: Theme[] = ['light', 'dark', 'auto']
    const idx = order.indexOf(uiStore.theme)
    const next = order[(idx + 1) % order.length]
    setTheme(next)
  }

  /**
   * 从 DOM/localStorage 反向同步到 store（hydrate 时信任 SSR 注入的 data-theme）
   * 修复 FOUC：不用 store 初始值覆盖 DOM
   */
  function syncFromDOM() {
    if (import.meta.server) return
    try {
      const ls = localStorage.getItem('favshub_theme') as Theme | null
      if (ls && ['light', 'dark', 'auto'].includes(ls)) {
        uiStore.theme = ls
      } else {
        // 无 localStorage 记录，从 DOM 推断（SSR 注入的是解析后的值）
        const domTheme = document.documentElement.getAttribute('data-theme') as EffectiveTheme | null
        if (domTheme) uiStore.theme = domTheme
      }
    } catch {
      // localStorage 不可用时保持默认 'auto'
    }
  }

  /**
   * 启动主题监听（在每个布局的 setup 中调用一次）
   *
   * 1. 从 DOM/localStorage 同步 store（修复 FOUC）
   * 2. 响应 store 主题变化 → 应用到 DOM
   * 3. 监听系统主题变化（auto 模式下）
   * 4. 响应后端 settings 变化 → 同步到 store
   */
  function initThemeWatchers() {
    if (import.meta.server) return

    // 1. hydrate 时从 DOM/localStorage 同步 store（信任 SSR 注入，避免 FOUC）
    syncFromDOM()

    // 2. 响应 uiStore.theme 变化 → 应用到 DOM（非 immediate，不覆盖 SSR 注入）
    watch(() => uiStore.theme, (t) => {
      const effective = resolveTheme(t)
      document.documentElement.setAttribute('data-theme', effective)
    })

    // 3. 监听系统主题变化（auto 模式下响应）
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => {
      if (uiStore.theme === 'auto') {
        const effective = resolveTheme('auto')
        document.documentElement.setAttribute('data-theme', effective)
      }
    }
    mql.addEventListener('change', handler)
    onScopeDispose(() => mql.removeEventListener('change', handler))

    // 4. 响应后端 settings 变化 → 同步到 store（用 setTheme 确保写 localStorage）
    //    仅登录用户：后端 settings 才是其主题真值。
    //    游客的主题真值是 localStorage（由 setTheme/cycleTheme 驱动），
    //    fetchSettings 对游客返回的是系统默认（theme=auto），不能用它覆盖游客的本地选择。
    watch(() => settingsStore.get('theme'), (t: string) => {
      if (!authStore.isLoggedIn) return
      if (t && t !== uiStore.theme) {
        uiStore.setTheme(t as Theme)
      }
    })

    // 5. 响应背景设置变化，更新 <html> 类名和 localStorage
    //    immediate 应用初始值；但游客场景下，初始值来自系统默认而非本地选择，
    //    因此游客只在「确有本地背景」时才以 localStorage 为准（见下方 guestBg 兜底）。
    watch(() => settingsStore.get('selectedBackground'), (bg: string) => {
      // 游客：忽略来自系统默认的背景同步，保留 localStorage 中的本地选择
      if (!authStore.isLoggedIn) {
        const localBg = (() => { try { return localStorage.getItem('favshub_bg') } catch { return null } })()
        // 已有本地选择且与传入值不同 → 不让系统默认覆盖（首屏脚本已据 localStorage 应用）
        if (localBg && localBg !== bg) return
      }
      const html = document.documentElement
      const oldClasses = Array.from(html.classList).filter(c => c.startsWith('gradient-background'))
      if (oldClasses.length) html.classList.remove(...oldClasses)
      if (bg && bg.startsWith('gradient-background')) {
        html.classList.add(bg)
        try { localStorage.setItem('favshub_bg', bg) } catch {}
      } else {
        try { localStorage.removeItem('favshub_bg') } catch {}
      }
    }, { immediate: true })
  }

  /** 当前是否为深色（用于图标显示） */
  const isDark = computed(() => {
    if (import.meta.server) return false
    return resolveTheme(uiStore.theme) === 'dark'
  })

  /** 当前主题标签（用于 tooltip） */
  const themeLabel = computed(() => {
    const labels: Record<Theme, string> = { light: '浅色', dark: '深色', auto: '跟随系统' }
    return labels[uiStore.theme]
  })

  return {
    theme: computed(() => uiStore.theme),
    isDark,
    themeLabel,
    setTheme,
    cycleTheme,
    applyTheme,
    initThemeWatchers,
  }
}
