<template>
  <div class="bookmarks-container" id="bookmarks-list" :class="{ loaded: !isLoading, 'density-compact': density === 'compact' }" @keydown="onGridKeydown">
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
      <i class="ri-bookmark-line bookmarks-empty-icon" aria-hidden="true"></i>
      <p>暂无书签</p>
      <button class="add-first-btn client-only-user" @click="$emit('add')">添加第一个书签</button>
    </div>

    <!-- 网格工具条：独立 v-if，不能与下面的分组/平铺分支组成 else 链 -->
    <div v-if="bookmarks.length > 0" class="grid-toolbar">
      <nav v-if="folderGroups.length > 1" class="category-index" aria-label="分类快速索引">
        <a
          v-for="group in folderGroups"
          :key="group.folderId ?? 'recommended'"
          class="category-index-link"
          :class="{ active: activeGroupKey === groupKey(group) }"
          :href="'#' + groupDomId(group)"
          @click="jumpToGroup($event, group)"
        >
          <i :class="groupIcon(group)" class="category-index-icon" aria-hidden="true"></i>
          <span>{{ group.name }}</span>
        </a>
      </nav>
      <button
        type="button"
        class="density-toggle"
        :title="density === 'compact' ? '当前紧凑密度，点击切换为舒适' : '当前舒适密度，点击切换为紧凑'"
        :aria-label="density === 'compact' ? '当前紧凑密度，点击切换为舒适' : '当前舒适密度，点击切换为紧凑'"
        :aria-pressed="density === 'compact'"
        @click="toggleDensity"
      >
        <i :class="density === 'compact' ? 'ri-list-check-2' : 'ri-layout-grid-line'" aria-hidden="true"></i>
        <span class="density-label">{{ density === 'compact' ? '紧凑' : '舒适' }}</span>
      </button>
    </div>

    <!-- 分组显示（独立条件：勿接在工具条的 v-if 后形成 else 链，否则会被工具条吞掉） -->
    <template v-if="bookmarks.length > 0 && folderGroups.length > 0">
      <div
        v-for="group in folderGroups"
        :key="group.folderId ?? 'recommended'"
        class="folder-group flat-layout"
        :id="groupDomId(group)"
        :data-group-key="groupKey(group)"
        :style="{ '--group-accent': groupAccent(group) }"
      >
        <h3 :id="groupTitleId(group)" class="folder-group-title">
          <button
            type="button"
            class="folder-toggle"
            :aria-expanded="isGroupExpanded(group)"
            :aria-controls="groupGridId(group)"
            :aria-label="(isGroupExpanded(group) ? '收起' : '展开') + group.name"
            @click="toggleGroup(group)"
          >
            <i class="ri-arrow-down-s-line folder-chevron" aria-hidden="true"></i>
            <span>{{ group.name }}</span>
          </button>
        </h3>
        <div
          v-show="isGroupExpanded(group)"
          :id="groupGridId(group)"
          :ref="setGridRef"
          class="folder-bookmarks-grid"
          role="region"
          :aria-labelledby="groupTitleId(group)"
        >
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
    <div v-else-if="bookmarks.length > 0" class="folder-group flat-layout">
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

const emit = defineEmits<{
  edit: [bookmark: any]
  delete: [bookmark: any]
  add: []
  reorder: [items: { id: number; sort_order: number }[]]
}>()

const gridEls = ref<HTMLElement[]>([])
function setGridRef(el: any) {
  gridEls.value = gridEls.value.filter(item => item.isConnected)
  for (const [element, instance] of sortableInstances) {
    if (!element.isConnected) {
      instance.destroy()
      sortableInstances.delete(element)
    }
  }
  if (el && !gridEls.value.includes(el)) {
    gridEls.value.push(el)
    // 渐进加载/折叠状态更新产生的新网格也要补建拖拽实例
    if (mounted.value) nextTick(() => ensureSortableInstances())
  }
}

// 相邻分类卡片的强调色轮换：驱动标题下划线与 hover 阴影的着色（--group-accent）
// 「全部/推荐」保持主题色，其余按文件夹 ID 稳定轮换，刷新后同一分类颜色不变
const GROUP_ACCENTS = ['#10b981', '#0ea5e9', '#8b5cf6', '#f59e0b', '#f43f5e', '#06b6d4']
function groupAccent(group: { folderId: number | null }): string {
  if (group.folderId === null) return 'var(--primary)'
  return GROUP_ACCENTS[Math.abs(group.folderId) % GROUP_ACCENTS.length]
}

function groupDomId(group: { folderId: number | null }): string {
  return group.folderId === null ? 'folder-group-recommended' : `folder-group-${group.folderId}`
}
function groupTitleId(group: { folderId: number | null }): string {
  return `${groupDomId(group)}-title`
}
function groupGridId(group: { folderId: number | null }): string {
  return `${groupDomId(group)}-bookmarks`
}
function groupKey(group: { folderId: number | null }): string {
  const viewKey = bookmarksStore.viewMode === 'collection'
    ? `collection:${bookmarksStore.currentCollectionId || 'unknown'}`
    : 'mine'
  return `${viewKey}:${group.folderId ?? 'recommended'}`
}

// 当前激活的分类索引标签（点击或滚动到该分组时高亮）
const activeGroupKey = ref('')

// ── scroll-spy：顶部导航与主体分组焦点联动 ─────────────────────────
// IntersectionObserver 观察每个分组容器；把「当前可见分组」同步到顶部导航高亮。
// 点击导航时用 suppressScrollSpyUntil 短暂抑制 observer 回写，
// 否则点击 A 分组后滚动过程会一路高亮 B、C，最终才落到 A，造成视觉跳动。
let groupObserver: IntersectionObserver | null = null
let suppressScrollSpyUntil = 0

function setupGroupObserver() {
  if (!import.meta.client) return
  if (groupObserver) return
  // root 必须是**实际滚动容器**：桌面端是 <main>（overflow:auto），移动端是 body/window。
  // 用 viewport（root:null）时桌面端检测不到交叉变化（2026-11-27 实测：滚动后高亮不更新）。
  const scroller = resolveScrollContainer()
  groupObserver = new IntersectionObserver(() => {
    if (performance.now() < suppressScrollSpyUntil) return
    updateActiveGroupFromScroll()
  }, {
    root: scroller instanceof HTMLElement ? scroller : null,
    rootMargin: '-8% 0px -60% 0px',
    threshold: 0,
  })
}

/** 找当前真正的滚动容器：优先 <main>（桌面端），否则用 window（移动端 body 滚动） */
function resolveScrollContainer(): HTMLElement | null {
  const main = document.querySelector('main')
  if (main instanceof HTMLElement) {
    const cs = getComputedStyle(main)
    const scrollable = /(auto|scroll)/.test(cs.overflowY) && main.scrollHeight > main.clientHeight
    if (scrollable) return main
    // 内容还没加载完时也可能还没变成滚动容器，后续由 observeGroups 重试
    return main
  }
  return null
}

/**
 * 从当前滚动位置算出激活分组。
 *
 * 不能只看 IntersectionObserver 的 entries —— 回调只报告**本次变化**的元素，
 * 当分组 A 滚出视野时 entries 里只有 A（isIntersecting=false），
 * 此时新的分组 B 可能早就 intersecting 却没进 entries，于是高亮会卡在旧值
 * （2026-11-27 实测：滚到第 19 个分组，高亮仍停在第一个）。
 * 这里改为直接按几何位置遍历全部分组，谁的顶边最靠近判定线谁就是当前分组。
 */
function updateActiveGroupFromScroll() {
  if (performance.now() < suppressScrollSpyUntil) return
  // 判定线：视口上方 1/3 处。其上方（已滚过）的分组里，最靠下的那个就是当前分组。
  // 不用 <main> 作参照 —— 桌面端 main 是滚动容器、移动端是 body，
  // 用 viewport 坐标能同时覆盖两种情况。
  const line = window.innerHeight / 3
  let bestKey: string | null = null
  let bestTop = -Infinity
  for (const el of document.querySelectorAll<HTMLElement>('.folder-group[data-group-key]')) {
    const key = el.dataset.groupKey
    if (!key) continue
    const rect = el.getBoundingClientRect()
    if (rect.top > line) continue
    if (rect.top > bestTop) {
      bestTop = rect.top
      bestKey = key
    }
  }
  if (bestKey) activeGroupKey.value = bestKey
}

function observeGroups() {
  if (!groupObserver) return
  groupObserver.disconnect()
  for (const el of document.querySelectorAll<HTMLElement>('.folder-group[data-group-key]')) {
    groupObserver.observe(el)
  }
}

/**
 * 重建 observer —— 滚动容器可能在书签加载完成后才确定
 * （桌面端 <main> 的 overflow-y 一开始是 visible，内容够高才变成 auto）。
 */
function rebuildGroupObserver() {
  groupObserver?.disconnect()
  groupObserver = null
  setupGroupObserver()
  observeGroups()
}

onMounted(() => {
  setupGroupObserver()
  observeGroups()
  // observer 只在交叉关系变化时触发，不保证覆盖「连续滚动」的所有位置，
  // 因此额外挂滚动监听兜底（rAF 节流）。
  //
  // 监听 document + 捕获阶段：scroll 事件不冒泡，但**可以被捕获**，
  // document 在捕获阶段能收到任意元素（桌面端 <main>、移动端 body）的滚动。
  let rafId = 0
  const onScroll = () => {
    if (rafId) return
    rafId = requestAnimationFrame(() => {
      rafId = 0
      updateActiveGroupFromScroll()
    })
  }
  document.addEventListener('scroll', onScroll, { passive: true, capture: true })
  onBeforeUnmount(() => {
    document.removeEventListener('scroll', onScroll, true)
    if (rafId) cancelAnimationFrame(rafId)
  })
})

onBeforeUnmount(() => {
  groupObserver?.disconnect()
  groupObserver = null
})

// 分类图标：按名称哈希稳定选取 Remix 图标，与 FolderTreeItem 同一逻辑
const GROUP_ICONS = ['ri-folder-line','ri-folder-2-line','ri-folder-3-line','ri-folder-4-line','ri-bookmark-line','ri-star-line']
function groupIcon(group: { folderId: number | null; name: string }): string {
  if (group.folderId === null) return 'ri-apps-line'
  let h = 0
  for (let i = 0; i < group.name.length; i++) h = ((h << 5) - h) + group.name.charCodeAt(i)
  return GROUP_ICONS[Math.abs(h) % GROUP_ICONS.length]
}

function isGroupExpanded(group: { folderId: number | null }): boolean {
  return bookmarksStore.isGroupExpanded(groupKey(group))
}
function toggleGroup(group: { folderId: number | null }) {
  bookmarksStore.toggleGroup(groupKey(group))
}

async function jumpToGroup(event: MouseEvent, group: { folderId: number | null }) {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  event.preventDefault()
  // 收起的分组也允许通过索引定位；标题始终是实际存在的锚点
  bookmarksStore.setGroupExpanded(groupKey(group), true)
  activeGroupKey.value = groupKey(group)
  // 抑制 scroll-spy 一小段时间，避免平滑滚动过程中高亮来回跳
  suppressScrollSpyUntil = performance.now() + 900
  await nextTick()
  const id = groupDomId(group)
  const target = document.getElementById(id)
  if (!target) return
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' })
  history.replaceState(history.state, '', `#${id}`)
}

// 锚点保持原生 Tab/Enter 行为；方向键在当前网格内移动并保证焦点可见
function onGridKeydown(event: KeyboardEvent) {
  if (event.altKey || event.ctrlKey || event.metaKey) return
  const target = event.target as HTMLElement | null
  const card = target?.closest<HTMLAnchorElement>('.bookmark-card')
  const grid = card?.closest<HTMLElement>('.folder-bookmarks-grid')
  if (!card || !grid) return

  const cards = Array.from(grid.querySelectorAll<HTMLAnchorElement>('.bookmark-card'))
    .filter(el => el.getClientRects().length > 0)
  const index = cards.indexOf(card)
  if (index < 0) return
  const columnCount = Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length)
  let nextIndex = index
  if (event.key === 'ArrowLeft') nextIndex = index - 1
  else if (event.key === 'ArrowRight') nextIndex = index + 1
  else if (event.key === 'ArrowUp') nextIndex = index - columnCount
  else if (event.key === 'ArrowDown') nextIndex = index + columnCount
  else if (event.key === 'Home') nextIndex = 0
  else if (event.key === 'End') nextIndex = cards.length - 1
  else return

  // 已到网格边界时也不把方向键/Home/End 冒泡成整页滚动
  event.preventDefault()
  const next = cards[nextIndex]
  if (!next || next === card) return
  next.focus({ preventScroll: true })
  next.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

// C2: SSR/hydration 阶段仅渲染前 30 张卡片，挂载后补齐其余（懒加载）
// mounted 标志保证 SSR HTML 与客户端首帧一致，避免 hydration mismatch
const INITIAL_RENDER_LIMIT = 30
const mounted = ref(false)
// 首屏（前 30 张）书签 ID，用于 favicon fetchpriority="high"
// 用响应式 ref 维护，避免在 computed 中做副作用（frontend review）
const priorityIds = ref(new Set<number>())

// frontend #7/#15：卸载时统一清理；generation 使尚未完成的动态 import 不能复活旧实例
const sortableInstances = new Map<HTMLElement, { destroy: () => void }>()
let sortableGeneration = 0
function destroySortableInstances() {
  ++sortableGeneration
  for (const instance of sortableInstances.values()) instance.destroy()
  sortableInstances.clear()
}

onMounted(() => {
  bookmarksStore.loadViewPreferences()
  mounted.value = true
  nextTick(() => ensureSortableInstances())
})

// 视图偏好由 store 统一持久化，游客与登录用户使用同一套本地行为
const bookmarksStore = useBookmarksStore()
const density = computed(() => bookmarksStore.density)
const canSort = computed(() => !props.isGuest && bookmarksStore.viewMode === 'mine')
function toggleDensity() {
  bookmarksStore.setDensity(density.value === 'compact' ? 'comfortable' : 'compact')
}

// 分组数据变化（切换视图）后重新观察分组容器（scroll-spy 依赖 data-group-key）
watch(() => bookmarksStore.viewMode, () => nextTick(observeGroups))
// C5 + frontend #7/#15：卸载时清空 DOM 引用、销毁拖拽实例并使 pending import 失效
onBeforeUnmount(() => {
  gridEls.value.length = 0
  destroySortableInstances()
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

// 拖拽排序：仅个人书签且非游客；游客/精选集销毁，回到个人视图重建
function onSortableEnd(event: { from: HTMLElement }) {
  if (!canSort.value) return
  const items: { id: number; sort_order: number }[] = []
  // 只读取触发事件的 grid 的直接子卡片；排除添加按钮与其他 grid/嵌套节点。
  for (const child of Array.from(event.from.children)) {
    if (!child.classList.contains('bookmark-card')) continue
    const id = Number((child as HTMLElement).dataset.id)
    if (!Number.isSafeInteger(id) || id <= 0) continue
    items.push({ id, sort_order: items.length })
  }
  if (items.length) emit('reorder', items)
}

function ensureSortableInstances() {
  if (!canSort.value || !mounted.value) {
    if (sortableInstances.size) destroySortableInstances()
    return
  }
  const generation = sortableGeneration
  import('sortablejs').then(({ default: Sortable }) => {
    if (generation !== sortableGeneration || !mounted.value || !canSort.value) return
    for (const el of gridEls.value) {
      if (!el?.isConnected || sortableInstances.has(el)) continue
      sortableInstances.set(el, Sortable.create(el, {
        animation: 200,
        ghostClass: 'sortable-ghost',
        draggable: '.bookmark-card',
        onEnd: onSortableEnd,
      }))
    }
  }).catch(error => {
    if (generation === sortableGeneration) console.error('加载拖拽排序组件失败', error)
  })
}
watch(canSort, enabled => {
  if (!enabled) destroySortableInstances()
  else if (mounted.value) nextTick(() => ensureSortableInstances())
})
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

// 分组渲染完成后重新挂 scroll-spy 观察。
// 书签是异步加载的：onMounted 时分组 DOM 还不存在，observer 会观察到 0 个元素，
// 必须在分组数量变化后重挂，否则滚动联动永远不触发（2026-11-27 实测）。
watch(() => folderGroups.value.length, () => nextTick(rebuildGroupObserver))
</script>

<style scoped>
/* 卡片尺寸由 CSS 变量驱动，支持父级传入。
   变量声明在本组件根元素上，由 CSS 自定义属性继承传给后代节点，
   消费方在全局 main-bundle.css：
   --bookmark-width      → .folder-bookmarks-grid 列宽 / .bookmark-placeholder / .add-bookmark-card 上限
   --bookmark-card-height → .folder-bookmarks-grid .bookmark-card 高度 */
.bookmarks-container {
  --bookmark-sticky-top: 0px;
  --bookmark-toolbar-height: 44px;
  --bookmark-card-height: v-bind('bookmarkCardHeight ? bookmarkCardHeight + "px" : "auto"');
  --bookmark-container-width: v-bind('bookmarkContainerWidth ? bookmarkContainerWidth + "%" : "100%"');
  --bookmark-width: v-bind('bookmarkWidth ? bookmarkWidth + "px" : "210px"');
  margin: 0 auto;
}

/* 容器宽度：main-bundle.css 的 #bookmarks-list { width: 100% } 是 ID 选择器（特异度 1,0,0），
   类选择器（0,1,0）必胜不过，故此处同样以 ID 选择器提升特异度，让用户设置能覆盖全局默认值 */
#bookmarks-list {
  width: var(--bookmark-container-width);
}

.folder-bookmarks-grid .bookmark-card {
  height: var(--bookmark-card-height);
}

.bookmark-placeholder {
  height: var(--bookmark-card-height, 56px);
}

.add-bookmark-card {
  min-height: var(--bookmark-card-height, 56px);
}

/* 空状态图标 */
.bookmarks-empty-icon {
  display: block;
  font-size: 36px;
  color: var(--text-quaternary);
  margin-bottom: 10px;
}

/* 分类索引与密度共用一个吸顶工具条；分组标题在其下方吸顶 */
.grid-toolbar {
  position: sticky;
  top: var(--bookmark-sticky-top);
  z-index: 30;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: var(--bookmark-toolbar-height);
  box-sizing: border-box;
  margin: -4px -4px 12px;
  padding: 4px;
  background: color-mix(in srgb, var(--surface-raised) 94%, transparent);
  border: 0.5px solid var(--border);
  border-radius: 10px;
  backdrop-filter: blur(12px);
}
.category-index {
  display: flex;
  flex: 1;
  gap: 6px;
  min-width: 0;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  scrollbar-width: none;
  padding: 2px;
  /* 两端渐隐提示可滚动 */
  mask-image: linear-gradient(to right, transparent, black 12px, black calc(100% - 24px), transparent);
  -webkit-mask-image: linear-gradient(to right, transparent, black 12px, black calc(100% - 24px), transparent);
}
.category-index::-webkit-scrollbar { display: none; }
.category-index-link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: 0 0 auto;
  max-width: 180px;
  padding: 5px 12px;
  overflow: hidden;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 500;
  line-height: 1.4;
  text-decoration: none;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-radius: 20px;
  background: var(--surface-sunken, rgba(0,0,0,0.04));
  border: 1px solid transparent;
  transition: color 150ms, background 150ms, border-color 150ms;
  scroll-margin-top: calc(var(--bookmark-sticky-top) + var(--bookmark-toolbar-height) + 64px);
}
.category-index-icon {
  flex-shrink: 0;
  font-size: 14px;
  opacity: 0.7;
}
.category-index-link:hover {
  color: var(--control-accent);
  background: var(--control-hover-bg);
  border-color: var(--border);
}
.category-index-link.active {
  color: var(--control-accent);
  background: color-mix(in srgb, var(--control-accent) 12%, transparent);
  border-color: color-mix(in srgb, var(--control-accent) 25%, transparent);
  font-weight: 600;
}
.category-index-link.active .category-index-icon {
  opacity: 1;
}
.category-index-link:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 1px;
}
.folder-group {
  scroll-margin-top: calc(var(--bookmark-sticky-top) + var(--bookmark-toolbar-height) + 12px);
}
.folder-group-title {
  position: sticky;
  top: calc(var(--bookmark-sticky-top) + var(--bookmark-toolbar-height));
  z-index: 20;
  margin: 0 0 1rem;
  padding: 0.5rem 0;
  /* 与分组容器 flat-layout 的毛玻璃底一致（92% 不透明），
     否则不透明底色会与半透明容器形成突兀色块（2026-11-27 用户实测反馈） */
  background: color-mix(in srgb, var(--surface-raised) 92%, transparent);
  backdrop-filter: blur(10px);
}
.folder-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 0;
  color: inherit;
  font: inherit;
  text-align: left;
  background: transparent;
  border: 0;
  border-radius: 4px;
  cursor: pointer;
}
.folder-group:hover .folder-toggle {
  color: var(--control-accent);
}
.folder-toggle:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 3px;
}
.folder-chevron {
  flex: 0 0 auto;
  transition: transform 160ms ease;
}
.folder-toggle[aria-expanded="false"] .folder-chevron {
  transform: rotate(-90deg);
}
:deep(.bookmark-card) {
  scroll-margin-block: calc(var(--bookmark-sticky-top) + var(--bookmark-toolbar-height) + 64px) 16px;
}
.density-toggle {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  font-size: 12px;
  color: var(--text-secondary);
  /* 11 主题实测：默认文字最低 4.76:1；accent/焦点最低 4.89:1；hover 最低 4.94:1 */
  background: light-dark(var(--surface-raised), var(--surface-sunken));
  border: 0.5px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
  transition: color 180ms cubic-bezier(0.22, 1, 0.36, 1), border-color 180ms cubic-bezier(0.22, 1, 0.36, 1), background-color 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.density-toggle:hover {
  color: var(--control-accent);
  border-color: var(--control-accent);
  background: var(--control-hover-bg);
}
.density-toggle:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}

/* 紧凑密度：更小的卡片高度/内边距/间距，标题单行截断 */
.density-compact .folder-bookmarks-grid {
  gap: 8px;
}
.density-compact :deep(.card) {
  min-height: 44px;
  padding: 0.5rem 0.625rem;
  border-radius: 10px;
}
.density-compact :deep(.card-title) {
  -webkit-line-clamp: 1;
  line-clamp: 1;
  max-height: 1.3em;
}
.density-compact :deep(.card-description) {
  display: none;
}
.density-compact .add-bookmark-card {
  min-height: 44px;
}

@media (max-width: 1024px) {
  .bookmarks-container {
    --bookmark-sticky-top: 60px;
    --bookmark-toolbar-height: 40px;
    padding-bottom: calc(88px + env(safe-area-inset-bottom, 0px));
  }
  .folder-group-title {
    margin-bottom: 0.75rem;
  }
}

@media (max-width: 640px) {
  .grid-toolbar {
    margin-inline: -2px;
  }
  .category-index {
    gap: 4px;
    mask-image: linear-gradient(to right, transparent, black 8px, black calc(100% - 16px), transparent);
    -webkit-mask-image: linear-gradient(to right, transparent, black 8px, black calc(100% - 16px), transparent);
  }
  .category-index-link {
    max-width: 120px;
    padding: 4px 10px;
    font-size: 12px;
  }
  .category-index-icon {
    font-size: 13px;
  }
  .density-label {
    display: none;
  }
  .density-toggle {
    padding: 4px 7px;
  }
}

@media (max-width: 480px) {
  .bookmarks-container {
    --bookmark-sticky-top: 52px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .folder-chevron {
    transition: none;
  }
}
</style>
