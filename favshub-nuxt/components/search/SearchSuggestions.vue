<template>
  <div v-if="visible && suggestions.length > 0" class="suggestions-dropdown">
    <div
      v-for="(s, i) in suggestions"
      :key="i"
      class="suggestion-item"
      @mousedown.prevent="$emit('select', s)"
    >
      <i class="ri-bookmark-line" style="margin-right:8px;font-size:12px;color:#999;"></i>
      <span class="suggestion-title">{{ s.title }}</span>
      <span class="suggestion-url">{{ s.url }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
interface Bookmark {
  id: number
  title: string
  url: string
}

defineProps<{
  suggestions: Bookmark[]
  visible: boolean
}>()

defineEmits<{
  select: [bookmark: Bookmark]
}>()
</script>

<style scoped>
.suggestions-dropdown {
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
.suggestion-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  cursor: pointer;
  font-size: 13px;
  transition: background 0.15s;
}
.suggestion-item:hover {
  background: #f5f5f5;
}
.suggestion-url {
  font-size: 11px;
  color: #999;
  margin-left: auto;
}
/* Dark mode is now defined globally in layouts/default.vue */
</style>
