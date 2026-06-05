/**
 * Pinia Auth Store — 认证状态管理
 * Token 持久化到 localStorage (key: favshub_token)
 */
import { defineStore } from 'pinia'

export interface AuthUser {
  id: number
  username: string
  email?: string | null
  nickname?: string | null
  is_admin?: number
  created_at?: number
}

interface AuthState {
  token: string | null
  user: AuthUser | null
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    token: null,
    user: null,
  }),

  getters: {
    isLoggedIn: (state) => !!state.token,
    isGuest: (state) => !state.token,
    isAdmin: (state) => state.user?.is_admin === 1,
  },

  actions: {
    /**
     * 初始化：从 localStorage 恢复 token 并尝试获取用户信息
     */
    async init() {
      if (import.meta.server) return

      const savedToken = localStorage.getItem('favshub_token')
      if (savedToken) {
        this.token = savedToken
        try {
          await this.fetchMe()
        } catch {
          this.logout()
        }
      }
    },

    /**
     * 登录
     */
    async login(username: string, password: string) {
      const res = await $fetch<{ token: string; user: AuthUser }>('/api/auth/login', {
        method: 'POST',
        body: { username, password },
      })
      this.token = res.token
      this.user = res.user
      localStorage.setItem('favshub_token', res.token)
      return res
    },

    /**
     * 注册
     */
    async register(username: string, password: string, email?: string, nickname?: string) {
      const res = await $fetch<{ token: string; user: AuthUser }>('/api/auth/register', {
        method: 'POST',
        body: { username, password, email, nickname },
      })
      this.token = res.token
      this.user = res.user
      localStorage.setItem('favshub_token', res.token)
      return res
    },

    /**
     * 获取当前用户信息
     */
    async fetchMe() {
      if (!this.token) return
      const res = await $fetch<{ user: AuthUser }>('/api/auth/me', {
        headers: { Authorization: `Bearer ${this.token}` },
      })
      this.user = res.user
    },

    /**
     * 登出
     */
    logout() {
      this.token = null
      this.user = null
      if (import.meta.client) {
        localStorage.removeItem('favshub_token')
      }
    },
  },
})
