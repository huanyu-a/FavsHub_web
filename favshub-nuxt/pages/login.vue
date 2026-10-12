<template>
  <div class="login-page">
    <div class="login-container">
      <div class="login-logo">
        <img src="/images/logo.svg" alt="FavsHub">
        <h1>FavsHub</h1>
        <p>你的智能书签工作台</p>
      </div>
      <div class="tab-nav">
        <button :class="{ active: tab === 'login' }" @click="switchTab('login')">登录</button>
        <button v-if="registrationAllowed" :class="{ active: tab === 'register' }" @click="switchTab('register')">注册</button>
      </div>
      <div v-if="errorMsg" class="error-msg" role="alert">{{ errorMsg }}</div>

      <div v-show="tab === 'login'">
        <form @submit.prevent="handleLogin">
          <div class="form-group">
            <label>用户名</label>
            <input v-model="loginForm.username" type="text" required autocomplete="username" placeholder="请输入用户名">
          </div>
          <div class="form-group">
            <label>密码</label>
            <input v-model="loginForm.password" type="password" required autocomplete="current-password" placeholder="请输入密码">
          </div>
          <button type="submit" class="submit-btn" :disabled="loading">
            {{ loading ? '登录中...' : '登录' }}
          </button>
        </form>
      </div>

      <div v-show="tab === 'register'">
        <form @submit.prevent="handleRegister">
          <div class="form-group">
            <label>用户名</label>
            <input v-model="regForm.username" type="text" required autocomplete="username" placeholder="2-32 个字符">
          </div>
          <div class="form-group">
            <label>邮箱（可选）</label>
            <input v-model="regForm.email" type="email" autocomplete="email" placeholder="your@email.com">
          </div>
          <div class="form-group">
            <label>密码</label>
            <input v-model="regForm.password" type="password" required autocomplete="new-password" minlength="8" placeholder="至少 8 位">
          </div>
          <div class="form-group">
            <label>人机验证</label>
            <TurnstileBox
              v-if="challengeProvider === 'turnstile'"
              ref="turnstileRef"
              :site-key="challengeSiteKey"
              @success="onTurnstileSuccess"
              @expired="onTurnstileExpired"
              @fail="onTurnstileFail"
            />
            <!-- 分支互斥：挂件态 / 挂件出错 / 配置获取失败 / 通道关闭 / 加载中，不会同时出现两条提示 -->
            <p v-if="challengeFailed" class="challenge-note">
              {{ challengeFailed }}
              <button type="button" class="challenge-retry" @click="retryChallenge">重新加载验证</button>
            </p>
            <template v-else-if="challengeProvider !== 'turnstile'">
              <p v-if="challengeRetryable" class="challenge-note">
                {{ challengeMessage }}
                <button type="button" class="challenge-retry" @click="loadChallenge">重试加载</button>
              </p>
              <p v-else-if="challengeProvider === 'disabled'" class="challenge-note">{{ challengeMessage }}</p>
              <p v-else class="challenge-note">正在加载人机验证…</p>
            </template>
          </div>
          <button type="submit" class="submit-btn" :disabled="loading || registerBlocked">
            {{ loading ? '注册中...' : '注册' }}
          </button>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: false })

useHead({
  title: '登录_FavsHub',
  meta: [
    { name: 'description', content: '登录 FavsHub 智能书签工作台，管理你的书签、精选集和AI提示词。' },
    { name: 'robots', content: 'noindex, nofollow' },
  ],
  link: [
    { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
    { rel: 'stylesheet', href: '/css/tokens.css?v=20260928' },
    { rel: 'stylesheet', href: '/css/themes.css?v=20260828' },
    { rel: 'stylesheet', href: '/css/main-bundle.css?v=20260929b' },
  ],
})

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const tab = ref<'login' | 'register'>('login')
const loading = ref(false)
const errorMsg = ref('')
const registrationAllowed = ref(true)

const { data: regConfig } = await useFetch<{ allowed: boolean }>('/api/config/registration')
if (regConfig.value) {
  registrationAllowed.value = regConfig.value.allowed
  if (!registrationAllowed.value && tab.value === 'register') {
    tab.value = 'login'
  }
}

const loginForm = reactive({ username: '', password: '' })
const regForm = reactive({ username: '', email: '', password: '' })

// ── 注册人机校验（与游客通道同一套 Cloudflare Turnstile；fail-closed）──
// 只在切到注册 tab 时才加载挂件脚本，避免登录页每次都去请求 challenges.cloudflare.com
const challengeProvider = ref<'loading' | 'turnstile' | 'disabled'>('loading')
const challengeSiteKey = ref('')
const challengeMessage = ref('')
const challengeFailed = ref('')
const turnstileToken = ref('')
const turnstileRef = ref<{ reset: () => void; retry: () => void } | null>(null)
/** 仅「挑战配置获取失败」为真：此时给一个「重试加载」按钮（通道未启用时无从重试） */
const challengeRetryable = ref(false)
/** 未拿到令牌 / 挂件出错 / 通道关闭 → 一律挡住提交（服务端同样 fail-closed） */
const registerBlocked = computed(() =>
  challengeProvider.value !== 'turnstile' || !!challengeFailed.value || !turnstileToken.value,
)

async function loadChallenge() {
  challengeProvider.value = 'loading'
  challengeFailed.value = ''
  challengeRetryable.value = false
  turnstileToken.value = ''
  try {
    const res = await $fetch<{ provider: string; site_key?: string; message?: string }>('/api/auth/register-challenge')
    if (res?.provider === 'turnstile' && res.site_key) {
      challengeSiteKey.value = res.site_key
      challengeProvider.value = 'turnstile'
    } else {
      challengeMessage.value = res?.message || '人机校验未启用，暂时无法注册'
      challengeProvider.value = 'disabled'
    }
  } catch (err: any) {
    challengeMessage.value = err?.data?.error || '人机校验加载失败，请刷新页面重试'
    challengeProvider.value = 'disabled'
    challengeRetryable.value = true
  }
}

function onTurnstileSuccess(token: string) {
  turnstileToken.value = token
  challengeFailed.value = ''
}
function onTurnstileExpired() {
  turnstileToken.value = ''
}
function onTurnstileFail(reason: string) {
  turnstileToken.value = ''
  challengeFailed.value = reason
}
function retryChallenge() {
  challengeFailed.value = ''
  turnstileRef.value?.retry()
}

// 切到注册 tab 且还没加载过 → 拉一次校验方式
watch(tab, (t) => {
  if (t === 'register' && challengeProvider.value === 'loading') loadChallenge()
})

// 已登录则跳转
onMounted(() => {
  if (authStore.isLoggedIn) {
    const redirect = route.query.redirect as string
    const safeRedirect = (redirect && redirect.startsWith('/') && !redirect.startsWith('//')) ? redirect : '/'
    router.replace(safeRedirect)
  }
  // URL 参数自动切换 tab
  if (route.query.tab === 'register') {
    tab.value = 'register'
    loadChallenge()
  }
})

function switchTab(t: 'login' | 'register') {
  tab.value = t
  errorMsg.value = ''
}

async function handleLogin() {
  loading.value = true
  errorMsg.value = ''
  try {
    await authStore.login(loginForm.username, loginForm.password)
    const redirect = route.query.redirect as string
    const safeRedirect = (redirect && redirect.startsWith('/') && !redirect.startsWith('//')) ? redirect : '/'
    await router.replace(safeRedirect)
  } catch (err: any) {
    errorMsg.value = err?.data?.error || err?.message || '登录失败'
  } finally {
    loading.value = false
  }
}

async function handleRegister() {
  if (registerBlocked.value) {
    errorMsg.value = challengeProvider.value === 'disabled'
      ? (challengeMessage.value || '人机校验未启用，暂时无法注册')
      : (challengeFailed.value || '请先完成人机验证')
    return
  }
  loading.value = true
  errorMsg.value = ''
  try {
    await authStore.register(regForm.username, regForm.password, regForm.email || undefined, undefined, turnstileToken.value)
    const redirect = route.query.redirect as string
    const safeRedirect = (redirect && redirect.startsWith('/') && !redirect.startsWith('//')) ? redirect : '/'
    await router.replace(safeRedirect)
  } catch (err: any) {
    errorMsg.value = err?.data?.error || err?.message || '注册失败'
  } finally {
    loading.value = false
    // 令牌一次性：无论成败都作废换新，否则再次提交必然报 timeout-or-duplicate
    turnstileToken.value = ''
    turnstileRef.value?.reset()
  }
}
</script>

<style scoped>
.challenge-note {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--text-tertiary);
  text-align: left;
}
.challenge-retry {
  margin-left: 6px;
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface-raised);
  color: var(--primary);
  font-size: 12px;
  cursor: pointer;
  transition: background-color 180ms cubic-bezier(0.22, 1, 0.36, 1);
}
.challenge-retry:hover { background: var(--surface-hover); }
.challenge-retry:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
</style>
