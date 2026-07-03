/**
 * 客户端插件 — 应用启动早期同步主题偏好到 store
 *
 * 文件名前缀 0. 保证早于 auth-init.client.ts 执行。
 *
 * 职责一：反同步主题偏好到 store
 * - SSR 已在 <html> 上注入 data-theme + class，视觉无闪烁。
 * - 但 Pinia store 默认 theme:'auto'，需尽早从 localStorage/DOM 反同步为用户真实偏好，
 *   否则在布局 setup 执行前读 uiStore.theme 会拿到错值。
 * - 关键：login 等 `layout:false` 页面不经过 default/admin 布局，
 *   useTheme().initThemeWatchers() 不会执行，此插件是这些页面唯一的 store 同步入口。
 * - 只反同步 store，不重写 DOM（信任 SSR 注入，避免 FOUC）。
 *
 * 职责二：cookie 迁移
 * - 已有 localStorage 偏好但无 cookie 的老用户，首次加载时自动写入 cookie，
 *   使后续请求走 SSR 直出路径。
 */
import { useUIStore } from '~/stores/ui'
import { getThemeCookie, setThemeCookie, setBackgroundCookie, getBackgroundCookie } from '~/utils/themeCookie'

export default defineNuxtPlugin((nuxtApp) => {
  const ui = useUIStore()

  // 仅做 cookie 迁移（不修改 store，避免 hydration mismatch）
  try {
    const ls = localStorage.getItem('favshub_theme') as 'light' | 'dark' | 'auto' | null
    if (ls && !getThemeCookie()) {
      setThemeCookie(ls)
    }
    const bgLs = localStorage.getItem('favshub_bg')
    if (bgLs && !getBackgroundCookie()) {
      setBackgroundCookie(bgLs)
    }
  } catch {
    // localStorage 不可用时跳过
  }

  // hydration 完成后同步主题到 store（此时 DOM 已由 SSR 正确设置）
  nuxtApp.hook('app:mounted', () => {
    try {
      const ls = localStorage.getItem('favshub_theme') as 'light' | 'dark' | 'auto' | null
      if (ls && ['light', 'dark', 'auto'].includes(ls)) {
        ui.theme = ls
      } else {
        const dom = document.documentElement.getAttribute('data-theme')
        if (dom === 'dark' || dom === 'light') ui.theme = dom
      }
    } catch {
      // 保持 store 默认 'auto'
    }
  })
})
