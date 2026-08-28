<template>
  <i :class="resolvedClass" class="app-icon"></i>
</template>

<script setup lang="ts">
import { isEmoji } from '~/utils/icon'

/**
 * 统一图标渲染：数据库中遗留的 emoji 图标值不再显示，
 * 统一渲染为 fallback Remix 图标；类名值原样渲染。
 */
const props = withDefaults(defineProps<{
  value?: string
  fallback?: string
}>(), {
  value: '',
  fallback: 'ri-folder-line',
})

const resolvedClass = computed(() => {
  if (!props.value || isEmoji(props.value)) return props.fallback
  return props.value
})
</script>

<style scoped>
.app-icon {
  font-style: normal;
  line-height: 1;
}
</style>
