/**
 * Mobile layout composable — shared state for drawer, overlay, bottom nav
 */
export function useMobile() {
  const MOBILE_BP = 768

  const isMobile = ref(false)
  const drawerOpen = ref(false)
  const searchSheetOpen = ref(false)

  function checkMobile() {
    if (import.meta.client) {
      isMobile.value = window.innerWidth <= MOBILE_BP
    }
  }

  function openDrawer() { drawerOpen.value = true }
  function closeDrawer() { drawerOpen.value = false }
  function toggleDrawer() { drawerOpen.value = !drawerOpen.value }

  function openSearchSheet() { searchSheetOpen.value = true }
  function closeSearchSheet() { searchSheetOpen.value = false }

  // Auto-close drawer on resize above breakpoint
  function onResize() {
    checkMobile()
    if (!isMobile.value) {
      drawerOpen.value = false
      searchSheetOpen.value = false
    }
  }

  if (import.meta.client) {
    checkMobile()
    window.addEventListener('resize', onResize)
    onUnmounted(() => window.removeEventListener('resize', onResize))
  }

  return {
    isMobile,
    drawerOpen,
    searchSheetOpen,
    openDrawer,
    closeDrawer,
    toggleDrawer,
    openSearchSheet,
    closeSearchSheet,
  }
}
