<template>
  <div class="admin-page">
    <header class="page-header">
      <h1 class="page-title">管理后台</h1>
    </header>

    <div v-if="isLoading" class="loading">加载中...</div>
    <template v-else>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">{{ stats.users }}</div>
          <div class="stat-label">用户数</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ stats.bookmarks }}</div>
          <div class="stat-label">书签数</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ stats.prompts }}</div>
          <div class="stat-label">提示词数</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">{{ stats.folders }}</div>
          <div class="stat-label">文件夹数</div>
        </div>
      </div>

      <div class="admin-nav">
        <h2 class="section-title">快捷操作</h2>
        <div class="nav-grid">
          <NuxtLink to="/admin/users" class="nav-card">
            <span class="nav-icon">👥</span>
            <span class="nav-label">用户管理</span>
          </NuxtLink>
          <NuxtLink to="/admin/bookmarks" class="nav-card">
            <span class="nav-icon">🔖</span>
            <span class="nav-label">书签管理</span>
          </NuxtLink>
          <NuxtLink to="/admin/prompts" class="nav-card">
            <span class="nav-icon">💬</span>
            <span class="nav-label">提示词管理</span>
          </NuxtLink>
          <NuxtLink to="/admin/import" class="nav-card">
            <span class="nav-icon">📥</span>
            <span class="nav-label">数据导入</span>
          </NuxtLink>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
definePageMeta({
  middleware: 'admin',
})

interface AdminStats {
  users: number
  bookmarks: number
  prompts: number
  folders: number
}

const { data, pending: isLoading } = await useFetch<{ stats: AdminStats }>('/api/admin/stats')

const stats = computed(() => data.value?.stats || { users: 0, bookmarks: 0, prompts: 0, folders: 0 })
</script>

<style scoped>
.admin-page {
  max-width: 1200px;
  margin: 0 auto;
  padding: 24px;
}
.page-header {
  margin-bottom: 24px;
}
.page-title {
  font-size: 24px;
  font-weight: 600;
  margin: 0;
  color: #333;
}
.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 16px;
  margin-bottom: 32px;
}
.stat-card {
  background: #fff;
  border: 1px solid #e8e8e8;
  border-radius: 10px;
  padding: 20px;
  text-align: center;
}
.stat-value {
  font-size: 32px;
  font-weight: 700;
  color: #1976d2;
}
.stat-label {
  font-size: 13px;
  color: #888;
  margin-top: 4px;
}
.admin-nav {
  margin-bottom: 32px;
}
.section-title {
  font-size: 18px;
  font-weight: 600;
  margin: 0 0 16px;
  color: #444;
}
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
.nav-icon {
  font-size: 28px;
}
.nav-label {
  font-size: 14px;
  color: #333;
  font-weight: 500;
}
.loading {
  text-align: center;
  padding: 60px 20px;
  color: #999;
}
@media (prefers-color-scheme: dark) {
  .page-title,
  .section-title {
    color: #eee;
  }
  .stat-card,
  .nav-card {
    background: #1e1e1e;
    border-color: #333;
  }
  .stat-card:hover,
  .nav-card:hover {
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
  }
  .stat-value {
    color: #64b5f6;
  }
  .nav-label {
    color: #ccc;
  }
}
</style>
