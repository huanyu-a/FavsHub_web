<template>
  <div class="error-page">
    <div class="error-container">
      <div class="error-code">{{ error?.statusCode || 500 }}</div>
      <h1>{{ error?.statusCode === 404 ? '页面未找到' : '服务器错误' }}</h1>
      <p class="error-message">{{ error?.message || '发生了意外错误' }}</p>
      <div class="error-actions">
        <button class="btn-primary" @click="handleError">返回首页</button>
        <button class="btn-ghost" @click="clearError({ redirect: '/' })">刷新</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: false })

useHead({
  link: [{ rel: 'stylesheet', href: '/css/error.css' }],
})

const props = defineProps<{
  error: {
    statusCode?: number
    message?: string
  }
}>()

function handleError() {
  clearError({ redirect: '/' })
}
</script>
