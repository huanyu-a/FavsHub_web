<template>
  <aside class="sidebar" :class="{ collapsed: !isOpen }">
    <div class="sidebar-header">
      <h2 class="sidebar-title">FavsHub</h2>
      <button class="toggle-btn" @click="$emit('toggle')" title="收起/展开">
        {{ isOpen ? '«' : '»' }}
      </button>
    </div>

    <nav v-if="isOpen" class="sidebar-nav">
      <div class="nav-section">
        <div class="nav-section-title">导航</div>
        <NuxtLink to="/" class="nav-item" :class="{ active: activePage === 'home' }">
          <span class="nav-icon">🏠</span>
          <span class="nav-label">首页</span>
        </NuxtLink>
        <NuxtLink to="/prompts" class="nav-item" :class="{ active: activePage === 'prompts' }">
          <span class="nav-icon">💬</span>
          <span class="nav-label">提示词</span>
        </NuxtLink>
        <NuxtLink v-if="isAdmin" to="/admin" class="nav-item" :class="{ active: activePage === 'admin' }">
          <span class="nav-icon">⚙️</span>
          <span class="nav-label">管理</span>
        </NuxtLink>
      </div>

      <div class="nav-section">
        <div class="nav-section-title">文件夹</div>
        <div
          v-for="folder in folders"
          :key="folder.id"
          class="nav-item folder-item"
          :class="{ active: currentFolderId === folder.id }"
          @click="$emit('select-folder', folder.id)"
        >
          <span class="nav-icon">📁</span>
          <span class="nav-label">{{ folder.name }}</span>
        </div>
        <div v-if="folders.length === 0" class="nav-empty">暂无文件夹</div>
      </div>
    </nav>
  </aside>
</template>

<script setup lang="ts">
interface Folder {
  id: number
  name: string
  icon?: string
}

defineProps<{
  isOpen: boolean
  folders: Folder[]
  currentFolderId: number | null
  activePage?: string
  isAdmin?: boolean
}>()

defineEmits<{
  toggle: []
  'select-folder': [id: number]
}>()
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
}
.sidebar.collapsed {
  width: 48px;
}
.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  border-bottom: 1px solid #e0e0e0;
}
.sidebar-title {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
  color: #333;
}
.toggle-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 14px;
  color: #666;
  padding: 4px 8px;
  border-radius: 4px;
}
.toggle-btn:hover {
  background: rgba(0, 0, 0, 0.05);
}
.sidebar-nav {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}
.nav-section {
  margin-bottom: 16px;
}
.nav-section-title {
  font-size: 11px;
  text-transform: uppercase;
  color: #999;
  padding: 4px 8px;
  letter-spacing: 0.5px;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border-radius: 6px;
  cursor: pointer;
  text-decoration: none;
  color: #333;
  font-size: 14px;
  transition: background 0.15s;
}
.nav-item:hover {
  background: rgba(0, 0, 0, 0.06);
}
.nav-item.active {
  background: #e3f2fd;
  color: #1976d2;
}
.nav-icon {
  font-size: 16px;
  width: 20px;
  text-align: center;
}
.nav-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.nav-empty {
  font-size: 12px;
  color: #bbb;
  padding: 8px;
}
@media (prefers-color-scheme: dark) {
  .sidebar {
    background: #1e1e1e;
    border-right-color: #333;
  }
  .sidebar-title {
    color: #eee;
  }
  .nav-item {
    color: #ccc;
  }
  .nav-item:hover {
    background: rgba(255, 255, 255, 0.06);
  }
  .nav-item.active {
    background: #1a3a5c;
    color: #64b5f6;
  }
  .toggle-btn {
    color: #aaa;
  }
  .toggle-btn:hover {
    background: rgba(255, 255, 255, 0.08);
  }
}
</style>
