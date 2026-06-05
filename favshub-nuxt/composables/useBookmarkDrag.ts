/**
 * useBookmarkDrag composable
 *
 * Wraps SortableJS to enable drag-and-drop reordering of bookmark cards.
 *
 * Usage:
 * ```vue
 * <script setup>
 * const containerRef = ref<HTMLElement | null>(null)
 * const bookmarksStore = useBookmarksStore()
 *
 * useBookmarkDrag(containerRef, (items) => {
 *   bookmarksStore.reorderBookmarks(items)
 * })
 * </script>
 *
 * <template>
 *   <div ref="containerRef"><!-- bookmark cards --></div>
 * </template>
 * ```
 */
import type { Ref } from 'vue'
import Sortable from 'sortablejs'

export interface ReorderItem {
  id: number
  sort_order: number
}

/**
 * @param containerRef - Template ref pointing to the scrollable container that holds bookmark cards.
 *   Each direct child must have a `data-id` attribute with the bookmark id.
 * @param onReorder - Callback invoked with the new order after a drag ends.
 *   Receives an array of `{ id, sort_order }` items.
 * @param options - Optional SortableJS options override.
 */
export function useBookmarkDrag(
  containerRef: Ref<HTMLElement | null>,
  onReorder: (items: ReorderItem[]) => void,
  options?: Partial<Sortable.Options>,
) {
  let sortableInstance: Sortable | null = null

  function initSortable() {
    const el = containerRef.value
    if (!el || sortableInstance) return

    sortableInstance = Sortable.create(el, {
      animation: 200,
      ghostClass: 'bookmark-ghost',
      chosenClass: 'bookmark-chosen',
      dragClass: 'bookmark-drag',
      handle: '.card', // Only drag from card elements
      ...options,

      onEnd(evt) {
        // Collect the new order from the DOM
        const children = el.children
        const items: ReorderItem[] = []
        for (let i = 0; i < children.length; i++) {
          const child = children[i] as HTMLElement
          const id = Number(child.dataset.id)
          if (!isNaN(id)) {
            items.push({ id, sort_order: i })
          }
        }
        onReorder(items)
      },
    })
  }

  function destroySortable() {
    if (sortableInstance) {
      sortableInstance.destroy()
      sortableInstance = null
    }
  }

  // Watch the container ref — initialise when the element appears, tear down when it disappears
  watch(
    containerRef,
    (el) => {
      destroySortable()
      if (el) {
        // Use nextTick so the DOM is settled after a render cycle
        nextTick(initSortable)
      }
    },
    { flush: 'post' },
  )

  // Clean up on scope dispose (e.g. component unmount)
  onBeforeUnmount(destroySortable)

  return {
    /** Re-create the Sortable instance (e.g. after the children change) */
    reinit() {
      destroySortable()
      nextTick(initSortable)
    },
    /** Manually destroy the Sortable instance */
    destroy: destroySortable,
  }
}
