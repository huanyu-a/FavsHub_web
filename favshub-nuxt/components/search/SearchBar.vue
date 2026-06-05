<template>
  <div class="search-bar">
    <div class="search-input-wrapper">
      <span class="search-icon">🔍</span>
      <input
        ref="inputRef"
        type="text"
        class="search-input"
        :value="modelValue"
        :placeholder="placeholder"
        @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
        @keyup.enter="$emit('search', modelValue)"
      />
      <button
        v-if="modelValue"
        class="clear-btn"
        @click="$emit('update:modelValue', '')"
        title="清除"
      >
        ✕
      </button>
    </div>
    <slot name="engine-select" />
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  modelValue: string
  placeholder?: string
}>()

defineEmits<{
  'update:modelValue': [value: string]
  search: [query: string]
}>()

const inputRef = ref<HTMLInputElement>()

const focus = () => inputRef.value?.focus()

defineExpose({ focus })
</script>

<style scoped>
.search-bar {
  display: flex;
  align-items: center;
  gap: 8px;
}
.search-input-wrapper {
  flex: 1;
  position: relative;
  display: flex;
  align-items: center;
}
.search-icon {
  position: absolute;
  left: 10px;
  font-size: 14px;
  color: #999;
  pointer-events: none;
}
.search-input {
  width: 100%;
  padding: 8px 32px 8px 34px;
  border: 1px solid #ddd;
  border-radius: 8px;
  font-size: 14px;
  outline: none;
  transition: border-color 0.2s;
  background: #fff;
  color: #333;
}
.search-input:focus {
  border-color: #4a90d9;
}
.search-input::placeholder {
  color: #aaa;
}
.clear-btn {
  position: absolute;
  right: 8px;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 12px;
  color: #999;
  padding: 2px 6px;
  border-radius: 50%;
}
.clear-btn:hover {
  background: rgba(0, 0, 0, 0.08);
  color: #666;
}
@media (prefers-color-scheme: dark) {
  .search-input {
    background: #2a2a2a;
    border-color: #444;
    color: #eee;
  }
  .search-input:focus {
    border-color: #64b5f6;
  }
  .search-input::placeholder {
    color: #777;
  }
  .clear-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #ccc;
  }
}
</style>
