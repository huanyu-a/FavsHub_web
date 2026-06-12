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
        <NuxtLink v-if="isAdmin" to="/admin/users" class="nav-item" :class="{ active: route.path === '/admin/users' }" @click="closeSidebar">
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
        <NuxtLink v-if="isAdmin" to="/admin/backup" class="nav-item" :class="{ active: route.path === '/admin/backup' }" @click="closeSidebar">
          <i class="ri-database-2-line"></i><span>备份管理</span>
        </NuxtLink>
        <NuxtLink to="/admin/settings" class="nav-item" :class="{ active: route.path === '/admin/settings' }" @click="closeSidebar">
          <i class="ri-user-settings-line"></i><span>用户设置</span>
        </NuxtLink>
        <NuxtLink v-if="isAdmin" to="/admin/config" class="nav-item" :class="{ active: route.path === '/admin/config' }" @click="closeSidebar">
          <i class="ri-settings-3-line"></i><span>系统配置</span>
        </NuxtLink>
      </nav>
      <div class="admin-sidebar-footer">
        <div class="user-info" @click="showProfile = true" title="点击修改个人信息">
          <div class="user-avatar">{{ (authStore.user?.username || 'U')[0].toUpperCase() }}</div>
          <div class="user-details">
            <span class="user-name">{{ authStore.user?.nickname || authStore.user?.username || '未知用户' }}</span>
            <span class="user-role">{{ isAdmin ? '管理员' : '普通用户' }}</span>
          </div>
        </div>
        <NuxtLink to="/" class="nav-item">
          <i class="ri-arrow-left-line"></i><span>返回前台</span>
        </NuxtLink>
      </div>
    </aside>
    <main class="admin-main">
      <slot />
    </main>

    <!-- 个人信息编辑弹窗 -->
    <Teleport to="body">
      <div v-if="showProfile" class="profile-overlay" @click.self="showProfile = false">
        <div class="profile-modal">
          <div class="profile-header">
            <h3>个人信息</h3>
            <button class="profile-close" @click="showProfile = false">&times;</button>
          </div>
          <div class="profile-body">
            <div v-if="profileMsg" :class="['profile-msg', profileMsgType]">{{ profileMsg }}</div>
            <div class="profile-field">
              <label>用户名</label>
              <input :value="authStore.user?.username" disabled class="profile-input disabled">
            </div>
            <div class="profile-field">
              <label>昵称</label>
              <input v-model="profileForm.nickname" class="profile-input" placeholder="设置昵称">
            </div>
            <div class="profile-field">
              <label>邮箱</label>
              <input v-model="profileForm.email" type="email" class="profile-input" placeholder="your@email.com">
            </div>
            <div class="profile-divider"><span>修改密码（可选）</span></div>
            <div class="profile-field">
              <label>旧密码</label>
              <input v-model="profileForm.old_password" type="password" class="profile-input" placeholder="输入旧密码">
            </div>
            <div class="profile-field">
              <label>新密码</label>
              <input v-model="profileForm.password" type="password" class="profile-input" placeholder="至少 6 位">
            </div>
            <div class="profile-actions">
              <button class="btn-cancel" @click="showProfile = false">取消</button>
              <button class="btn-save" :disabled="profileSaving" @click="saveProfile">{{ profileSaving ? '保存中...' : '保存' }}</button>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
const route = useRoute()
const authStore = useAuthStore()
const isAdmin = computed(() => authStore.isAdmin)
const sidebarOpen = ref(false)
function closeSidebar() { sidebarOpen.value = false }

// ── 个人信息编辑 ──────────────────────────────────────────────
const showProfile = ref(false)
const profileSaving = ref(false)
const profileMsg = ref('')
const profileMsgType = ref<'success' | 'error'>('success')
const profileForm = reactive({
  nickname: '',
  email: '',
  old_password: '',
  password: '',
})

// 打开弹窗时填充当前值
watch(showProfile, (val) => {
  if (val) {
    profileForm.nickname = authStore.user?.nickname || ''
    profileForm.email = authStore.user?.email || ''
    profileForm.old_password = ''
    profileForm.password = ''
    profileMsg.value = ''
  }
})

async function saveProfile() {
  profileSaving.value = true
  profileMsg.value = ''
  try {
    const body: any = {
      nickname: profileForm.nickname,
      email: profileForm.email || null,
    }
    // 仅在填写了新密码时才提交密码字段
    if (profileForm.password) {
      body.old_password = profileForm.old_password
      body.password = profileForm.password
    }
    const res = await $fetch<{ user: any }>('/api/auth/profile', { method: 'PUT', body })
    // 更新 store 中的用户信息
    if (res.user) {
      authStore.$patch({ user: res.user })
    }
    profileMsg.value = '保存成功'
    profileMsgType.value = 'success'
    profileForm.old_password = ''
    profileForm.password = ''
    setTimeout(() => { showProfile.value = false }, 800)
  } catch (err: any) {
    profileMsg.value = err?.data?.error || err?.message || '保存失败'
    profileMsgType.value = 'error'
  } finally {
    profileSaving.value = false
  }
}

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
.user-info {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  cursor: pointer;
  padding: 6px;
  border-radius: 8px;
  transition: background 0.2s;
}
.user-info:hover {
  background: rgba(255,255,255,0.08);
}
.user-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: linear-gradient(135deg, #667eea, #764ba2);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 600;
  color: #fff;
  flex-shrink: 0;
}
.user-details {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.user-name {
  font-size: 14px;
  font-weight: 500;
  color: rgba(255,255,255,0.9);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.user-role {
  font-size: 11px;
  color: rgba(255,255,255,0.4);
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

/* ── Profile Dialog ── */
.profile-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
}
.profile-modal {
  background: #fff;
  border-radius: 12px;
  width: 400px;
  max-width: 90vw;
  box-shadow: 0 20px 60px rgba(0,0,0,0.2);
  overflow: hidden;
}
.profile-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid #f0f0f0;
}
.profile-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #333;
}
.profile-close {
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
  color: #888;
  padding: 0 4px;
}
.profile-body {
  padding: 20px;
}
.profile-field {
  margin-bottom: 14px;
}
.profile-field label {
  display: block;
  font-size: 13px;
  color: #666;
  margin-bottom: 4px;
}
.profile-input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 14px;
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.2s;
}
.profile-input:focus {
  border-color: #667eea;
}
.profile-input.disabled {
  background: #f5f5f5;
  color: #999;
  cursor: not-allowed;
}
.profile-divider {
  text-align: center;
  margin: 16px 0 12px;
  position: relative;
}
.profile-divider::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  border-top: 1px solid #eee;
}
.profile-divider span {
  background: #fff;
  padding: 0 12px;
  font-size: 12px;
  color: #999;
  position: relative;
}
.profile-msg {
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 13px;
  margin-bottom: 12px;
  text-align: center;
}
.profile-msg.success {
  background: #d1fae5;
  color: #065f46;
}
.profile-msg.error {
  background: #fee2e2;
  color: #991b1b;
}
.profile-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
.btn-cancel {
  padding: 8px 16px;
  border: 1px solid #ddd;
  border-radius: 6px;
  background: #fff;
  color: #666;
  font-size: 14px;
  cursor: pointer;
}
.btn-save {
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: #fff;
  font-size: 14px;
  cursor: pointer;
}
.btn-save:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

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
