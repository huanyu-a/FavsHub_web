<template>
  <div class="sidebar-bottom">
    <div class="sidebar-user-panel" ref="userMenuRef">
      <div class="sidebar-user-bar" @click="showUserMenu = !showUserMenu">
        <div class="sidebar-user-avatar">{{ userInitial }}</div>
        <span class="sidebar-user-name">{{ displayName }}</span>
      </div>

      <Transition name="user-menu">
        <div v-if="showUserMenu" class="sidebar-user-menu">
          <div class="user-menu-header">
            <div class="user-menu-avatar">{{ userInitial }}</div>
            <div class="user-menu-info">
              <span class="user-menu-name">{{ displayName }}</span>
              <span v-if="authStore.isAdmin" class="user-menu-role admin">管理员</span>
              <span v-else-if="authStore.isLoggedIn" class="user-menu-role">普通用户</span>
              <span v-else class="user-menu-role guest">游客</span>
            </div>
          </div>

          <div class="user-menu-divider"></div>

          <div class="user-menu-items">
            <NuxtLink to="/admin/settings" class="user-menu-item" @click="showUserMenu = false">
              <i class="ri-settings-3-line"></i>
              <span>设置</span>
            </NuxtLink>
            <NuxtLink v-if="authStore.isAdmin" to="/admin" target="_blank" class="user-menu-item" @click="showUserMenu = false">
              <i class="ri-dashboard-line"></i>
              <span>管理后台</span>
            </NuxtLink>
            <div class="user-menu-item" @click="cycleTheme">
              <i :class="themeIcon"></i>
              <span>外观</span>
              <span class="user-menu-toggle">{{ themeLabel }}</span>
            </div>
          </div>

          <div class="user-menu-divider"></div>

          <div class="user-menu-items">
            <div v-if="authStore.isGuest" class="user-menu-item" @click="showLogin = true; showUserMenu = false">
              <i class="ri-login-box-line"></i>
              <span>登录</span>
            </div>
            <a v-else href="#" class="user-menu-item danger" @click.prevent="handleLogout">
              <i class="ri-logout-box-r-line"></i>
              <span>退出登录</span>
            </a>
          </div>
        </div>
      </Transition>
    </div>

    <Teleport to="body">
      <LoginDialog v-if="showLogin" @close="showLogin = false" />
    </Teleport>
  </div>
</template>

<script setup lang="ts">
const authStore = useAuthStore()
const uiStore = useUIStore()
const router = useRouter()
const { cycleTheme, themeLabel } = useTheme()

const showLogin = ref(false)

const themeIcon = computed(() => {
  const icons: Record<string, string> = { light: 'ri-sun-line', dark: 'ri-moon-line', auto: 'ri-mac-line' }
  return icons[uiStore.theme] || 'ri-sun-line'
})

const showUserMenu = ref(false)
const userMenuRef = ref<HTMLElement | null>(null)

const userInitial = computed(() => {
  const name = authStore.user?.nickname || authStore.user?.username || 'U'
  return name[0].toUpperCase()
})

const displayName = computed(() => {
  if (authStore.isGuest) return '未登录'
  return authStore.user?.nickname || authStore.user?.username || '用户'
})

function handleLogout() {
  authStore.logout()
  router.push('/login')
}

if (import.meta.client) {
  const handleClickOutside = (e: MouseEvent) => {
    if (userMenuRef.value && !userMenuRef.value.contains(e.target as Node)) {
      showUserMenu.value = false
    }
  }
  document.addEventListener('click', handleClickOutside)
}
</script>

<style scoped>
.sidebar-user-panel {
  position: relative;
}
.sidebar-user-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
  user-select: none;
}
.sidebar-user-bar:hover {
  background: var(--surface-hover);
}
.sidebar-user-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--accent-blue) 0%, var(--accent-purple) 100%);
  color: var(--text-inverse);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  flex-shrink: 0;
}
.sidebar-user-name {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sidebar-user-menu {
  position: absolute;
  bottom: 100%;
  left: 0;
  right: 0;
  margin-bottom: 6px;
  background: var(--surface-raised);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: var(--shadow-lg);
  padding: 8px 0;
  z-index: 1000;
}
.user-menu-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
}
.user-menu-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--accent-blue) 0%, var(--accent-purple) 100%);
  color: var(--text-inverse);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 600;
  flex-shrink: 0;
}
.user-menu-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.user-menu-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}
.user-menu-role {
  font-size: 11px;
  color: var(--text-secondary);
}
.user-menu-role.admin {
  color: var(--primary);
}
.user-menu-role.guest {
  color: var(--text-tertiary);
}
.user-menu-divider {
  height: 1px;
  background: var(--border);
  margin: 4px 0;
}
.user-menu-items {
  padding: 2px 0;
}
.user-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  font-size: 13px;
  color: var(--text-primary);
  cursor: pointer;
  transition: background 0.12s;
  text-decoration: none;
}
.user-menu-item:hover {
  background: var(--surface-hover);
}
.user-menu-item i {
  font-size: 16px;
  color: var(--text-secondary);
  width: 20px;
  text-align: center;
}
.user-menu-item.danger {
  color: var(--danger);
}
.user-menu-item.danger i {
  color: var(--danger);
}
.user-menu-toggle {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--surface-sunken);
  padding: 2px 8px;
  border-radius: 4px;
}
.user-menu-enter-active,
.user-menu-leave-active {
  transition: opacity 0.15s, transform 0.15s;
}
.user-menu-enter-from,
.user-menu-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
</style>
