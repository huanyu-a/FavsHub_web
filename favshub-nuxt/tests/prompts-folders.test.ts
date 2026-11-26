import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import PromptsPage from '../pages/prompts/index.vue'

vi.mock('~/components/prompts/PromptDialogs.vue', () => ({ default: { template: '<div />' } }))
vi.mock('~/components/prompts/TemplateVarModal.vue', () => ({ default: { template: '<div />' } }))
vi.mock('~/components/BackToTop.vue', () => ({ default: { template: '<div />' } }))
vi.mock('~/components/common/SiteFooter.vue', () => ({ default: { template: '<div />' } }))
vi.mock('~/components/sidebar/FolderTreeItem.vue', () => ({
  default: {
    name: 'FolderTreeItem',
    props: { node: { type: Object, required: true } },
    template: `
      <li class="folder-tree-stub">
        <span class="folder-name">{{ node.name }}</span>
        <ul v-if="node.children.length">
          <FolderTreeItem v-for="child in node.children" :key="child.id" :node="child" />
        </ul>
      </li>
    `,
  },
}))
vi.mock('~/utils/pinyin', () => ({ searchPrompts: (items: unknown[]) => items }))
vi.mock('~/utils/clipboard', () => ({ copyText: async () => true }))
vi.mock('~/utils/template-variables', () => ({ parseTemplateVariables: () => [] }))

interface FolderFixture {
  id: string
  name: string
  parent_id?: string
  prompt_count?: number
}

async function mountPrompts(folders: FolderFixture[]) {
  const fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/prompts/folders/all') return { folders }
    if (url === '/api/tags') return { tags: [] }
    if (url === '/api/prompts?recycle=1&limit=1000') return { prompts: [] }
    if (url === '/api/prompts') {
      return { prompts: [{ id: 'p1', title: '示例提示词', content: '内容' }] }
    }
    throw new Error(`未预期的请求: ${url}`)
  })

  vi.stubGlobal('$fetch', fetchMock)
  vi.stubGlobal('definePageMeta', () => undefined)
  vi.stubGlobal('useHead', () => undefined)
  vi.stubGlobal('useFetch', async () => ({ data: ref({}) }))
  vi.stubGlobal('useRuntimeConfig', () => ({ public: { baseUrl: 'https://test.local' } }))
  vi.stubGlobal('useAuth', () => ({ isGuest: ref(true) }))
  vi.stubGlobal('useAuthStore', () => ({ isAdmin: false, user: null }))
  vi.stubGlobal('useMobile', () => ({ mobileActionsSlot: ref(null) }))
  vi.stubGlobal('useState', (_key: string, init: () => unknown) => ref(init()))

  const Host = defineComponent({
    components: { PromptsPage },
    template: '<Suspense><PromptsPage /></Suspense>',
  })
  const wrapper = mount(Host, {
    global: {
      stubs: {
        NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
        UserPanel: { template: '<div />' },
        ClientOnly: { template: '<div><slot /></div>' },
      },
    },
  })
  await flushPromises()
  await nextTick()
  await flushPromises()
  return wrapper
}

describe('PromptPro 分类过滤', () => {
  it('移除空分类，同时保留含非空子分类的空父节点', async () => {
    const wrapper = await mountPrompts([
      { id: 'parent', name: '空父分类', prompt_count: 0 },
      { id: 'child', name: '非空子分类', parent_id: 'parent', prompt_count: 2 },
      { id: 'single', name: '独立非空分类', prompt_count: 1 },
      { id: 'empty', name: '完全空分类', prompt_count: 0 },
    ])

    const categories = wrapper.get('#categories-list').text()
    expect(categories).toContain('空父分类')
    expect(categories).toContain('非空子分类')
    expect(categories).toContain('独立非空分类')
    expect(categories).not.toContain('完全空分类')
    expect(wrapper.findAll('.folder-tree-stub')).toHaveLength(3)
  })

  it('所有分类为空时不渲染分类节点，只保留全部入口', async () => {
    const wrapper = await mountPrompts([
      { id: 'empty-1', name: '空分类一', prompt_count: 0 },
      { id: 'empty-2', name: '空分类二' },
    ])

    expect(wrapper.findAll('.folder-tree-stub')).toHaveLength(0)
    expect(wrapper.get('#categories-list').text()).toContain('全部')
    expect(wrapper.get('#categories-list').text()).not.toContain('空分类一')
  })
})
