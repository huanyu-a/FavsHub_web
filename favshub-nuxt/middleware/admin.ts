/**
 * 客户端路由守卫 — 管理员权限保护
 * 保护 /admin/** 路由
 */
export default defineNuxtRouteMiddleware((to) => {
  if (import.meta.server) return

  const { isLoggedIn, isAdmin } = useAuth()

  if (!isLoggedIn.value) {
    return navigateTo(`/login?redirect=${encodeURIComponent(to.fullPath)}`)
  }

  if (!isAdmin.value) {
    return navigateTo('/')
  }
})
