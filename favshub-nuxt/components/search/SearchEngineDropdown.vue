<template>
  <div v-if="visible" class="engine-dropdown" @mousedown.prevent>
    <div
      v-for="engine in engines"
      :key="engine.id"
      class="engine-item"
      @click="$emit('select', engine)"
    >
      <img v-if="engine.icon" :src="engine.icon" class="engine-icon" :alt="engine.name">
      <span>{{ engine.name }}</span>
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
:global([data-theme="dark"]) .engine-dropdown {
  background: #2a2a2a;
  border-color: #444;
}
:global([data-theme="dark"]) .engine-item:hover {
  background: #333;
}
</style>
