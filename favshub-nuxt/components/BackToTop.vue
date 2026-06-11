<template>
  <div id="back-to-top-container">
    <div id="back-to-top" :class="{ show: showButton }" title="回到顶部" @click="scrollToTop">
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:20px; height:20px;">
        <path d="M12 19V5M5 12l7-7 7 7"></path>
      </svg>
      <span id="scroll-percent" class="scroll-percent-text">{{ scrollPercent }}%</span>
    </div>
  </div>
</template>

<script setup lang="ts">
const scrollPercent = ref(0)
const showButton = ref(false)

function getScrollTop(): number {
  // 优先取 window，再取 main 元素
  const winST = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop
  if (winST > 0) return winST
  const mainEl = document.querySelector('main') as HTMLElement | null
  return mainEl?.scrollTop || 0
}

function getScrollMetrics() {
  // 优先用 window 的滚动高度
  const winST = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop
  if (winST > 0 || document.documentElement.scrollHeight > document.documentElement.clientHeight) {
    return {
      scrollTop: winST,
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
    }
  }
  // fallback: main 元素
  const mainEl = document.querySelector('main') as HTMLElement | null
  if (mainEl && mainEl.scrollHeight > mainEl.clientHeight) {
    return { scrollTop: mainEl.scrollTop, scrollHeight: mainEl.scrollHeight, clientHeight: mainEl.clientHeight }
  }
  return { scrollTop: 0, scrollHeight: 0, clientHeight: 0 }
}

function handleScroll() {
  const { scrollTop, scrollHeight, clientHeight } = getScrollMetrics()
  const maxScroll = scrollHeight - clientHeight
  scrollPercent.value = maxScroll > 0 ? Math.round((scrollTop / maxScroll) * 100) : 0
  showButton.value = scrollTop > 50
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' })
  const mainEl = document.querySelector('main') as HTMLElement | null
  if (mainEl) mainEl.scrollTo({ top: 0, behavior: 'smooth' })
}

onMounted(() => {
  window.addEventListener('scroll', handleScroll, { passive: true } as any)
  const mainEl = document.querySelector('main') as HTMLElement | null
  if (mainEl) mainEl.addEventListener('scroll', handleScroll, { passive: true } as any)
  handleScroll()
})

onUnmounted(() => {
  window.removeEventListener('scroll', handleScroll as any)
  const mainEl = document.querySelector('main') as HTMLElement | null
  if (mainEl) mainEl.removeEventListener('scroll', handleScroll as any)
})
</script>

<style scoped>
/* #back-to-top-container / #back-to-top / #back-to-top.show / #scroll-percent
   全部来自 main-bundle.css（含暗色模式与环形进度动画）。 */
</style>
