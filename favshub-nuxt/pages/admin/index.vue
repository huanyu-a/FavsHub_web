<template>
  <div class="admin-page">
    <header class="page-header">
      <h2>管理后台</h2>
      <p>系统概览与快捷操作</p>
    </header>

    <div v-if="isLoading" class="empty-state">加载中...</div>
    <template v-else>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="label">用户数</div>
          <div class="value blue">{{ stats.users }}</div>
        </div>
        <div class="stat-card">
          <div class="label">书签数</div>
          <div class="value green">{{ stats.bookmarks }}</div>
        </div>
        <div class="stat-card">
          <div class="label">提示词数</div>
          <div class="value purple">{{ stats.prompts }}</div>
        </div>
        <div class="stat-card">
          <div class="label">文件夹数</div>
          <div class="value orange">{{ stats.folders }}</div>
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
          <NuxtLink to="/admin/folders" class="nav-card">
            <i class="ri-folder-line nav-icon"></i>
            <span class="nav-label">文件夹管理</span>
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

interface AdminStats {
  users: number
  bookmarks: number
  prompts: number
  folders: number
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
