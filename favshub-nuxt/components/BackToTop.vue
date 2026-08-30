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
/**
 * 回到顶部按钮（全滚动容器自适应）。
 *
 * 滚动可能发生在 window、html、body（main-bundle.css 将 html/body 限高 100vh，
 * 移动端 .home-shell 解除内部滚动后 body 成为实际滚动容器）、main 或任意内部
 * 容器上。scroll 事件不冒泡，但在 document 上以 capture 监听可截获所有元素的
 * 滚动，再配合候选容器度量，保证任意滚动方式下按钮都能出现。
 */
const scrollPercent = ref(0)
const showButton = ref(false)
const lastScroller = ref<HTMLElement | null>(null)

interface ScrollMetrics { scrollTop: number; maxScroll: number }

function metricsOf(el: HTMLElement | typeof window): ScrollMetrics {
  if (el === window) {
    return {
      scrollTop: window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0,
      maxScroll: Math.max(
        document.documentElement.scrollHeight - document.documentElement.clientHeight,
        document.body.scrollHeight - document.body.clientHeight,
      ),
    }
  }
  const node = el as HTMLElement
  return { scrollTop: node.scrollTop, maxScroll: node.scrollHeight - node.clientHeight }
}

function collectCandidates(): Array<HTMLElement | typeof window> {
  const list: Array<HTMLElement | typeof window> = [window]
  if (document.body) list.push(document.body)
  if (lastScroller.value) list.push(lastScroller.value)
  const mainEl = document.querySelector('main') as HTMLElement | null
  if (mainEl && mainEl !== lastScroller.value) list.push(mainEl)
  return list
}

function handleScroll(e?: Event) {
  // 记录实际在滚动的内部容器（html/body/window 的滚动走候选列表兜底）
  const target = e?.target
  if (target instanceof HTMLElement && target !== document.body && target !== document.documentElement) {
    lastScroller.value = target
  }

  let shown = false
  let best = 0
  for (const el of collectCandidates()) {
    const { scrollTop, maxScroll } = metricsOf(el)
    if (scrollTop > 50) shown = true
    if (maxScroll > 0) best = Math.max(best, Math.min(scrollTop / maxScroll, 1))
  }
  showButton.value = shown
  scrollPercent.value = Math.round(best * 100)
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' })
  for (const el of [document.documentElement, document.body, lastScroller.value]) {
    if (el instanceof HTMLElement) el.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const mainEl = document.querySelector('main') as HTMLElement | null
  if (mainEl) mainEl.scrollTo({ top: 0, behavior: 'smooth' })
}

onMounted(() => {
  // capture：截获 window / body / main / 任意内部容器的 scroll（scroll 不冒泡）
  document.addEventListener('scroll', handleScroll, { capture: true, passive: true })
  handleScroll()
})

onUnmounted(() => {
  document.removeEventListener('scroll', handleScroll, { capture: true })
})
</script>


