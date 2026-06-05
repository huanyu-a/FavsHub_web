<template>
  <aside class="sidebar" :class="{ collapsed: !isOpen }">
    <!-- 品牌 -->
    <div class="sidebar-top">
      <NuxtLink to="/" class="sidebar-brand-card" title="主页">
        <img src="/images/logo.svg" alt="Logo" class="sidebar-brand-logo">
        <div v-if="isOpen" class="sidebar-brand-copy">
          <span class="sidebar-brand-title">FavsHub</span>
          <span class="sidebar-brand-subtitle">Workspace</span>
        </div>
      </NuxtLink>

      <!-- 导航链接 -->
      <div class="sidebar-hub-nav">
        <NuxtLink to="/" class="sidebar-hub-link" :class="{ active: activePage === 'home' }">
          <span class="sidebar-hub-icon"><i class="ri-home-5-line"></i></span>
          <span v-if="isOpen" class="sidebar-hub-label">主页</span>
        </NuxtLink>
        <NuxtLink to="/prompts" class="sidebar-hub-link" :class="{ active: activePage === 'prompts' }">
          <span class="sidebar-hub-icon"><i class="ri-sparkling-line"></i></span>
          <span v-if="isOpen" class="sidebar-hub-label">提示词管理</span>
        </NuxtLink>
      </div>
    </div>

    <!-- 文件夹列表 -->
    <nav v-if="isOpen" class="sidebar-folders-panel">
      <ul class="folder-list">
        <li
          class="folder-item"
          :class="{ active: currentFolderId === null }"
          @click="$emit('select-folder', null)"
        >
          <i class="ri-folder-3-line"></i>
          <span>全部</span>
        </li>
        <li
          v-for="folder in folderTree"
          :key="folder.id"
          class="folder-item"
          :class="{ active: currentFolderId === folder.id }"
          :style="{ paddingLeft: (folder._depth || 0) * 16 + 8 + 'px' }"
          @click="$emit('select-folder', folder.id)"
        >
          <i class="ri-folder-3-line"></i>
          <span>{{ folder.name }}</span>
          <span v-if="folder._count > 0" class="folder-count">{{ folder._count }}</span>
        </li>
        <li class="folder-item add-folder client-only-guest" @click="$emit('create-folder')">
          <i class="ri-add-line"></i>
          <span>新建文件夹</span>
        </li>
      </ul>
    </nav>

    <!-- 底部工具栏 -->
    <div class="sidebar-bottom">
      <div class="sidebar-toolbar">
        <a href="#" class="sidebar-toolbar-icon" :style="{ display: settingsStore.get('showHistoryLink', true) ? '' : 'none' }" title="历史记录" @click.prevent="openChromePage('history')">
          <i class="ri-history-line" style="font-size:14px;"></i>
        </a>
        <a href="#" class="sidebar-toolbar-icon" :style="{ display: settingsStore.get('showDownloadsLink', true) ? '' : 'none' }" title="下载记录" @click.prevent="openChromePage('downloads')">
          <i class="ri-download-line" style="font-size:14px;"></i>
        </a>
        <a href="#" class="sidebar-toolbar-icon" :style="{ display: settingsStore.get('showPasswordsLink', true) ? '' : 'none' }" title="密码管理" @click.prevent="openChromePage('passwords')">
          <i class="ri-key-2-line" style="font-size:14px;"></i>
        </a>
        <a href="#" class="sidebar-toolbar-icon" :style="{ display: settingsStore.get('showExtensionsLink', true) ? '' : 'none' }" title="扩展管理" @click.prevent="openChromePage('extensions')">
          <i class="ri-apps-line" style="font-size:14px;"></i>
        </a>
        <button class="sidebar-theme-btn" @click="toggleTheme" title="切换主题">
          <i :class="isDark ? 'ri-sun-line' : 'ri-moon-line'" style="font-size:14px;"></i>
        </button>
        <NuxtLink to="/login" class="sidebar-toolbar-icon client-only-guest" title="登录">
          <i class="ri-login-box-line" style="font-size:14px;"></i>
        </NuxtLink>
        <NuxtLink to="/admin" class="sidebar-toolbar-icon client-only-admin" title="管理后台">
          <i class="ri-dashboard-line" style="font-size:14px;"></i>
        </NuxtLink>
        <button class="sidebar-toolbar-icon client-only-user" @click="handleLogout" title="退出登录">
          <i class="ri-logout-box-r-line" style="font-size:14px;"></i>
        </button>
      </div>
      <button class="sidebar-collapse-btn" @click="$emit('toggle')" title="收起/展开">
        <i :class="isOpen ? 'ri-arrow-left-s-line' : 'ri-arrow-right-s-line'"></i>
      </button>
    </div>
  </aside>
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
}>()

const uiStore = useUIStore()
const authStore = useAuthStore()
const settingsStore = useSettingsStore()
const router = useRouter()

const isDark = computed(() => uiStore.theme === 'dark' || (uiStore.theme === 'auto' && import.meta.client && window.matchMedia('(prefers-color-scheme: dark)').matches))

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
.sidebar {
  width: 220px;
  min-height: 100vh;
  background: #f5f5f5;
  border-right: 1px solid #e0e0e0;
  transition: width 0.2s;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}
.sidebar.collapsed {
  width: 52px;
}
.sidebar-top {
  padding: 12px;
  border-bottom: 1px solid #e0e0e0;
}
.sidebar-brand-card {
  display: flex;
  align-items: center;
  gap: 8px;
  text-decoration: none;
  color: inherit;
  padding: 4px 0;
}
.sidebar-brand-logo {
  width: 28px;
  height: 28px;
}
.sidebar-brand-copy {
  display: flex;
  flex-direction: column;
}
.sidebar-brand-title {
  font-size: 14px;
  font-weight: 700;
  color: #333;
}
.sidebar-brand-subtitle {
  font-size: 10px;
  color: #999;
}
.sidebar-hub-nav {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.sidebar-hub-link {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border-radius: 6px;
  text-decoration: none;
  color: #555;
  font-size: 13px;
  transition: background 0.15s;
}
.sidebar-hub-link:hover { background: rgba(0,0,0,0.06); }
.sidebar-hub-link.active { background: #e3f2fd; color: #1976d2; }
.sidebar-hub-icon { width: 20px; text-align: center; }
.sidebar-folders-panel {
  flex: 1;
  overflow-y: auto;
  padding: 8px 12px;
}
.folder-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.folder-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  color: #555;
  transition: background 0.15s;
}
.folder-item:hover { background: rgba(0,0,0,0.06); }
.folder-item.active { background: #e3f2fd; color: #1976d2; }
.folder-item.add-folder { color: #999; font-size: 12px; margin-top: 4px; }
.folder-count { font-size: 10px; color: #999; margin-left: auto; }
.sidebar-bottom {
  padding: 8px 12px;
  border-top: 1px solid #e0e0e0;
}
.sidebar-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}
.sidebar-toolbar-icon,
.sidebar-theme-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 6px;
  border-radius: 4px;
  color: #666;
  text-decoration: none;
  display: flex;
  align-items: center;
}
.sidebar-toolbar-icon:hover,
.sidebar-theme-btn:hover {
  background: rgba(0,0,0,0.06);
}
.sidebar-collapse-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
  margin-top: 4px;
  color: #999;
  width: 100%;
  text-align: center;
}
/* Auth-dependent visibility (CSS-only, no v-if to avoid hydration mismatch) */
.client-only-guest { display: none; }
.client-only-user { display: flex; }
.client-only-admin { display: none; }
:global([data-guest="true"]) .client-only-guest { display: flex; }
:global([data-guest="true"]) .client-only-user { display: none; }
:global([data-admin="true"]) .client-only-admin { display: flex; }
/* Dark mode */
:global([data-theme="dark"]) .sidebar {
  background: #1e1e1e;
  border-right-color: #333;
}
:global([data-theme="dark"]) .sidebar-brand-title { color: #eee; }
:global([data-theme="dark"]) .sidebar-hub-link { color: #ccc; }
:global([data-theme="dark"]) .sidebar-hub-link:hover { background: rgba(255,255,255,0.06); }
:global([data-theme="dark"]) .sidebar-hub-link.active { background: #1a3a5c; color: #64b5f6; }
:global([data-theme="dark"]) .folder-item { color: #ccc; }
:global([data-theme="dark"]) .folder-item:hover { background: rgba(255,255,255,0.06); }
:global([data-theme="dark"]) .folder-item.active { background: #1a3a5c; color: #64b5f6; }
:global([data-theme="dark"]) .sidebar-quick-links { border-top-color: #333; }
:global([data-theme="dark"]) .quick-link { color: #aaa; }
:global([data-theme="dark"]) .quick-link:hover { background: rgba(255,255,255,0.06); color: #ccc; }
:global([data-theme="dark"]) .sidebar-bottom { border-top-color: #333; }
:global([data-theme="dark"]) .sidebar-top { border-bottom-color: #333; }
:global([data-theme="dark"]) .sidebar-toolbar-icon,
:global([data-theme="dark"]) .sidebar-theme-btn { color: #aaa; }
</style>
