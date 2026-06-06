<template>
  <div
    class="bookmark-card"
    :draggable="!isGuest"
    @contextmenu.prevent="$emit('contextmenu', $event, bookmark)"
  >
    <a :href="bookmark.url" target="_blank" rel="noopener noreferrer" class="bookmark-link" :title="bookmark.title">
      <div class="bookmark-icon">
        <img
          v-if="iconSrc"
          :src="iconSrc"
          :alt="bookmark.title"
          loading="lazy"
          @error="iconFailed = true"
        />
        <span v-else class="bookmark-icon-text">{{ initialChar }}</span>
      </div>
      <div class="bookmark-title">{{ bookmark.title }}</div>
    </a>
    <div v-if="!isGuest" class="bookmark-actions">
      <button class="bookmark-edit-btn" @click.stop="$emit('edit', bookmark)" title="编辑">
        <i class="ri-edit-line"></i>
      </button>
      <button class="bookmark-delete-btn" @click.stop="$emit('delete', bookmark)" title="删除">
        <i class="ri-delete-bin-line"></i>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  bookmark: any
  isGuest?: boolean
}>()

defineEmits<{
  edit: [bookmark: any]
  delete: [bookmark: any]
  contextmenu: [event: MouseEvent, bookmark: any]
}>()

const iconFailed = ref(false)

/**
 * 图标显示逻辑：
 * 1. 若有自定义 icon 且加载成功 → 显示
 * 2. 若无 icon 或加载失败 → 使用 Google favicon 服务作为 fallback
 * 3. 若 favicon 也失败 → 显示首字母
 */
const iconSrc = computed(() => {
  if (iconFailed.value) return null
  if (props.bookmark.icon && !iconFailed.value) return props.bookmark.icon
  // Fallback to Google favicon service
  try {
    const url = new URL(props.bookmark.url)
    return `https://www.google.com/s2/favicons?domain=${url.hostname}&sz=32`
  } catch {
    return null
  }
})

const initialChar = computed(() => {
  const t = props.bookmark.title || props.bookmark.url || '?'
  return t.charAt(0).toUpperCase()
})
</script>

<style scoped>
.bookmark-card {
  position: relative;
  text-align: center;
  padding: 12px;
  border-radius: 8px;
  transition: background 0.2s;
  cursor: pointer;
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
  border-radius: 4px;
}
.bookmark-icon-text {
  font-size: 24px;
  font-weight: bold;
  color: #4a90d9;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(74, 144, 217, 0.1);
  border-radius: 8px;
}
.bookmark-title {
  font-size: 12px;
  color: #333;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bookmark-actions {
  position: absolute;
  top: 4px;
  right: 4px;
  display: none;
  gap: 2px;
}
.bookmark-card:hover .bookmark-actions {
  display: flex;
}
.bookmark-edit-btn,
.bookmark-delete-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  color: #999;
  font-size: 14px;
}
.bookmark-edit-btn:hover,
.bookmark-delete-btn:hover {
  background: rgba(0,0,0,0.1);
  color: #333;
}
/* Auth visibility and dark mode are now defined globally in layouts/default.vue */
@media (prefers-color-scheme: dark) {
  .bookmark-card:hover { background: rgba(255, 255, 255, 0.08); }
  .bookmark-title { color: #ddd; }
  .bookmark-icon-text { background: rgba(74, 144, 217, 0.2); }
}
</style>
