/**
 * 主题/背景 cookie 工具 — 替代纯 localStorage 驱动的首屏防闪
 *
 * 与 localStorage 双写：cookie 给 SSR 读，localStorage 给客户端 anti-flash 回退读。
 * cookie 优先级高于 localStorage（SSR 已据此渲染，客户端不能反着来）。
 */

const THEME_KEY = 'fh_theme'
const BG_KEY = 'fh_bg'
const MAX_AGE = 365 * 24 * 60 * 60 // 1 年

function writeCookie(name: string, value: string): void {
  document.cookie = `${name}=${encodeURIComponent(value)};path=/;max-age=${MAX_AGE};SameSite=Lax`
}

function readCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))
  return m ? decodeURIComponent(m[1]) : null
}

export function setThemeCookie(theme: 'light' | 'dark' | 'auto'): void {
  writeCookie(THEME_KEY, theme)
}

export function getThemeCookie(): 'light' | 'dark' | 'auto' | null {
  const v = readCookie(THEME_KEY)
  if (v === 'light' || v === 'dark' || v === 'auto') return v
  return null
}

export function setBackgroundCookie(bg: string): void {
  writeCookie(BG_KEY, bg)
}

export function getBackgroundCookie(): string | null {
  return readCookie(BG_KEY)
}

/**
 * 解析有效主题色（cookie > localStorage > 系统偏好）
 * auto 时读 matchMedia 解析为 light/dark。
 */
export function resolveEffectiveTheme(): 'light' | 'dark' {
  const cookie = getThemeCookie()
  const stored = cookie || (localStorage.getItem('favshub_theme') as 'light' | 'dark' | 'auto' | null)
  const theme = stored || 'auto'
  if (theme === 'light' || theme === 'dark') return theme
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** 取当前背景值（cookie > localStorage > 默认） */
export function resolveBackground(): string {
  return getBackgroundCookie() || localStorage.getItem('favshub_bg') || 'gradient-background-7'
}
