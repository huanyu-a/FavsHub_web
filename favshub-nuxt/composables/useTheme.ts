import { useUIStore } from '~/stores/ui'
import { useSettingsStore } from '~/stores/settings'
import { useAuthStore } from '~/stores/auth'
import { onScopeDispose } from 'vue'
import { setBackgroundCookie } from '~/utils/themeCookie'

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

  /** 解析主题为实际生效值（auto 时根据系统偏好） */
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
    const html = document.documentElement
    html.setAttribute('data-theme', effective)
    html.style.colorScheme = effective
  }

  /** 设置主题（完整流程：store + localStorage + 后端 + DOM） */
  function setTheme(t: Theme) {
    if (!document.startViewTransition || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      uiStore.setTheme(t)
      return
    }
    document.startViewTransition(() => {
      uiStore.setTheme(t)
    })
  }

  /** 三态循环切换：light、dark、auto 依次循环 */
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
   * 2. 响应 store 主题变化并应用到 DOM
   * 3. 监听系统主题变化（auto 模式下）
   * 4. 响应后端 settings 变化并同步到 store
   */
  function initThemeWatchers() {
    if (import.meta.server) return

    // 1. hydrate 时从 DOM/localStorage 同步 store（信任 SSR 注入，避免 FOUC）
    syncFromDOM()

    // 2. 响应 uiStore.theme 变化并应用到 DOM（非 immediate，不覆盖 SSR 注入）
    watch(() => uiStore.theme, (t) => {
      const effective = resolveTheme(t)
      const html = document.documentElement
      html.setAttribute('data-theme', effective)
      html.style.colorScheme = effective
    })

    // 3. 监听系统主题变化（auto 模式下响应）
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => {
      if (uiStore.theme === 'auto') {
        const effective = resolveTheme('auto')
        const html = document.documentElement
        html.setAttribute('data-theme', effective)
        html.style.colorScheme = effective
      }
    }
    mql.addEventListener('change', handler)
    onScopeDispose(() => mql.removeEventListener('change', handler))

    // 4. 响应后端 settings 变化并同步到 store（用 setTheme 确保写 localStorage）
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
    //    新主题体系：浅色主题在浅色模式生效，深色主题在深色模式生效
    //    CSS 选择器 html[data-theme="..."].theme-bg-xxx 负责模式匹配，
    //    因此无需在 JS 中判断模式，直接添加 class 即可。
    //    immediate 应用初始值；但游客场景下，初始值来自系统默认而非本地选择，
    //    因此游客只在「确有本地背景」时才以 localStorage 为准（见下方 guestBg 兜底）。

    /** 已下线主题迁移目标（与服务端 theme-init.ts 保持一致） */
    const THEME_MIGRATIONS: Record<string, string> = {
      'theme-bg-2': 'theme-bg-tian-qing',
      'theme-bg-3': 'theme-bg-6',
      'theme-bg-5': 'theme-bg-hu-po',
      'theme-bg-chen-guang': 'theme-bg-tian-qing',
    }

    /** 将旧 gradient-background-N 值迁移为 theme-bg-N，并归并已下线主题 */
    function normalizeBg(bg: string): string {
      if (!bg) return ''
      const m = bg.match(/^gradient-background-(\d+)$/)
      if (m) return `theme-bg-${m[1]}`
      return THEME_MIGRATIONS[bg] || bg
    }

    function applyBackground() {
      const rawBg = settingsStore.get('selectedBackground') as string
      const bg = normalizeBg(rawBg)
      // 游客：忽略来自系统默认的背景同步，保留 localStorage 中的本地选择
      if (!authStore.isLoggedIn) {
        const localBg = (() => { try { return localStorage.getItem('favshub_bg') } catch { return null } })()
        const normalizedLocal = normalizeBg(localBg || '')
        // 已有本地选择且与传入值不同时不让系统默认覆盖（首屏脚本已据 localStorage 应用）
        if (normalizedLocal && normalizedLocal !== bg) return
      }
      const html = document.documentElement
      // 清除所有旧 gradient-background-* 和新 theme-bg-* 类
      const oldClasses = Array.from(html.classList).filter(c =>
        c.startsWith('gradient-background') || c.startsWith('theme-bg-')
      )
      if (oldClasses.length) html.classList.remove(...oldClasses)

      if (bg && bg.startsWith('theme-bg-')) {
        html.classList.add(bg)
        try { localStorage.setItem('favshub_bg', bg) } catch {}
        try { setBackgroundCookie(bg) } catch {}
      } else {
        try { localStorage.removeItem('favshub_bg') } catch {}
      }
    }
    watch(() => settingsStore.get('selectedBackground'), applyBackground, { immediate: true })
    // 主题切换时也要重新应用背景（明暗切换时 CSS 选择器自动匹配）
    watch(() => uiStore.theme, applyBackground)
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
