<template>
  <div id="year-progress" class="year-progress-container">
    <div class="year-progress">
      <span>{{ currentYear }} 年进度</span>
      <div class="progress-bar">
        <div v-for="i in 12" :key="i" :class="{ active: i <= activeSegments }"></div>
      </div>
    </div>
    <div class="progress-percentage">{{ progressPercent }}%</div>
  </div>
</template>

<script setup lang="ts">
const now = ref(new Date())

if (import.meta.client) {
  const timer = setInterval(() => { now.value = new Date() }, 60_000)
  onUnmounted(() => clearInterval(timer))
}

const currentYear = computed(() => now.value.getFullYear())
const yearProgress = computed(() => {
  const start = new Date(currentYear.value, 0, 1).getTime()
  const end = new Date(currentYear.value, 11, 31, 23, 59, 59).getTime()
  return ((now.value.getTime() - start) / (end - start)) * 100
})
const activeSegments = computed(() => Math.floor(yearProgress.value / 8.33))
const progressPercent = computed(() => yearProgress.value.toFixed(2))
</script>


