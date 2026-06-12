/**
 * 客户端插件 — 应用启动时恢复认证状态
 *
 * 由于 SSR hydration 会覆盖 Pinia state，因此需要在此处重新从 localStorage 读取 token
 * 并强制写入 store（覆盖 SSR 传递的 token: null）。
 */
import { useAuthStore } from '~/stores/auth'

export default defineNuxtPlugin(async () => {
  const authStore = useAuthStore()

  // 从 localStorage 恢复 token
  const savedToken = localStorage.getItem('favshub_token')
  if (savedToken) {
    authStore.$patch({ token: savedToken })
    // 异步获取用户信息，失败则登出
    try {
      await authStore.fetchMe()
    } catch {
      authStore.logout()
    }
  }
})
