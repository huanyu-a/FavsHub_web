import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useBookmarksStore } from '../stores/bookmarks'

beforeEach(() => {
  window.localStorage.clear()
  setActivePinia(createPinia())
})

describe('bookmarks store 视图偏好', () => {
  it('loadViewPreferences 读取有效密度并过滤非字符串分组键', () => {
    window.localStorage.setItem('favshub_density', 'compact')
    window.localStorage.setItem('favshub_collapsed_groups', JSON.stringify(['mine:1', 42, null, 'mine:2']))
    const store = useBookmarksStore()

    store.loadViewPreferences()

    expect(store.density).toBe('compact')
    expect(store.collapsedGroupKeys).toEqual(['mine:1', 'mine:2'])
    expect(store.viewPreferencesLoaded).toBe(true)
    expect(store.isGroupExpanded('mine:1')).toBe(false)
    expect(store.isGroupExpanded('mine:3')).toBe(true)
  })

  it('loadViewPreferences 遇到非法密度与损坏 JSON 时保留安全默认值', () => {
    window.localStorage.setItem('favshub_density', 'dense')
    window.localStorage.setItem('favshub_collapsed_groups', '{broken')
    const store = useBookmarksStore()

    expect(() => store.loadViewPreferences()).not.toThrow()
    expect(store.density).toBe('comfortable')
    expect(store.collapsedGroupKeys).toEqual([])
    expect(store.viewPreferencesLoaded).toBe(true)
  })

  it('loadViewPreferences 忽略非数组分组数据及非字符串密度', () => {
    window.localStorage.setItem('favshub_density', 'null')
    window.localStorage.setItem('favshub_collapsed_groups', JSON.stringify({ 'mine:1': true }))
    const store = useBookmarksStore()

    store.loadViewPreferences()

    expect(store.density).toBe('comfortable')
    expect(store.collapsedGroupKeys).toEqual([])
  })

  it('setDensity 更新真实 store 并持久化每次选择', () => {
    const store = useBookmarksStore()

    store.setDensity('compact')
    expect(store.density).toBe('compact')
    expect(window.localStorage.getItem('favshub_density')).toBe('compact')

    store.setDensity('comfortable')
    expect(store.density).toBe('comfortable')
    expect(window.localStorage.getItem('favshub_density')).toBe('comfortable')
  })

  it('setGroupExpanded 从损坏数据恢复并持久化收起与展开结果', () => {
    window.localStorage.setItem('favshub_collapsed_groups', '{broken')
    const store = useBookmarksStore()
    store.loadViewPreferences()

    store.setGroupExpanded('mine:1', false)
    expect(store.collapsedGroupKeys).toEqual(['mine:1'])
    expect(JSON.parse(window.localStorage.getItem('favshub_collapsed_groups') || '[]')).toEqual(['mine:1'])

    store.setGroupExpanded('mine:2', false)
    store.setGroupExpanded('mine:1', true)
    expect(store.collapsedGroupKeys).toEqual(['mine:2'])
    expect(JSON.parse(window.localStorage.getItem('favshub_collapsed_groups') || '[]')).toEqual(['mine:2'])
  })
})
