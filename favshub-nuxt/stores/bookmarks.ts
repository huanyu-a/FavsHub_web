import { defineStore } from 'pinia'
import { useAuthStore } from '~/stores/auth'

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
    /** Get Authorization header from the auth store (skip for cookie auth) */
    _authHeaders(): Record<string, string> {
      const auth = useAuthStore()
      const headers: Record<string, string> = {}
      if (auth.token && auth.token !== 'cookie_auth') headers.Authorization = `Bearer ${auth.token}`
      return headers
    },

    /** Get fetch options with credentials for cookie auth */
    _authOptions(): Record<string, any> {
      return { headers: this._authHeaders(), credentials: 'include' as const }
    },

    // ── Bookmarks ──────────────────────────────────────────────

    async fetchBookmarks(token?: string) {
      this.isLoading = true
      try {
        const headers: Record<string, string> = {}
        if (token && token !== 'cookie_auth') headers.Authorization = `Bearer ${token}`
        const res = await $fetch<{ bookmarks: Bookmark[]; folders: Folder[] }>('/api/bookmarks', { headers, credentials: 'include' })
        this.bookmarks = res.bookmarks
        this.folders = res.folders
      } finally {
        this.isLoading = false
      }
    },

    async createBookmark(data: { title: string; url: string; folder_id?: number | null; icon?: string }) {
      const res = await $fetch<{ bookmark: Bookmark }>('/api/bookmarks', {
        method: 'POST',
        headers: this._authHeaders(),
        body: data,
        credentials: 'include',
      })
      this.bookmarks.push(res.bookmark)
      return res.bookmark
    },

    async updateBookmark(id: number, data: Partial<Omit<Bookmark, 'id' | 'user_id'>>) {
      const res = await $fetch<{ bookmark: Bookmark }>(`/api/bookmarks/${id}`, {
        method: 'PUT',
        headers: this._authHeaders(),
        body: data,
        credentials: 'include',
      })
      const idx = this.bookmarks.findIndex(b => b.id === id)
      if (idx !== -1) this.bookmarks[idx] = res.bookmark
      return res.bookmark
    },

    async deleteBookmark(id: number) {
      await $fetch(`/api/bookmarks/${id}`, {
        method: 'DELETE',
        headers: this._authHeaders(),
        credentials: 'include',
      })
      this.bookmarks = this.bookmarks.filter(b => b.id !== id)
    },

    async reorderBookmarks(items: { id: number; sort_order: number }[]) {
      await $fetch('/api/bookmarks/reorder', {
        method: 'PUT',
        headers: this._authHeaders(),
        body: { items },
        credentials: 'include',
      })
      // Apply the new sort_order locally so the UI reflects the change immediately
      for (const item of items) {
        const bookmark = this.bookmarks.find(b => b.id === item.id)
        if (bookmark) bookmark.sort_order = item.sort_order
      }
    },

    // ── Folders ────────────────────────────────────────────────

    async fetchFolders() {
      const res = await $fetch<{ folders: Folder[] }>('/api/folders', {
        headers: this._authHeaders(),
        credentials: 'include',
      })
      this.folders = res.folders
    },

    async createFolder(data: { name: string; parent_id?: number | null }) {
      const res = await $fetch<{ folder: Folder }>('/api/folders', {
        method: 'POST',
        headers: this._authHeaders(),
        body: data,
        credentials: 'include',
      })
      this.folders.push(res.folder)
      return res.folder
    },

    async updateFolder(id: number, data: Partial<Omit<Folder, 'id' | 'user_id'>>) {
      const res = await $fetch<{ folder: Folder }>(`/api/folders/${id}`, {
        method: 'PUT',
        headers: this._authHeaders(),
        body: data,
        credentials: 'include',
      })
      const idx = this.folders.findIndex(f => f.id === id)
      if (idx !== -1) this.folders[idx] = res.folder
      return res.folder
    },

    async deleteFolder(id: number) {
      await $fetch(`/api/folders/${id}`, {
        method: 'DELETE',
        headers: this._authHeaders(),
        credentials: 'include',
      })
      this.folders = this.folders.filter(f => f.id !== id)
      // Clear folder_id on bookmarks that belonged to the deleted folder
      this.bookmarks = this.bookmarks.map(b =>
        b.folder_id === id ? { ...b, folder_id: null } : b
      )
    },

    // ── Query helpers ──────────────────────────────────────────

    setSearchQuery(q: string) { this.searchQuery = q },
    setCurrentFolder(id: number | null) { this.currentFolderId = id },
  },
})
