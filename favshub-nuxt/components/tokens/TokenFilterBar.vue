<template>
  <div class="filter-bar">
    <div class="filter-tabs">
      <button
        v-for="opt in SORT_OPTIONS"
        :key="opt.value"
        type="button"
        class="filter-tab"
        :class="{ active: sort === opt.value }"
        @click="$emit('update:sort', opt.value)"
      >
        {{ opt.label }}
      </button>
    </div>

    <div class="filter-selects">
      <label class="filter-select">
        <span class="sr-only">品质分级</span>
        <select :value="quality" @change="onChange('update:quality', $event)">
          <option value="">品质：全部</option>
          <option v-for="q in QUALITY_LEVELS" :key="q" :value="q">{{ q }}</option>
        </select>
      </label>

      <label class="filter-select">
        <span class="sr-only">来源标签</span>
        <select :value="sourceTag" @change="onChange('update:sourceTag', $event)">
          <option value="">来源：全部</option>
          <option v-for="s in SOURCE_OPTIONS" :key="s.value" :value="s.value">{{ s.label }}</option>
        </select>
      </label>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  sort: string
  quality: string
  sourceTag: string
}>()

const emit = defineEmits<{
  'update:sort': [value: string]
  'update:quality': [value: string]
  'update:sourceTag': [value: string]
}>()

const SORT_OPTIONS = [
  { value: 'nexus', label: 'Nexus 实测' },
  { value: 'latest', label: '最新' },
  { value: 'hot', label: '最热' },
  { value: 'rating', label: '高分' },
  { value: 'expiring', label: '即将过期' },
]

// 与 server/utils/token-deals.ts 的 QUALITY_LEVELS / SOURCE_TAGS 保持一致
const QUALITY_LEVELS = ['上上品', '上品', '中品', '下品', '下下品']
const SOURCE_OPTIONS = [
  { value: 'official', label: '官方直营' },
  { value: 'relay', label: '中转站' },
  { value: 'community', label: '社区转发' },
]

function onChange(eventName: 'update:quality' | 'update:sourceTag', e: Event) {
  const value = (e.target as HTMLSelectElement).value
  if (eventName === 'update:quality') emit('update:quality', value)
  else emit('update:sourceTag', value)
}
</script>

<style scoped>
.filter-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 8px 0;
  border-top: 0.5px solid var(--divider);
  border-bottom: 0.5px solid var(--divider);
  margin-bottom: 16px;
}
.filter-tabs {
  display: flex;
  gap: 14px;
}
.filter-tab {
  border: none;
  background: none;
  padding: 2px 0;
  font-size: 13px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: color 0.15s;
}
.filter-tab:hover {
  color: var(--text-primary);
}
.filter-tab.active {
  color: var(--text-primary);
  font-weight: 500;
}
.filter-selects {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.filter-select select {
  font-size: 12px;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  border: 0.5px solid var(--border);
  background: var(--surface-raised);
  color: var(--text-secondary);
  cursor: pointer;
}
.filter-select select:focus {
  outline: none;
  border-color: var(--border-focus);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
