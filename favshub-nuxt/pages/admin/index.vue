<template>
  <div class="admin-page">
    <header class="page-header">
      <h2>管理后台</h2>
      <p v-if="isAdmin">欢迎回来，{{ authStore.user?.nickname || authStore.user?.username || '用户' }}！（管理员）</p>
      <p v-else>欢迎回来，{{ authStore.user?.nickname || authStore.user?.username || '用户' }}！</p>
    </header>
    <div v-if="isLoading" class="empty-state">加载中...</div>
    <template v-else>
      <!-- 统计面板：管理员 / 普通用户共用同一 DOM 结构 -->
      <div class="stats-groups">
        <!-- 系统（仅管理员） -->
        <div v-if="isAdmin" class="stat-group">
          <h4 class="stat-group-title"><i class="ri-settings-4-line"></i> 系统</h4>
          <div class="stat-group-items">
            <div class="stat-group-item"><span class="sgi-label">搜索引擎</span><span class="sgi-value">{{ stats.searchEngines || 0 }}</span></div>
            <div class="stat-group-item"><span class="sgi-label">数据库大小</span><span class="sgi-value">{{ stats.dbSize || '0MB' }}</span></div>
          </div>
        </div>
        <div class="stat-group">
          <h4 class="stat-group-title"><i class="ri-bookmark-line"></i> {{ isAdmin ? '书签' : '我的书签' }}</h4>
          <div class="stat-group-items">
            <div class="stat-group-item"><span class="sgi-label">书签总数</span><span class="sgi-value blue">{{ stats.bookmarks }}</span></div>
            <div class="stat-group-item"><span class="sgi-label">文件夹数</span><span class="sgi-value">{{ stats.folders }}</span></div>
            <div class="stat-group-item"><span class="sgi-label">今日新增</span><span class="sgi-value">{{ stats.todayBookmarks || 0 }}</span></div>
          </div>
        </div>
        <div class="stat-group">
          <h4 class="stat-group-title"><i class="ri-chat-quote-line"></i> {{ isAdmin ? '提示词' : '我的提示词' }}</h4>
          <div class="stat-group-items">
            <div class="stat-group-item"><span class="sgi-label">提示词数</span><span class="sgi-value purple">{{ stats.prompts }}</span></div>
            <div class="stat-group-item"><span class="sgi-label">文件夹</span><span class="sgi-value">{{ stats.promptFolders || 0 }}</span></div>
            <div v-if="!isAdmin" class="stat-group-item"><span class="sgi-label">收藏数</span><span class="sgi-value orange">{{ stats.favoritePrompts || 0 }}</span></div>
            <div class="stat-group-item"><span class="sgi-label">标签</span><span class="sgi-value">{{ stats.tags || 0 }}</span></div>
            <div class="stat-group-item"><span class="sgi-label">版本数</span><span class="sgi-value">{{ stats.promptVersions || 0 }}</span></div>
          </div>
        </div>
        <div v-if="isAdmin" class="stat-group">
          <h4 class="stat-group-title"><i class="ri-user-line"></i> 用户</h4>
          <div class="stat-group-items">
            <div class="stat-group-item"><span class="sgi-label">注册用户</span><span class="sgi-value green">{{ stats.users }}</span></div>
            <div class="stat-group-item"><span class="sgi-label">管理员</span><span class="sgi-value">{{ stats.adminUsers || 0 }}</span></div>
          </div>
        </div>
      </div>

      <!-- 快捷操作：统一 DOM 结构，只通过 v-if 控制卡片显隐 -->
      <div class="admin-nav">
        <h3 class="settings-section-title">快捷操作</h3>
        <div class="nav-grid" style="display:flex;flex-wrap:wrap;gap:12px;">
          <NuxtLink v-if="isAdmin" to="/admin/users" class="nav-card">
            <i class="ri-user-line nav-icon"></i>
            <span class="nav-label">用户管理</span>
          </NuxtLink>
          <NuxtLink to="/admin/bookmarks" class="nav-card">
            <i class="ri-bookmark-line nav-icon"></i>
            <span class="nav-label">{{ isAdmin ? '书签管理' : '我的书签' }}</span>
          </NuxtLink>
          <NuxtLink to="/admin/prompts" class="nav-card">
            <i class="ri-chat-quote-line nav-icon"></i>
            <span class="nav-label">{{ isAdmin ? '提示词管理' : '我的提示词' }}</span>
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
    <BackToTop />
  </div>
</template>

<script setup lang="ts">
import BackToTop from '~/components/BackToTop.vue'
definePageMeta({
  middleware: 'admin',
  layout: 'admin',
})
useHead({ title: '仪表盘' })
const authStore = useAuthStore()
const isAdmin = computed(() => authStore.isAdmin)

function getAuthHeaders() {
  return authStore.token && authStore.token !== 'cookie_auth' ? { Authorization: `Bearer ${authStore.token}` } : {}
}
const { data, pending: isLoading } = await useFetch('/api/admin/stats', { headers: getAuthHeaders(), credentials: 'include' })
const stats = computed(() => {
  const d = data.value as any
  return d || { bookmarks: 0, folders: 0, prompts: 0 }
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
      headers: getAuthHeaders(),
      responseType: 'blob',
      credentials: 'include',
    })
    downloadBlob(blob as Blob, `favshub-bookmarks-all-${Date.now()}.html`)
  } catch { alert('导出失败') }
}
async function exportMyBookmarks() {
  try {
    const blob = await $fetch('/api/bookmarks/export', {
      headers: getAuthHeaders(),
      responseType: 'blob',
      credentials: 'include',
    })
    downloadBlob(blob as Blob, `favshub-bookmarks-${Date.now()}.html`)
  } catch { alert('导出失败') }
}
async function exportAdminPrompts() {
  try {
    const blob = await $fetch('/api/prompts/export?all=1', {
      headers: getAuthHeaders(),
      responseType: 'blob',
      credentials: 'include',
    })
    downloadBlob(blob as Blob, `favshub-prompts-all-${Date.now()}.json`)
  } catch { alert('导出失败') }
}
async function exportMyPrompts() {
  try {
    const blob = await $fetch('/api/prompts/export', {
      headers: getAuthHeaders(),
      responseType: 'blob',
      credentials: 'include',
    })
    downloadBlob(blob as Blob, `favshub-prompts-${Date.now()}.json`)
  } catch { alert('导出失败') }
}
</script>
<style>
/* 确保仪表盘 nav-grid 有正确的 grid 布局（不受 @layer 优先级影响） */
.admin-page .nav-grid {
  display: flex; flex-wrap: wrap;
  gap: 12px;
}
</style>