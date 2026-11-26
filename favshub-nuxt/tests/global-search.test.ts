import fs from 'node:fs'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGlobalSearch } from '../composables/useGlobalSearch'
import { useAuthStore } from '../stores/auth'

type Search = ReturnType<typeof useGlobalSearch>
type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: Error) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function searchResponse(title: string) {
  return {
    query: 'Alpha',
    limit: 6,
    total: 1,
    groups: {
      bookmarks: [],
      collections: [{
        id: title,
        type: 'collection',
        title,
        subtitle: '',
        url: `/collections/${encodeURIComponent(title)}`,
        external: false,
        personal: false,
      }],
      prompts: [],
      tokens: [],
    },
  }
}

function privateBookmarkResponse(title: string) {
  return {
    query: 'Alpha',
    limit: 6,
    total: 1,
    groups: {
      bookmarks: [{
        id: 'private-bookmark',
        type: 'bookmark',
        title,
        subtitle: '',
        url: 'https://example.com/private',
        external: true,
        personal: true,
      }],
      collections: [],
      prompts: [],
      tokens: [],
    },
  }
}

const wrappers: VueWrapper[] = []
let fetchMock: ReturnType<typeof vi.fn>

function mountSearch(): Search {
  let search!: Search
  const wrapper = mount(defineComponent({
    setup() {
      search = useGlobalSearch()
      return () => h('div')
    },
  }))
  wrappers.push(wrapper)
  return search
}

async function startSearch(search: Search) {
  search.open()
  search.query.value = 'Alpha'
  await nextTick()
  search.handleInputKeydown(new KeyboardEvent('keydown', { key: 'Enter' }))
  expect(fetchMock).toHaveBeenCalledTimes(1)
}

async function settleResponse() {
  await Promise.resolve()
  await Promise.resolve()
  await nextTick()
}

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  setActivePinia(createPinia())
  fetchMock = vi.fn()
  vi.stubGlobal('$fetch', fetchMock)
  vi.stubGlobal('useRouter', () => ({ push: vi.fn() }))
  vi.stubGlobal('useMobile', () => ({
    isMobile: ref(false),
    closeDrawer: vi.fn(),
    closeSearchSheet: vi.fn(),
  }))
})

afterEach(() => {
  while (wrappers.length) wrappers.pop()?.unmount()
})

describe('全局搜索身份代际', () => {
  it('账号变化时仅清理并切换最近记录，旧响应隔离，显式 Enter 才搜索新账号', async () => {
    window.localStorage.setItem('favshub:global-search:searches:user-1', JSON.stringify(['账号一记录']))
    window.localStorage.setItem('favshub:global-search:searches:user-2', JSON.stringify(['账号二记录']))
    const auth = useAuthStore()
    auth.user = { id: 1, username: 'first' }
    auth.token = 'cookie_auth'
    const first = deferred<ReturnType<typeof searchResponse>>()
    const second = deferred<ReturnType<typeof searchResponse>>()
    fetchMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const search = mountSearch()

    search.open()
    expect(search.recentSearches.value).toEqual(['账号一记录'])
    search.query.value = 'Alpha'
    await nextTick()
    search.handleInputKeydown(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(fetchMock).toHaveBeenCalledTimes(1)

    auth.user = { id: 2, username: 'second' }

    expect(search.recentSearches.value).toEqual(['账号二记录'])
    expect(search.total.value).toBe(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true)

    first.resolve(searchResponse('账号一旧结果'))
    await settleResponse()
    expect(search.total.value).toBe(0)
    expect(search.loading.value).toBe(false)
    expect(search.errorMessage.value).toBe('')
    expect(JSON.parse(window.localStorage.getItem('favshub:global-search:searches:user-2') || '[]')).toEqual(['账号二记录'])

    search.handleInputKeydown(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    second.resolve(searchResponse('账号二新结果'))
    await settleResponse()
    expect(search.groups.value.collections.map(item => item.title)).toEqual(['账号二新结果'])
    expect(search.loading.value).toBe(false)
  })

  it('同账号 Token 变化时不自动重搜，旧错误和 finally 隔离，显式 Enter 才使用新 Token', async () => {
    const auth = useAuthStore()
    auth.user = { id: 1, username: 'same-user' }
    auth.token = 'token-a'
    const first = deferred<ReturnType<typeof searchResponse>>()
    const second = deferred<ReturnType<typeof searchResponse>>()
    fetchMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const search = mountSearch()
    await startSearch(search)

    auth.token = 'token-b'

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer token-a')
    expect(search.total.value).toBe(0)

    first.reject(new Error('旧 Token 请求失败'))
    await settleResponse()
    expect(search.errorMessage.value).toBe('')
    expect(search.loading.value).toBe(false)

    search.handleInputKeydown(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer token-b')
    second.resolve(searchResponse('新 Token 结果'))
    await settleResponse()
    expect(search.groups.value.collections.map(item => item.title)).toEqual(['新 Token 结果'])
    expect(search.loading.value).toBe(false)
  })

  it('真实 auth.logout 等待 Cookie 清理期间不发新搜索，旧私人响应不能落入游客态', async () => {
    const auth = useAuthStore()
    auth.user = { id: 1, username: 'logout-user' }
    auth.token = 'cookie_auth'
    const first = deferred<ReturnType<typeof privateBookmarkResponse>>()
    const logout = deferred<unknown>()
    const guest = deferred<ReturnType<typeof searchResponse>>()
    fetchMock
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(logout.promise)
      .mockReturnValueOnce(guest.promise)
    const search = mountSearch()
    await startSearch(search)
    const searchRequests = () => fetchMock.mock.calls.filter(call => call[0] === '/api/search')

    const logoutPromise = auth.logout()

    expect(auth.user).toBeNull()
    expect(auth.token).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][0]).toBe('/api/auth/logout')
    expect(fetchMock.mock.calls[1][1].method).toBe('POST')
    expect(searchRequests()).toHaveLength(1)
    expect(search.total.value).toBe(0)
    expect(search.loading.value).toBe(false)

    // The pending logout endpoint means the HttpOnly cookie has not been cleared yet.
    first.resolve(privateBookmarkResponse('Cookie 未清除时的私人结果'))
    await settleResponse()
    expect(search.total.value).toBe(0)
    expect(search.errorMessage.value).toBe('')
    expect(search.loading.value).toBe(false)
    expect(searchRequests()).toHaveLength(1)

    logout.resolve({ success: true })
    await logoutPromise
    await settleResponse()
    expect(searchRequests()).toHaveLength(1)

    search.handleInputKeydown(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(searchRequests()).toHaveLength(2)
    expect(searchRequests()[1][1].headers.Authorization).toBeUndefined()
    guest.resolve(searchResponse('游客公开结果'))
    await settleResponse()
    expect(search.groups.value.collections.map(item => item.title)).toEqual(['游客公开结果'])
    expect(search.groups.value.bookmarks).toEqual([])
  })
})

describe('全局搜索快捷键', () => {
  it.each(['ctrlKey', 'metaKey'])('%s+K 忽略 repeat，不会长按反复开关', (modifier) => {
    const search = mountSearch()
    const event = (repeat: boolean) => new KeyboardEvent('keydown', {
      key: 'k',
      repeat,
      [modifier]: true,
    })

    search.handleGlobalKeydown(event(false))
    expect(search.isOpen.value).toBe(true)
    search.handleGlobalKeydown(event(true))
    expect(search.isOpen.value).toBe(true)
    search.handleGlobalKeydown(event(false))
    expect(search.isOpen.value).toBe(false)
    search.handleGlobalKeydown(event(true))
    expect(search.isOpen.value).toBe(false)
  })
})

describe('全局搜索矮屏布局契约', () => {
  it('结果区可收缩滚动，移动端面板受 backdrop 内容高度约束', () => {
    const source = fs.readFileSync('components/search/GlobalSearch.vue', 'utf8')
    const baseResults = source.match(/\.gs-results\s*\{([^}]+)\}/)?.[1] || ''
    expect(baseResults).toMatch(/\bflex:\s*1\s*;/)
    expect(baseResults).toMatch(/\bmin-height:\s*0\s*;/)
    expect(baseResults).toMatch(/\boverflow-y:\s*auto\s*;/)

    const mobileStart = source.indexOf('@media (max-width: 640px)')
    const mobileEnd = source.indexOf('@media (prefers-reduced-motion: reduce)')
    const mobile = source.slice(mobileStart, mobileEnd)
    const panel = mobile.match(/\.gs-panel\s*\{([^}]+)\}/)?.[1] || ''
    const results = mobile.match(/\.gs-results\s*\{([^}]+)\}/)?.[1] || ''
    expect(panel).toMatch(/\bmax-height:\s*100%\s*;/)
    expect(panel).not.toMatch(/\bmax-height:\s*none\s*;/)
    expect(results).not.toMatch(/\bmin-height\s*:/)
  })
})
