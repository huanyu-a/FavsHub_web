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
let scroller: HTMLElement | Window = window

function getScrollContainer(): HTMLElement | null {
  // 首页主内容区是 main 滚动容器（旧版同样在 main 上滚动）
  return document.querySelector('.home-shell > main') as HTMLElement | null
}

function handleScroll() {
  const el = getScrollContainer()
  let scrollTop: number, scrollHeight: number
  if (el) {
    scrollTop = el.scrollTop
    scrollHeight = el.scrollHeight - el.clientHeight
  } else {
    scrollTop = window.scrollY || document.documentElement.scrollTop
    scrollHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight
  }
  scrollPercent.value = scrollHeight > 0 ? Math.round((scrollTop / scrollHeight) * 100) : 0
  showButton.value = scrollTop > 50
}

function scrollToTop() {
  const el = getScrollContainer()
  if (el) el.scrollTo({ top: 0, behavior: 'smooth' })
  else window.scrollTo({ top: 0, behavior: 'smooth' })
}

onMounted(() => {
  const el = getScrollContainer()
  scroller = el || window
  scroller.addEventListener('scroll', handleScroll, { passive: true } as any)
  handleScroll()
})

onUnmounted(() => {
  scroller.removeEventListener('scroll', handleScroll as any)
})
</script>

<style scoped>
/* #back-to-top-container / #back-to-top / #back-to-top.show / #scroll-percent
   全部来自 main-bundle.css（含暗色模式与环形进度动画）。 */
</style>
