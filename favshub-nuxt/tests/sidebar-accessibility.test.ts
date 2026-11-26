import fs from 'node:fs'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'
import FolderTreeItem from '../components/sidebar/FolderTreeItem.vue'
import Sidebar from '../components/sidebar/Sidebar.vue'
import { useAuthStore } from '../stores/auth'
import { useBookmarksStore } from '../stores/bookmarks'

function mountTree() {
  return mount(FolderTreeItem, {
    props: {
      node: {
        id: 1,
        name: '工作',
        icon: 'ri-folder-line',
        _hasChildren: true,
        _depth: 0,
        _count: 0,
        children: [
          {
            id: 2,
            name: '项目',
            icon: 'ri-folder-line',
            _hasChildren: false,
            _depth: 1,
            _count: 0,
            children: [],
          },
        ],
      },
      currentFolderId: 2,
      expandedIds: new Set([1]),
    },
  })
}

describe('FolderTreeItem 无障碍与列表语义', () => {
  it('将子列表嵌套在父 li 内，并把交互角色放在内部控件而非 li 上', () => {
    const wrapper = mountTree()
    const root = wrapper.get('li.folder-tree-node')

    expect(root.attributes('role')).toBeUndefined()
    expect(root.find(':scope > div.folder-tree-item').exists()).toBe(true)
    expect(root.get(':scope > ul.folder-tree-children > li.folder-tree-node').text()).toContain('项目')

    const select = root.get(':scope > div.folder-tree-item > .folder-select')
    expect(select.attributes('role')).toBe('button')
    expect(select.attributes('tabindex')).toBe('0')
    expect(select.attributes('aria-label')).toBe('选择文件夹 工作')

    const toggle = root.get(':scope > div.folder-tree-item > .folder-toggle')
    expect(toggle.attributes('aria-label')).toBe('收起文件夹 工作')
    expect(toggle.attributes('aria-expanded')).toBe('true')
  })

  it('文件夹选择与展开分别触发事件，支持键盘且不会相互冒泡', async () => {
    const wrapper = mountTree()
    const root = wrapper.get('li.folder-tree-node')
    const select = root.get(':scope > div.folder-tree-item > .folder-select')
    const toggle = root.get(':scope > div.folder-tree-item > .folder-toggle')

    await select.trigger('keydown', { key: ' ' })
    expect(wrapper.emitted('select-folder')).toEqual([[1]])
    expect(wrapper.emitted('toggle-expand')).toEqual([[1]])

    await toggle.trigger('click')
    expect(wrapper.emitted('toggle-expand')).toEqual([[1], [1]])
    expect(wrapper.emitted('select-folder')).toHaveLength(1)

    await toggle.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('toggle-expand')).toEqual([[1], [1], [1]])
    expect(wrapper.emitted('select-folder')).toHaveLength(1)
  })

  it('Enter 选择、叶子节点和整行点击保持独立语义', async () => {
    const wrapper = mountTree()
    const root = wrapper.get('li.folder-tree-node')
    const select = root.get(':scope > div.folder-tree-item > .folder-select')

    await select.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('select-folder')).toEqual([[1]])
    expect(wrapper.emitted('toggle-expand')).toEqual([[1]])

    await select.trigger('click')
    expect(wrapper.emitted('select-folder')).toEqual([[1], [1]])
    expect(wrapper.emitted('toggle-expand')).toEqual([[1], [1]])

    const leaf = root.get(':scope > ul.folder-tree-children > li.folder-tree-node > div.folder-tree-item')
    expect(leaf.find('.folder-toggle').exists()).toBe(false)
    await leaf.get('.folder-select').trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('select-folder')?.at(-1)).toEqual([2])
    expect(wrapper.emitted('toggle-expand')).toHaveLength(2)
  })

  it('从选择或展开控件发起的右键菜单只上报一次', async () => {
    const wrapper = mountTree()
    const root = wrapper.get('li.folder-tree-node')
    await root.get(':scope > div.folder-tree-item > .folder-select').trigger('contextmenu')
    expect(wrapper.emitted('contextmenu-folder')).toHaveLength(1)

    await root.get(':scope > div.folder-tree-item > .folder-toggle').trigger('contextmenu')
    expect(wrapper.emitted('contextmenu-folder')).toHaveLength(2)
  })

  it('保留 PromptPro 字符串 ID 合约，并支持直接点击行空白区域', async () => {
    const wrapper = mount(FolderTreeItem, {
      props: {
        node: {
          id: 'prompt-folder-abc',
          name: '提示词分类',
          _hasChildren: false,
          _depth: 0,
          _count: 0,
          children: [],
        },
        currentFolderId: 'prompt-folder-abc',
        expandedIds: new Set<string>(),
      },
    })

    expect(wrapper.get('.folder-tree-item').classes()).toContain('selected')
    await wrapper.get('.folder-tree-item').trigger('click')
    expect(wrapper.emitted('select-folder')).toEqual([['prompt-folder-abc']])
    expect(wrapper.emitted('toggle-expand')).toBeUndefined()
  })
})

describe('Sidebar 全部书签可访问名称', () => {
  it('aria-label 连续包含可见的全部与动态计数', () => {
    const source = fs.readFileSync('components/sidebar/Sidebar.vue', 'utf8')
    expect(source).toContain(':aria-label="`全部 ${totalBookmarkCount}，选择全部书签`"')
    expect(source).toContain('<span class="item-count item-count--pinned">{{ totalBookmarkCount }}</span>')
  })

  it('分类与精选集 accessible name 按可见顺序包含名称、计数和可选新增数', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const auth = useAuthStore()
    auth.token = 'cookie_auth'
    auth.user = { id: 7, username: 'a11y-user' }
    vi.stubGlobal('useRoute', () => ({ path: '/' }))
    vi.stubGlobal('useAuthStore', useAuthStore)
    vi.stubGlobal('useBookmarksStore', useBookmarksStore)
    vi.stubGlobal('useSettingsStore', () => ({}))
    vi.stubGlobal('navigateTo', vi.fn())
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({
      collections: [
        { id: 'tools', name: '效率工具', bookmark_count: 7, new_count: 2 },
        { id: 'docs', name: '文档', bookmark_count: 3 },
      ],
    }))

    const wrapper = mount(Sidebar, {
      props: {
        isOpen: true,
        folders: [],
        currentFolderId: null,
        activeCollectionId: 'collection-a',
        activeCategoryId: null,
        collectionCategories: [
          { id: 1, name: '开发', parent_id: null, bookmark_count: 8 },
          { id: 2, name: '前端', parent_id: 1, bookmark_count: 3 },
        ],
      },
      global: {
        plugins: [pinia],
        stubs: {
          NuxtLink: { template: '<a><slot /></a>' },
          ClientOnly: { template: '<div><slot /></div>' },
          FolderTreeItem: true,
          UserPanel: true,
          AppIcon: { template: '<i />' },
        },
      },
    })
    await vi.waitFor(() => expect(wrapper.findAll('.collection-select')).toHaveLength(2))

    const categories = wrapper.findAll('.folder-select')
    expect(categories.map(control => control.attributes('aria-label'))).toEqual([
      '全部分类 11，选择全部分类',
      '开发 8，选择分类',
      '前端 3，选择分类',
    ])
    expect(categories.map(control => control.get('.folder-name').text())).toEqual(['全部分类', '开发', '前端'])
    expect(categories.map(control => control.find('.item-count').text())).toEqual(['11', '8', '3'])

    const collections = wrapper.findAll('.collection-select')
    expect(collections.map(control => control.attributes('aria-label'))).toEqual([
      '效率工具 7 2，打开精选集',
      '文档 3，打开精选集',
    ])
    expect(collections[0].find('.collection-new-badge').text()).toBe('2')
    expect(collections[1].find('.collection-new-badge').exists()).toBe(false)
    expect(collections.map(control => control.get('.collection-item-name').text())).toEqual(['效率工具', '文档'])

    const categoryRows = wrapper.findAll('li.folder-item')
    await categoryRows[0].trigger('click')
    expect(wrapper.emitted('select-collection-category')).toEqual([[null]])
    await categories[0].trigger('click')
    expect(wrapper.emitted('select-collection-category')).toEqual([[null], [null]])
    await categoryRows[2].trigger('click')
    expect(wrapper.emitted('select-collection-category')?.at(-1)).toEqual([2])

    const collectionRows = wrapper.findAll('li.collection-item')
    await collectionRows[0].trigger('click')
    expect(wrapper.emitted('select-collection')).toEqual([['tools']])
    await collections[0].trigger('click')
    expect(wrapper.emitted('select-collection')).toEqual([['tools'], ['tools']])

    await wrapper.setProps({ activeCollectionId: null })
    const allRow = wrapper.get('li.folder-item--all')
    await allRow.trigger('click')
    expect(wrapper.emitted('select-folder')).toEqual([[null]])
    await allRow.get('.folder-select').trigger('click')
    expect(wrapper.emitted('select-folder')).toEqual([[null], [null]])
    await allRow.get('.folder-toggle').trigger('click')
    expect(wrapper.emitted('select-folder')).toHaveLength(2)
    wrapper.unmount()
  })

  it('分类与精选集名称连续包含全部可见文字和计数', () => {
    const source = fs.readFileSync('components/sidebar/Sidebar.vue', 'utf8')
    expect(source).toContain(':aria-label="`全部分类 ${visibleCollectionTotal}，选择全部分类`"')
    expect(source).toContain(':aria-label="`${cat.name} ${cat.bookmark_count || 0}，选择分类`"')
    expect(source).toContain(':aria-label="`${child.name} ${child.bookmark_count || 0}，选择分类`"')
    expect(source).toContain(":aria-label=\"`${c.name} ${c.bookmark_count}${c.new_count && c.new_count > 0 ? ' ' + c.new_count : ''}，打开精选集`\"")
  })
})
