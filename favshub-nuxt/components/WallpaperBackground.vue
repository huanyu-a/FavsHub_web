<template>
  <div v-if="backgroundStyle" class="wallpaper-background" :style="backgroundStyle"></div>
</template>

<script setup lang="ts">
const settingsStore = useSettingsStore()

const backgroundStyle = computed(() => {
  const bgType = settingsStore.get('backgroundType', 'none')
  const selected = settingsStore.get('selectedBackground', '')

  // 渐变背景由 useTheme.ts 通过 <html> class 应用，此处不处理
  if (bgType === 'gradient') {
    return null
  }

  if (bgType === 'image' && selected) {
    return { backgroundImage: `url(${selected})` }
  }

  return null
})
</script>
