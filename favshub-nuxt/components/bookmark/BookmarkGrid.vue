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
        :id="group.folderId === null ? 'folder-group-recommended' : 'folder-group-' + group.folderId"
      >
        <h3 class="folder-group-title">{{ group.name }}</h3>
        <div :ref="setGridRef" class="folder-bookmarks-grid">
          <BookmarkCard
            v-for="bookmark in group.bookmarks"
            :key="bookmark.id"
            :bookmark="bookmark"
            :favicon-priority="priorityIds.has(bookmark.id)"
            @contextmenu="onContextMenu"
          />
        </div>
      </div>
    </template>

    <!-- 无分组（选中单个文件夹）扁平显示 -->
    <div v-else class="folder-group flat-layout">
      <div :ref="setGridRef" class="folder-bookmarks-grid">
        <BookmarkCard
          v-for="bookmark in flatVisibleBookmarks"
          :key="bookmark.id"
          :bookmark="bookmark"
          :favicon-priority="priorityIds.has(bookmark.id)"
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

const gridEls = ref<HTMLElement[]>([])
function setGridRef(el: any) {
  if (el && !gridEls.value.includes(el)) gridEls.value.push(el)
}

// C2: SSR/hydration 阶段仅渲染前 30 张卡片，挂载后补齐其余（懒加载）
// mounted 标志保证 SSR HTML 与客户端首帧一致，避免 hydration mismatch
const INITIAL_RENDER_LIMIT = 30
const mounted = ref(false)
// 首屏（前 30 张）书签 ID，用于 favicon fetchpriority="high"
// 用响应式 ref 维护，避免在 computed 中做副作用（frontend review）
const priorityIds = ref(new Set<number>())

// frontend #7/#15：注入的 <style> 引用 + 拖拽实例，卸载时统一清理
let customStyleEl: HTMLStyleElement | null = null
const sortableInstances = new Map<HTMLElement, { destroy: () => void }>()

onMounted(() => {
  mounted.value = true
  ensureSortableInstances()
})

// C5 + frontend #7/#15：卸载时清空 DOM 引用、移除注入样式、销毁拖拽实例
onBeforeUnmount(() => {
  gridEls.value.length = 0
  if (customStyleEl) {
    customStyleEl.remove()
    customStyleEl = null
  }
  for (const instance of sortableInstances.values()) instance.destroy()
  sortableInstances.clear()
})

// 首屏前 30 张书签 ID 优先 fetchpriority（SSR 与客户端输入一致，无求值顺序漂移）
watchEffect(() => {
  const ids = new Set<number>()
  for (const b of props.bookmarks.slice(0, INITIAL_RENDER_LIMIT)) {
    if (b && b.id != null) ids.add(b.id)
  }
  priorityIds.value = ids
})

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

// 书签宽度写入 CSS 变量 --bookmark-width，由其驱动 grid 列宽
watchEffect(() => {
  if (import.meta.client && props.bookmarkWidth) {
    document.documentElement.style.setProperty('--bookmark-width', props.bookmarkWidth + 'px')
  }
})

// 卡片高度：注入 <style> 覆盖 .card height（卸载时移除，避免全局样式残留）
watchEffect(() => {
  if (import.meta.client && props.bookmarkCardHeight) {
    let el = document.getElementById('custom-card-height') as HTMLStyleElement | null
    if (!el) {
      el = document.createElement('style')
      el.id = 'custom-card-height'
      document.head.appendChild(el)
    }
    customStyleEl = el
    el.textContent = `.folder-bookmarks-grid .bookmark-card { height: ${props.bookmarkCardHeight}px !important; }`
  }
})

// 容器宽度写入 .bookmarks-container
watchEffect(() => {
  if (import.meta.client && props.bookmarkContainerWidth) {
    const container = document.getElementById('bookmarks-list') as HTMLElement | null
    if (container) {
      container.style.width = `${props.bookmarkContainerWidth}%`
      container.style.margin = '0 auto'
    }
  }
})

// 拖拽排序（仅登录用户）— frontend #15：onMounted 内动态加载，实例可被 destroy
function ensureSortableInstances() {
  if (props.isGuest) return
  import('sortablejs').then(({ default: Sortable }) => {
    for (const el of gridEls.value) {
      if (!el || sortableInstances.has(el)) continue
      sortableInstances.set(el, Sortable.create(el, {
        animation: 200,
        ghostClass: 'sortable-ghost',
        draggable: '.bookmark-card',
      }))
    }
  })
}
// 挂载后懒加载补齐的新网格容器也补建拖拽实例
watch(gridEls, () => ensureSortableInstances())

/**
 * 按文件夹分组书签（M2: 先按 folder_id 建 Map，O(N) 构建 + O(1) 取，避免 O(F×N) 重复过滤）
 */
const folderGroups = computed(() => {
  const folders = props.folders || []
  if (!props.bookmarks.length) {
    return []
  }

  // 单次遍历：按 folder_id 分桶 + 保留全量有序列表（供无分组回退）
  const byFolderId = new Map<number | 'none', any[]>()
  const sortedAll: any[] = []
  for (const b of props.bookmarks) {
    sortedAll.push(b)
    const key = b.folder_id == null ? 'none' : b.folder_id
    const arr = byFolderId.get(key)
    if (arr) arr.push(b)
    else byFolderId.set(key, [b])
  }

  const sortArr = (arr: any[]) => arr.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))

  const allGroups: { folderId: number | null; name: string; bookmarks: any[]; depth: number }[] = []

  const ungrouped = byFolderId.get('none')
  if (ungrouped && ungrouped.length > 0) {
    allGroups.push({ folderId: null, name: '常用推荐', bookmarks: sortArr(ungrouped), depth: 0 })
  }

  // children 也按 parent_id 建 Map，避免递归中重复 filter
  const childrenByParent = new Map<number, FolderInfo[]>()
  for (const f of folders) {
    if (f.parent_id == null) continue
    const arr = childrenByParent.get(f.parent_id)
    if (arr) arr.push(f)
    else childrenByParent.set(f.parent_id, [f])
  }

  const roots = folders.filter(f => !f.parent_id)
  function processFolder(folder: FolderInfo, depth: number) {
    const folderBookmarks = byFolderId.get(folder.id)
    if (folderBookmarks && folderBookmarks.length > 0) {
      allGroups.push({ folderId: folder.id, name: folder.name, bookmarks: sortArr(folderBookmarks), depth })
    }
    const children = childrenByParent.get(folder.id) || []
    for (const child of children) processFolder(child, depth + 1)
  }
  for (const root of roots) processFolder(root, 0)

  // 没有任何分组（没有文件夹信息）时，回退到单一"常用推荐"分组
  if (allGroups.length === 0) {
    allGroups.push({ folderId: null, name: '常用推荐', bookmarks: sortArr([...sortedAll]), depth: 0 })
  }

  // C2: SSR/hydration 阶段只渲染前 30 张卡片，挂载后补齐其余（懒加载）
  if (!mounted.value) {
    let count = 0
    const capped = allGroups
      .map(g => {
        const take = g.bookmarks.slice(0, Math.max(0, INITIAL_RENDER_LIMIT - count))
        count += take.length
        return { ...g, bookmarks: take }
      })
      .filter(g => g.bookmarks.length > 0)
    return capped
  }
  return allGroups
})

// 扁平分支（无文件夹分组）同样限制首屏渲染数量
const flatVisibleBookmarks = computed(() => {
  if (mounted.value || props.bookmarks.length <= INITIAL_RENDER_LIMIT) return props.bookmarks
  return props.bookmarks.slice(0, INITIAL_RENDER_LIMIT)
})
</script>

