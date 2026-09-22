<template>
  <ClientOnly>
    <div class="sidebar-bottom">
      <div class="sidebar-user-panel" ref="userMenuRef">
        <div class="sidebar-user-bar" @click="showUserMenu = !showUserMenu">
          <div class="sidebar-user-avatar" :class="{ 'has-img': userAvatar && !avatarBroken }">
            <img
              v-if="userAvatar && !avatarBroken"
              :src="userAvatar"
              :alt="displayName"
              @error="avatarBroken = true"
            >
            <template v-else>{{ userInitial }}</template>
          </div>
          <span class="sidebar-user-name">{{ displayName }}</span>
        </div>

        <Transition name="user-menu">
          <div v-if="showUserMenu" class="sidebar-user-menu">
            <div class="user-menu-header">
              <div class="user-menu-avatar" :class="{ 'has-img': userAvatar && !avatarBroken }">
                <img
                  v-if="userAvatar && !avatarBroken"
                  :src="userAvatar"
                  :alt="displayName"
                  @error="avatarBroken = true"
                >
                <template v-else>{{ userInitial }}</template>
              </div>
              <div class="user-menu-info">
                <span class="user-menu-name">{{ displayName }}</span>
                <span v-if="authStore.isAdmin" class="user-menu-role admin">管理员</span>
                <span v-else-if="authStore.isLoggedIn" class="user-menu-role">普通用户</span>
                <span v-else class="user-menu-role guest">游客</span>
              </div>
            </div>

            <div class="user-menu-divider"></div>

            <div class="user-menu-items">
              <div v-if="authStore.isLoggedIn" class="user-menu-item" @click="openProfile">
                <i class="ri-user-settings-line"></i>
                <span>个人资料</span>
              </div>
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

      <!-- 个人资料：填 QQ 号以使用 QQ 头像 -->
      <Teleport to="body">
        <div v-if="profileOpen" class="up-backdrop" @click.self="closeProfile">
          <div class="up-modal" role="dialog" aria-modal="true" aria-label="个人资料">
            <header class="up-head">
              <h3>个人资料</h3>
              <button type="button" class="up-close" title="关闭" @click="closeProfile">
                <i class="ri-close-line"></i>
              </button>
            </header>

            <div class="up-body">
              <div class="up-avatar-row">
                <div class="up-avatar" :class="{ 'has-img': previewAvatar && !previewBroken }">
                  <img
                    v-if="previewAvatar && !previewBroken"
                    :src="previewAvatar"
                    alt="头像预览"
                    @error="previewBroken = true"
                  >
                  <template v-else>{{ userInitial }}</template>
                </div>
                <div class="up-avatar-copy">
                  <span class="up-avatar-title">头像</span>
                  <span class="up-avatar-sub">填入 QQ 号即使用该 QQ 的头像</span>
                </div>
              </div>

              <label class="up-field">
                <span class="up-label">昵称</span>
                <input v-model="profileNickname" type="text" class="up-input" :maxlength="64" placeholder="展示用的名字">
              </label>

              <label class="up-field">
                <span class="up-label">QQ 号（可选）</span>
                <input
                  v-model="profileQQ"
                  type="text"
                  class="up-input"
                  inputmode="numeric"
                  :maxlength="11"
                  placeholder="5-11 位数字；留空则用首字母头像"
                >
              </label>
              <p class="up-privacy">
                <i class="ri-shield-check-line"></i>
                加密存储，仅用于服务端获取头像；不会公开显示，页面源码中也看不到。
              </p>
            </div>

            <footer class="up-foot">
              <button type="button" class="up-btn ghost" @click="closeProfile">取消</button>
              <button type="button" class="up-btn primary" :disabled="profileSaving" @click="saveProfile">
                {{ profileSaving ? '保存中...' : '保存' }}
              </button>
            </footer>
          </div>
        </div>
      </Teleport>

      <Transition name="up-toast">
        <div v-if="message" class="up-toast" :class="messageType">{{ message }}</div>
      </Transition>
    </div>
    <template #fallback>
      <div class="sidebar-bottom">
        <div class="sidebar-user-panel">
          <div class="sidebar-user-bar">
            <div class="sidebar-user-avatar">U</div>
            <span class="sidebar-user-name">用户</span>
          </div>
        </div>
      </div>
    </template>
  </ClientOnly>
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

/** 轻量提示（项目约定：各组件自持，无全局 toast） */
const message = ref('')
const messageType = ref<'ok' | 'err'>('ok')
let messageTimer: ReturnType<typeof setTimeout> | null = null
function toast(text: string, type: 'ok' | 'err' = 'ok') {
  message.value = text
  messageType.value = type
  if (messageTimer) clearTimeout(messageTimer)
  messageTimer = setTimeout(() => { message.value = '' }, 2600)
}

/** 头像：来源为 authStore.user.avatar（服务端返回 /avatar/<加密令牌>.jpg）；加载失败回退首字母 */
const avatarBroken = ref(false)
const userAvatar = computed(() => authStore.user?.avatar || null)

/** 个人资料弹窗 */
const profileOpen = ref(false)
const profileNickname = ref('')
const profileQQ = ref('')
const profileSaving = ref(false)
const previewBroken = ref(false)

/** 预览头像：本地拼 QQ 头像直链仅用于即时预览；保存后走服务端代理（QQ 号不外露） */
const previewAvatar = computed(() => {
  const qq = profileQQ.value.trim()
  if (!/^[1-9]\d{4,10}$/.test(qq) || previewBroken.value) return null
  return `https://q2.qlogo.cn/headimg_dl?dst_uin=${qq}&spec=100`
})

const userInitial = computed(() => {
  const name = authStore.user?.nickname || authStore.user?.username || 'U'
  return name[0].toUpperCase()
})

const displayName = computed(() => {
  if (authStore.isGuest) return '未登录'
  return authStore.user?.nickname || authStore.user?.username || '用户'
})

function openProfile() {
  showUserMenu.value = false
  profileNickname.value = authStore.user?.nickname || ''
  profileQQ.value = ''
  previewBroken.value = false
  profileOpen.value = true
}

function closeProfile() {
  profileOpen.value = false
}

/**
 * 保存资料。
 *
 * `qq` 只在用户实际改动时才提交 —— 后端返回的 user 里只有加密后的 avatar URL，
 * 不含明文 QQ 号（这是刻意的隐私设计），所以无法回填输入框。
 * 留空即视为「不修改」；清除头像需清空并保存，与新建区分开需显式提交空串。
 */
async function saveProfile() {
  if (profileSaving.value) return
  const nickname = profileNickname.value.trim()
  if (!nickname) return toast('昵称不能为空', 'err')
  const qq = profileQQ.value.trim()
  if (qq && !/^[1-9]\d{4,10}$/.test(qq)) {
    return toast('QQ 号格式不正确（5-11 位数字）', 'err')
  }

  profileSaving.value = true
  try {
    const body: Record<string, any> = { nickname }
    // 仅在用户填了内容时提交 qq，避免误清空已有头像
    if (qq) body.qq = qq

    const res = await $fetch<{ user: any }>('/api/auth/profile', {
      method: 'PUT',
      body,
      credentials: 'include',
    })
    if (authStore.user) {
      authStore.user.nickname = res.user.nickname
      authStore.user.avatar = res.user.avatar
    }
    avatarBroken.value = false
    profileOpen.value = false
    toast('资料已保存')
  } catch (err: any) {
    toast(err?.data?.error || '保存失败', 'err')
  } finally {
    profileSaving.value = false
  }
}

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
  onBeforeUnmount(() => document.removeEventListener('click', handleClickOutside))
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
  background: var(--primary);
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
  background: var(--primary);
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

/* 头像：有图走 <img>，无图/加载失败回退首字母色块 */
.sidebar-user-avatar.has-img,
.user-menu-avatar.has-img {
  background: transparent;
  overflow: hidden;
}
.sidebar-user-avatar img,
.user-menu-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  border-radius: 50%;
}

/* ── 个人资料弹窗 ── */
.up-backdrop {
  position: fixed;
  inset: 0;
  z-index: 10060;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.up-modal {
  width: min(420px, 100%);
  background: var(--surface-raised);
  border: 1px solid var(--border);
  border-radius: 14px;
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}
.up-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
}
.up-head h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}
.up-close {
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  font-size: 18px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 6px;
}
.up-close:hover { color: var(--text-primary); background: var(--surface-hover); }
.up-body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.up-avatar-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.up-avatar {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--primary);
  color: var(--text-inverse);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: 600;
  overflow: hidden;
}
.up-avatar.has-img { background: transparent; }
.up-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
.up-avatar-copy { display: flex; flex-direction: column; gap: 2px; }
.up-avatar-title { font-size: 13px; font-weight: 500; color: var(--text-primary); }
.up-avatar-sub { font-size: 11.5px; color: var(--text-tertiary); }
.up-field { display: flex; flex-direction: column; gap: 5px; }
.up-label { font-size: 12px; color: var(--text-secondary); }
.up-input {
  width: 100%;
  padding: 8px 11px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--surface-sunken);
  color: var(--text-primary);
  font-size: 13px;
  font-family: inherit;
}
.up-input:focus { outline: none; border-color: var(--border-focus); }
.up-privacy {
  margin: 0;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--text-tertiary);
  display: flex;
  align-items: flex-start;
  gap: 5px;
}
.up-privacy i { margin-top: 1px; }
.up-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
}
.up-btn {
  padding: 7px 16px;
  border-radius: 8px;
  font-size: 12.5px;
  cursor: pointer;
  border: 1px solid var(--border);
  font-family: inherit;
}
.up-btn.ghost { background: transparent; color: var(--text-secondary); }
.up-btn.ghost:hover { background: var(--surface-hover); }
.up-btn.primary {
  background: var(--primary);
  color: var(--text-inverse);
  border-color: var(--primary);
}
.up-btn.primary:disabled { opacity: 0.6; cursor: not-allowed; }
.up-toast {
  position: fixed;
  left: 50%;
  bottom: 90px;
  transform: translateX(-50%);
  z-index: 10080;
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 12.5px;
  background: var(--surface-raised);
  color: var(--text-primary);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-lg);
}
.up-toast.err { color: var(--danger); border-color: var(--danger); }
.up-toast-enter-active,
.up-toast-leave-active { transition: opacity 0.2s; }
.up-toast-enter-from,
.up-toast-leave-to { opacity: 0; }
</style>
