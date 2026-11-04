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
        <select :value="quality" @change="onSelect('update:quality', $event)">
          <option value="">品质：全部</option>
          <option v-for="q in QUALITY_LEVELS" :key="q" :value="q">{{ q }}</option>
        </select>
      </label>

      <!-- 分类落地页（/tokens/api 等）由页面锁死分类，这里不再给用户改的机会 -->
      <label v-if="!lockCategory" class="filter-select">
        <span class="sr-only">通告分类</span>
        <select :value="category" @change="onSelect('update:category', $event)">
          <option value="">分类：全部</option>
          <option v-for="c in CATEGORY_OPTIONS" :key="c.value" :value="c.value">{{ c.label }}</option>
        </select>
      </label>

      <label class="filter-select">
        <span class="sr-only">来源标签</span>
        <select :value="sourceTag" @change="onSelect('update:sourceTag', $event)">
          <option value="">来源：全部</option>
          <option v-for="s in SOURCE_OPTIONS" :key="s.value" :value="s.value">{{ s.label }}</option>
        </select>
      </label>

      <!-- 核实状态（2026-11-04）：替代原先独立的「待复核」chip，避免同一维度两套控件。
           三档对应 /api/token-deals 的 verified=1 / stale=1，空值为不加条件。 -->
      <label class="filter-select" :title="verifyTitle">
        <span class="sr-only">核实状态</span>
        <select :value="verifyState" @change="onSelect('update:verifyState', $event)">
          <option v-for="v in VERIFY_OPTIONS" :key="v.value" :value="v.value">{{ v.label }}</option>
        </select>
      </label>

      <!-- 只看收藏：纯本地过滤（收藏存在 localStorage，服务端不知道），由 board 侧执行 -->
      <button
        type="button"
        class="filter-chip"
        :class="{ active: favOnly }"
        :aria-pressed="favOnly"
        title="只看我收藏过的通告（收藏保存在本机浏览器）"
        @click="$emit('update:favOnly', !favOnly)"
      >
        <i :class="favOnly ? 'ri-star-fill' : 'ri-star-line'"></i> 只看收藏
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
  /** 核实状态：'' 全部 | 'verified' 近期已核实 | 'stale' 待复核 */
  verifyState: string
  favOnly: boolean
  /** 分类落地页传 true：分类被页面锁死，隐藏分类下拉 */
  lockCategory?: boolean
}>()

const emit = defineEmits<{
  'update:sort': [value: string]
  'update:quality': [value: string]
  'update:sourceTag': [value: string]
  'update:category': [value: string]
  'update:verifyState': [value: string]
  'update:favOnly': [value: boolean]
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

// 与 server/utils/token-deals.ts 的 DEAL_CATEGORIES 保持一致（顺序即展示顺序）
const CATEGORY_OPTIONS = [
  { value: 'token', label: 'API 额度' },
  { value: 'cloud', label: '免费云服务器' },
  { value: 'domain', label: '免费域名' },
  { value: 'client', label: '客户端额度' },
]

const VERIFY_OPTIONS = [
  { value: '', label: '核实：全部记录' },
  { value: 'verified', label: '核实：近期已核实' },
  { value: 'stale', label: '核实：待复核' },
]

/** 「待复核」只是新鲜度提示，不代表已失效 —— 下拉自身没法挂 title，挂在外层 label 上 */
const verifyTitle = '「近期已核实」= 阈值内人工确认过仍可用；「待复核」= 超过阈值（默认 30 天）没核验，只做提示、不代表已失效'

function onSelect(
  eventName: 'update:quality' | 'update:sourceTag' | 'update:category' | 'update:verifyState',
  e: Event,
) {
  const value = (e.target as HTMLSelectElement).value
  if (eventName === 'update:quality') emit('update:quality', value)
  else if (eventName === 'update:sourceTag') emit('update:sourceTag', value)
  else if (eventName === 'update:category') emit('update:category', value)
  else emit('update:verifyState', value)
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
  align-items: center;
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
  /* 移动端：4 个下拉 + 1 个 chip 挤一行会换行参差 —— 让每个控件各占半行，chip 独占整行 */
  .filter-select {
    flex: 1 1 calc(50% - 4px);
    min-width: 0;
  }
  .filter-select select {
    width: 100%;
  }
  .filter-chip {
    flex: 1 1 100%;
    justify-content: center;
  }
}
</style>
