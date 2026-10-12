/**
 * Cloudflare Turnstile 脚本懒加载（浏览器侧）
 *
 * 只在游客通道真的要用时才注入脚本 —— 不让每个普通访客都多付一个第三方请求。
 * 加载失败/超时会 reject，调用方据此回落到算术题：挂件来自
 * challenges.cloudflare.com，境内无代理访客很可能加载不出来，不能因此把人挡在门外。
 */
const SCRIPT_ID = 'favshub-turnstile-script'
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

let pending: Promise<any> | null = null

/** 加载并返回 window.turnstile（多次调用共享同一次加载） */
export function loadTurnstileScript(timeoutMs = 8000): Promise<any> {
  if (typeof window === 'undefined') return Promise.reject(new Error('Turnstile 仅浏览器可用'))
  const api = (window as any).turnstile
  if (api?.render) return Promise.resolve(api)
  if (pending) return pending

  pending = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending = null
      reject(new Error('人机验证组件加载超时'))
    }, timeoutMs)
    const onLoad = () => {
      clearTimeout(timer)
      const loaded = (window as any).turnstile
      if (loaded?.render) resolve(loaded)
      else {
        pending = null
        reject(new Error('人机验证组件未就绪'))
      }
    }
    const onFail = () => {
      clearTimeout(timer)
      pending = null
      reject(new Error('人机验证组件加载失败'))
    }

    // 两个表单可能同时打开（列表页弹窗），复用已注入的 script 标签
    const exist = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null
    if (exist) {
      exist.addEventListener('load', onLoad, { once: true })
      exist.addEventListener('error', onFail, { once: true })
      return
    }
    const el = document.createElement('script')
    el.id = SCRIPT_ID
    el.src = SCRIPT_SRC
    el.async = true
    el.defer = true
    el.addEventListener('load', onLoad, { once: true })
    el.addEventListener('error', onFail, { once: true })
    document.head.appendChild(el)
  })
  return pending
}
