<template>
  <div class="admin-page">
    <header class="page-header">
      <h2>管理后台</h2>
      <p>欢迎回来，{{ authStore.user?.nickname || authStore.user?.username || '用户' }}！{{ isAdmin ? '（管理员）' : '' }}</p>
    </header>
    <div v-if="isLoading" class="empty-state">加载中...</div>
    <template v-else>
      <!-- 统计分组卡片 -->
      <div class="stats-groups">
        <div class="stat-group">
          <h4 class="stat-group-title"><i class="ri-settings-4-line"></i> 系统</h4>
          <div class="stat-group-items">
            <div class="stat-group-item"><span class="sgi-label">搜索引擎</span><span class="sgi-value">{{ stats.searchEngines || 0 }}</span></div>
            <div class="stat-group-item"><span class="sgi-label">数据库大小</span><span class="sgi-value">{{ stats.dbSize || '0MB' }}</span></div>
          </div>
        </div>
        <div class="stat-group">
          <h4 class="stat-group-title"><i class="ri-bookmark-line"></i> 书签</h4>
          <div class="stat-group-items">
            <div class="stat-group-item"><span class="sgi-label">书签总数</span><span class="sgi-value blue">{{ stats.bookmarks }}</span></div>
            <div class="stat-group-item"><span class="sgi-label">文件夹数</span><span class="sgi-value">{{ stats.folders }}</span></div>
            <div class="stat-group-item"><span class="sgi-label">今日新增</span><span class="sgi-value">{{ stats.todayBookmarks || 0 }}</span></div>
          </div>
        </div>
        <div class="stat-group">
          <h4 class="stat-group-title"><i class="ri-chat-quote-line"></i> 提示词</h4>
          <div class="stat-group-items">
            <div class="stat-group-item"><span class="sgi-label">提示词数</span><span class="sgi-value purple">{{ stats.prompts }}</span></div>
            <div class="stat-group-item"><span class="sgi-label">文件夹</span><span class="sgi-value">{{ stats.promptFolders || 0 }}</span></div>
            <div class="stat-group-item"><span class="sgi-label">标签</span><span class="sgi-value">{{ stats.tags || 0 }}</span></div>
            <div class="stat-group-item"><span class="sgi-label">版本数</span><span class="sgi-value">{{ stats.promptVersions || 0 }}</span></div>
          </div>
        </div>
        <div class="stat-group">
          <h4 class="stat-group-title"><i class="ri-user-line"></i> 用户</h4>
          <div class="stat-group-items">
            <div class="stat-group-item"><span class="sgi-label">注册用户</span><span class="sgi-value green">{{ stats.users }}</span></div>
            <div class="stat-group-item"><span class="sgi-label">管理员</span><span class="sgi-value">{{ stats.adminUsers || 0 }}</span></div>
          </div>
        </div>
      </div>
      <!-- 数据导出 -->
      <div class="export-section">
        <h3 class="settings-section-title">数据导出</h3>
        <div class="export-cards">
          <div class="export-card">
            <div class="export-card-header">
              <i class="ri-bookmark-line"></i>
              <span>书签导出</span>
            </div>
            <div class="export-card-body">
              <button v-if="isAdmin" class="btn btn-primary btn-sm" @click="exportAdminBookmarks">📥 导出全部书签</button>
              <button class="btn btn-ghost btn-sm" @click="exportMyBookmarks">📥 导出我的书签</button>
              <p class="export-hint">Netscape HTML 格式，兼容浏览器导入</p>
            </div>
          </div>
          <div class="export-card">
            <div class="export-card-header">
              <i class="ri-chat-quote-line"></i>
              <span>提示词导出</span>
            </div>
            <div class="export-card-body">
              <button v-if="isAdmin" class="btn btn-primary btn-sm" @click="exportAdminPrompts">📥 导出全部提示词</button>
              <button class="btn btn-ghost btn-sm" @click="exportMyPrompts">📥 导出我的提示词</button>
              <p class="export-hint">JSON 格式，包含标签和文件夹</p>
            </div>
          </div>
        </div>
      </div>
      <div class="admin-nav">
        <h3 class="settings-section-title">快捷操作</h3>
        <div class="nav-grid">
          <NuxtLink v-if="isAdmin" to="/admin/users" class="nav-card">
            <i class="ri-user-line nav-icon"></i>
            <span class="nav-label">用户管理</span>
          </NuxtLink>
          <NuxtLink to="/admin/bookmarks" class="nav-card">
            <i class="ri-bookmark-line nav-icon"></i>
            <span class="nav-label">书签管理</span>
          </NuxtLink>
          <NuxtLink to="/admin/prompts" class="nav-card">
            <i class="ri-chat-quote-line nav-icon"></i>
            <span class="nav-label">提示词管理</span>
          </NuxtLink>
          <NuxtLink to="/admin/search-engines" class="nav-card">
            <i class="ri-search-line nav-icon"></i>
            <span class="nav-label">搜索引擎</span>
          </NuxtLink>
          <NuxtLink v-if="isAdmin" to="/admin/backup" class="nav-card">
            <i class="ri-database-2-line nav-icon"></i>
            <span class="nav-label">备份管理</span>
          </NuxtLink>
          <NuxtLink to="/admin/settings" class="nav-card">
            <i class="ri-user-settings-line nav-icon"></i>
            <span class="nav-label">用户设置</span>
          </NuxtLink>
          <NuxtLink v-if="isAdmin" to="/admin/config" class="nav-card">
            <i class="ri-settings-3-line nav-icon"></i>
            <span class="nav-label">系统配置</span>
          </NuxtLink>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
definePageMeta({
  middleware: 'admin',
  layout: 'admin',
})
useHead({ title: '仪表盘' })
const authStore = useAuthStore()
const isAdmin = computed(() => authStore.isAdmin)
interface AdminStats {
  users: number
  bookmarks: number
  prompts: number
  folders: number
  tags: number
  promptFolders: number
  promptVersions: number
  searchEngines: number
  adminUsers: number
  favoritePrompts: number
  todayBookmarks: number
  todayPrompts: number
  dbSize: string
}
function getAuthHeaders() {
  return authStore.token ? { Authorization: `Bearer ${authStore.token}` } : {}
}
const { data, pending: isLoading } = await useFetch('/api/admin/stats', { headers: getAuthHeaders() })
const stats = computed(() => {
  const d = data.value as any
  return d || { users: 0, bookmarks: 0, prompts: 0, folders: 0 }
})
// ── 数据导出 ──
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
async function exportAdminBookmarks() {
  try {
    const blob = await $fetch('/api/admin/bookmarks/export', {
      headers: { Authorization: `Bearer ${authStore.token}` },
      responseType: 'blob',
    })
    downloadBlob(blob as Blob, `favshub-bookmarks-all-${Date.now()}.html`)
  } catch { alert('导出失败') }
}
async function exportMyBookmarks() {
  try {
    const blob = await $fetch('/api/bookmarks/export', {
      headers: { Authorization: `Bearer ${authStore.token}` },
      responseType: 'blob',
    })
    downloadBlob(blob as Blob, `favshub-bookmarks-${Date.now()}.html`)
  } catch { alert('导出失败') }
}
async function exportAdminPrompts() {
  try {
    const blob = await $fetch('/api/prompts/export?all=1', {
      headers: { Authorization: `Bearer ${authStore.token}` },
      responseType: 'blob',
    })
    downloadBlob(blob as Blob, `favshub-prompts-all-${Date.now()}.json`)
  } catch { alert('导出失败') }
}
async function exportMyPrompts() {
  try {
    const blob = await $fetch('/api/prompts/export', {
      headers: { Authorization: `Bearer ${authStore.token}` },
      responseType: 'blob',
    })
    downloadBlob(blob as Blob, `favshub-prompts-${Date.now()}.json`)
  } catch { alert('导出失败') }
}
</script>
