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
import type { NuxtError } from '#app'

definePageMeta({ layout: false })

useHead({
  link: [
    { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
    { rel: 'icon', type: 'image/png', sizes: '512x512', href: '/favicon.png' },
    { rel: 'stylesheet', href: '/css/error.css?v=20260830b' },
  ],
})

const error = useError()

function handleError() {
  clearError({ redirect: '/' })
}
</script>
