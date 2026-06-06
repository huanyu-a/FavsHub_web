<template>
  <div v-if="visible" class="engine-dropdown" @mousedown.prevent>
    <div
      v-for="engine in engines"
      :key="engine.id"
      class="engine-item"
      @click="$emit('select', engine)"
    >
      <img v-if="engine.icon" :src="engine.icon" class="engine-icon" :alt="engine.name">
      <img v-else src="/images/placeholder-icon.svg" class="engine-icon" :alt="engine.name">
      <span>{{ engine.name }}</span>
    </div>
    <div class="engine-item engine-item--manage" @click="$emit('manage')">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
      <span>管理搜索引擎</span>
    </div>
  </div>
</template>

<script setup lang="ts">
interface Engine {
  id: number
  name: string
  url: string
  icon?: string | null
}

defineProps<{
  engines: Engine[]
  visible: boolean
}>()

defineEmits<{
  select: [engine: Engine]
  manage: []
}>()
</script>

<style scoped>
.engine-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: #fff;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  margin-top: 4px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.1);
  z-index: 100;
  max-height: 300px;
  overflow-y: auto;
}
.engine-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  cursor: pointer;
  font-size: 13px;
  transition: background 0.15s;
}
.engine-item:hover {
  background: #f5f5f5;
}
.engine-icon {
  width: 18px;
  height: 18px;
  object-fit: contain;
}
/* 管理搜索引擎按钮 */
.engine-item--manage {
  border-top: 1px solid #f0f0f0;
  color: #667eea;
  font-weight: 500;
}
.engine-item--manage:hover {
  background: #e8f0fe;
}
/* Dark mode is now defined globally in layouts/default.vue */
</style>
