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

<style scoped>
.error-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
.error-container {
  text-align: center;
  padding: 48px;
  background: rgba(255,255,255,0.95);
  border-radius: 20px;
  box-shadow: 0 20px 60px rgba(0,0,0,0.2);
  max-width: 480px;
  width: 90%;
}
.error-code {
  font-size: 80px;
  font-weight: 800;
  background: linear-gradient(135deg, #667eea, #764ba2);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  line-height: 1;
  margin-bottom: 8px;
}
h1 {
  font-size: 24px;
  color: #333;
  margin: 0 0 12px;
}
.error-message {
  font-size: 14px;
  color: #888;
  margin: 0 0 32px;
}
.error-actions {
  display: flex;
  justify-content: center;
  gap: 12px;
}
.btn-primary {
  padding: 12px 32px;
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: #fff;
  border: none;
  border-radius: 10px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s;
}
.btn-primary:hover { opacity: 0.9; }
.btn-ghost {
  padding: 12px 32px;
  background: none;
  border: 1.5px solid #ddd;
  color: #666;
  border-radius: 10px;
  font-size: 15px;
  cursor: pointer;
}
.btn-ghost:hover { border-color: #667eea; color: #667eea; }
</style>
