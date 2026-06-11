<template>
    <div v-if="visible" class="search-engine-dropdown" @mousedown.prevent>
      <div class="search-engine-options-container">
        <div
          v-for="engine in engines"
          :key="engine.id"
          class="search-engine-option"
          :title="engine.label || engine.name"
          @click="$emit('select', engine)"
        >
          <div class="search-engine-option-content">
            <img
              :src="engine.icon || '/images/placeholder-icon.svg'"
              class="search-engine-option-icon"
              :alt="engine.label || engine.name"
            >
            <span class="search-engine-option-label">{{ engine.label || engine.name }}</span>
          </div>
        </div>
        <div class="search-engine-option" title="管理搜索引擎" @click="$emit('manage')">
          <div class="search-engine-option-content">
            <span class="search-engine-option-icon" style="display:inline-flex;align-items:center;justify-content:center;color:#667eea;">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            </span>
            <span class="search-engine-option-label">管理</span>
          </div>
        </div>
      </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

interface Engine {
  id: number
  name: string
  label?: string
  url: string
  icon?: string | null
}

const props = defineProps<{
  engines: Engine[]
  visible: boolean
}>()

defineEmits<{
  select: [engine: Engine]
  manage: []
}>()
</script>

<style scoped>
/* 下拉菜单容器 */
.search-engine-dropdown {
  position: absolute;
  left: 0;
  top: 100%;
  background: white;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  padding: 16px;
  z-index: 1000;
  width: 100%;
  margin-top: 8px;
}

/* 搜索引擎选项容器 - 6列网格布局 */
.search-engine-options-container {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 12px;
}

/* 单个选项项 */
.search-engine-option {
  cursor: pointer;
  padding: 8px;
  border-radius: 8px;
  transition: background-color 0.2s;
}

.search-engine-option:hover {
  background-color: #f5f5f5;
}

/* 选项内容 - 图标在上，名称在下 */
.search-engine-option-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  min-height: 0;
}

/* 选项图标 */
.search-engine-option-icon {
  height: 18px;
  margin-bottom: 4px;
  object-fit: contain;
}

/* 标签样式 */
.search-engine-option-label {
  font-size: 12px;
  color: #1a202c;
  text-align: center;
}

/* 移动端响应式 - 改为3列 */
@media (max-width: 480px) {
  .search-engine-options-container {
    grid-template-columns: repeat(3, 1fr);
  }
}

/* 暗色模式 */
[data-theme="dark"] .search-engine-dropdown {
  background: rgba(30, 41, 59, 0.98);
  border: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(12px);
}

[data-theme="dark"] .search-engine-option:hover {
  background-color: rgba(255, 255, 255, 0.08);
}

[data-theme="dark"] .search-engine-option-label {
  color: #e2e8f0;
}
</style>
