import { defineStore } from 'pinia'

export interface Bookmark {
  id: number; user_id: number; title: string; url: string;
  folder_id: number | null; icon: string | null; sort_order: number;
  container: string; source: string; login_required: number;
  folder_name?: string; created_at?: number; updated_at?: number;
}

export interface Folder {
  id: number; user_id: number; name: string;
  parent_id: number | null; sort_order: number; icon: string;
}

export const useBookmarksStore = defineStore('bookmarks', {
  state: () => ({
    bookmarks: [] as Bookmark[],
    folders: [] as Folder[],
    searchQuery: '',
    currentFolderId: null as number | null,
    isLoading: false,
  }),
  getters: {
    filteredBookmarks: (state) => {
      let result = state.bookmarks
      if (state.searchQuery) {
        const q = state.searchQuery.toLowerCase()
        result = result.filter(b =>
          b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q)
        )
      }
      if (state.currentFolderId !== null) {
        result = result.filter(b => b.folder_id === state.currentFolderId)
      }
      return result
    },
    visibleFolders: (state) => state.folders,
  },
  actions: {
    async fetchBookmarks(token?: string) {
      this.isLoading = true
      try {
        const headers: Record<string, string> = {}
        if (token) headers.Authorization = `Bearer ${token}`
        const res = await $fetch<{ bookmarks: Bookmark[]; folders: Folder[] }>('/api/bookmarks', { headers })
        this.bookmarks = res.bookmarks
        this.folders = res.folders
      } finally {
        this.isLoading = false
      }
    },
    setSearchQuery(q: string) { this.searchQuery = q },
    setCurrentFolder(id: number | null) { this.currentFolderId = id },
  },
})
