<template>
  <div class="bookmark-grid">
    <div v-if="isLoading" class="loading">加载中...</div>
    <div v-else-if="bookmarks.length === 0" class="empty">暂无书签</div>
    <div v-else class="grid" :style="gridStyle">
      <div v-for="bookmark in bookmarks" :key="bookmark.id" class="bookmark-card">
        <a :href="bookmark.url" target="_blank" rel="noopener" class="bookmark-link">
          <div class="bookmark-icon">
            <img
              v-if="bookmark.icon"
              :src="bookmark.icon"
              :alt="bookmark.title"
              @error="(e: Event) => (e.target as HTMLImageElement).style.display = 'none'"
            />
            <span v-else class="bookmark-icon-text">{{ bookmark.title.charAt(0).toUpperCase() }}</span>
          </div>
          <div class="bookmark-title" :title="bookmark.title">{{ bookmark.title }}</div>
        </a>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
interface Bookmark {
  id: number
  title: string
  url: string
  icon: string | null
}

const props = defineProps<{
  bookmarks: Bookmark[]
  isLoading?: boolean
}>()

const gridStyle = computed(() => ({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
  gap: '16px',
  padding: '16px',
}))
</script>

<style scoped>
.bookmark-card {
  text-align: center;
  padding: 12px;
  border-radius: 8px;
  transition: background 0.2s;
}
.bookmark-card:hover {
  background: rgba(0, 0, 0, 0.05);
}
.bookmark-link {
  text-decoration: none;
  color: inherit;
  display: block;
}
.bookmark-icon {
  width: 48px;
  height: 48px;
  margin: 0 auto 8px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.bookmark-icon img {
  width: 32px;
  height: 32px;
  object-fit: contain;
}
.bookmark-icon-text {
  font-size: 24px;
  font-weight: bold;
  color: #4a90d9;
}
.bookmark-title {
  font-size: 12px;
  color: #333;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.loading,
.empty {
  text-align: center;
  padding: 40px;
  color: #999;
}
@media (prefers-color-scheme: dark) {
  .bookmark-card:hover {
    background: rgba(255, 255, 255, 0.08);
  }
  .bookmark-title {
    color: #ddd;
  }
}
</style>
