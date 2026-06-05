import { defineStore } from 'pinia'

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    settings: {} as Record<string, any>,
    isLoading: false,
  }),
  getters: {
    theme: (state) => state.settings.theme || 'auto',
    bookmarkWidth: (state) => state.settings.bookmarkWidth || 160,
  },
  actions: {
    async fetchSettings(token?: string) {
      this.isLoading = true
      try {
        const headers: Record<string, string> = {}
        if (token) headers.Authorization = `Bearer ${token}`
        const res = await $fetch<{ data: Record<string, any> }>('/api/settings', { headers })
        this.settings = res.data
      } finally {
        this.isLoading = false
      }
    },
    async updateSettings(data: Record<string, any>, token: string) {
      const res = await $fetch<{ data: Record<string, any> }>('/api/settings', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
        body: { data },
      })
      this.settings = res.data
    },
  },
})
