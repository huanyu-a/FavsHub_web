/**
 * useAuth composable — 认证状态响应式封装
 * 提供 isGuest/isLoggedIn/user 等便捷引用
 */
import { storeToRefs } from 'pinia'
import { useAuthStore } from '~/stores/auth'

export function useAuth() {
  const store = useAuthStore()
  const { isLoggedIn, isGuest, isAdmin, user, token } = storeToRefs(store)

  return {
    // 响应式引用
    isLoggedIn,
    isGuest,
    isAdmin,
    user,
    token,
    // 方法
    login: store.login.bind(store),
    register: store.register.bind(store),
    logout: store.logout.bind(store),
    fetchMe: store.fetchMe.bind(store),
    init: store.init.bind(store),
  }
}
