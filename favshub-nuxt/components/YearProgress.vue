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

<!-- 样式随组件走（scoped）：全局 main-bundle.css 中的 .progress-bar 规则在重复清理中被移除，
     迁移至此一处一源。已激活段 var(--primary)，未激活段 var(--surface-active)。 -->
<style scoped>
.year-progress-container {
  display: flex;
  align-items: center;
  justify-content: center;
}

.year-progress {
  display: flex;
  align-items: center;
}

.year-progress span {
  margin-right: 0.5rem;
  font-size: 12px;
  color: var(--text-secondary);
}

.progress-bar {
  display: flex;
  align-items: center;
}

.progress-bar div {
  width: 12px;
  height: 12px;
  margin-right: 4px;
  background-color: var(--surface-active);
  border-radius: 6px;
  transition: background-color 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}

.progress-bar div.active {
  background-color: var(--primary);
}

.progress-percentage {
  margin-left: 0.5rem;
  font-size: 12px;
  color: var(--text-secondary);
}
</style>

