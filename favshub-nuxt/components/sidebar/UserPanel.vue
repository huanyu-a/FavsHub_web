<template>
  <ClientOnly>
    <div class="sidebar-bottom">
      <div class="sidebar-user-panel" ref="userMenuRef">
        <div
          class="sidebar-user-bar"
          role="button"
          tabindex="0"
          aria-haspopup="true"
          :aria-expanded="showUserMenu"
          @click="showUserMenu = !showUserMenu"
          @keydown.enter="showUserMenu = !showUserMenu"
          @keydown.space.prevent="showUserMenu = !showUserMenu"
        >
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
              <div
                v-if="authStore.isLoggedIn"
                class="user-menu-item"
                role="button"
                tabindex="0"
                @click="openProfile"
                @keydown.enter="openProfile"
                @keydown.space.prevent="openProfile"
              >
                <i class="ri-user-settings-line"></i>
                <span>个人资料</span>
              </div>
              <div
                v-if="authStore.isLoggedIn"
                class="user-menu-item"
                role="button"
                tabindex="0"
                @click="openQqBind"
                @keydown.enter="openQqBind"
                @keydown.space.prevent="openQqBind"
              >
                <i class="ri-robot-2-line"></i>
                <span>QQ 绑定</span>
              </div>
              <NuxtLink to="/admin/settings" class="user-menu-item" @click="showUserMenu = false">
                <i class="ri-settings-3-line"></i>
                <span>设置</span>
              </NuxtLink>
              <NuxtLink v-if="authStore.isAdmin" to="/admin" target="_blank" class="user-menu-item" @click="showUserMenu = false">
                <i class="ri-dashboard-line"></i>
                <span>管理后台</span>
              </NuxtLink>
              <div
                class="user-menu-item"
                role="button"
                tabindex="0"
                @click="cycleTheme"
                @keydown.enter="cycleTheme"
                @keydown.space.prevent="cycleTheme"
              >
                <i :class="themeIcon"></i>
                <span>外观</span>
                <span class="user-menu-toggle">{{ themeLabel }}</span>
              </div>
            </div>

            <div class="user-menu-divider"></div>

            <div class="user-menu-items">
              <div
                v-if="authStore.isGuest"
                class="user-menu-item"
                role="button"
                tabindex="0"
                @click="showLogin = true; showUserMenu = false"
                @keydown.enter="showLogin = true; showUserMenu = false"
                @keydown.space.prevent="showLogin = true; showUserMenu = false"
              >
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

      <!-- QQ 绑定：生成绑定码 / 查看绑定状态 / 解绑 -->
      <Teleport to="body">
        <div v-if="qqBindOpen" class="up-backdrop" @click.self="closeQqBind">
          <div class="up-modal" role="dialog" aria-modal="true" aria-label="QQ 绑定">
            <header class="up-head">
              <h3>QQ 绑定</h3>
              <button type="button" class="up-close" title="关闭" @click="closeQqBind">
                <i class="ri-close-line"></i>
              </button>
            </header>

            <div class="up-body">
              <p v-if="qqBindLoading" class="up-bind-hint">加载中...</p>

              <!-- 已绑定：显示 QQ 号 + 解绑 -->
              <template v-else-if="qqBoundQQ">
                <p class="up-bind-hint">
                  当前已绑定 QQ：<strong class="up-bind-qq">{{ qqBoundQQ }}</strong>
                </p>
                <p class="up-privacy">
                  <i class="ri-robot-2-line"></i>
                  绑定后可在 QQ 私聊机器人使用个人指令（我的投稿、解绑等）。
                </p>
              </template>

              <!-- 未绑定 -->
              <template v-else>
                <template v-if="qqBindCode">
                  <div class="up-bind-code-box">
                    <span class="up-bind-code">{{ qqBindCode }}</span>
                    <span class="up-bind-countdown">{{ qqCountdownText }}</span>
                  </div>
                  <p class="up-privacy">
                    <i class="ri-time-line"></i>
                    10 分钟内在 QQ 私聊机器人发送：绑定 {{ qqBindCode }}
                  </p>
                </template>
                <p v-else class="up-bind-hint">未绑定 QQ。生成绑定码后，在 QQ 私聊机器人发送「绑定 码」即可完成绑定。</p>
              </template>
            </div>

            <footer class="up-foot">
              <button v-if="!qqBoundQQ && qqBindCode" type="button" class="up-btn ghost" @click="generateBindCode">重新生成</button>
              <button v-if="!qqBoundQQ && !qqBindCode" type="button" class="up-btn primary" :disabled="qqBindLoading" @click="generateBindCode">
                生成绑定码
              </button>
              <button v-if="qqBoundQQ" type="button" class="up-btn danger" :disabled="qqBindLoading" @click="unbindQQ">
                解绑
              </button>
              <button type="button" class="up-btn ghost" @click="closeQqBind">关闭</button>
            </footer>
          </div>
        </div>
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

// ── QQ 绑定 ──────────────────────────────
const qqBindOpen = ref(false)
const qqBindLoading = ref(false)
const qqBoundQQ = ref<string | null>(null)
const qqBindCode = ref('')
const qqBindExpiresAt = ref(0)
let qqCountdownTimer: ReturnType<typeof setInterval> | null = null
const qqCountdownText = ref('')

/** 打开弹窗：顺带拉取当前绑定状态（POST 幂等复用未过期码，无副作用负担） */
async function openQqBind() {
  showUserMenu.value = false
  qqBindOpen.value = true
  qqBindCode.value = ''
  qqBoundQQ.value = null
  await fetchBindStatus()
}

function closeQqBind() {
  qqBindOpen.value = false
  stopCountdown()
}

async function fetchBindStatus() {
  qqBindLoading.value = true
  try {
    const res = await $fetch<{ code: string; expiresAt: number; bound: string | null }>('/api/qq/bind-code', {
      method: 'POST',
      credentials: 'include',
    })
    qqBoundQQ.value = res.bound
  } catch (err: any) {
    toast(err?.data?.error || '获取绑定状态失败', 'err')
    qqBindOpen.value = false
  } finally {
    qqBindLoading.value = false
  }
}

/** 生成（或复用未过期的）绑定码并开始倒计时 */
async function generateBindCode() {
  if (qqBindLoading.value) return
  qqBindLoading.value = true
  try {
    const res = await $fetch<{ code: string; expiresAt: number; bound: string | null }>('/api/qq/bind-code', {
      method: 'POST',
      credentials: 'include',
    })
    if (res.bound) {
      qqBoundQQ.value = res.bound
      qqBindCode.value = ''
      stopCountdown()
      return
    }
    qqBindCode.value = res.code
    qqBindExpiresAt.value = res.expiresAt
    startCountdown()
  } catch (err: any) {
    toast(err?.data?.error || '生成绑定码失败', 'err')
  } finally {
    qqBindLoading.value = false
  }
}

function startCountdown() {
  stopCountdown()
  updateCountdown()
  qqCountdownTimer = setInterval(updateCountdown, 1000)
}

function updateCountdown() {
  const remain = Math.max(0, qqBindExpiresAt.value - Date.now())
  if (remain <= 0) {
    // 码过期：回到「生成绑定码」初始态
    qqBindCode.value = ''
    stopCountdown()
    return
  }
  const totalSec = Math.ceil(remain / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  qqCountdownText.value = `${m}:${String(s).padStart(2, '0')}`
}

function stopCountdown() {
  if (qqCountdownTimer) {
    clearInterval(qqCountdownTimer)
    qqCountdownTimer = null
  }
}

async function unbindQQ() {
  if (qqBindLoading.value) return
  qqBindLoading.value = true
  try {
    await $fetch('/api/qq/bind-code', { method: 'DELETE', credentials: 'include' })
    qqBoundQQ.value = null
    qqBindCode.value = ''
    stopCountdown()
    toast('已解绑 QQ')
  } catch (err: any) {
    toast(err?.data?.error || '解绑失败', 'err')
  } finally {
    qqBindLoading.value = false
  }
}

onBeforeUnmount(stopCountdown)

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
  border-radius: 6px;
  cursor: pointer;
  transition: background 120ms cubic-bezier(0.22, 1, 0.36, 1);
  user-select: none;
}
.sidebar-user-bar:hover {
  background: var(--surface-hover);
}
.sidebar-user-bar:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
.sidebar-user-bar:active {
  background: var(--surface-active);
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
  border-radius: 14px;
  box-shadow: var(--shadow-lg);
  padding: 8px 0;
  z-index: 1000;
}
.user-menu-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
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
  padding: 8px 16px;
  font-size: 13px;
  color: var(--text-primary);
  cursor: pointer;
  transition: background 120ms cubic-bezier(0.22, 1, 0.36, 1);
  text-decoration: none;
}
.user-menu-item:hover {
  background: var(--surface-hover);
}
.user-menu-item:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: -2px;
}
.user-menu-item:active {
  background: var(--surface-active);
  transform: scale(0.98);
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
  border-radius: 6px;
}
.user-menu-enter-active,
.user-menu-leave-active {
  transition: opacity 180ms cubic-bezier(0.22, 1, 0.36, 1), transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
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
  background: var(--overlay);
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
  padding: 12px 16px;
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
  transition: background 120ms cubic-bezier(0.22, 1, 0.36, 1), color 120ms cubic-bezier(0.22, 1, 0.36, 1);
}
.up-close:hover { color: var(--text-primary); background: var(--surface-hover); }
.up-close:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
.up-close:active { background: var(--surface-active); }
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
.up-avatar-sub { font-size: 12px; color: var(--text-tertiary); }
.up-field { display: flex; flex-direction: column; gap: 4px; }
.up-label { font-size: 12px; color: var(--text-secondary); }
.up-input {
  width: 100%;
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--surface-sunken);
  color: var(--text-primary);
  font-size: 13px;
  font-family: inherit;
  transition: border-color 120ms cubic-bezier(0.22, 1, 0.36, 1);
}
.up-input:focus { outline: none; border-color: var(--border-focus); }
.up-input:focus-visible { outline: 2px solid var(--primary); outline-offset: 1px; }
.up-privacy {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-tertiary);
  display: flex;
  align-items: flex-start;
  gap: 4px;
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
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  border: 1px solid var(--border);
  font-family: inherit;
  transition: background 120ms cubic-bezier(0.22, 1, 0.36, 1), transform 120ms cubic-bezier(0.22, 1, 0.36, 1);
}
.up-btn:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
.up-btn:active:not(:disabled) { transform: scale(0.98); }
.up-btn.ghost { background: transparent; color: var(--text-secondary); }
.up-btn.ghost:hover { background: var(--surface-hover); }
.up-btn.primary {
  background: var(--primary);
  color: var(--text-inverse);
  border-color: var(--primary);
}
.up-btn.primary:hover:not(:disabled) { background: var(--primary-hover); }
.up-btn.primary:disabled { opacity: 0.6; cursor: not-allowed; }
.up-btn.danger {
  background: transparent;
  color: var(--danger);
  border-color: var(--danger);
}
.up-btn.danger:hover:not(:disabled) { background: var(--danger); color: var(--text-inverse); }
.up-btn.danger:disabled { opacity: 0.6; cursor: not-allowed; }

/* ── QQ 绑定弹窗 ── */
.up-bind-hint {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-primary);
}
.up-bind-qq {
  font-weight: 600;
}
.up-bind-code-box {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border: 1px dashed var(--border);
  border-radius: 8px;
  background: var(--surface-sunken);
}
.up-bind-code {
  font-size: 26px;
  font-weight: 700;
  letter-spacing: 6px;
  color: var(--primary);
  font-variant-numeric: tabular-nums;
}
.up-bind-countdown {
  font-size: 12px;
  color: var(--text-tertiary);
  font-variant-numeric: tabular-nums;
}
.up-toast {
  position: fixed;
  left: 50%;
  bottom: 90px;
  transform: translateX(-50%);
  z-index: 10080;
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 13px;
  background: var(--surface-raised);
  color: var(--text-primary);
  border: 1px solid var(--border);
  box-shadow: var(--shadow-lg);
}
.up-toast.err { color: var(--danger); border-color: var(--danger); }
.up-toast-enter-active,
.up-toast-leave-active { transition: opacity 180ms cubic-bezier(0.22, 1, 0.36, 1); }
.up-toast-enter-from,
.up-toast-leave-to { opacity: 0; }
</style>
