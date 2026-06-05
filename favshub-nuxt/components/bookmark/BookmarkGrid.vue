<template>
  <div class="bookmark-grid-wrapper">
    <div v-if="isLoading" class="loading">加载中...</div>
    <div v-else-if="bookmarks.length === 0" class="empty">
      <p>暂无书签</p>
      <button class="add-first-btn client-only-user" @click="$emit('add')">添加第一个书签</button>
    </div>
    <div v-else ref="gridRef" class="bookmarks-container" :style="gridStyle">
      <BookmarkCard
        v-for="bookmark in bookmarks"
        :key="bookmark.id"
        :bookmark="bookmark"
        :is-guest="isGuest"
        @edit="$emit('edit', $event)"
        @delete="$emit('delete', $event)"
        @contextmenu="onContextMenu"
      />
      <!-- 添加占位卡片 -->
      <div class="add-bookmark-card client-only-user" @click="$emit('add')">
        <div class="add-icon">+</div>
        <div class="add-text">添加</div>
      </div>
    </div>

    <!-- 右键菜单 -->
    <BookmarkContextMenu
      :bookmark="contextMenu.bookmark"
      :visible="contextMenu.visible"
      :x="contextMenu.x"
      :y="contextMenu.y"
      :is-guest="isGuest"
      @edit="$emit('edit', $event)"
      @delete="$emit('delete', $event)"
      @close="contextMenu.visible = false"
    />
  </div>
</template>

<script setup lang="ts">
import BookmarkCard from './BookmarkCard.vue'
import BookmarkContextMenu from './BookmarkContextMenu.vue'

const props = defineProps<{
  bookmarks: any[]
  isLoading?: boolean
  isGuest?: boolean
  bookmarkWidth?: number
}>()

defineEmits<{
  edit: [bookmark: any]
  delete: [bookmark: any]
  add: []
  reorder: [items: { id: number; sort_order: number }[]]
}>()

const gridRef = ref<HTMLElement | null>(null)

const contextMenu = reactive({
  visible: false,
  x: 0,
  y: 0,
  bookmark: null as any,
})

function onContextMenu(event: MouseEvent, bookmark: any) {
  contextMenu.x = event.clientX
  contextMenu.y = event.clientY
  contextMenu.bookmark = bookmark
  contextMenu.visible = true
}

const gridStyle = computed(() => ({
  display: 'grid',
  gridTemplateColumns: `repeat(auto-fill, minmax(${props.bookmarkWidth || 200}px, 1fr))`,
  gap: '16px',
  padding: '16px 0',
}))

// 拖拽排序（仅登录用户）
if (import.meta.client) {
  const { default: Sortable } = await import('sortablejs')

  onMounted(() => {
    if (!gridRef.value || props.isGuest) return
    Sortable.create(gridRef.value, {
      animation: 200,
      ghostClass: 'sortable-ghost',
      onEnd(evt) {
        const items = props.bookmarks.map((b, i) => ({
          id: b.id,
          sort_order: i,
        }))
      },
    })
  })
}
</script>

<style scoped>
.add-bookmark-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 20px;
  border: 2px dashed #ddd;
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.2s;
}
.add-bookmark-card:hover {
  border-color: #667eea;
}
.add-icon {
  font-size: 28px;
  color: #999;
}
.add-text {
  font-size: 12px;
  color: #999;
  margin-top: 4px;
}
.loading,
.empty {
  text-align: center;
  padding: 40px;
  color: #999;
}
.add-first-btn {
  margin-top: 12px;
  padding: 10px 20px;
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: #fff;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
}
.sortable-ghost {
  opacity: 0.4;
}
:global([data-guest="true"]) .add-bookmark-card {
  display: none !important;
}
:global([data-guest="true"]) .client-only-user {
  display: none !important;
}
.client-only-user {
  display: flex;
}
@media (prefers-color-scheme: dark) {
  .add-bookmark-card { border-color: #444; }
  .add-bookmark-card:hover { border-color: #667eea; }
}
:global([data-theme="dark"]) .add-bookmark-card { border-color: #444; }
</style>
