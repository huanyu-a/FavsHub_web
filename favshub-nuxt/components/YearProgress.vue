<template>
  <div id="year-progress" class="year-progress-container">
    <div class="year-progress-label">
      <span>{{ currentYear }} 年已过去</span>
      <span class="year-progress-percent">{{ progressPercent }}%</span>
    </div>
    <div class="year-progress-bar">
      <div class="year-progress-fill" :style="{ width: progressPercent + '%' }"></div>
    </div>
    <div class="year-progress-days">
      已过 {{ daysPassed }} 天，剩余 {{ daysRemaining }} 天
    </div>
  </div>
</template>

<script setup lang="ts">
const now = ref(new Date())

// 每分钟更新一次
if (import.meta.client) {
  const timer = setInterval(() => { now.value = new Date() }, 60_000)
  onUnmounted(() => clearInterval(timer))
}

const currentYear = computed(() => now.value.getFullYear())
const daysPassed = computed(() => {
  const start = new Date(currentYear.value, 0, 1)
  return Math.floor((now.value.getTime() - start.getTime()) / 86_400_000)
})
const isLeapYear = computed(() => (currentYear.value % 4 === 0 && currentYear.value % 100 !== 0) || currentYear.value % 400 === 0)
const totalDays = computed(() => isLeapYear.value ? 366 : 365)
const daysRemaining = computed(() => totalDays.value - daysPassed.value)
const progressPercent = computed(() => ((daysPassed.value / totalDays.value) * 100).toFixed(1))
</script>

<style scoped>
.year-progress-container {
  max-width: 600px;
  margin: 0 auto;
  padding: 8px 0;
}
.year-progress-label {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #999;
  margin-bottom: 4px;
}
.year-progress-percent {
  font-weight: 600;
  color: #667eea;
}
.year-progress-bar {
  height: 4px;
  background: #e8e8e8;
  border-radius: 2px;
  overflow: hidden;
}
.year-progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #667eea, #764ba2);
  border-radius: 2px;
  transition: width 0.3s;
}
.year-progress-days {
  font-size: 11px;
  color: #bbb;
  margin-top: 4px;
  text-align: center;
}
</style>
