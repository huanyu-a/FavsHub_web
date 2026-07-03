/**
 * Pinia Auth Store — 认证状态管理
 * Web 端使用 httpOnly cookie 认证（不存储 token 到 localStorage）
 * 扩展端通过响应体获取 token 并存储到 localStorage
 */
import { defineStore } from 'pinia'

export interface AuthUser {
  id: number
  username: string
  email?: string | null
  nickname?: string | null
  is_admin?: boolean | number
  created_at?: number
}

interface AuthState {
  token: string | null
  user: AuthUser | null
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => {
    // 从 localStorage 恢复 token（仅扩展环境或旧版本兼容）
    let token: string | null = null
    if (typeof localStorage !== 'undefined') {
      token = localStorage.getItem('favshub_token') || localStorage.getItem('fh_local_favshub_token')
    }
    return { token, user: null }
  },

  getters: {
    isLoggedIn: (state) => !!state.token || !!state.user,
    isGuest: (state) => !state.token && !state.user,
    isAdmin: (state) => !!state.user?.is_admin,
  },

  actions: {
    /**
     * 初始化：尝试获取当前用户信息（依赖 httpOnly cookie 或 localStorage token）
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
      } else {
        // 无 localStorage token，尝试通过 httpOnly cookie 获取用户信息
        try {
          await this.fetchMe()
        } catch {
          // 未登录，正常情况
        }
      }
    },

    /**
     * 登录（Web 端通过 httpOnly cookie 认证，扩展端使用 token）
     */
    async login(username: string, password: string) {
      const res = await $fetch<{ token?: string; user: AuthUser }>('/api/auth/login', {
        method: 'POST',
        body: { username, password },
        credentials: 'include', // 携带 httpOnly cookie
      })
      this.user = res.user
      // 仅当响应包含 token 时（扩展端）才存储到 localStorage
      if (res.token) {
        this.token = res.token
        localStorage.setItem('favshub_token', res.token)
      } else {
        // Web 端：使用 cookie 认证，设置一个标记表示已登录
        this.token = 'cookie_auth'
      }
      return res
    },

    /**
     * 注册
     */
    async register(username: string, password: string, email?: string, nickname?: string) {
      const res = await $fetch<{ token?: string; user: AuthUser }>('/api/auth/register', {
        method: 'POST',
        body: { username, password, email, nickname },
        credentials: 'include',
      })
      this.user = res.user
      if (res.token) {
        this.token = res.token
        localStorage.setItem('favshub_token', res.token)
      } else {
        this.token = 'cookie_auth'
      }
      return res
    },

    /**
     * 获取当前用户信息
     */
    async fetchMe() {
      // 优先使用 localStorage token（扩展端），否则依赖 httpOnly cookie（Web 端）
      const headers: Record<string, string> = {}
      if (this.token && this.token !== 'cookie_auth') {
        headers.Authorization = `Bearer ${this.token}`
      }

      const res = await $fetch<{ user: AuthUser }>('/api/auth/me', {
        headers,
        credentials: 'include',
      })
      this.user = res.user
    },

    /**
     * 登出
     */
    async logout() {
      this.token = null
      this.user = null
      if (import.meta.client) {
        localStorage.removeItem('favshub_token')
        // 清除服务端 httpOnly cookie
        try { await $fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }) } catch {}
      }
    },
  },
})
