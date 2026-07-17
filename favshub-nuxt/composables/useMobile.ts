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

  checkMobile()
  window.addEventListener('resize', onResize)
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
