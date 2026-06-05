<template>
  <div v-if="backgroundStyle" class="wallpaper-background" :style="backgroundStyle"></div>
</template>

<script setup lang="ts">
const settingsStore = useSettingsStore()

const bingUrl = ref('')

const backgroundStyle = computed(() => {
  const bgType = settingsStore.get('backgroundType', 'none')
  const selected = settingsStore.get('selectedBackground', '')
  const solid = settingsStore.get('solidBackground', '')

  if (bgType === 'solid' && solid) {
    return { background: solid }
  }

  if (bgType === 'bing') {
    return bingUrl.value ? { backgroundImage: `url(${bingUrl.value})` } : null
  }

  if (bgType === 'image' && selected) {
    return { backgroundImage: `url(${selected})` }
  }

  if (bgType === 'none' || !bgType) {
    return null
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

<style scoped>
.wallpaper-background {
  position: fixed;
  inset: 0;
  z-index: -1;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  pointer-events: none;
}
</style>
