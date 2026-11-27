import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import PromptsPage from '../pages/prompts/index.vue'

vi.mock('~/components/prompts/PromptDialogs.vue', () => ({
  default: {
    props: {
      showEditDialog: Boolean,
      isReviewMode: Boolean,
      editForm: Object,
    },
    emits: ['save'],
    template: '<button v-if="showEditDialog" class="save-prompt-stub" @click="$emit(\'save\')">保存</button>',
  },
}))
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

interface PromptFixture {
  id: string
  title: string
  description?: string
  content: string
  folder_id?: string
  user_id?: number
  owner_is_admin?: number
  current_version?: string
  tags?: { id: number; name: string; color?: string }[]
}

interface UserFixture {
  id: number
  is_admin?: number
}

interface FetchOptionsFixture {
  method?: string
  body?: {
    title?: string
    description?: string
    content?: string
    folder_id?: string | null
    tags?: number[]
    change_note?: string
  }
}

interface MountPromptsOptions {
  user?: UserFixture
  prompt?: PromptFixture
  updateResponse?: { prompt: PromptFixture } | {
    success: true
    message: string
    review_id: string
    review_required: true
  }
}

async function mountPrompts(folders: FolderFixture[], options: MountPromptsOptions = {}) {
  const prompt: PromptFixture = options.prompt ?? { id: 'p1', title: '示例提示词', content: '内容' }
  const updateResponse = options.updateResponse ?? { prompt }
  const fetchMock = vi.fn(async (url: string, requestOptions?: FetchOptionsFixture) => {
    if (url === `/api/prompts/${prompt.id}` && requestOptions?.method === 'PUT') return updateResponse
    if (url === '/api/prompts/folders/all') return { folders }
    if (url === '/api/tags') return { tags: [] }
    if (url === '/api/prompts?recycle=1&limit=1000') return { prompts: [] }
    if (url === '/api/prompts') return { prompts: [prompt] }
    throw new Error(`未预期的请求: ${url}`)
  })

  vi.stubGlobal('$fetch', fetchMock)
  vi.stubGlobal('alert', vi.fn())
  vi.stubGlobal('definePageMeta', () => undefined)
  vi.stubGlobal('useHead', () => undefined)
  vi.stubGlobal('useFetch', async () => ({ data: ref({}) }))
  vi.stubGlobal('useRuntimeConfig', () => ({ public: { baseUrl: 'https://test.local' } }))
  vi.stubGlobal('useAuth', () => ({ isGuest: ref(!options.user) }))
  vi.stubGlobal('useAuthStore', () => ({ isAdmin: options.user?.is_admin === 1, user: options.user ?? null }))
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
  return { wrapper, fetchMock }
}

describe('PromptPro 分类过滤', () => {
  it('移除空分类，同时保留含非空子分类的空父节点', async () => {
    const { wrapper } = await mountPrompts([
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
    const { wrapper } = await mountPrompts([
      { id: 'empty-1', name: '空分类一', prompt_count: 0 },
      { id: 'empty-2', name: '空分类二' },
    ])

    expect(wrapper.findAll('.folder-tree-stub')).toHaveLength(0)
    expect(wrapper.get('#categories-list').text()).toContain('全部')
    expect(wrapper.get('#categories-list').text()).not.toContain('空分类一')
  })
})

describe('PromptPro 提示词编辑', () => {
  it('非管理员申请修改时走公开 PUT，审核提交后关闭且不刷新', async () => {
    const prompt: PromptFixture = {
      id: 'admin-prompt',
      title: '管理员提示词',
      description: '公开说明',
      content: '公开内容',
      user_id: 1,
      owner_is_admin: 1,
    }
    const { wrapper, fetchMock } = await mountPrompts([], {
      user: { id: 7 },
      prompt,
      updateResponse: {
        success: true,
        message: '已提交审核请求，等待管理员审核',
        review_id: 'review-1',
        review_required: true,
      },
    })

    await wrapper.get('button[title="申请修改"]').trigger('click')
    await nextTick()
    expect(wrapper.find('.save-prompt-stub').exists()).toBe(true)

    await wrapper.get('.save-prompt-stub').trigger('click')
    await flushPromises()

    const putCalls = fetchMock.mock.calls.filter(([url, options]) => (
      url === '/api/prompts/admin-prompt' && options?.method === 'PUT'
    ))
    expect(putCalls).toHaveLength(1)
    expect(putCalls[0][1]?.body).toEqual({
      title: '管理员提示词',
      description: '公开说明',
      content: '公开内容',
      folder_id: null,
      tags: [],
      change_note: undefined,
    })
    expect(putCalls[0][1]?.body).not.toHaveProperty('_reviewMode')
    expect(putCalls[0][1]?.body).not.toHaveProperty('isReviewMode')
    expect(wrapper.find('.save-prompt-stub').exists()).toBe(false)
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/prompts')).toHaveLength(1)
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/prompts/folders/all')).toHaveLength(1)
  })

  it('普通自有提示词仍走同一公开 PUT，并在保存后正常刷新', async () => {
    const prompt: PromptFixture = {
      id: 'own-prompt',
      title: '我的提示词',
      content: '我的内容',
      user_id: 7,
      owner_is_admin: 0,
    }
    const { wrapper, fetchMock } = await mountPrompts([], {
      user: { id: 7 },
      prompt,
    })

    await wrapper.get('button[title="编辑"]').trigger('click')
    await wrapper.get('.save-prompt-stub').trigger('click')
    await flushPromises()

    const putCalls = fetchMock.mock.calls.filter(([url, options]) => (
      url === '/api/prompts/own-prompt' && options?.method === 'PUT'
    ))
    expect(putCalls).toHaveLength(1)
    expect(putCalls[0][1]?.body).not.toHaveProperty('_reviewMode')
    expect(putCalls[0][1]?.body).not.toHaveProperty('isReviewMode')
    expect(wrapper.find('.save-prompt-stub').exists()).toBe(false)
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/prompts')).toHaveLength(2)
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/prompts/folders/all')).toHaveLength(2)
  })
})
