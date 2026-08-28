/**
 * Nitro plugin: SSR 注入主题属性（零闪烁）
 *
 * 仅在 <html> 上注入 data-theme / color-scheme / class，
 * 不再用内联 <style> 硬编码背景色——背景由 CSS 规则自然接管：
 *   - themes.css 中 html[data-theme="light"].theme-bg-xxx { background: ... }
 *   - themes.css 中 html[data-theme="dark"].theme-bg-xxx { background: ... }
 *
 * 新主题体系：浅色主题在浅色模式生效，深色主题在深色模式生效。
 * SSR 直接注入 theme-bg-* class，CSS 选择器负责模式匹配。
 *
 * 优先级：
 * 1. cookie（用户已选过主题）→ SSR 直接注入正确主题 + 背景类
 * 2. Sec-CH-Prefers-Color-Scheme 请求头 → auto 模式也能 SSR 精确
 * 3. 无 cookie → 默认浅色 + 客户端兜底脚本
 */

/** 所有有效主题 class（含旧值自动迁移） */
const VALID_THEMES: Record<string, true> = {
  // 浅色主题
  'theme-bg-1': true, 'theme-bg-4': true, 'theme-bg-6': true,
  'theme-bg-7': true,
  'theme-bg-tian-qing': true, 'theme-bg-hu-po': true, 'theme-bg-na-tie': true,
  // 深色主题
  'theme-bg-mo-ye': true, 'theme-bg-xing-yun': true,
  'theme-bg-ji-guang': true, 'theme-bg-zi-teng': true,
}

/** 已下线主题 → 迁移目标 */
const THEME_MIGRATIONS: Record<string, string> = {
  'theme-bg-2': 'theme-bg-tian-qing',
  'theme-bg-3': 'theme-bg-6',
  'theme-bg-5': 'theme-bg-hu-po',
  'theme-bg-chen-guang': 'theme-bg-tian-qing',
}

/** 将旧值（gradient-background-N / 已下线主题）迁移为现行主题 class */
function normalizeBg(bg: string | undefined): string | null {
  if (!bg) return null
  const m = bg.match(/^gradient-background-(\d+)$/)
  if (m) {
    const legacy = `theme-bg-${m[1]}`
    return THEME_MIGRATIONS[legacy] || legacy
  }
  if (THEME_MIGRATIONS[bg]) return THEME_MIGRATIONS[bg]
  if (VALID_THEMES[bg]) return bg
  return null
}

const DEFAULT_BG = 'theme-bg-7'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('render:html', (html, { event }) => {
    const themeCookie = event ? getCookie(event, 'fh_theme') : undefined
    const bgCookie = event ? getCookie(event, 'fh_bg') : undefined

    const theme = (themeCookie === 'light' || themeCookie === 'dark' || themeCookie === 'auto')
      ? themeCookie
      : null

    const bg = normalizeBg(bgCookie)

    // ── 有 cookie → SSR 直接注入 html 属性 ──
    if (theme) {
      let effective: 'light' | 'dark' = 'light'
      let colorScheme = 'light'

      if (theme === 'auto') {
        const prefersDark = event
          ? getRequestHeader(event, 'Sec-CH-Prefers-Color-Scheme') === 'dark'
          : false
        effective = prefersDark ? 'dark' : 'light'
        colorScheme = 'light dark'
      } else {
        effective = theme
        colorScheme = theme
      }

      html.htmlAttrs.push(`data-theme="${effective}"`)
      html.htmlAttrs.push(`style="color-scheme:${colorScheme}"`)

      // 注入 theme-bg-* class（CSS 选择器负责模式匹配）
      const bgClass = bg || DEFAULT_BG
      html.htmlAttrs.push(`class="${bgClass}"`)

      // 服务端解码 auth token 注入 data-admin
      const authToken = getCookie(event, 'favshub_token')
      if (authToken) {
        try {
          const payload = JSON.parse(Buffer.from(authToken.split('.')[1], 'base64url').toString())
          if (payload.isAdmin) {
            html.htmlAttrs.push('data-admin="true"')
          }
        } catch (_) {}
      }
      return
    }

    // ── 无 cookie → 客户端兜底脚本（首访用户） ──
    html.head.unshift(`<script>(function(){
var h=document.documentElement;
try{
var th=localStorage.getItem('favshub_theme')||'auto';
if(th==='auto'){th=matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light'}
h.setAttribute('data-theme',th);
h.style.colorScheme=th;
var bg=localStorage.getItem('favshub_bg')||'${DEFAULT_BG}';
// 迁移旧 gradient-background-N 与已下线主题
var m=bg.match(/^gradient-background-(\\d+)$/);
if(m) bg='theme-bg-'+m[1];
var MIG={'theme-bg-2':'theme-bg-tian-qing','theme-bg-3':'theme-bg-6','theme-bg-5':'theme-bg-hu-po','theme-bg-chen-guang':'theme-bg-tian-qing'};
if(MIG[bg]) bg=MIG[bg];
h.classList.add(bg);
var t=localStorage.getItem('favshub_token');
if(t&&t!=='cookie_auth'){try{var p=JSON.parse(atob(t.split('.')[1]));if(p.isAdmin)h.setAttribute('data-admin','true')}catch(e){}}
}catch(e){}
})()</script>`)
  })
})
