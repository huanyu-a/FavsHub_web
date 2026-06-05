/**
 * 客户端插件 — 应用启动时恢复认证状态
 * 从 localStorage 读取 token 并调用 /api/auth/me
 */
import { useAuthStore } from '~/stores/auth'

export default defineNuxtPlugin(() => {
  const authStore = useAuthStore()

  if (import.meta.client) {
    // 同步读取 token 设置状态（立即生效，不阻塞渲染）
    const savedToken = localStorage.getItem('favshub_token')
    if (savedToken) {
      authStore.token = savedToken
      // 异步获取用户信息，失败则登出
      authStore.fetchMe().catch(() => authStore.logout())
    }
  }
})
