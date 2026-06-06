<template>
  <div class="bookmark-grid-wrapper">
    <div v-if="isLoading" class="loading">
      <!-- 占位卡片，匹配旧版加载动画 -->
      <div class="bookmark-placeholder" v-for="i in 12" :key="'ph-'+i"></div>
    </div>
    <div v-else-if="bookmarks.length === 0" class="empty">
      <p>暂无书签</p>
      <button class="add-first-btn client-only-user" @click="$emit('add')">添加第一个书签</button>
    </div>
    <div v-else class="bookmarks-container" :class="{ loaded: !isLoading }">
      <div ref="gridRef" class="bookmarks-list" :style="gridStyle">
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
  gridTemplateColumns: `repeat(auto-fit, minmax(${props.bookmarkWidth || 180}px, 1fr))`,
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
        // 拖拽完成后通知父组件
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
.bookmark-grid-wrapper {
  position: relative;
}

/* 占位卡片（加载时显示） */
.bookmark-placeholder {
  width: 100%;
  max-width: 180px;
  height: 70px;
  background: rgba(0,0,0,0.04);
  border-radius: 12px;
  animation: placeholder-pulse 1.5s ease-in-out infinite;
}
@keyframes placeholder-pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 0.8; }
}

/* 容器：匹配旧版 .bookmarks-container */
.bookmarks-container {
  opacity: 0;
  transition: opacity 0.3s ease-out, transform 0.3s ease-out;
  background: #ffffff6b;
  padding: 1rem 2rem 2rem 2rem;
  width: 85%;
  max-width: 1200px;
  margin: 2.5rem auto 2.5rem;
  border-radius: 12px;
  box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.06), 0 2px 4px -2px rgb(0 0 0 / 0.06);
  display: flex;
  flex-direction: column;
  position: relative;
}
.bookmarks-container.loaded {
  opacity: 1;
  transform: translateY(0);
}

/* 书签网格 */
.bookmarks-list {
  display: grid;
  gap: 1rem;
  justify-items: center;
}

/* 添加卡片 */
.add-bookmark-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  max-width: 180px;
  min-height: 70px;
  border: 2px dashed #ddd;
  border-radius: 12px;
  cursor: pointer;
  transition: border-color 0.2s, transform 0.2s, box-shadow 0.2s;
}
.add-bookmark-card:hover {
  border-color: #667eea;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
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

.loading {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 1rem;
  padding: 1rem 2rem;
  width: 85%;
  max-width: 1200px;
  margin: 2.5rem auto;
}
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

@media (max-width: 1024px) {
  .bookmarks-container { width: 95%; padding: 1rem; }
  .loading { width: 95%; padding: 1rem; }
}
@media (max-width: 640px) {
  .bookmarks-container { width: 100%; padding: 0.75rem; margin-top: 1.5rem; }
  .loading { width: 100%; padding: 0.75rem; }
}
</style>
