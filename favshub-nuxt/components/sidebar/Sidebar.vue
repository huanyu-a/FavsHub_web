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
            <li
              v-for="folder in folderTree"
              :key="folder.id"
              class="cursor-pointer p-2 hover:bg-emerald-500 rounded-lg flex items-center folder-item"
              :class="{ 'bg-emerald-500': currentFolderId === folder.id }"
              :style="{ paddingLeft: (folder._depth * 20 + 8) + 'px' }"
              @click="$emit('select-folder', folder.id)"
            >
              <i :class="folderIcon(folder.name)" style="font-size:16px;color:#667eea;margin-right:8px;flex-shrink:0;width:20px;text-align:center;"></i>
              <span>{{ folder.name }}</span>
              <span v-if="folder._count > 0" class="ml-auto" style="font-size:11px;color:#94a3b8;">{{ folder._count }}</span>
            </li>
            <li
              class="cursor-pointer p-2 hover:bg-emerald-500 rounded-lg flex items-center folder-item client-only-user add-folder"
              @click="$emit('create-folder')"
            >
              <i class="ri-add-line" style="font-size:16px;color:#94a3b8;margin-right:8px;flex-shrink:0;width:20px;text-align:center;"></i>
              <span>新建文件夹</span>
            </li>
          </ul>
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
}>()

const uiStore = useUIStore()
const authStore = useAuthStore()
const settingsStore = useSettingsStore()
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

// 构建层级文件夹树
interface FolderNode extends Folder {
  _depth: number
  _count: number
  children: FolderNode[]
}
const folderTree = computed(() => {
  const map = new Map<number, FolderNode>()
  const roots: FolderNode[] = []

  for (const f of props.folders) {
    const count = (f as any).bookmark_count || 0
    map.set(f.id, { ...f, _depth: 0, _count: count, children: [] })
  }

  for (const node of map.values()) {
    const pid = node.parent_id
    if (pid && map.has(pid)) {
      map.get(pid)!.children.push(node)
    } else {
      roots.push(node)
    }
  }

  function flatten(nodes: FolderNode[], depth: number): FolderNode[] {
    let result: FolderNode[] = []
    for (const n of nodes) {
      n._depth = depth
      result.push(n)
      if (n.children.length > 0) {
        result = result.concat(flatten(n.children, depth + 1))
      }
    }
    return result
  }

  return flatten(roots, 0)
})

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
