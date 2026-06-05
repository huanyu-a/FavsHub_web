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
        <button :class="{ active: tab === 'register' }" @click="switchTab('register')">注册</button>
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

useHead({ title: 'FavsHub - 登录' })

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()

const tab = ref<'login' | 'register'>('login')
const loading = ref(false)
const errorMsg = ref('')

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

<style scoped>
.login-page {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}
.login-container {
  background: #fff;
  border-radius: 16px;
  padding: 48px 40px;
  width: 400px;
  max-width: 90vw;
  box-shadow: 0 20px 60px rgba(0,0,0,0.2);
}
.login-logo {
  text-align: center;
  margin-bottom: 32px;
}
.login-logo img {
  width: 48px;
  height: 48px;
}
.login-logo h1 {
  font-size: 24px;
  margin-top: 8px;
  color: #333;
}
.login-logo p {
  color: #888;
  font-size: 14px;
  margin-top: 4px;
}
.tab-nav {
  display: flex;
  margin-bottom: 24px;
  border-bottom: 2px solid #eee;
}
.tab-nav button {
  flex: 1;
  padding: 12px;
  border: none;
  background: none;
  font-size: 15px;
  cursor: pointer;
  color: #888;
  transition: all 0.2s;
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
}
.tab-nav button.active {
  color: #667eea;
  border-bottom-color: #667eea;
  font-weight: 600;
}
.form-group {
  margin-bottom: 16px;
}
.form-group label {
  display: block;
  font-size: 13px;
  color: #666;
  margin-bottom: 6px;
}
.form-group input {
  width: 100%;
  padding: 12px 16px;
  border: 1.5px solid #e0e0e0;
  border-radius: 10px;
  font-size: 14px;
  transition: border-color 0.2s;
  outline: none;
}
.form-group input:focus {
  border-color: #667eea;
}
.submit-btn {
  width: 100%;
  padding: 14px;
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: #fff;
  border: none;
  border-radius: 10px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s;
  margin-top: 8px;
}
.submit-btn:hover { opacity: 0.9; }
.submit-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.error-msg {
  color: #e74c3c;
  font-size: 13px;
  text-align: center;
  margin-bottom: 12px;
  padding: 8px;
  background: #ffeaea;
  border-radius: 8px;
}
</style>
