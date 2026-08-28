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
    // 从 storage 恢复 token（扩展环境或旧版本兼容）。
    // frontend #5：JWT 改为 sessionStorage（标签页级生命周期），降低 XSS 窃取长期持有 token 的风险；
    // localStorage 仅作为旧版本遗留 token 的回退读取来源。
    return { token: readStoredToken(), user: null }
  },

  getters: {
    isLoggedIn: (state) => !!state.token || !!state.user,
    isGuest: (state) => !state.token && !state.user,
    isAdmin: (state) => !!state.user?.is_admin,
  },

  actions: {
    /**
     * 初始化：尝试获取当前用户信息（依赖 httpOnly cookie 或存储的 token）
     */
    async init() {
      if (import.meta.server) return

      const savedToken = readStoredToken()
      if (savedToken) {
        this.token = savedToken
        try {
          await this.fetchMe()
        } catch {
          this.logout()
        }
      } else {
        // 无存储 token，尝试通过 httpOnly cookie 获取用户信息
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
      // 仅当响应包含 token 时（扩展端）才存储，且使用 sessionStorage 降低 XSS 窃取风险
      if (res.token) {
        this.token = res.token
        writeStoredToken(res.token)
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
        writeStoredToken(res.token)
      } else {
        this.token = 'cookie_auth'
      }
      return res
    },

    /**
     * 获取当前用户信息
     */
    async fetchMe() {
      // 优先使用存储的 token（扩展端），否则依赖 httpOnly cookie（Web 端）
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
        clearStoredToken()
        // 清除服务端 httpOnly cookie
        try { await $fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }) } catch {}
      }
    },
  },
})

const TOKEN_KEY = 'favshub_token'

/** 读取存储的 token：优先 sessionStorage（当前标签页），回退 localStorage（旧版本遗留） */
function readStoredToken(): string | null {
  try {
    if (typeof sessionStorage !== 'undefined') {
      const s = sessionStorage.getItem(TOKEN_KEY)
      if (s) return s
    }
    if (typeof localStorage !== 'undefined') {
      const l = localStorage.getItem(TOKEN_KEY) || localStorage.getItem('fh_local_favshub_token')
      if (l) return l
    }
  } catch { /* storage 不可用（隐私模式）时忽略 */ }
  return null
}

/** 写入 token：仅 sessionStorage，避免 JWT 长期持久化到 localStorage */
function writeStoredToken(token: string) {
  try {
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(TOKEN_KEY, token)
  } catch { /* 隐私模式降级 */ }
}

/** 清除 token：sessionStorage 与旧版 localStorage 遗留一并清理 */
function clearStoredToken() {
  try {
    if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(TOKEN_KEY)
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem('fh_local_favshub_token')
    }
  } catch { /* ignore */ }
}
