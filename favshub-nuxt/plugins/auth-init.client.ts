/**
 * 客户端插件 — 应用启动时恢复认证状态
 *
 * 优先尝试 httpOnly cookie 认证（Web 端，更安全），
 * 回退到 localStorage token（扩展端兼容）。
 */
import { useAuthStore } from '~/stores/auth'
import { useSettingsStore } from '~/stores/settings'

export default defineNuxtPlugin(async () => {
  const authStore = useAuthStore()

  // 尝试从 localStorage 恢复 token（扩展端）
  const savedToken = localStorage.getItem('favshub_token')
  if (savedToken) {
    authStore.$patch({ token: savedToken })
    try {
      await authStore.fetchMe()
      const settingsStore = useSettingsStore()
      await settingsStore.fetchSettings(savedToken)
    } catch {
      authStore.logout()
    }
  } else {
    // Web 端：尝试通过 httpOnly cookie 获取用户信息
    try {
      await authStore.fetchMe()
      if (authStore.user) {
        authStore.$patch({ token: 'cookie_auth' })
        const settingsStore = useSettingsStore()
        await settingsStore.fetchSettings()
      }
    } catch {
      // 未登录，正常情况
    }
  }
})
