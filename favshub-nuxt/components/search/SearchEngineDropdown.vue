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
            <span class="search-engine-option-icon" style="display:inline-flex;align-items:center;justify-content:center;color:var(--primary);">
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

