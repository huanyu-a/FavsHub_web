<template>
  <div class="admin-page">
    <div style="padding: 40px; text-align: center; color: var(--text-secondary);">
      <p>正在跳转至「机器人与 API」令牌管理...</p>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'admin', layout: 'admin' })
await navigateTo('/admin/bot?tab=tokens', { replace: true })
</script>
