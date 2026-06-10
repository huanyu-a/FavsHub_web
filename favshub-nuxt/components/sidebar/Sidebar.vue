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
          <ul id="categories-list" class="space-y-2">
            <li
              class="cursor-pointer p-2 hover:bg-emerald-500 rounded-lg flex items-center folder-item"
              :class="{ 'bg-emerald-500': currentFolderId === null }"
              @click="$emit('select-folder', null)"
            >
              <i class="ri-folder-3-line" style="font-size:16px;color:#667eea;margin-right:8px;flex-shrink:0;width:20px;text-align:center;"></i>
              <span>全部</span>
            </li>
            <template v-for="folder in flatFolderTree" :key="folder.id">
              <li
                v-if="folder._visible"
                class="cursor-pointer p-2 hover:bg-emerald-500 rounded-lg flex items-center folder-item"
                :class="{ 'bg-emerald-500': currentFolderId === folder.id }"
                :style="{ paddingLeft: (folder._depth * 20 + 8) + 'px' }"
                @click="$emit('select-folder', folder.id)"
                @contextmenu.prevent="onFolderContextMenu($event, folder)"
              >
                <!-- 展开/收缩箭头 -->
                <span
                  v-if="folder._hasChildren"
                  class="folder-arrow"
                  @click.stop="toggleExpand(folder.id)"
                  style="width:20px;text-align:center;margin-right:4px;flex-shrink:0;cursor:pointer;font-size:12px;color:#94a3b8;"
                >
                  <i :class="expandedIds.has(folder.id) ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'" style="font-size:16px;"></i>
                </span>
                <span v-else style="width:20px;margin-right:4px;flex-shrink:0;"></span>
                <i :class="folderIcon(folder.name)" style="font-size:16px;color:#667eea;margin-right:8px;flex-shrink:0;width:20px;text-align:center;"></i>
                <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{{ folder.name }}</span>
                <span v-if="folder._count > 0" class="ml-auto" style="font-size:11px;color:#94a3b8;flex-shrink:0;">{{ folder._count }}</span>
              </li>
            </template>
            <li
              class="cursor-pointer p-2 hover:bg-emerald-500 rounded-lg flex items-center folder-item client-only-user add-folder"
              @click="$emit('create-folder')"
            >
              <i class="ri-add-line" style="font-size:16px;color:#94a3b8;margin-right:8px;flex-shrink:0;width:20px;text-align:center;"></i>
              <span>新建文件夹</span>
            </li>
          </ul>

          <!-- 文件夹右键菜单 -->
          <Teleport to="body">
            <div
              v-if="folderMenu.visible"
              class="folder-context-menu"
              :style="{ left: folderMenu.x + 'px', top: folderMenu.y + 'px' }"
              @click.stop
            >
              <div class="folder-context-item" @click="renameFolder(folderMenu.folder!)">
                <i class="ri-edit-line"></i> 重命名
              </div>
              <div class="folder-context-item" @click="createSubFolder(folderMenu.folder!)">
                <i class="ri-folder-add-line"></i> 新建子文件夹
              </div>
              <div class="folder-context-item danger" @click="deleteFolder(folderMenu.folder!)">
                <i class="ri-delete-bin-line"></i> 删除
              </div>
            </div>
            <div v-if="folderMenu.visible" class="folder-context-overlay" @click="folderMenu.visible = false"></div>
          </Teleport>
        </div>

        <div class="sidebar-bottom">
          <div class="sidebar-toolbar">
            <a v-if="settingsStore.get('showHistoryLink', true)" href="#" class="sidebar-toolbar-icon" title="历史记录" style="text-decoration:none;" @click.prevent="openChromePage('history')">
              <i class="ri-history-line" style="font-size:14px;"></i>
            </a>
            <a v-if="settingsStore.get('showDownloadsLink', true)" href="#" class="sidebar-toolbar-icon" title="下载记录" style="text-decoration:none;" @click.prevent="openChromePage('downloads')">
              <i class="ri-download-line" style="font-size:14px;"></i>
            </a>
            <a v-if="settingsStore.get('showPasswordsLink', true)" href="#" class="sidebar-toolbar-icon" title="密码管理" style="text-decoration:none;" @click.prevent="openChromePage('passwords')">
              <i class="ri-key-2-line" style="font-size:14px;"></i>
            </a>
            <a v-if="settingsStore.get('showExtensionsLink', true)" href="#" class="sidebar-toolbar-icon" title="扩展管理" style="text-decoration:none;" @click.prevent="openChromePage('extensions')">
              <i class="ri-apps-line" style="font-size:14px;"></i>
            </a>
            <button class="sidebar-theme-btn" title="切换主题" @click="toggleTheme">
              <i :class="isDark ? 'ri-sun-line' : 'ri-moon-line'" style="font-size:14px;"></i>
            </button>
            <button class="sidebar-toolbar-icon client-only-user" title="个人设置" @click="$emit('open-settings')">
              <i class="ri-settings-3-line" style="font-size:14px;"></i>
            </button>
            <NuxtLink to="/login" class="sidebar-toolbar-icon client-only-guest" title="登录" style="text-decoration:none;">
              <i class="ri-login-box-line" style="font-size:14px;"></i>
            </NuxtLink>
            <NuxtLink to="/admin" class="sidebar-toolbar-icon client-only-admin" title="管理后台" style="text-decoration:none;">
              <i class="ri-dashboard-line" style="font-size:14px;"></i>
            </NuxtLink>
            <a href="#" class="sidebar-toolbar-icon client-only-user" title="退出登录" style="text-decoration:none;" @click.prevent="handleLogout">
              <i class="ri-logout-box-r-line" style="font-size:14px;"></i>
            </a>
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

defineEmits<{
  toggle: []
  'select-folder': [id: number | null]
  'create-folder': []
  'open-settings': []
  'rename-folder': [id: number, name: string]
  'create-sub-folder': [parentId: number, name: string]
  'delete-folder': [id: number]
}>()

const uiStore = useUIStore()
const authStore = useAuthStore()
const settingsStore = useSettingsStore()
const bookmarksStore = useBookmarksStore()
const router = useRouter()

const isDark = computed(() =>
  uiStore.theme === 'dark' ||
  (uiStore.theme === 'auto' && import.meta.client && window.matchMedia('(prefers-color-scheme: dark)').matches)
)

// 文件夹图标按名称哈希选取（匹配旧版逻辑）
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
  folder: null as (Folder & { _depth: number; _count: number; _hasChildren: boolean; _visible: boolean }) | null,
})

// 初始化：根文件夹默认展开
watch(() => props.folders, (folders) => {
  if (folders.length > 0 && expandedIds.value.size === 0) {
    const childParentIds = new Set(folders.filter(f => f.parent_id).map(f => f.parent_id!))
    folders.filter(f => !f.parent_id || !childParentIds.has(f.id)).forEach(f => expandedIds.value.add(f.id))
  }
}, { immediate: true })

function toggleExpand(id: number) {
  if (expandedIds.value.has(id)) {
    expandedIds.value.delete(id)
  } else {
    expandedIds.value.add(id)
  }
}

// ── 构建带展开/收缩的扁平文件夹树 ────────────────────────────
interface FolderNode extends Folder {
  _depth: number
  _count: number
  _hasChildren: boolean
  _visible: boolean
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

const flatFolderTree = computed(() => {
  const map = new Map<number, FolderNode>()
  const roots: FolderNode[] = []

  for (const f of props.folders) {
    map.set(f.id, {
      ...f,
      _depth: 0,
      _count: bookmarkCountMap.value.get(f.id) || 0,
      _hasChildren: false,
      _visible: false,
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

  // 只有父级展开时才显示子节点
  const result: FolderNode[] = []
  function traverse(nodes: FolderNode[], depth: number) {
    for (const n of nodes) {
      n._depth = depth
      n._visible = true
      result.push(n)
      if (n.children.length > 0 && expandedIds.value.has(n.id)) {
        traverse(n.children, depth + 1)
      }
    }
  }
  traverse(roots, 0)
  return result
})

// ── 右键菜单处理 ──────────────────────────────────────────────
function onFolderContextMenu(event: MouseEvent, folder: any) {
  event.preventDefault()
  folderMenu.x = event.clientX
  folderMenu.y = event.clientY
  folderMenu.folder = folder
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

function toggleTheme() {
  uiStore.setTheme(isDark.value ? 'light' : 'dark')
}

function handleLogout() {
  authStore.logout()
  router.push('/login')
}

function openChromePage(page: string) {
  if (import.meta.client) {
    const urls: Record<string, string> = {
      history: 'chrome://history',
      downloads: 'chrome://downloads',
      passwords: 'chrome://password-manager/passwords',
      extensions: 'chrome://extensions',
    }
    const url = urls[page]
    if (url) window.open(url, '_blank')
  }
}
</script>

<style scoped>
/* 折叠态：复用旧框架 #sidebar-container.collapsed（margin-left 负值），此处仅声明过渡 */
#sidebar-container {
  transition: margin-left 0.3s ease;
}
.add-folder span {
  color: #94a3b8;
  font-size: 12px;
}
</style>

<style>
/* 右键菜单（Teleport 到 body，不可 scoped） */
.folder-context-menu {
  position: fixed;
  z-index: 10000;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.12);
  padding: 4px 0;
  min-width: 160px;
  font-size: 13px;
}
.folder-context-item {
  padding: 8px 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  color: #334155;
  transition: background 0.15s;
}
.folder-context-item:hover {
  background: #f1f5f9;
}
.folder-context-item.danger {
  color: #ef4444;
}
.folder-context-item.danger:hover {
  background: #fef2f2;
}
.folder-context-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
}
</style>
