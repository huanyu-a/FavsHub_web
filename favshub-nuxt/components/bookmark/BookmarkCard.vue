<template>
  <div
    class="bookmark-card"
    :class="{ 'is-guest': isGuest }"
    :draggable="!isGuest"
    @contextmenu.prevent="$emit('contextmenu', $event, bookmark)"
  >
    <a :href="bookmark.url" target="_blank" rel="noopener noreferrer" class="card" :title="bookmark.title">
      <div class="card-icon">
        <img
          v-if="iconSrc && !iconFailed"
          :src="iconSrc"
          :alt="bookmark.title"
          loading="lazy"
          @error="iconFailed = true"
        />
        <span v-else class="card-icon-text">{{ initialChar }}</span>
      </div>
      <div class="card-title">{{ bookmark.title }}</div>
      <span v-if="!isGuest" class="card-actions">
        <button class="card-edit-btn" @click.prevent.stop="$emit('edit', bookmark)" title="编辑">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="card-delete-btn" @click.prevent.stop="$emit('delete', bookmark)" title="删除">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
        </button>
      </span>
    </a>
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

const iconSrc = computed(() => {
  if (iconFailed.value) return null
  if (props.bookmark.icon) return props.bookmark.icon
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
  width: 100%;
  max-width: 180px;
  text-decoration: none;
  color: inherit;
  transition: all 0.3s ease;
  cursor: grab;
}
.bookmark-card:active {
  cursor: grabbing;
}
.bookmark-card.is-guest {
  cursor: pointer;
}

.card {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem;
  border-radius: 12px;
  text-decoration: none;
  transition: all 0.3s ease;
  box-sizing: border-box;
  min-height: 56px;
  width: 100%;
  color: inherit;
  background: transparent;
  position: relative;
}
.card:hover {
  transform: translateY(-2px) scale(1.02);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  background: rgba(255,255,255,0.9);
}

.card-icon {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.card-icon img {
  width: 24px;
  height: 24px;
  object-fit: contain;
  border-radius: 4px;
}
.card-icon-text {
  font-size: 18px;
  font-weight: 700;
  color: #4a90d9;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(74, 144, 217, 0.1);
  border-radius: 6px;
}

.card-title {
  font-size: 13px;
  font-weight: 500;
  color: #333;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

/* 操作按钮（hover 时显示） */
.card-actions {
  display: none;
  position: absolute;
  right: 0.25rem;
  top: 50%;
  transform: translateY(-50%);
  gap: 2px;
}
.card:hover .card-actions {
  display: flex;
}

.card-edit-btn,
.card-delete-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #999;
  cursor: pointer;
  transition: all 0.15s;
}
.card-edit-btn:hover {
  background: rgba(102,126,234,0.1);
  color: #667eea;
}
.card-delete-btn:hover {
  background: rgba(231,76,60,0.1);
  color: #e74c3c;
}

@media (prefers-color-scheme: dark) {
  .card-title { color: #ddd; }
  .card-icon-text { background: rgba(74,144,217,0.2); }
  .card:hover { background: rgba(255,255,255,0.06); }
}
</style>
