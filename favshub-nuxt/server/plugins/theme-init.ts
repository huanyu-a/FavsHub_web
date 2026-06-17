/**
 * Nitro plugin: 消除页面加载时的白色闪烁
 *
 * 两层防护：
 * 1. SSR 默认 <style> — 未登录 / 首次访问用户看到正确的默认背景（浅色 #F8F7F4）
 * 2. 阻塞 <script> — 读 localStorage，document.write 写入用户实际偏好色，覆盖默认
 *
 * 已登录深色用户：默认浅色 → JS 立即覆盖深色，无绘制间隙
 * 未登录 / 新用户：默认浅色直接就是终态
 */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('render:html', (html) => {
    // SSR 默认背景：未登录/新用户直接得到正确的浅色背景
    const defaultCSS = `<style>html,body,#__nuxt,aside,main,#sidebar-container,.custom-width{background:#F8F7F4;color-scheme:light}</style>`

    // 阻塞脚本：读本地偏好 → document.write 注入实际主题色（高优先级覆盖默认）
    const initScript = `<script>(function(){var h=document.documentElement;try{var th=localStorage.getItem('favshub_theme')||'light';if(th==='auto'){th=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}h.setAttribute('data-theme',th);var bgc;if(th==='dark'){bgc='#0B1120'}else{var bg=localStorage.getItem('favshub_bg')||'gradient-background-7';h.classList.add(bg);var m={'gradient-background-1':'#CBD5E1','gradient-background-2':'#BFDBFE','gradient-background-3':'#E9D5FF','gradient-background-4':'#F2F8F0','gradient-background-5':'#FCFCF7','gradient-background-6':'#F4F1F8','gradient-background-7':'#F8F7F4'};bgc=m[bg]||'#F8F7F4'}document.write('<style>html,body,#__nuxt,aside,main,#sidebar-container,.custom-width{background:'+bgc+';color-scheme:'+th+'}</style>');var t=localStorage.getItem('favshub_token')||localStorage.getItem('fh_local_favshub_token');if(t){h.setAttribute('data-guest','false');try{var p=JSON.parse(atob(t.split('.')[1]));if(p.isAdmin)h.setAttribute('data-admin','true')}catch(e){}}else{h.setAttribute('data-guest','true')}}catch(e){}})()</script>`

    html.head.unshift(initScript)
    html.head.unshift(defaultCSS)
  })
})
