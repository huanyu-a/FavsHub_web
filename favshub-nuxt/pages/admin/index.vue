<template>
  <div class="admin-page">
    <header class="page-header">
      <h2>管理后台</h2>
      <p>系统概览与快捷操作</p>
    </header>

    <div v-if="isLoading" class="empty-state">加载中...</div>
    <template v-else>
      <!-- 统计分组卡片（复刻旧版8指标） -->
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

      <div class="admin-nav">
        <h3 class="settings-section-title">快捷操作</h3>
        <div class="nav-grid">
          <NuxtLink to="/admin/users" class="nav-card">
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
          <NuxtLink to="/admin/backup" class="nav-card">
            <i class="ri-database-2-line nav-icon"></i>
            <span class="nav-label">备份管理</span>
          </NuxtLink>
          <NuxtLink to="/admin/settings" class="nav-card">
            <i class="ri-user-settings-line nav-icon"></i>
            <span class="nav-label">用户设置</span>
          </NuxtLink>
          <NuxtLink to="/admin/config" class="nav-card">
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

const { data, pending: isLoading } = await useFetch('/api/admin/stats')

const stats = computed(() => {
  const d = data.value as any
  return d || { users: 0, bookmarks: 0, prompts: 0, folders: 0 }
})
</script>

<style scoped>
/* stat-card / .label / .value / .badge / .btn 等来自 /css/admin.css（admin 布局加载）。
   此处仅页面容器与快捷操作网格。 */
.admin-page {
  max-width: 1200px;
  margin: 0 auto;
  padding: 32px;
}
.stats-groups {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 16px;
  margin-bottom: 28px;
}
.stat-group {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.08);
  overflow: hidden;
}
.stat-group-title {
  padding: 12px 16px;
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: #555;
  background: #f8f9fa;
  border-bottom: 1px solid #f0f0f0;
  display: flex;
  align-items: center;
  gap: 6px;
}
.stat-group-title i { color: #667eea; font-size: 16px; }
.stat-group-items { padding: 8px 0; }
.stat-group-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px;
}
.sgi-label { font-size: 13px; color: #666; }
.sgi-value { font-size: 18px; font-weight: 700; color: #333; }
.sgi-value.blue { color: #667eea; }
.sgi-value.green { color: #10b981; }
.sgi-value.purple { color: #764ba2; }
.sgi-value.orange { color: #f59e0b; }
.admin-nav { margin-bottom: 32px; }
.nav-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 12px;
}
.nav-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 20px;
  background: #fff;
  border: 1px solid #e8e8e8;
  border-radius: 10px;
  text-decoration: none;
  color: inherit;
  transition: box-shadow 0.2s, transform 0.15s;
}
.nav-card:hover {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
  transform: translateY(-2px);
}
.nav-icon { font-size: 24px; color: #667eea; }
.nav-label { font-size: 14px; color: #333; font-weight: 500; }

@media (max-width: 768px) {
  .admin-page { padding: 16px; }
  .nav-grid { grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; }
  .nav-card { padding: 14px; }
  .nav-icon { font-size: 20px; }
  .nav-label { font-size: 13px; }
}
@media (max-width: 480px) {
  .nav-grid { grid-template-columns: 1fr 1fr; }
}
</style>
