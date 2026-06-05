/**
 * 路由守卫 — 管理员权限保护
 * 保护 /admin/** 路由
 * - SSR 时：检查 cookie 中的 token（服务端中间件做完整验证）
 * - 客户端：检查 Pinia store 状态
 */
import { useAuthStore } from '~/stores/auth'

export default defineNuxtRouteMiddleware((to) => {
  // SSR: 快速检查 cookie 是否存在，无 cookie 直接跳转
  if (import.meta.server) {
    const cookieHeader = useRequestHeaders(['cookie']).cookie || ''
    if (!cookieHeader.includes('favshub_token=')) {
      return navigateTo(`/login?redirect=${encodeURIComponent(to.fullPath)}`)
    }
    return // cookie 存在，由 server/middleware/admin-guard.ts 做完整 JWT 验证
  }

  // 客户端: 检查 store 状态
  const authStore = useAuthStore()

  if (!authStore.isLoggedIn) {
    return navigateTo(`/login?redirect=${encodeURIComponent(to.fullPath)}`)
  }

  if (!authStore.isAdmin) {
    return navigateTo('/')
  }
})
