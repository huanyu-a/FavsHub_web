<template>
  <div class="admin-layout">
    <aside class="admin-sidebar" :class="{ open: sidebarOpen }">
      <div class="admin-sidebar-logo">
        <NuxtLink to="/admin" class="logo-link">
          <img src="/images/logo.svg" alt="FavsHub" class="logo-img">
          <div class="logo-text">
            <h1>FavsHub</h1>
            <span>管理后台</span>
          </div>
          <button class="hamburger" @click="sidebarOpen = !sidebarOpen">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12h18M3 6h18M3 18h18"/></svg>
          </button>
        </NuxtLink>
      </div>
      <nav class="admin-sidebar-nav">
        <NuxtLink to="/admin" class="nav-item" :class="{ active: route.path === '/admin' }" @click="closeSidebar">
          <i class="ri-dashboard-line"></i><span>仪表盘</span>
        </NuxtLink>
        <NuxtLink to="/admin/users" class="nav-item" :class="{ active: route.path === '/admin/users' }" @click="closeSidebar">
          <i class="ri-user-line"></i><span>用户管理</span>
        </NuxtLink>
        <NuxtLink to="/admin/bookmarks" class="nav-item" :class="{ active: route.path === '/admin/bookmarks' }" @click="closeSidebar">
          <i class="ri-bookmark-line"></i><span>书签管理</span>
        </NuxtLink>
        <NuxtLink to="/admin/prompts" class="nav-item" :class="{ active: route.path === '/admin/prompts' }" @click="closeSidebar">
          <i class="ri-chat-quote-line"></i><span>提示词管理</span>
        </NuxtLink>
        <NuxtLink to="/admin/search-engines" class="nav-item" :class="{ active: route.path === '/admin/search-engines' }" @click="closeSidebar">
          <i class="ri-search-line"></i><span>搜索引擎</span>
        </NuxtLink>
        <NuxtLink to="/admin/backup" class="nav-item" :class="{ active: route.path === '/admin/backup' }" @click="closeSidebar">
          <i class="ri-database-2-line"></i><span>备份管理</span>
        </NuxtLink>
        <NuxtLink to="/admin/settings" class="nav-item" :class="{ active: route.path === '/admin/settings' }" @click="closeSidebar">
          <i class="ri-user-settings-line"></i><span>用户设置</span>
        </NuxtLink>
        <NuxtLink to="/admin/config" class="nav-item" :class="{ active: route.path === '/admin/config' }" @click="closeSidebar">
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
const sidebarOpen = ref(false)
function closeSidebar() { sidebarOpen.value = false }

// 复用旧框架 admin 样式 + 图标字体
useHead({
  titleTemplate: (title) => title ? `${title} - FavsHub Admin` : 'FavsHub 管理后台',
  link: [
    { rel: 'stylesheet', href: '/vendor/remixicon.css' },
    { rel: 'stylesheet', href: '/css/admin.css' },
  ],
})
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
  position: sticky;
  top: 0;
  height: 100vh;
}
.admin-sidebar-logo {
  padding: 24px 24px 24px;
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
.logo-text h1 { font-size: 20px; font-weight: 700; margin: 0; }
.logo-text span { font-size: 12px; color: rgba(255,255,255,0.5); }
.admin-sidebar-nav {
  flex: 1;
  padding: 16px 0;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 24px;
  color: rgba(255,255,255,0.7);
  text-decoration: none;
  font-size: 14px;
  transition: all 0.2s;
}
.nav-item:hover, .nav-item.active {
  color: #fff;
  background: rgba(255,255,255,0.1);
}
.nav-item i { font-size: 18px; width: 20px; text-align: center; }
.admin-sidebar-footer {
  padding: 16px 24px;
  border-top: 1px solid rgba(255,255,255,0.1);
}
.admin-sidebar-footer .nav-item {
  padding: 0;
  color: rgba(255,255,255,0.5);
  font-size: 13px;
}
.admin-sidebar-footer .nav-item:hover {
  color: #fff;
  background: none;
}
.admin-main {
  flex: 1;
  overflow-y: auto;
  height: 100vh;
  padding: 0;
}
.hamburger {
  display: none;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: none;
  background: none;
  cursor: pointer;
  color: rgba(255,255,255,0.8);
  border-radius: 8px;
  margin-left: auto;
}
.hamburger:active { background: rgba(255,255,255,0.1); }
.hamburger svg { width: 22px; height: 22px; }

/* ── Mobile responsive ── */
@media (max-width: 768px) {
  .admin-layout { flex-direction: column; height: auto; min-height: 100vh; overflow: visible; }
  .admin-sidebar { width: 100%; height: auto; position: sticky; top: 0; z-index: 100; }
  .admin-sidebar-logo { padding: 10px 16px; }
  .logo-text h1 { font-size: 18px; }
  .logo-text span { display: none; }
  .hamburger { display: flex; }
  .admin-sidebar-nav { display: none; padding: 8px 0; }
  .admin-sidebar.open .admin-sidebar-nav { display: block; }
  .nav-item { padding: 12px 16px; }
  .admin-sidebar-footer { display: none; }
  .admin-main { height: auto; overflow-y: visible; }
}
</style>
