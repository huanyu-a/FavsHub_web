<template>
  <div class="modal" style="display:flex;" @click.self="$emit('close')">
    <div class="modal-content login-dialog-content">
      <span class="close-button" @click="$emit('close')">&times;</span>
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
defineEmits<{ close: [] }>()

const authStore = useAuthStore()
const router = useRouter()

const tab = ref<'login' | 'register'>('login')
const loading = ref(false)
const errorMsg = ref('')
const registrationAllowed = ref(true)

// 检查是否允许注册
const { data: regConfig } = await useFetch<{ allowed: boolean }>('/api/config/registration')
if (regConfig.value) {
  registrationAllowed.value = regConfig.value.allowed
  if (!registrationAllowed.value && tab.value === 'register') {
    tab.value = 'login'
  }
}

const loginForm = reactive({ username: '', password: '' })
const regForm = reactive({ username: '', email: '', password: '' })

function switchTab(t: 'login' | 'register') {
  tab.value = t
  errorMsg.value = ''
}

async function handleLogin() {
  loading.value = true
  errorMsg.value = ''
  try {
    await authStore.login(loginForm.username, loginForm.password)
    await router.replace('/admin')
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
    await router.replace('/admin')
  } catch (err: any) {
    errorMsg.value = err?.data?.error || err?.message || '注册失败'
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-dialog-content {
  max-width: 420px;
  width: 90vw;
  padding: 40px;
  text-align: center;
}
.login-logo {
  margin-bottom: 24px;
}
.login-logo img {
  width: 48px;
  height: 48px;
}
.login-logo h1 {
  font-size: 22px;
  margin-top: 8px;
  color: var(--text-primary);
}
.login-logo p {
  color: var(--text-tertiary);
  font-size: 13px;
  margin-top: 4px;
}
.tab-nav {
  display: flex;
  margin-bottom: 20px;
  border-bottom: 2px solid var(--border);
}
.tab-nav button {
  flex: 1;
  padding: 10px;
  border: none;
  background: none;
  font-size: 14px;
  cursor: pointer;
  color: var(--text-tertiary);
  transition: all 0.2s;
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
}
.tab-nav button.active {
  color: var(--primary-color);
  border-bottom-color: var(--primary-color);
  font-weight: 600;
}
.form-group {
  margin-bottom: 14px;
  text-align: left;
}
.form-group label {
  display: block;
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 5px;
}
.form-group input {
  width: 100%;
  padding: 10px 14px;
  border: 1.5px solid var(--border);
  border-radius: 8px;
  font-size: 14px;
  transition: border-color 0.2s;
  outline: none;
  background: var(--surface-raised);
  color: var(--text-primary);
}
.form-group input:focus {
  border-color: var(--primary-color);
}
.submit-btn {
  width: 100%;
  padding: 12px;
  background: linear-gradient(135deg, var(--primary-color), var(--accent-purple));
  color: var(--text-inverse);
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s;
  margin-top: 6px;
}
.submit-btn:hover {
  opacity: 0.9;
}
.submit-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.error-msg {
  color: var(--danger);
  font-size: 13px;
  text-align: center;
  margin-bottom: 12px;
  padding: 8px;
  background: light-dark(#ffeaea, rgba(255,234,234,0.1));
  border-radius: 8px;
}
</style>
