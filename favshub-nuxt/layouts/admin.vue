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

        <div class="nav-divider"></div>

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

        <div class="nav-divider"></div>

        <NuxtLink to="/admin/settings" class="nav-item" :class="{ active: route.path === '/admin/settings' }" @click="closeSidebar">
          <i class="ri-user-settings-line"></i><span>用户设置</span>
        </NuxtLink>

        <template v-if="isAdmin">
          <div class="nav-divider"></div>
          <div class="nav-group-label">管理</div>
          <NuxtLink to="/admin/users" class="nav-item" :class="{ active: route.path === '/admin/users' }" @click="closeSidebar">
            <i class="ri-user-line"></i><span>用户管理</span>
          </NuxtLink>
          <NuxtLink to="/admin/config" class="nav-item" :class="{ active: route.path === '/admin/config' }" @click="closeSidebar">
            <i class="ri-settings-3-line"></i><span>系统配置</span>
          </NuxtLink>
        </template>
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
// ── 主题切换逻辑（集中在 composables/useTheme.ts）──
const { initThemeWatchers } = useTheme()

if (import.meta.client) {
  initThemeWatchers()
}

useHead({
  titleTemplate: (title) => title ? `${title} - FavsHub Admin` : 'FavsHub 管理后台',
  link: [
    { rel: 'stylesheet', href: '/css/tokens.css?v=20260703d' },
    { rel: 'stylesheet', href: '/css/themes.css?v=20260703c' },
    { rel: 'stylesheet', href: '/css/main-bundle.css?v=20260703d' },
    { rel: 'stylesheet', href: '/vendor/remixicon.css' },
    { rel: 'stylesheet', href: '/css/admin.css?v=20260703' },
  ],
})
</script>
