import { defineStore } from 'pinia'
import { useAuthStore } from '~/stores/auth'

export interface SearchEngine {
  id: number
  name: string
  url: string
  icon: string | null
  category: string
  is_default: number
}

export const useSearchEnginesStore = defineStore('searchEngines', {
  state: () => ({
    engines: [] as SearchEngine[],
    currentEngineId: null as number | null,
    isLoading: false,
  }),

  getters: {
    /**
     * The currently selected engine.
     * Falls back to the engine marked `is_default`, then to the first engine.
     */
    currentEngine(state): SearchEngine | null {
      // 1. User-selected engine
      if (state.currentEngineId !== null) {
        const found = state.engines.find(e => e.id === state.currentEngineId)
        if (found) return found
      }
      // 2. Admin-marked default
      const adminDefault = state.engines.find(e => e.is_default === 1)
      if (adminDefault) return adminDefault
      // 3. First available
      return state.engines[0] ?? null
    },
  },

  actions: {
    async fetchEngines() {
      this.isLoading = true
      try {
        const res = await $fetch<{ engines: SearchEngine[] }>('/api/search-engines')
        this.engines = res.engines
      } finally {
        this.isLoading = false
      }
    },

    setCurrentEngine(id: number) {
      this.currentEngineId = id
    },
  },
})
