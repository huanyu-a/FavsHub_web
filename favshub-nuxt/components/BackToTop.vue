<template>
  <div id="back-to-top-container" :class="{ visible: showButton }">
    <div id="back-to-top" title="回到顶部" @click="scrollToTop">
      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 19V5M5 12l7-7 7 7"/>
      </svg>
      <span class="scroll-percent-text">{{ scrollPercent }}%</span>
    </div>
  </div>
</template>

<script setup lang="ts">
const scrollPercent = ref(0)
const showButton = ref(false)

function handleScroll() {
  const scrollTop = window.scrollY || document.documentElement.scrollTop
  const scrollHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight
  scrollPercent.value = scrollHeight > 0 ? Math.round((scrollTop / scrollHeight) * 100) : 0
  showButton.value = scrollTop > 300
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

onMounted(() => {
  window.addEventListener('scroll', handleScroll, { passive: true })
  handleScroll()
})

onUnmounted(() => {
  window.removeEventListener('scroll', handleScroll)
})
</script>

<style scoped>
#back-to-top-container {
  position: fixed;
  bottom: 0;
  right: 0;
  z-index: 999;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.3s;
}
#back-to-top-container.visible {
  opacity: 1;
}

#back-to-top {
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  width: 40px;
  padding: 8px 4px;
  margin: 0 16px 16px 0;
  background: rgba(255,255,255,0.85);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(0,0,0,0.08);
  border-radius: 20px;
  cursor: pointer;
  color: #666;
  transition: all 0.2s;
  box-shadow: 0 2px 8px rgba(0,0,0,0.06);
}
#back-to-top:hover {
  background: #fff;
  color: #333;
  box-shadow: 0 4px 16px rgba(0,0,0,0.1);
  transform: translateY(-2px);
}

.scroll-percent-text {
  font-size: 10px;
  font-weight: 600;
  color: #999;
  line-height: 1;
}
</style>
