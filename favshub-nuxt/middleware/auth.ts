/**
 * 客户端路由守卫 — 认证保护
 * 保护需要登录的页面
 */
export default defineNuxtRouteMiddleware((to) => {
  if (import.meta.server) return

  const { isLoggedIn } = useAuth()

  // 受保护的页面列表（登录页不需要守卫）
  if (to.path === '/login') return

  if (!isLoggedIn.value && to.meta.requiresAuth) {
    return navigateTo(`/login?redirect=${encodeURIComponent(to.fullPath)}`)
  }
})
