<template>
  <div class="error-page">
    <div class="error-container">
      <div class="error-code">{{ error?.statusCode || 500 }}</div>
      <h1>{{ error?.statusCode === 404 ? '页面未找到' : '服务器错误' }}</h1>
      <p class="error-message">{{ safeMessage }}</p>
      <div class="error-actions">
        <button class="btn-primary" @click="handleError">返回首页</button>
        <button class="btn-ghost" @click="clearError({ redirect: '/' })">刷新</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { NuxtError } from '#app'
import { redactPaths } from '~/utils/sanitize'

definePageMeta({ layout: false })

useHead({
  link: [
    { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
    { rel: 'icon', type: 'image/png', sizes: '512x512', href: '/favicon.png' },
    { rel: 'stylesheet', href: '/css/error.css?v=20260830b' },
  ],
})

const error = useError()

/**
 * 错误消息脱敏后才渲染。
 *
 * 服务端抛出的错误消息可能携带文件系统绝对路径（如 `ENOENT ... open '/www/...'`），
 * 本页是 SSR 渲染的**页面**，不经 `/api/**` 的全局 error 钩子，必须在此单独脱敏，
 * 否则会把部署根路径直接印在页面上给访客看。
 */
const safeMessage = computed(() => {
  const raw = (error.value as NuxtError | undefined)?.message
  if (!raw) return '发生了意外错误'
  return redactPaths(raw)
})

function handleError() {
  clearError({ redirect: '/' })
}
</script>
