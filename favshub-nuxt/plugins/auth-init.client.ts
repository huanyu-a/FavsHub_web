/**
 * 客户端插件 — 应用启动时恢复认证状态
 * 从 localStorage 读取 token 并调用 /api/auth/me
 */
import { useAuthStore } from '~/stores/auth'

export default defineNuxtPlugin(() => {
  const authStore = useAuthStore()

  // 仅在客户端执行
  if (import.meta.client) {
    authStore.init()
  }
})
