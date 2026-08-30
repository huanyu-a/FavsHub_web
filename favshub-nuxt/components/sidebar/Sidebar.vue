<template>
  <div id="sidebar-container" class="flex" :class="{ collapsed: !isOpen }">
    <aside class="custom-width p-4 overflow-auto relative">
      <div class="sidebar-shell">
        <div class="sidebar-top">
          <NuxtLink to="/" class="sidebar-brand-card" title="主页">
            <img src="/images/logo.svg" alt="Logo" class="sidebar-brand-logo">
            <div class="sidebar-brand-copy">
              <span class="sidebar-brand-title">FavsHub</span>
              <span class="sidebar-brand-subtitle">Workspace</span>
            </div>
          </NuxtLink>

          <div class="sidebar-hub-nav">
            <NuxtLink to="/" class="sidebar-hub-link" :class="{ active: activePage === 'home' }" title="主页">
              <span class="sidebar-hub-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
              </span>
              <span class="sidebar-hub-label">主页</span>
            </NuxtLink>
            <NuxtLink to="/prompts" class="sidebar-hub-link" :class="{ active: activePage === 'prompts' }" title="提示词管理">
              <span class="sidebar-hub-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/></svg>
              </span>
              <span class="sidebar-hub-label">提示词管理</span>
            </NuxtLink>
          </div>
        </div>

        <div class="sidebar-folders-panel">
          <!-- 精选集浏览模式：显示精选集分类（支持层级） -->
          <ul v-if="activeCollectionId && visibleCollectionCategories.length" id="categories-list">
            <li
              class="folder-item"
              :class="{ 'bg-emerald-500': activeCategoryId === null }"
              style="cursor:pointer;padding:8px;border-radius:8px;display:flex;align-items:center;"
              @click="$emit('select-collection-category', null)"
            >
              <i class="ri-apps-line" style="font-size:16px;color:var(--primary);flex-shrink:0;width:20px;text-align:center;"></i>
              <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">全部分类</span>
              <span class="item-count" style="margin-left:auto;">{{ visibleCollectionTotal }}</span>
            </li>
            <!-- 按层级渲染：父分类紧接着其子分类（隐藏空分类） -->
            <template v-for="cat in visibleCollectionRoots" :key="cat.id">
              <li
                class="folder-item"
                :class="{ 'bg-emerald-500': activeCategoryId === cat.id }"
                style="cursor:pointer;padding:8px;border-radius:8px;display:flex;align-items:center;"
                @click="$emit('select-collection-category', cat.id)"
              >
                <i class="ri-folder-line" style="font-size:16px;color:var(--primary);flex-shrink:0;width:20px;text-align:center;"></i>
                <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{{ cat.name }}</span>
                <span class="item-count" style="margin-left:auto;">{{ cat.bookmark_count || 0 }}</span>
              </li>
              <li
                v-for="child in visibleCollectionChildren(cat.id)"
                :key="child.id"
                class="folder-item"
                :class="{ 'bg-emerald-500': activeCategoryId === child.id }"
                style="cursor:pointer;padding:8px 8px 8px 28px;border-radius:8px;display:flex;align-items:center;"
                @click="$emit('select-collection-category', child.id)"
              >
                <i class="ri-corner-down-right-line" style="font-size:14px;color:var(--text-tertiary);flex-shrink:0;width:20px;text-align:center;"></i>
                <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{{ child.name }}</span>
                <span class="item-count" style="margin-left:auto;">{{ child.bookmark_count || 0 }}</span>
              </li>
            </template>
          </ul>

          <!-- 个人书签模式：显示文件夹树 -->
          <ul v-else id="categories-list">
            <!-- 全部：icon + name + count + 展开收缩箭头 -->
            <li
              class="folder-item"
              :class="{ 'bg-emerald-500': currentFolderId === null }"
              style="cursor:pointer;padding:8px;border-radius:8px;display:flex;align-items:center;position:relative;"
              @click="$emit('select-folder', null)"
              @contextmenu.prevent="onAllContextMenu"
            >
              <i class="ri-apps-line" style="font-size:16px;color:var(--primary);flex-shrink:0;width:20px;text-align:center;"></i>
              <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-right:60px;">全部</span>
              <span class="item-count" style="position:absolute;right:8px;">{{ totalBookmarkCount }}</span>
              <span
                style="cursor:pointer;display:inline-flex;align-items:center;position:absolute;right:30px;"
                @click.stop="toggleAllFolders"
              >
                <svg v-if="allExpanded" xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 -960 960 960" width="18px" fill="currentColor"><path d="M480-541.85 317.08-378.92q-8.31 8.3-20.89 8.5-12.57.19-21.27-8.5-8.69-8.7-8.69-21.08 0-12.38 8.69-21.08l179.77-179.77q10.85-10.84 25.31-10.84 14.46 0 25.31 10.84l179.77 179.77q8.3 8.31 8.5 20.89.19 12.57-8.5 21.27-8.7 8.69-21.08 8.69-12.38 0-21.08-8.69L480-541.85Z"/></svg>
                <svg v-else xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 -960 960 960" width="18px" fill="currentColor"><path d="M517.85-480 354.92-642.92q-8.3-8.31-8.5-20.89-.19-12.57 8.5-21.27 8.7-8.69 21.08-8.69 12.38 0 21.08 8.69l179.77 179.77q5.61 5.62 7.92 11.85 2.31 6.23 2.31 13.46t-2.31 13.46q-2.31 6.23-7.92 11.85L397.08-274.92q-8.31 8.3-20.89 8.5-12.57.19-21.27-8.5-8.69-8.69-8.69-21.08 0-12.38 8.69-21.08L517.85-480Z"/></svg>
              </span>
            </li>
            <FolderTreeItem
              v-for="node in folderTree"
              :key="node.id"
              :node="node"
              :current-folder-id="currentFolderId"
              :expanded-ids="expandedIds"
              @select-folder="(id: number | null) => $emit('select-folder', id)"
              @toggle-expand="toggleExpand"
              @contextmenu-folder="onFolderContextMenu"
            />
          </ul>

          <!-- 文件夹右键菜单 -->
          <Teleport to="body">
            <div
              v-if="folderMenu.visible"
              class="folder-context-menu"
              :style="{ left: folderMenu.x + 'px', top: folderMenu.y + 'px' }"
              @click.stop
            >
              <!-- 全部右键菜单 -->
              <template v-if="folderMenu.isAll">
                <div class="folder-context-item" @click="createRootFolder">
                  <i class="ri-folder-add-line"></i> 新建文件夹
                </div>
              </template>
              <!-- 文件夹右键菜单 -->
              <template v-else>
                <div v-if="authStore.isAdmin" class="folder-context-item" @click="renameFolder(folderMenu.folder!)">
                  <i class="ri-edit-line"></i> 重命名
                </div>
                <div class="folder-context-item" @click="createSubFolder(folderMenu.folder!)">
                  <i class="ri-folder-add-line"></i> 新建子文件夹
                </div>
                <div v-if="authStore.isAdmin" class="folder-context-item danger" @click="deleteFolder(folderMenu.folder!)">
                  <i class="ri-delete-bin-line"></i> 删除
                </div>
              </template>
            </div>
            <div v-if="folderMenu.visible" class="folder-context-overlay" @click="folderMenu.visible = false"></div>
          </Teleport>
        </div>

        <!-- 精选集区 - ClientOnly 防止 SSR/客户端 auth 状态不一致导致水合不匹配 -->
        <ClientOnly>
          <div class="sidebar-collections-panel">
            <template v-if="authStore.isLoggedIn">
              <div class="sidebar-section-label">
                <span>我的精选集</span>
                <NuxtLink to="/collections" title="浏览更多精选集" class="sidebar-link-all">
                  <i class="ri-external-link-line"></i>
                </NuxtLink>
              </div>
              <ul v-if="collections.length > 0" class="collections-list">
                <li
                  v-for="c in collections"
                  :key="c.id"
                  class="collection-item"
                  @click="$emit('select-collection', c.id)"
                >
                  <span class="collection-item-icon"><AppIcon :value="c.icon" fallback="ri-book-2-line" /></span>
                  <span class="collection-item-name">{{ c.name }}</span>
                  <span class="collection-item-count">{{ c.bookmark_count }}</span>
                  <span v-if="c.new_count && c.new_count > 0" class="collection-new-badge">{{ c.new_count }}</span>
                </li>
              </ul>
              <NuxtLink v-else to="/collections" class="collections-empty">
                浏览精选集市场
              </NuxtLink>
            </template>
            <template v-else>
              <div class="sidebar-section-label">
                <span>精选集</span>
              </div>
              <NuxtLink to="/collections" class="collections-entry-link">
                <span class="collections-entry-icon"><i class="ri-book-2-line"></i></span>
                <span class="collections-entry-text">进入精选集市场</span>
                <i class="ri-arrow-right-s-line"></i>
              </NuxtLink>
            </template>
          </div>
        </ClientOnly>

        <UserPanel />
      </div>
    </aside>
  </div>
</template>

<script setup lang="ts">
interface Folder {
  id: number
  name: string
  icon?: string
  parent_id?: number | null
}

const props = defineProps<{
  isOpen: boolean
  folders: Folder[]
  currentFolderId: number | null
  activePage?: string
  isAdmin?: boolean
  isGuest?: boolean
  collectionCategories?: any[]
  activeCollectionId?: string | null
  activeCategoryId?: number | null
}>()

const emit = defineEmits<{
  toggle: []
  'select-folder': [id: number | null]
  'select-collection': [id: string]
  'select-collection-category': [categoryId: number | null]
  'create-folder': []
  'rename-folder': [id: number, name: string]
  'create-sub-folder': [parentId: number, name: string]
  'delete-folder': [id: number]
}>()

// 用户导入过的精选集（从本地存储 + API 获取）
interface ICollection {
  id: string
  name: string
  description: string
  icon: string
  is_public: number
  is_official: number
  bookmark_count: number
  created_at: number
  username?: string
  new_count?: number
}

const authStore = useAuthStore()
const settingsStore = useSettingsStore()
const bookmarksStore = useBookmarksStore()

const collections = ref<ICollection[]>([])

async function loadCollections() {
  try {
    // 已登录：已订阅列表；未登录：官方公开精选集作为入口
    const query = authStore.isLoggedIn
      ? { subscribed: '1', limit: 10 }
      : { is_official: '1', limit: 8 }
    const data = await $fetch<{ collections: ICollection[] }>('/api/collections', { query })
    collections.value = data?.collections || []
  } catch (err) {
    console.error('加载精选集失败', err)
    collections.value = []
  }
}

function onSelectCollection(id: string) {
  // 未登录：跳转精选集详情页（公开可读）；已登录：首页 tab 切换
  if (!authStore.isLoggedIn) {
    navigateTo(`/collections/${id}`)
    return
  }
  emit('select-collection', id)
}

// 全局点击关闭右键菜单（注册 + 清理）
let cleanupClickHandler: (() => void) | null = null

onMounted(() => {
  loadCollections()
  if (import.meta.client) {
    const handler = () => { folderMenu.visible = false }
    document.addEventListener('click', handler)
    cleanupClickHandler = () => document.removeEventListener('click', handler)
  }
})

// 登录状态变化时刷新列表（订阅 vs 官方）
watch(() => authStore.isLoggedIn, () => {
  loadCollections()
})

onBeforeUnmount(() => {
  if (cleanupClickHandler) {
    cleanupClickHandler()
    cleanupClickHandler = null
  }
})

// 文件夹图标按名称哈希选取
function folderIcon(name: string) {
  const iconList = ['ri-folder-line', 'ri-folder-2-line', 'ri-folder-3-line', 'ri-folder-4-line', 'ri-bookmark-line', 'ri-star-line']
  let h = 0
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h) + name.charCodeAt(i)
  return iconList[Math.abs(h) % iconList.length]
}

// ── 展开/收缩状态 ─────────────────────────────────────────────
const expandedIds = ref(new Set<number>())
const folderMenu = reactive({
  visible: false,
  x: 0,
  y: 0,
  folder: null as FolderNode | null,
  isAll: false,
})

// 收集所有文件夹 ID（含子文件夹）
const allFolderIds = computed(() => {
  const ids: number[] = []
  function walk(nodes: FolderNode[]) {
    for (const n of nodes) {
      ids.push(n.id)
      if (n.children.length) walk(n.children)
    }
  }
  walk(folderTree.value)
  return ids
})

// 是否全部展开
const allExpanded = computed(() =>
  allFolderIds.value.length > 0 && allFolderIds.value.every(id => expandedIds.value.has(id))
)

// 展开/收缩所有文件夹
function toggleAllFolders() {
  if (allExpanded.value) {
    expandedIds.value = new Set<number>()
  } else {
    expandedIds.value = new Set(allFolderIds.value)
  }
}

function toggleExpand(id: number) {
  if (expandedIds.value.has(id)) {
    expandedIds.value.delete(id)
  } else {
    expandedIds.value.add(id)
  }
}

function selectAndToggle(folder: FolderNode) {
  // 选中文件夹
  emit('select-folder', folder.id)
  // 有子级时同时切换展开/收缩状态
  if (folder._hasChildren) {
    toggleExpand(folder.id)
  }
}

interface FolderNode extends Folder {
  _depth: number
  _count: number
  _hasChildren: boolean
  children: FolderNode[]
}

const bookmarkCountMap = computed(() => {
  const map = new Map<number, number>()
  for (const b of bookmarksStore.bookmarks) {
    if (b.folder_id) {
      map.set(b.folder_id, (map.get(b.folder_id) || 0) + 1)
    }
  }
  return map
})

const totalBookmarkCount = computed(() => bookmarksStore.bookmarks.length)

// 精选集分类：隐藏书签数为 0 的项（父级若自身为 0 但子级有书签仍显示）
const visibleCollectionCategories = computed(() => {
  const list = props.collectionCategories || []
  const childHas = (parentId: number) =>
    list.some(c => c.parent_id === parentId && (c.bookmark_count || 0) > 0)
  return list.filter(c => (c.bookmark_count || 0) > 0 || (!c.parent_id && childHas(c.id)))
})
const visibleCollectionRoots = computed(() =>
  visibleCollectionCategories.value.filter(c => !c.parent_id),
)
function visibleCollectionChildren(parentId: number) {
  return visibleCollectionCategories.value.filter(c => c.parent_id === parentId && (c.bookmark_count || 0) > 0)
}
const visibleCollectionTotal = computed(() =>
  visibleCollectionCategories.value.reduce((s, c) => s + (c.bookmark_count || 0), 0),
)

const folderTree = computed(() => {
  const map = new Map<number, FolderNode>()
  const roots: FolderNode[] = []

  for (const f of props.folders) {
    map.set(f.id, {
      ...f,
      _depth: 0,
      _count: bookmarkCountMap.value.get(f.id) || 0,
      _hasChildren: false,
      children: [],
    })
  }

  for (const node of map.values()) {
    const pid = node.parent_id
    if (pid && map.has(pid)) {
      map.get(pid)!.children.push(node)
      map.get(pid)!._hasChildren = true
    } else {
      roots.push(node)
    }
  }

  // 递归剔除「自身 + 子孙」书签数均为 0 的文件夹
  function pruneEmpty(nodes: FolderNode[]): FolderNode[] {
    const kept: FolderNode[] = []
    for (const n of nodes) {
      const children = pruneEmpty(n.children)
      const total = n._count + children.reduce((s, c) => s + subtreeCount(c), 0)
      if (total <= 0) continue
      n.children = children
      n._hasChildren = children.length > 0
      kept.push(n)
    }
    return kept
  }
  function subtreeCount(n: FolderNode): number {
    return n._count + n.children.reduce((s, c) => s + subtreeCount(c), 0)
  }

  const pruned = pruneEmpty(roots)

  // 设置 depth
  function setDepth(nodes: FolderNode[], depth: number) {
    for (const n of nodes) {
      n._depth = depth
      if (n.children.length) setDepth(n.children, depth + 1)
    }
  }
  setDepth(pruned, 0)
  return pruned
})

// 保持 flatFolderTree 兼容
const flatFolderTree = computed(() => {
  const result: FolderNode[] = []
  function walk(nodes: FolderNode[]) {
    for (const n of nodes) {
      result.push(n)
      if (n.children.length && expandedIds.value.has(n.id)) walk(n.children)
    }
  }
  walk(folderTree.value)
  return result
})

// ── 右键菜单处理 ──────────────────────────────────────────────
function onAllContextMenu(event: MouseEvent) {
  event.preventDefault()
  folderMenu.x = event.clientX
  folderMenu.y = event.clientY
  folderMenu.folder = null
  folderMenu.isAll = true
  folderMenu.visible = true
}

function onFolderContextMenu(event: MouseEvent, folder: any) {
  event.preventDefault()
  folderMenu.x = event.clientX
  folderMenu.y = event.clientY
  folderMenu.folder = folder
  folderMenu.isAll = false
  folderMenu.visible = true
}

// Input validation for folder names
function validateFolderName(raw: string | null, currentName?: string): string | null {
  const trimmed = raw?.trim()
  if (!trimmed) return null
  if (trimmed.length > 100) return null
  // Reject names that are only whitespace or contain control characters
  if (/[\x00-\x1f\x7f]/.test(trimmed)) return null
  // Return null if name unchanged
  if (currentName !== undefined && trimmed === currentName.trim()) return null
  return trimmed
}

async function renameFolder(folder: FolderNode) {
  folderMenu.visible = false
  if (import.meta.client) {
    const newName = validateFolderName(prompt('重命名文件夹', folder.name), folder.name)
    if (newName) {
      await bookmarksStore.updateFolder(folder.id, { name: newName })
    }
  }
}

async function createRootFolder() {
  folderMenu.visible = false
  if (import.meta.client) {
    const name = validateFolderName(prompt('新建文件夹'))
    if (name) {
      await bookmarksStore.createFolder({ name })
    }
  }
}

async function createSubFolder(parentFolder: FolderNode) {
  folderMenu.visible = false
  if (import.meta.client) {
    const name = validateFolderName(prompt('新建子文件夹'))
    if (name) {
      await bookmarksStore.createFolder({ name, parent_id: parentFolder.id })
      expandedIds.value.add(parentFolder.id)
    }
  }
}

async function deleteFolder(folder: FolderNode) {
  folderMenu.visible = false
  if (import.meta.client) {
    if (confirm(`确定删除文件夹「${folder.name}」？\n书签将移至未分类，子文件夹将移至上级。`)) {
      await bookmarksStore.deleteFolder(folder.id)
      expandedIds.value.delete(folder.id)
    }
  }
}

</script>

<style scoped>
.sidebar-collections-panel {
  margin-top: 16px;
  border-top: 1px solid var(--border, #e5e7eb);
  padding-top: 12px;
}
.sidebar-section-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-tertiary, #9ca3af);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.sidebar-link-all {
  color: var(--text-tertiary, #9ca3af);
  font-size: 14px;
  text-decoration: none;
}
.sidebar-link-all:hover { color: var(--primary, #10b981); }
.collections-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.collection-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
  position: relative;
}
.collection-item:hover { background: var(--surface-hover, #f3f4f6); }
.collection-item-icon { font-size: 16px; flex-shrink: 0; display: inline-flex; align-items: center; }
.collection-item-icon i { font-size: 15px; }
.collection-item-name {
  flex: 1;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary, #111827);
}
.collection-item-count {
  font-size: 11px;
  color: var(--text-tertiary, #9ca3af);
  background: var(--surface-hover, #f3f4f6);
  padding: 1px 6px;
  border-radius: 8px;
}
.collection-new-badge {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 10px;
  font-weight: 600;
  color: #fff;
  background: #f59e0b;
  padding: 2px 5px;
  border-radius: 8px;
  pointer-events: none;
}
.collections-empty {
  display: block;
  padding: 8px;
  font-size: 12px;
  color: var(--primary, #10b981);
  text-decoration: none;
}
.collections-empty:hover { text-decoration: underline; }
.collections-entry-link {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 8px;
  text-decoration: none;
  color: var(--text-primary, #111827);
  background: var(--surface-hover, #f3f4f6);
  transition: background 0.15s;
}
.collections-entry-link:hover { background: var(--surface-active, #e5e7eb); }
.collections-entry-icon { font-size: 18px; display: inline-flex; align-items: center; }
.collections-entry-text { flex: 1; font-size: 13px; font-weight: 500; }
.collections-entry-link i { color: var(--text-tertiary, #9ca3af); }
</style>

