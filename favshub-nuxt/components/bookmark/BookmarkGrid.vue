<template>
  <div class="bookmarks-container" id="bookmarks-list" :class="{ loaded: !isLoading }">
    <!-- 加载占位 -->
    <template v-if="isLoading">
      <div class="folder-group flat-layout">
        <div class="folder-bookmarks-grid">
          <div class="bookmark-placeholder" v-for="i in 12" :key="'ph-' + i"></div>
        </div>
      </div>
    </template>

    <!-- 空状态 -->
    <div v-else-if="bookmarks.length === 0" class="bookmarks-empty">
      <p>暂无书签</p>
      <button class="add-first-btn client-only-user" @click="$emit('add')">添加第一个书签</button>
    </div>

    <!-- 分组显示 -->
    <template v-else-if="folderGroups.length > 0">
      <div
        v-for="(group, gIdx) in folderGroups"
        :key="group.folderId ?? 'recommended'"
        class="folder-group flat-layout"
        :class="'depth-' + Math.min(group.depth, 5)"
        :id="group.folderId === null ? 'folder-group-recommended' : 'folder-group-' + group.folderId"
      >
        <h3 class="folder-group-title">{{ group.name }}</h3>
        <div :ref="setGridRef" class="folder-bookmarks-grid">
          <BookmarkCard
            v-for="bookmark in group.bookmarks"
            :key="bookmark.id"
            :bookmark="bookmark"
            @contextmenu="onContextMenu"
          />
        </div>
      </div>
    </template>

    <!-- 无分组（选中单个文件夹）扁平显示 -->
    <div v-else class="folder-group flat-layout">
      <div :ref="setGridRef" class="folder-bookmarks-grid">
        <BookmarkCard
          v-for="bookmark in bookmarks"
          :key="bookmark.id"
          :bookmark="bookmark"
          @contextmenu="onContextMenu"
        />
        <button class="add-bookmark-card client-only-user" @click="$emit('add')">
          <span class="add-icon">+</span>
          <span class="add-text">添加</span>
        </button>
      </div>
    </div>

    <!-- 右键菜单 -->
    <BookmarkContextMenu
      :bookmark="contextMenu.bookmark"
      :visible="contextMenu.visible"
      :x="contextMenu.x"
      :y="contextMenu.y"
      :is-guest="isGuest"
      :is-own="contextMenu.bookmark ? contextMenu.bookmark.user_id === currentUserId : false"
      @edit="$emit('edit', $event)"
      @delete="$emit('delete', $event)"
      @close="contextMenu.visible = false"
    />
  </div>
</template>

<script setup lang="ts">
import BookmarkCard from './BookmarkCard.vue'
import BookmarkContextMenu from './BookmarkContextMenu.vue'

interface FolderInfo {
  id: number; name: string; parent_id: number | null;
}

const props = defineProps<{
  bookmarks: any[]
  folders?: FolderInfo[]
  isLoading?: boolean
  isGuest?: boolean
  currentUserId?: number
  bookmarkWidth?: number
  bookmarkCardHeight?: number
  bookmarkContainerWidth?: number
  currentFolderId?: number | null
}>()

defineEmits<{
  edit: [bookmark: any]
  delete: [bookmark: any]
  add: []
  reorder: [items: { id: number; sort_order: number }[]]
}>()

const gridEls: HTMLElement[] = []
function setGridRef(el: any) {
  if (el && !gridEls.includes(el)) gridEls.push(el)
}

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

// 书签宽度 → CSS 变量（旧版 --bookmark-width 驱动 grid 列宽）
watchEffect(() => {
  if (import.meta.client && props.bookmarkWidth) {
    document.documentElement.style.setProperty('--bookmark-width', props.bookmarkWidth + 'px')
  }
})

// 卡片高度 → 注入 <style> 覆盖 .card height
watchEffect(() => {
  if (import.meta.client && props.bookmarkCardHeight) {
    let el = document.getElementById('custom-card-height') as HTMLStyleElement | null
    if (!el) {
      el = document.createElement('style')
      el.id = 'custom-card-height'
      document.head.appendChild(el)
    }
    el.textContent = `.folder-bookmarks-grid .bookmark-card { height: ${props.bookmarkCardHeight}px !important; }`
  }
})

// 容器宽度 → .bookmarks-container 宽度
watchEffect(() => {
  if (import.meta.client && props.bookmarkContainerWidth) {
    const container = document.getElementById('bookmarks-list') as HTMLElement | null
    if (container) {
      container.style.width = `${props.bookmarkContainerWidth}%`
      container.style.margin = '0 auto'
    }
  }
})

/**
 * 按文件夹分组书签，匹配旧版 folder-group 结构
 */
const folderGroups = computed(() => {
  const folders = props.folders || []
  if (!props.bookmarks.length) return []

  const roots = folders.filter(f => !f.parent_id)
  const allGroups: { folderId: number | null; name: string; bookmarks: any[]; depth: number }[] = []

  const ungrouped = props.bookmarks.filter(b => b.folder_id === null || b.folder_id === undefined)
  if (ungrouped.length > 0) {
    const sorted = [...ungrouped].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    allGroups.push({ folderId: null, name: '常用推荐', bookmarks: sorted, depth: 0 })
  }

  function processFolder(folder: FolderInfo, depth: number) {
    const folderBookmarks = props.bookmarks
      .filter(b => b.folder_id === folder.id)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))

    if (folderBookmarks.length > 0) {
      allGroups.push({ folderId: folder.id, name: folder.name, bookmarks: folderBookmarks, depth })
    }

    const children = folders.filter(f => f.parent_id === folder.id)
    for (const child of children) processFolder(child, depth + 1)
  }

  for (const root of roots) processFolder(root, 0)

  // 没有任何分组（没有文件夹信息）时，回退到单一"常用推荐"分组
  if (allGroups.length === 0 && props.bookmarks.length > 0) {
    allGroups.push({ folderId: null, name: '常用推荐', bookmarks: props.bookmarks, depth: 0 })
  }

  return allGroups
})

// 拖拽排序（仅登录用户）
if (import.meta.client) {
  const { default: Sortable } = await import('sortablejs')
  onMounted(() => {
    for (const el of gridEls) {
      if (!el || props.isGuest) continue
      Sortable.create(el, {
        animation: 200,
        ghostClass: 'sortable-ghost',
        draggable: '.bookmark-card',
      })
    }
  })
}
</script>

<style scoped>
/* .bookmarks-container / .folder-group / .folder-group-title / .folder-bookmarks-grid /
   .bookmark-card 等样式全部来自 main-bundle.css。此处仅补充加载占位与新增控件。 */

.bookmark-placeholder {
  width: 100%;
  max-width: var(--bookmark-width, 180px);
  height: 56px;
  background: rgba(0, 0, 0, 0.04);
  border-radius: 12px;
  animation: placeholder-pulse 1.5s ease-in-out infinite;
}
@keyframes placeholder-pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 0.8; }
}

.bookmarks-empty {
  text-align: center;
  padding: 40px;
  color: #94a3b8;
}
.add-first-btn {
  margin-top: 12px;
  padding: 10px 20px;
  background: #10b981;
  color: #fff;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
}

/* 添加卡片：与旧版书签卡尺寸一致 */
.add-bookmark-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  max-width: var(--bookmark-width, 180px);
  min-height: 56px;
  border: 2px dashed #d1d5db;
  border-radius: 12px;
  background: transparent;
  cursor: pointer;
  transition: border-color 0.2s, transform 0.2s, box-shadow 0.2s;
}
.add-bookmark-card:hover {
  border-color: #10b981;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}
.add-icon { font-size: 24px; color: #94a3b8; line-height: 1; }
.add-text { font-size: 12px; color: #94a3b8; margin-top: 2px; }

.sortable-ghost { opacity: 0.4; }
</style>
