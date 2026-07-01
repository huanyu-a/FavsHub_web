/**
 * Nitro plugin: 消除页面加载时的白色闪烁（cookie 驱动版）
 *
 * 优先级：
 * 1. cookie（用户已选过主题）→ SSR 直接注入正确主题，零闪烁
 * 2. Sec-CH-Prefers-Color-Scheme 请求头 → auto 模式也能 SSR 精确
 * 3. 无 cookie + 无头 → 默认浅色 + 客户端 anti-flash 脚本兜底
 *
 * 不再使用 document.write — 改用 document.createElement('style') 注入。
 * cookie 由客户端 utils/themeCookie.ts 双写（localStorage 镜像）。
 *
 * 注意：gradient-background-N 是整段渐变，不纳入本文件处理，
 * 仅在无 cookie 兜底脚本中通过 class + 颜色映射近似覆盖。
 */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('render:html', (html, { event }) => {
    // ── 读 cookie（无 event 时跳过，如 prerender） ──
    const themeCookie = event ? getCookie(event, 'fh_theme') : undefined
    const bgCookie = event ? getCookie(event, 'fh_bg') : undefined

    const theme = (themeCookie === 'light' || themeCookie === 'dark' || themeCookie === 'auto')
      ? themeCookie
      : null

    const bg = bgCookie || null

    // ── 有 cookie → SSR 直接注入精确主题 ──
    if (theme) {
      let effective: 'light' | 'dark' = 'light'
      let colorScheme = 'light'

      if (theme === 'auto') {
        // 读 Client Hint 精确判断；无头则默认 light
        const prefersDark = event
          ? getRequestHeader(event, 'Sec-CH-Prefers-Color-Scheme') === 'dark'
          : false
        effective = prefersDark ? 'dark' : 'light'
        colorScheme = 'light dark' // auto 双值，让浏览器跟随系统
      } else {
        effective = theme
        colorScheme = theme
      }

      html.htmlAttrs.push(`data-theme="${effective}"`)
      html.htmlAttrs.push(`style="color-scheme:${colorScheme}"`)

      // 服务端解码 auth token 注入 data-admin（仅用于 UI 样式，非安全守卫）
      const authToken = getCookie(event, 'favshub_token')
      if (authToken) {
        try {
          const payload = JSON.parse(Buffer.from(authToken.split('.')[1], 'base64url').toString())
          if (payload.isAdmin) {
            html.htmlAttrs.push('data-admin="true"')
          }
        } catch (_) {}
      }

      // 替换 defaultCSS：精确背景色
      const bgColor = effective === 'dark' ? '#0B1120' : '#F8F7F4'
      html.head.unshift(
        `<style id="__fh_anti_flash">html,body,#__nuxt,aside,main,#sidebar-container,.custom-width{background:${bgColor}}</style>`
      )
      return // 有 cookie，不需要兜底脚本
    }

    // ── 无 cookie → 默认浅色 + 客户端兜底脚本 ──
    html.head.unshift(
      `<style id="__fh_anti_flash">html,body,#__nuxt,aside,main,#sidebar-container,.custom-width{background:#F8F7F4;color-scheme:light}</style>`
    )

    // 非阻塞脚本：无 document.write，用 createElement 注入
    // 仅处理 SSR 无法覆盖的场景（首访无 cookie）
    html.head.unshift(`<script>(function(){
var h=document.documentElement,s=document.createElement('style');
s.id='__fh_anti_flash';
try{
var th=localStorage.getItem('favshub_theme')||'auto';
if(th==='auto'){th=matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light'}
h.setAttribute('data-theme',th);
var bgc=th==='dark'?'#0B1120':(function(){
var bg=localStorage.getItem('favshub_bg')||'gradient-background-7';
h.classList.add(bg);
var m={'gradient-background-1':'#CBD5E1','gradient-background-2':'#BFDBFE','gradient-background-3':'#E9D5FF','gradient-background-4':'#F2F8F0','gradient-background-5':'#FCFCF7','gradient-background-6':'#F4F1F8','gradient-background-7':'#F8F7F4'};
return m[bg]||'#F8F7F4'
})();
s.textContent='html,body,#__nuxt,aside,main,#sidebar-container,.custom-width{background:'+bgc+';color-scheme:'+th+'}';
var t=localStorage.getItem('favshub_token')||localStorage.getItem('fh_local_favshub_token');
if(t){h.setAttribute('data-guest','false');try{var p=JSON.parse(atob(t.split('.')[1]));if(p.isAdmin)h.setAttribute('data-admin','true')}catch(e){}}
else{h.setAttribute('data-guest','true')}
}catch(e){}
document.head.appendChild(s);
// 清理由 0.theme-init.client.ts 的 app:mounted hook 负责
})()</script>`)
  })
})
