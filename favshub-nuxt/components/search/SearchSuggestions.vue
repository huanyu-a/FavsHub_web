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

