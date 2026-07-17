<template>
  <div class="stats-grid">
    <div class="stat-card">
      <div class="label">精选集总数</div>
      <div class="value blue">{{ loading ? '-' : total }}</div>
    </div>
    <div class="stat-card">
      <div class="label">官方推荐</div>
      <div class="value purple">{{ loading ? '-' : official }}</div>
    </div>
    <div class="stat-card">
      <div class="label">总书签数</div>
      <div class="value green">{{ loading ? '-' : bookmarks }}</div>
    </div>
    <div class="stat-card">
      <div class="label">平均书签数</div>
      <div class="value orange">{{ loading ? '-' : avgBookmarks }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  total: number
  official: number
  bookmarks: number
  subscribers?: number
  loading?: boolean
}>()

const avgBookmarks = computed(() => {
  if (props.total === 0) return 0
  return Math.round(props.bookmarks / props.total)
})
</script>

<style scoped>
.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
  margin-bottom: 32px;
}

.stat-card {
  background: var(--surface-raised);
  border-radius: 12px;
  padding: 20px;
  box-shadow: var(--shadow-sm);
}

.stat-card .label {
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.stat-card .value {
  font-size: 28px;
  font-weight: 700;
}

.stat-card .value.blue  { color: var(--primary); }
.stat-card .value.green { color: var(--primary); }
.stat-card .value.purple { color: var(--accent-purple); }
.stat-card .value.orange { color: var(--accent-yellow); }

@media (max-width: 768px) {
  .stats-grid {
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 10px;
    margin-bottom: 16px;
  }
  .stat-card {
    padding: 14px;
  }
  .stat-card .value {
    font-size: 22px;
  }
}

@media (max-width: 480px) {
  .stats-grid {
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .stat-card {
    padding: 12px;
  }
  .stat-card .value {
    font-size: 20px;
  }
  .stat-card .label {
    font-size: 12px;
  }
}
</style>
