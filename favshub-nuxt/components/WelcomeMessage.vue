<template>
  <div class="welcome-search-container">
    <div id="welcome-message" class="welcome-text">{{ greeting }}</div>
  </div>
</template>

<script setup lang="ts">
const authStore = useAuthStore()
const settingsStore = useSettingsStore()

const greeting = computed(() => {
  const hours = new Date().getHours()
  let timeGreeting: string
  if (hours < 12) timeGreeting = '早上好'
  else if (hours < 18) timeGreeting = '下午好'
  else timeGreeting = '晚上好'

  const userName = authStore.user?.nickname || settingsStore.get('userName', '')
  return userName ? `${timeGreeting}, ${userName}` : timeGreeting
})
</script>

<style scoped>
.welcome-search-container {
  margin-bottom: 16px;
}
.welcome-text {
  font-size: 28px;
  font-weight: 600;
  color: #333;
  padding: 8px 0;
}
@media (prefers-color-scheme: dark) {
  .welcome-text {
    color: #eee;
  }
}
/* Dark mode is now defined globally in layouts/default.vue */
</style>
