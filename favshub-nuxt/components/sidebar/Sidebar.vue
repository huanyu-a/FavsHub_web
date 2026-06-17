<template>
  <div id="sidebar-container" class="flex" :class="{ collapsed: !isOpen }">
    <aside class="custom-width p-4 overflow-auto border-r border-gray-200 relative">
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
          <ul id="categories-list">
            <!-- 全部：icon + name + count + 展开收缩箭头 -->
            <li
              class="folder-item"
              :class="{ 'bg-emerald-500': currentFolderId === null }"
              style="cursor:pointer;padding:8px;border-radius:8px;display:flex;align-items:center;position:relative;"
              @click="$emit('select-folder', null)"
              @contextmenu.prevent="onAllContextMenu"
            >
              <i class="ri-apps-line" style="font-size:16px;color:var(--primary-color);flex-shrink:0;width:20px;text-align:center;"></i>
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

        <div class="sidebar-bottom">
          <!-- 用户面板 -->
          <div class="sidebar-user-panel" ref="userMenuRef">
            <div class="sidebar-user-bar" @click="showUserMenu = !showUserMenu">
              <div class="sidebar-user-avatar">{{ userInitial }}</div>
              <span class="sidebar-user-name">{{ displayName }}</span>
            </div>

            <!-- 用户菜单弹出面板 -->
            <Transition name="user-menu">
              <div v-if="showUserMenu" class="sidebar-user-menu">
                <div class="user-menu-header">
                  <div class="user-menu-avatar">{{ userInitial }}</div>
                  <div class="user-menu-info">
                    <span class="user-menu-name">{{ displayName }}</span>
                    <span v-if="authStore.isAdmin" class="user-menu-role admin">管理员</span>
                    <span v-else-if="authStore.isLoggedIn" class="user-menu-role">普通用户</span>
                    <span v-else class="user-menu-role guest">游客</span>
                  </div>
                </div>

                <div class="user-menu-divider"></div>

                <div class="user-menu-items">
                  <NuxtLink to="/admin/settings" class="user-menu-item" @click="showUserMenu = false">
                    <i class="ri-settings-3-line"></i>
                    <span>设置</span>
                  </NuxtLink>
                  <NuxtLink v-if="authStore.isAdmin" to="/admin" target="_blank" class="user-menu-item" @click="showUserMenu = false">
                    <i class="ri-dashboard-line"></i>
                    <span>管理后台</span>
                  </NuxtLink>
                  <div class="user-menu-item" @click="cycleTheme">
                    <i :class="themeIcon"></i>
                    <span>外观</span>
                    <span class="user-menu-toggle">{{ themeLabel }}</span>
                  </div>
                </div>

                <div class="user-menu-divider"></div>

                <div class="user-menu-items">
                  <NuxtLink v-if="authStore.isGuest" to="/login" class="user-menu-item" @click="showUserMenu = false">
                    <i class="ri-login-box-line"></i>
                    <span>登录</span>
                  </NuxtLink>
                  <a v-else href="#" class="user-menu-item danger" @click.prevent="handleLogout">
                    <i class="ri-logout-box-r-line"></i>
                    <span>退出登录</span>
                  </a>
                </div>
              </div>
            </Transition>
          </div>
        </div>
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
}>()

const emit = defineEmits<{
  toggle: []
  'select-folder': [id: number | null]
  'create-folder': []
  'rename-folder': [id: number, name: string]
  'create-sub-folder': [parentId: number, name: string]
  'delete-folder': [id: number]
}>()

const uiStore = useUIStore()
const authStore = useAuthStore()
const settingsStore = useSettingsStore()
const bookmarksStore = useBookmarksStore()
const router = useRouter()
const { cycleTheme, themeLabel } = useTheme()

// 三态主题图标：light=太阳 / dark=月亮 / auto=电脑
const themeIcon = computed(() => {
  const icons: Record<string, string> = { light: 'ri-sun-line', dark: 'ri-moon-line', auto: 'ri-mac-line' }
  return icons[uiStore.theme] || 'ri-sun-line'
})

// ── 用户面板 ────────────────────────────────────────────────
const showUserMenu = ref(false)
const userMenuRef = ref<HTMLElement | null>(null)

const userInitial = computed(() => {
  const name = authStore.user?.nickname || authStore.user?.username || 'U'
  return name[0].toUpperCase()
})

const displayName = computed(() => {
  if (authStore.isGuest) return '未登录'
  return authStore.user?.nickname || authStore.user?.username || '用户'
})

// 点击外部关闭用户菜单
if (import.meta.client) {
  const handleClickOutside = (e: MouseEvent) => {
    if (userMenuRef.value && !userMenuRef.value.contains(e.target as Node)) {
      showUserMenu.value = false
    }
  }
  document.addEventListener('click', handleClickOutside)
}

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

  // 设置 depth
  function setDepth(nodes: FolderNode[], depth: number) {
    for (const n of nodes) {
      n._depth = depth
      if (n.children.length) setDepth(n.children, depth + 1)
    }
  }
  setDepth(roots, 0)
  return roots
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

async function renameFolder(folder: FolderNode) {
  folderMenu.visible = false
  if (import.meta.client) {
    const newName = prompt('重命名文件夹', folder.name)
    if (newName && newName !== folder.name) {
      await bookmarksStore.updateFolder(folder.id, { name: newName })
    }
  }
}

async function createRootFolder() {
  folderMenu.visible = false
  if (import.meta.client) {
    const name = prompt('新建文件夹')
    if (name) {
      await bookmarksStore.createFolder({ name })
    }
  }
}

async function createSubFolder(parentFolder: FolderNode) {
  folderMenu.visible = false
  if (import.meta.client) {
    const name = prompt('新建子文件夹')
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

// 全局点击关闭右键菜单
if (import.meta.client) {
  document.addEventListener('click', () => {
    folderMenu.visible = false
  })
}

function handleLogout() {
  authStore.logout()
  router.push('/login')
}
</script>

<style scoped>
/* ── 用户面板 ─────────────────────────────────────────────── */
.sidebar-user-panel {
  position: relative;
}

.sidebar-user-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
  user-select: none;
}

.sidebar-user-bar:hover {
  background: rgba(0, 0, 0, 0.04);
}

[data-theme="dark"] .sidebar-user-bar:hover {
  background: rgba(255, 255, 255, 0.06);
}

.sidebar-user-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  flex-shrink: 0;
}

.sidebar-user-name {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary, #1e293b);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

[data-theme="dark"] .sidebar-user-name {
  color: #CBD5E1;
}

/* ── 弹出菜单 ─────────────────────────────────────────────── */
.sidebar-user-menu {
  position: absolute;
  bottom: 100%;
  left: 0;
  right: 0;
  margin-bottom: 6px;
  background: var(--bg-primary, #fff);
  border: 1px solid var(--border-color, rgba(0, 0, 0, 0.08));
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  padding: 8px 0;
  z-index: 1000;
}

[data-theme="dark"] .sidebar-user-menu {
  background: rgba(30, 41, 59, 0.95);
  border-color: rgba(255, 255, 255, 0.08);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}

.user-menu-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
}

.user-menu-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 600;
  flex-shrink: 0;
}

.user-menu-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.user-menu-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #1e293b);
}

[data-theme="dark"] .user-menu-name {
  color: #CBD5E1;
}

.user-menu-role {
  font-size: 11px;
  color: var(--text-secondary, #64748b);
}

.user-menu-role.admin {
  color: var(--primary-color);
}

.user-menu-role.guest {
  color: #94a3b8;
}

.user-menu-divider {
  height: 1px;
  background: var(--border-color, rgba(0, 0, 0, 0.06));
  margin: 4px 0;
}

[data-theme="dark"] .user-menu-divider {
  background: rgba(255, 255, 255, 0.08);
}

.user-menu-items {
  padding: 2px 0;
}

.user-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  font-size: 13px;
  color: var(--text-primary, #1e293b);
  cursor: pointer;
  transition: background 0.12s;
  text-decoration: none;
}

[data-theme="dark"] .user-menu-item {
  color: #CBD5E1;
}

.user-menu-item:hover {
  background: rgba(0, 0, 0, 0.04);
}

[data-theme="dark"] .user-menu-item:hover {
  background: rgba(255, 255, 255, 0.06);
}

.user-menu-item i {
  font-size: 16px;
  color: var(--text-secondary, #64748b);
  width: 20px;
  text-align: center;
}

.user-menu-item.danger {
  color: #ef4444;
}

.user-menu-item.danger i {
  color: #ef4444;
}

.user-menu-toggle {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-secondary, #64748b);
  background: var(--bg-secondary, #f1f5f9);
  padding: 2px 8px;
  border-radius: 4px;
}

[data-theme="dark"] .user-menu-toggle {
  background: rgba(255, 255, 255, 0.08);
}

/* ── 菜单动画 ─────────────────────────────────────────────── */
.user-menu-enter-active,
.user-menu-leave-active {
  transition: opacity 0.15s, transform 0.15s;
}

.user-menu-enter-from,
.user-menu-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
</style>

