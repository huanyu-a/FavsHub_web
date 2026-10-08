/**
 * Mobile layout composable — shared state for drawer, overlay, bottom nav
 * Uses module-level state so all components share the same refs.
 */

const MOBILE_BP = 1024

// Initialize to false so SSR never renders mobile markup (avoids hydration mismatch).
// Client-side initMobile() will set the correct value immediately after hydration.
const isMobile = ref(false)
const drawerOpen = ref(false)
const searchSheetOpen = ref(false)
/** Pages can set this to render extra action buttons in the mobile header */
const mobileActionsSlot = ref<(() => any) | null>(null)

let initialized = false

function initMobile() {
  if (initialized || !import.meta.client) return
  initialized = true

  function checkMobile() {
    isMobile.value = window.innerWidth <= MOBILE_BP
  }

  function onResize() {
    checkMobile()
    if (!isMobile.value) {
      drawerOpen.value = false
      searchSheetOpen.value = false
    }
  }

  // 首次判定必须推迟到 app ready（hydration 完成后）：SSR 没有视口概念，
  // isMobile 固定 false（渲染桌面标记）；若在 hydration 渲染阶段就翻转，
  // 客户端会改渲染移动壳 → 全站每个页面在 ≤1024px 视口都报 hydration
  // mismatch（2026-10-08 实测 /tokens /prompts /collections 全中）。
  // ready 后翻转只产生一次正常的响应式重渲染，视觉跳变与原先一致。
  onNuxtReady(() => {
    checkMobile()
    window.addEventListener('resize', onResize)
  })
  onUnmounted(() => window.removeEventListener('resize', onResize))
}

export function useMobile() {
  initMobile()

  function openDrawer() { drawerOpen.value = true }
  function closeDrawer() { drawerOpen.value = false }
  function toggleDrawer() { drawerOpen.value = !drawerOpen.value }

  function openSearchSheet() { searchSheetOpen.value = true }
  function closeSearchSheet() { searchSheetOpen.value = false }

  return {
    isMobile,
    drawerOpen,
    searchSheetOpen,
    mobileActionsSlot,
    openDrawer,
    closeDrawer,
    toggleDrawer,
    openSearchSheet,
    closeSearchSheet,
  }
}
