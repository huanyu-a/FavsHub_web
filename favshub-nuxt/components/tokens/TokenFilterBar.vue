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
        <span class="sr-only">通告分类</span>
        <select :value="category" @change="onChange('update:category', $event)">
          <option value="">分类：全部</option>
          <option v-for="c in CATEGORY_OPTIONS" :key="c.value" :value="c.value">{{ c.label }}</option>
        </select>
      </label>

      <label class="filter-select">
        <span class="sr-only">来源标签</span>
        <select :value="sourceTag" @change="onChange('update:sourceTag', $event)">
          <option value="">来源：全部</option>
          <option v-for="s in SOURCE_OPTIONS" :key="s.value" :value="s.value">{{ s.label }}</option>
        </select>
      </label>

      <!-- 待复核：超过核验新鲜度阈值 / 从未人工核验的通告（只提示，不代表已失效） -->
      <button
        type="button"
        class="filter-chip"
        :class="{ active: stale }"
        :aria-pressed="stale"
        title="只看超过核验阈值（默认 30 天）没有人工核验的通告"
        @click="$emit('update:stale', !stale)"
      >
        <i class="ri-refresh-line"></i> 待复核
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  sort: string
  quality: string
  sourceTag: string
  category: string
  stale: boolean
}>()

const emit = defineEmits<{
  'update:sort': [value: string]
  'update:quality': [value: string]
  'update:sourceTag': [value: string]
  'update:category': [value: string]
  'update:stale': [value: boolean]
}>()

const SORT_OPTIONS = [
  { value: 'nexus', label: 'Nexus 实测' },
  { value: 'verified', label: '最近核验' },
  { value: 'latest', label: '最新' },
  { value: 'hot', label: '最热' },
  { value: 'rating', label: '高分' },
  { value: 'expiring', label: '临期（7 天内）' },
]

// 与 server/utils/token-deals.ts 的 QUALITY_LEVELS / SOURCE_TAGS 保持一致
const QUALITY_LEVELS = ['上上品', '上品', '中品', '下品', '下下品']
const SOURCE_OPTIONS = [
  { value: 'official', label: '官方直营' },
  { value: 'relay', label: '中转站' },
  { value: 'community', label: '社区转发' },
]

// 与 server/utils/token-deals.ts 的 DEAL_CATEGORIES 保持一致
const CATEGORY_OPTIONS = [
  { value: 'token', label: 'API 额度' },
  { value: 'cloud', label: '免费云服务器' },
]

function onChange(
  eventName: 'update:quality' | 'update:sourceTag' | 'update:category',
  e: Event,
) {
  const value = (e.target as HTMLSelectElement).value
  if (eventName === 'update:quality') emit('update:quality', value)
  else if (eventName === 'update:category') emit('update:category', value)
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
  padding: 12px 0;
  border-bottom: 0.5px solid var(--divider);
  margin-bottom: 16px;
}
.filter-tabs {
  display: flex;
  gap: 4px;
  padding: 4px;
  background: var(--surface-sunken);
  border-radius: 10px;
  overflow-x: auto;
  scrollbar-width: none;
  max-width: 100%;
}
.filter-tabs::-webkit-scrollbar { display: none; }
.filter-tab {
  border: none;
  background: none;
  padding: 6px 12px;
  font-size: 13px;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: 6px;
  white-space: nowrap;
  transition: color 0.18s cubic-bezier(0.22, 1, 0.36, 1), background 0.18s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}
.filter-tab:hover {
  color: var(--text-primary);
  background: var(--surface-hover);
}
.filter-tab:active { background: var(--surface-active); }
.filter-tab:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
.filter-tab.active {
  color: var(--primary);
  font-weight: 600;
  background: var(--surface-raised);
  box-shadow: var(--shadow-sm);
}
.filter-selects {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.filter-select select {
  font-size: 12px;
  padding: 6px 12px;
  border-radius: 10px;
  border: 0.5px solid var(--border);
  background: var(--surface-raised);
  color: var(--text-secondary);
  cursor: pointer;
  transition: border-color 0.18s cubic-bezier(0.22, 1, 0.36, 1), color 0.18s cubic-bezier(0.22, 1, 0.36, 1), box-shadow 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}
.filter-select select:hover {
  color: var(--text-primary);
  border-color: var(--border-focus);
}
.filter-select select:focus {
  outline: none;
  border-color: var(--border-focus);
  box-shadow: 0 0 0 3px var(--primary-light);
}
.filter-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  padding: 6px 12px;
  border-radius: 10px;
  border: 0.5px solid var(--border);
  background: var(--surface-raised);
  color: var(--text-secondary);
  cursor: pointer;
  transition: color 0.18s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.18s cubic-bezier(0.22, 1, 0.36, 1), background 0.18s cubic-bezier(0.22, 1, 0.36, 1);
}
.filter-chip:hover {
  color: var(--text-primary);
  border-color: var(--border-focus);
}
.filter-chip:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}
.filter-chip.active {
  color: var(--primary);
  border-color: var(--primary);
  background: var(--primary-light);
  font-weight: 600;
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
@media (max-width: 640px) {
  .filter-bar {
    flex-direction: column;
    align-items: stretch;
  }
  .filter-selects {
    width: 100%;
  }
  .filter-select {
    flex: 1;
  }
  .filter-select select {
    width: 100%;
  }
}
</style>
