<template>
  <div v-if="backgroundStyle" class="wallpaper-background" :style="backgroundStyle"></div>
</template>

<script setup lang="ts">
const settingsStore = useSettingsStore()

const bingUrl = ref('')

const backgroundStyle = computed(() => {
  const bgType = settingsStore.get('backgroundType', 'none')
  const selected = settingsStore.get('selectedBackground', '')

  // 渐变背景由 useTheme.ts 通过 <html> class 应用，此处不处理
  if (bgType === 'gradient') {
    return null
  }

  if (bgType === 'bing') {
    return bingUrl.value ? { backgroundImage: `url(${bingUrl.value})` } : null
  }

  if (bgType === 'image' && selected) {
    return { backgroundImage: `url(${selected})` }
  }

  return null
})

// Fetch Bing daily wallpaper when backgroundType is 'bing'
if (import.meta.client) {
  watch(() => settingsStore.get('backgroundType'), async (type) => {
    if (type === 'bing' && !bingUrl.value) {
      try {
        const res = await $fetch<{ url: string }>('/api/bing-wallpaper')
        bingUrl.value = res.url
      } catch { /* ignore */ }
    }
  }, { immediate: true })
}
</script>

