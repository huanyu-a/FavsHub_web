import { mount } from '@vue/test-utils'
import { nextTick, reactive } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import BookmarkGrid from '../components/bookmark/BookmarkGrid.vue'

vi.mock('../components/bookmark/BookmarkCard.vue', () => ({
  default: {
    name: 'BookmarkCard',
    props: {
      bookmark: { type: Object, required: true },
      faviconPriority: { type: Boolean, default: false },
    },
    emits: ['contextmenu'],
    template: '<article class="bookmark-card" :data-id="bookmark.id">{{ bookmark.title }}</article>',
  },
}))

vi.mock('../components/bookmark/BookmarkContextMenu.vue', () => ({
  default: { name: 'BookmarkContextMenu', template: '<div class="context-menu-stub" />' },
}))

function bookmark(id: number, title: string, folderId: number | null = null, sortOrder = 0) {
  return {
    id,
    title,
    url: `https://example.com/${id}`,
    folder_id: folderId,
    sort_order: sortOrder,
    user_id: 1,
  }
}

function mountGrid(
  props: Record<string, unknown>,
  initialDensity: 'comfortable' | 'compact' = 'comfortable',
) {
  const state = reactive({
    density: initialDensity,
    viewMode: 'mine',
    currentCollectionId: null as string | null,
    collapsedGroupKeys: [] as string[],
  })
  const store = {
    state,
    get density() { return state.density },
    get viewMode() { return state.viewMode },
    get currentCollectionId() { return state.currentCollectionId },
    loadViewPreferences: vi.fn(),
    setDensity: vi.fn((value: 'comfortable' | 'compact') => { state.density = value }),
    isGroupExpanded(key: string) { return !state.collapsedGroupKeys.includes(key) },
    setGroupExpanded(key: string, expanded: boolean) {
      state.collapsedGroupKeys = expanded
        ? state.collapsedGroupKeys.filter(item => item !== key)
        : [...new Set([...state.collapsedGroupKeys, key])]
    },
    toggleGroup(key: string) {
      const expanded = !state.collapsedGroupKeys.includes(key)
      state.collapsedGroupKeys = expanded
        ? state.collapsedGroupKeys.filter(item => item !== key)
        : [...state.collapsedGroupKeys, key]
    },
  }
  vi.stubGlobal('useBookmarksStore', () => store)

  const wrapper = mount(BookmarkGrid, {
    props: {
      bookmarks: [],
      isGuest: true,
      ...props,
    },
  })
  return { wrapper, store }
}

describe('BookmarkGrid', () => {
  it('无文件夹时仍平铺渲染全部书签，不退回空态', () => {
    const { wrapper } = mountGrid({
      bookmarks: [bookmark(1, 'Alpha'), bookmark(2, 'Beta')],
      folders: [],
    })

    expect(wrapper.find('.bookmarks-empty').exists()).toBe(false)
    expect(wrapper.find('.folder-group.flat-layout').exists()).toBe(true)
    expect(wrapper.findAll('.bookmark-card')).toHaveLength(2)
    expect(wrapper.text()).toContain('Alpha')
    expect(wrapper.text()).toContain('Beta')
  })

  it('有文件夹时按组展示、组内按 sort_order 排序且忽略空组', () => {
    const { wrapper } = mountGrid({
      bookmarks: [
        bookmark(2, '工作-B', 1, 2),
        bookmark(1, '工作-A', 1, 1),
        bookmark(3, '推荐'),
      ],
      folders: [
        { id: 1, name: '工作', parent_id: null },
        { id: 2, name: '空分类', parent_id: null },
      ],
    })

    expect(wrapper.findAll('.folder-group-title').map(node => node.text())).toEqual(['常用推荐', '工作'])
    expect(wrapper.text()).not.toContain('空分类')
    const workCards = wrapper.get('#folder-group-1').findAll('.bookmark-card')
    expect(workCards.map(node => node.text())).toEqual(['工作-A', '工作-B'])
  })

  it('空态不显示网格工具条，添加按钮向上抛出 add', async () => {
    const { wrapper } = mountGrid({ bookmarks: [] })

    expect(wrapper.get('.bookmarks-empty').text()).toContain('暂无书签')
    expect(wrapper.find('.grid-toolbar').exists()).toBe(false)
    expect(wrapper.findAll('.bookmark-card')).toHaveLength(0)

    await wrapper.get('.add-first-btn').trigger('click')
    expect(wrapper.emitted('add')).toHaveLength(1)
  })

  it('按 store 密度渲染，并在切换时调用 setDensity', async () => {
    const { wrapper, store } = mountGrid({ bookmarks: [bookmark(1, 'Alpha')] }, 'compact')
    await nextTick()

    expect(store.loadViewPreferences).toHaveBeenCalledOnce()
    expect(wrapper.classes()).toContain('density-compact')
    expect(wrapper.get('.density-toggle').attributes('aria-pressed')).toBe('true')
    expect(wrapper.get('.density-label').text()).toBe('紧凑')

    await wrapper.get('.density-toggle').trigger('click')
    expect(store.setDensity).toHaveBeenNthCalledWith(1, 'comfortable')
    expect(wrapper.classes()).not.toContain('density-compact')
    expect(wrapper.get('.density-toggle').attributes('aria-pressed')).toBe('false')

    await wrapper.get('.density-toggle').trigger('click')
    expect(store.setDensity).toHaveBeenNthCalledWith(2, 'compact')
    expect(wrapper.classes()).toContain('density-compact')
  })
})
