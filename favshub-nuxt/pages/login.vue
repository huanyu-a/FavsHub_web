<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
    <div class="w-full max-w-md bg-white dark:bg-gray-800 rounded-xl shadow-lg p-8 space-y-6">
      <!-- Logo / Title -->
      <div class="text-center">
        <h1 class="text-3xl font-bold text-gray-900 dark:text-white">FavsHub</h1>
        <p class="mt-2 text-gray-500 dark:text-gray-400">
          {{ isRegisterMode ? '创建新账户' : '欢迎回来' }}
        </p>
      </div>

      <!-- Error Message -->
      <div v-if="errorMsg" class="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg px-4 py-3 text-sm">
        {{ errorMsg }}
      </div>

      <!-- Form -->
      <form class="space-y-4" @submit.prevent="handleSubmit">
        <!-- Username -->
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">用户名</label>
          <input
            v-model="form.username"
            type="text"
            class="w-full px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
            placeholder="请输入用户名"
            required
            minlength="2"
            maxlength="32"
          />
        </div>

        <!-- Password -->
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">密码</label>
          <input
            v-model="form.password"
            type="password"
            class="w-full px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
            placeholder="请输入密码（至少 6 位）"
            required
            minlength="6"
          />
        </div>

        <!-- Email (register only) -->
        <div v-if="isRegisterMode">
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">邮箱（可选）</label>
          <input
            v-model="form.email"
            type="email"
            class="w-full px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
            placeholder="your@email.com"
          />
        </div>

        <!-- Nickname (register only) -->
        <div v-if="isRegisterMode">
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">昵称（可选）</label>
          <input
            v-model="form.nickname"
            type="text"
            class="w-full px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
            placeholder="显示名称"
          />
        </div>

        <!-- Submit -->
        <button
          type="submit"
          :disabled="isLoading"
          class="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium transition-colors"
        >
          {{ isLoading ? '处理中...' : (isRegisterMode ? '注册' : '登录') }}
        </button>
      </form>

      <!-- Toggle mode -->
      <p class="text-center text-sm text-gray-500 dark:text-gray-400">
        {{ isRegisterMode ? '已有账户？' : '没有账户？' }}
        <button
          type="button"
          class="text-blue-600 dark:text-blue-400 hover:underline"
          @click="toggleMode"
        >
          {{ isRegisterMode ? '去登录' : '去注册' }}
        </button>
      </p>

      <!-- Back to home -->
      <p class="text-center">
        <NuxtLink to="/" class="text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
          ← 返回首页
        </NuxtLink>
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'auth' })
useHead({ title: '登录' })

const route = useRoute()
const router = useRouter()
const { login, register } = useAuth()

const isRegisterMode = ref(false)
const isLoading = ref(false)
const errorMsg = ref('')

const form = reactive({
  username: '',
  password: '',
  email: '',
  nickname: '',
})

function toggleMode() {
  isRegisterMode.value = !isRegisterMode.value
  errorMsg.value = ''
}

async function handleSubmit() {
  errorMsg.value = ''
  isLoading.value = true

  try {
    if (isRegisterMode.value) {
      await register(form.username, form.password, form.email || undefined, form.nickname || undefined)
    } else {
      await login(form.username, form.password)
    }
    // 登录成功后跳转
    const redirect = (route.query.redirect as string) || '/'
    await navigateTo(redirect)
  } catch (err: any) {
    const data = err?.data?.data || err?.data || {}
    errorMsg.value = data.error || err?.statusMessage || '操作失败，请重试'
  } finally {
    isLoading.value = false
  }
}
</script>
