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
      <div v-if="errorMsg" class="error-msg">{{ errorMsg }}</div>

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
            <input v-model="regForm.password" type="password" required autocomplete="new-password" minlength="6" placeholder="至少 6 位">
          </div>
          <button type="submit" class="submit-btn" :disabled="loading">
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
  title: 'FavsHub - 登录',
  link: [
    { rel: 'stylesheet', href: '/css/main-bundle.css?v=20260619' },
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
  loading.value = true
  errorMsg.value = ''
  try {
    await authStore.register(regForm.username, regForm.password, regForm.email || undefined)
    const redirect = route.query.redirect as string
    const safeRedirect = (redirect && redirect.startsWith('/') && !redirect.startsWith('//')) ? redirect : '/'
    await router.replace(safeRedirect)
  } catch (err: any) {
    errorMsg.value = err?.data?.error || err?.message || '注册失败'
  } finally {
    loading.value = false
  }
}
</script>

