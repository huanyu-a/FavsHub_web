import { defineStore } from 'pinia'

export const useUIStore = defineStore('ui', {
  state: () => ({
    sidebarOpen: true,
    theme: 'auto' as 'light' | 'dark' | 'auto',
  }),
  actions: {
    toggleSidebar() { this.sidebarOpen = !this.sidebarOpen },
    setTheme(t: 'light' | 'dark' | 'auto') { this.theme = t },
  },
})
