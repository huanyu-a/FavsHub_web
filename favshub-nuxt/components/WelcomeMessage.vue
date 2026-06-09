<template>
  <div class="welcome-search-container">
    <div id="welcome-message" :style="{ visibility: ready ? 'visible' : 'hidden' }">{{ greeting }}</div>
  </div>
</template>

<script setup lang="ts">
const authStore = useAuthStore()
const settingsStore = useSettingsStore()

const ready = ref(false)
const now = ref(new Date())

const greeting = computed(() => {
  const hours = now.value.getHours()
  let timeGreeting: string
  if (hours < 12) timeGreeting = '早上好'
  else if (hours < 18) timeGreeting = '下午好'
  else timeGreeting = '晚上好'

  const userName = authStore.user?.nickname || settingsStore.get('userName', '')
  return userName ? `${timeGreeting}\u{1F44B}, ${userName}` : timeGreeting
})

let timer: ReturnType<typeof setTimeout> | null = null
function scheduleNextUpdate() {
  const d = new Date()
  const ms = (60 - d.getMinutes()) * 60 * 1000 - d.getSeconds() * 1000 - d.getMilliseconds()
  timer = setTimeout(() => {
    now.value = new Date()
    scheduleNextUpdate()
  }, ms)
}

onMounted(() => {
  setTimeout(() => { ready.value = true }, 100)
  scheduleNextUpdate()
})
onUnmounted(() => { if (timer) clearTimeout(timer) })
</script>

<style scoped>
/* .welcome-search-container 与 #welcome-message 样式均来自 main-bundle.css（含暗色模式） */
</style>
