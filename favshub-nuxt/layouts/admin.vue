<template>
  <div class="admin-layout">
    <aside class="admin-sidebar">
      <div class="admin-sidebar-logo">
        <NuxtLink to="/" class="logo-link">
          <img src="/images/logo.svg" alt="FavsHub" class="logo-img">
          <div class="logo-text">
            <h1>FavsHub</h1>
            <span>管理后台</span>
          </div>
        </NuxtLink>
      </div>
      <nav class="admin-sidebar-nav">
        <NuxtLink to="/admin" class="nav-item" :class="{ active: route.path === '/admin' }">
          <i class="ri-dashboard-line"></i><span>仪表盘</span>
        </NuxtLink>
        <NuxtLink to="/admin/users" class="nav-item" :class="{ active: route.path === '/admin/users' }">
          <i class="ri-user-line"></i><span>用户管理</span>
        </NuxtLink>
        <NuxtLink to="/admin/bookmarks" class="nav-item" :class="{ active: route.path === '/admin/bookmarks' }">
          <i class="ri-bookmark-line"></i><span>书签管理</span>
        </NuxtLink>
        <NuxtLink to="/admin/folders" class="nav-item" :class="{ active: route.path === '/admin/folders' }">
          <i class="ri-folder-line"></i><span>文件夹管理</span>
        </NuxtLink>
        <NuxtLink to="/admin/prompts" class="nav-item" :class="{ active: route.path === '/admin/prompts' }">
          <i class="ri-chat-quote-line"></i><span>提示词管理</span>
        </NuxtLink>
        <NuxtLink to="/admin/search-engines" class="nav-item" :class="{ active: route.path === '/admin/search-engines' }">
          <i class="ri-search-line"></i><span>搜索引擎</span>
        </NuxtLink>
        <NuxtLink to="/admin/backup" class="nav-item" :class="{ active: route.path === '/admin/backup' }">
          <i class="ri-database-2-line"></i><span>备份管理</span>
        </NuxtLink>
        <NuxtLink to="/admin/settings" class="nav-item" :class="{ active: route.path === '/admin/settings' }">
          <i class="ri-user-settings-line"></i><span>用户设置</span>
        </NuxtLink>
        <NuxtLink to="/admin/config" class="nav-item" :class="{ active: route.path === '/admin/config' }">
          <i class="ri-settings-3-line"></i><span>系统配置</span>
        </NuxtLink>
      </nav>
      <div class="admin-sidebar-footer">
        <NuxtLink to="/" class="nav-item">
          <i class="ri-arrow-left-line"></i><span>返回前台</span>
        </NuxtLink>
      </div>
    </aside>
    <main class="admin-main">
      <slot />
    </main>
  </div>
</template>

<script setup lang="ts">
const route = useRoute()
</script>

<style scoped>
.admin-layout {
  display: flex;
  height: 100vh;
  overflow: hidden;
  background: #f5f5f7;
}
.admin-sidebar {
  width: 220px;
  background: #1a1a2e;
  color: #fff;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  overflow-y: auto;
}
.admin-sidebar-logo {
  padding: 20px 20px 16px;
  border-bottom: 1px solid rgba(255,255,255,0.1);
}
.logo-link {
  display: flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
  color: inherit;
}
.logo-img { width: 32px; height: 32px; }
.logo-text h1 { font-size: 18px; font-weight: 700; margin: 0; }
.logo-text span { font-size: 11px; color: rgba(255,255,255,0.5); }
.admin-sidebar-nav {
  flex: 1;
  padding: 12px 0;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 24px;
  color: rgba(255,255,255,0.65);
  text-decoration: none;
  font-size: 14px;
  transition: all 0.15s;
  border-left: 3px solid transparent;
}
.nav-item:hover { color: #fff; background: rgba(255,255,255,0.06); }
.nav-item.active {
  color: #fff;
  background: rgba(255,255,255,0.1);
  border-left-color: #667eea;
}
.nav-item i { font-size: 18px; width: 20px; text-align: center; }
.admin-sidebar-footer {
  padding: 12px 0;
  border-top: 1px solid rgba(255,255,255,0.1);
}
.admin-main {
  flex: 1;
  overflow-y: auto;
  padding: 0;
}
</style>
