<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
    <div class="text-center space-y-6">
      <h1 class="text-4xl font-bold text-gray-900 dark:text-white">
        FavsHub
      </h1>
      <p class="text-gray-600 dark:text-gray-400">
        智能书签管理 & AI 提示词管理
      </p>

      <!-- Health Status -->
      <div v-if="health" class="inline-block text-left bg-white dark:bg-gray-800 rounded-lg shadow p-6 space-y-2">
        <div class="flex items-center gap-2">
          <span class="w-3 h-3 rounded-full" :class="health.status === 'ok' ? 'bg-green-500' : 'bg-red-500'"></span>
          <span class="font-medium" :class="health.status === 'ok' ? 'text-green-600' : 'text-red-600'">
            {{ health.status === 'ok' ? '服务正常' : '服务异常' }}
          </span>
        </div>
        <div v-if="health.stats" class="text-sm text-gray-500 dark:text-gray-400 space-y-1">
          <p>数据库：{{ health.database }}</p>
          <p>用户：{{ health.stats.users }} | 书签：{{ health.stats.bookmarks }} | 提示词：{{ health.stats.prompts }}</p>
        </div>
        <div v-if="health.error" class="text-sm text-red-500">
          {{ health.error }}
        </div>
      </div>

      <div v-else class="text-gray-400">加载中...</div>

      <!-- Auth Status -->
      <div class="flex items-center justify-center gap-4">
        <template v-if="isLoggedIn">
          <span class="text-sm text-green-600 dark:text-green-400">
            ✓ 已登录: {{ user?.username }}
            <span v-if="isAdmin" class="ml-1 text-xs bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300 px-2 py-0.5 rounded">管理员</span>
          </span>
          <button @click="logout" class="text-sm text-gray-400 hover:text-red-500">登出</button>
        </template>
        <NuxtLink v-else to="/login" class="text-sm text-blue-600 dark:text-blue-400 hover:underline">
          登录 / 注册
        </NuxtLink>
      </div>

      <p class="text-xs text-gray-400 dark:text-gray-600">
        Nuxt 3 + Drizzle ORM + Naive UI — 迁移进行中
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
interface HealthResponse {
  status: string
  database: string
  stats?: {
    users: number
    bookmarks: number
    prompts: number
  }
  error?: string
  timestamp: number
}

const { data: health } = await useFetch<HealthResponse>('/api/health')

const { isLoggedIn, isAdmin, user, logout } = useAuth()
</script>
