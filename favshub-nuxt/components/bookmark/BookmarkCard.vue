<template>
  <a
    :href="bookmark.url"
    target="_blank"
    rel="noopener noreferrer"
    class="bookmark-card card"
    :data-id="bookmark.id"
    :title="bookmark.title"
    @contextmenu.prevent="$emit('contextmenu', $event, bookmark)"
  >
    <div class="favicon">
      <img
        v-if="iconSrc && !iconFailed"
        :src="iconSrc"
        :alt="bookmark.title"
        class="w-6 h-6 mr-2"
        loading="lazy"
        @error="iconFailed = true"
      >
      <span v-else class="w-6 h-6 mr-2 card-icon-text">{{ initialChar }}</span>
    </div>
    <div class="card-content">
      <div class="card-title">{{ bookmark.title }}</div>
    </div>
    <span v-if="!isGuest" class="card-actions">
      <button class="card-edit-btn" title="编辑" @click.prevent.stop="$emit('edit', bookmark)">
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>
      <button class="card-delete-btn" title="删除" @click.prevent.stop="$emit('delete', bookmark)">
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </button>
    </span>
  </a>
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
/* .bookmark-card / .card / .favicon / .card-content / .card-title 全部来自 main-bundle.css。
   下面仅补充新框架特有的编辑/删除按钮（旧版无此控件），不覆盖旧版布局。 */
.bookmark-card { position: relative; }

.card-icon-text {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  color: #4a90d9;
  background: rgba(74, 144, 217, 0.12);
  border-radius: 6px;
  font-size: 14px;
}

.card-actions {
  display: none;
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  gap: 2px;
  z-index: 2;
}
.bookmark-card:hover .card-actions {
  display: inline-flex;
}
.card-edit-btn,
.card-delete-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.85);
  color: #94a3b8;
  cursor: pointer;
  transition: all 0.15s;
}
.card-edit-btn:hover { background: rgba(102, 126, 234, 0.12); color: #667eea; }
.card-delete-btn:hover { background: rgba(231, 76, 60, 0.12); color: #e74c3c; }
</style>
