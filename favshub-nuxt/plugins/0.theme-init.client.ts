/**
 * 客户端插件 — 应用启动早期同步主题偏好到 store + 退场首屏防闪样式
 *
 * 文件名前缀 0. 保证早于 auth-init.client.ts 执行。
 *
 * 职责一：反同步主题偏好到 store
 * - SSR 阻塞脚本（server/plugins/theme-init.ts）已在首屏正确设置 <html data-theme>，视觉无闪烁。
 * - 但 Pinia store 默认 theme:'auto'，需尽早从 localStorage/DOM 反同步为用户真实偏好，
 *   否则在布局 setup 执行前读 uiStore.theme 会拿到错值。
 * - 关键：login 等 `layout:false` 页面不经过 default/admin 布局，
 *   useTheme().initThemeWatchers() 不会执行，此插件是这些页面唯一的 store 同步入口。
 * - 只反同步 store，不重写 DOM（信任 SSR 注入，避免 FOUC）。
 *
 * 职责二：app 挂载后移除 SSR 注入的防闪内联 <style id="__fh_anti_flash">
 * - 那段 style 把背景色以硬编码 + ID 特异性钉在 #__nuxt/main/#sidebar-container 上，
 *   仅用于首屏 CSS 加载前防白闪。
 * - 一旦 main-bundle.css 就位，必须移除它，否则它会盖过 [data-theme] 规则：
 *   系统深浅色切换 / 手动切换时 data-theme 已变，但背景被它锁死旧色，须刷新才生效。
 * - app:mounted 时全局样式表已注入，再等一帧渲染后移除，无闪烁窗口。
 */
import { useUIStore } from '~/stores/ui'

export default defineNuxtPlugin((nuxtApp) => {
  const ui = useUIStore()
  try {
    const ls = localStorage.getItem('favshub_theme') as 'light' | 'dark' | 'auto' | null
    if (ls && ['light', 'dark', 'auto'].includes(ls)) {
      ui.theme = ls
    } else {
      // 无 localStorage 记录：从 SSR 已注入的 data-theme 推断（解析后的 light/dark）
      const dom = document.documentElement.getAttribute('data-theme')
      if (dom === 'dark' || dom === 'light') ui.theme = dom
    }
  } catch {
    // localStorage 不可用时保持 store 默认 'auto'
  }

  // app 挂载后，等一帧确保 main-bundle.css 已应用，再移除防闪 style
  nuxtApp.hook('app:mounted', () => {
    requestAnimationFrame(() => {
      document.getElementById('__fh_anti_flash')?.remove()
    })
  })
})
