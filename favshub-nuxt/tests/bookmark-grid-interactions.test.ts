import fs from 'node:fs'
import Database from 'better-sqlite3'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BookmarkGrid from '../components/bookmark/BookmarkGrid.vue'
import { createHomeCollectionLoader } from '../pages/index.vue'
import { useBookmarksStore, type Bookmark } from '../stores/bookmarks'
import { useAuthStore } from '../stores/auth'

let reorderDb: Database.Database | null = null
vi.mock('../server/database', () => ({ getRawDb: () => reorderDb }))
vi.mock('../server/utils/auth', () => ({ requireAuth: () => ({ id: 7 }) }))

const sortableMock = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('sortablejs', () => ({ default: { create: sortableMock.create } }))

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

type CreatedSortable = {
  element: HTMLElement
  options: { onEnd: (event: { from: HTMLElement }) => void }
  destroy: ReturnType<typeof vi.fn>
}
const created: CreatedSortable[] = []
const wrappers: VueWrapper[] = []

function bookmark(id: number, sortOrder: number) {
  return {
    id,
    title: `Bookmark ${id}`,
    url: `https://example.com/${id}`,
    folder_id: null,
    sort_order: sortOrder,
    user_id: 1,
  }
}

function mountGrid() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useBookmarksStore()
  vi.stubGlobal('useBookmarksStore', useBookmarksStore)
  const wrapper = mount(BookmarkGrid, {
    attachTo: document.body,
    props: {
      bookmarks: [bookmark(1, 0), bookmark(2, 1)],
      folders: [],
      isGuest: false,
    },
    global: { plugins: [pinia] },
  })
  wrappers.push(wrapper)
  return { wrapper, store }
}

async function waitForCreateCount(count: number) {
  await vi.waitFor(() => expect(sortableMock.create).toHaveBeenCalledTimes(count))
}

beforeEach(() => {
  created.length = 0
  sortableMock.create.mockImplementation((element: HTMLElement, options: CreatedSortable['options']) => {
    const instance = { element, options, destroy: vi.fn() }
    created.push(instance)
    return instance
  })
})

afterEach(() => {
  while (wrappers.length) wrappers.pop()?.unmount()
  sortableMock.create.mockReset()
  reorderDb?.close()
  reorderDb = null
})

describe('BookmarkGrid Sortable', () => {
  it('onEnd 只按当前 grid 的直接子卡片生成顺序并 emit reorder', async () => {
    const { wrapper } = mountGrid()
    await waitForCreateCount(1)

    const instance = created[0]
    const grid = instance.element
    const cards = Array.from(grid.children).filter(el => el.classList.contains('bookmark-card'))
    grid.insertBefore(cards[1], cards[0])

    const nested = document.createElement('div')
    nested.innerHTML = '<article class="bookmark-card" data-id="99"></article>'
    grid.append(nested)
    const addButton = document.createElement('button')
    addButton.className = 'add-bookmark-card'
    grid.append(addButton)

    instance.options.onEnd({ from: grid })
    expect(wrapper.emitted('reorder')).toEqual([[[
      { id: 2, sort_order: 0 },
      { id: 1, sort_order: 1 },
    ]]])
  })

  it('collection/游客禁用并销毁，回到个人视图可重建，过期回调不提交', async () => {
    const { wrapper, store } = mountGrid()
    await waitForCreateCount(1)
    const personal = created[0]

    store.setCurrentCollection('collection-a')
    await nextTick()
    expect(personal.destroy).toHaveBeenCalledTimes(1)
    await Promise.resolve()
    expect(sortableMock.create).toHaveBeenCalledTimes(1)

    personal.options.onEnd({ from: personal.element })
    expect(wrapper.emitted('reorder')).toBeUndefined()

    store.setCurrentCollection(null)
    await waitForCreateCount(2)
    const rebuilt = created[1]
    expect(rebuilt.element.isConnected).toBe(true)

    await wrapper.setProps({ isGuest: true })
    expect(rebuilt.destroy).toHaveBeenCalledTimes(1)
    await Promise.resolve()
    expect(sortableMock.create).toHaveBeenCalledTimes(2)

    await wrapper.setProps({ isGuest: false })
    await waitForCreateCount(3)
  })
})

// 直接解析生产 CSS 变量，避免把硬编码的“预期颜色”当成主题证据。
type CssRule = { selectors: string[]; declarations: Record<string, string> }
const emptyStateSelectors = new Set([
  '.bookmarks-empty',
  '.add-first-btn',
  '.add-first-btn:hover',
  '.add-first-btn:focus-visible',
])
function cssRules(source: string): CssRule[] {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const rules: CssRule[] = []
  for (const match of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1].split(',').map(value => value.trim()).filter(value => value === ':root' || value.startsWith('html[data-theme') || emptyStateSelectors.has(value))
    if (!selectors.length) continue
    const declarations: Record<string, string> = {}
    for (const entry of match[2].split(';')) {
      const colon = entry.indexOf(':')
      if (colon < 0) continue
      const name = entry.slice(0, colon).trim()
      if (name.startsWith('--') || selectors.some(selector => emptyStateSelectors.has(selector))) {
        declarations[name] = entry.slice(colon + 1).trim()
      }
    }
    rules.push({ selectors, declarations })
  }
  return rules
}

const productionRules = cssRules(
  fs.readFileSync('public/css/tokens.css', 'utf8')
  + fs.readFileSync('public/css/themes.css', 'utf8'),
)
const emptyStateRules = cssRules(fs.readFileSync('public/css/main-bundle.css', 'utf8'))
function cssDeclaration(rules: CssRule[], selector: string, name: string): string {
  const rule = rules.find(candidate => candidate.selectors.includes(selector))
  const value = rule?.declarations[name]
  if (!value) throw new Error(`缺少生产 CSS 声明: ${selector} { ${name} }`)
  return value
}

function themeVariables(mode: 'light' | 'dark', themeClass: string) {
  const accepted = new Set([
    ':root',
    `html[data-theme="${mode}"]`,
    `html[data-theme="${mode}"].${themeClass}`,
  ])
  const declarations: Record<string, string> = {}
  for (const rule of productionRules) {
    if (rule.selectors.some(selector => accepted.has(selector))) Object.assign(declarations, rule.declarations)
  }
  const resolving = new Set<string>()
  function resolve(name: string): string {
    if (resolving.has(name)) throw new Error(`CSS 变量循环: ${name}`)
    resolving.add(name)
    let value = declarations[name]
    if (!value) throw new Error(`缺少 CSS 变量: ${name}`)
    if (value.startsWith('light-dark(')) {
      const inner = value.slice('light-dark('.length, -1)
      let depth = 0
      let split = -1
      for (let index = 0; index < inner.length; index++) {
        if (inner[index] === '(') depth++
        else if (inner[index] === ')') depth--
        else if (inner[index] === ',' && depth === 0) { split = index; break }
      }
      if (split < 0 || !value.endsWith(')')) throw new Error(`无法解析 light-dark: ${value}`)
      value = (mode === 'light' ? inner.slice(0, split) : inner.slice(split + 1)).trim()
    }
    value = value.replace(/var\((--[\w-]+)\)/g, (_, dependency: string) => resolve(dependency))
    resolving.delete(name)
    return value
  }
  return resolve
}

type Rgba = { r: number; g: number; b: number; a: number }
function parseColor(value: string): Rgba {
  const hex = value.match(/^#([\da-f]{6})$/i)
  if (hex) {
    const [r, g, b] = hex[1].match(/../g)!.map(channel => Number.parseInt(channel, 16))
    return { r, g, b, a: 1 }
  }
  const rgba = value.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i)
  if (rgba) return { r: Number(rgba[1]), g: Number(rgba[2]), b: Number(rgba[3]), a: rgba[4] == null ? 1 : Number(rgba[4]) }
  throw new Error(`不是可计算的颜色: ${value}`)
}
function over(foreground: Rgba, background: Rgba): Rgba {
  const a = foreground.a + background.a * (1 - foreground.a)
  const channel = (front: number, back: number) => (front * foreground.a + back * background.a * (1 - foreground.a)) / a
  return {
    r: channel(foreground.r, background.r),
    g: channel(foreground.g, background.g),
    b: channel(foreground.b, background.b),
    a,
  }
}
function luminance(value: string | Rgba) {
  const color = typeof value === 'string' ? parseColor(value) : value
  const channels = [color.r, color.g, color.b].map(channel => channel / 255)
    .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
}
function contrast(foreground: string | Rgba, background: string | Rgba) {
  const a = luminance(foreground)
  const b = luminance(background)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

describe('书签控件主题语义色', () => {
  const themes = [
    ['light', 'theme-bg-1', '薄雾灰'],
    ['light', 'theme-bg-4', '薄荷绿'],
    ['light', 'theme-bg-6', '淡藤紫'],
    ['light', 'theme-bg-7', '暖灰白'],
    ['light', 'theme-bg-tian-qing', '天青'],
    ['light', 'theme-bg-hu-po', '琥珀'],
    ['light', 'theme-bg-na-tie', '霜华'],
    ['dark', 'theme-bg-mo-ye', '墨夜'],
    ['dark', 'theme-bg-xing-yun', '星云'],
    ['dark', 'theme-bg-ji-guang', '极光'],
    ['dark', 'theme-bg-zi-teng', '紫藤'],
  ] as const

  it('11 主题真实 toolbar、hover 与 selected:hover 的文字/焦点对比度均达 AA', () => {
    let minimumText = Number.POSITIVE_INFINITY
    let minimumFocus = Number.POSITIVE_INFINITY
    let minimumDensityText = Number.POSITIVE_INFINITY
    let minimumHoverText = Number.POSITIVE_INFINITY
    let minimumToolbarText = Number.POSITIVE_INFINITY
    for (const [mode, themeClass, name] of themes) {
      const variable = themeVariables(mode, themeClass)
      const accent = variable('--control-accent')
      const focus = variable('--focus-ring')
      for (const surface of ['--surface-raised', '--surface-sunken'] as const) {
        const background = variable(surface)
        const textRatio = contrast(accent, background)
        const focusRatio = contrast(focus, background)
        minimumText = Math.min(minimumText, textRatio)
        minimumFocus = Math.min(minimumFocus, focusRatio)
        expect(textRatio, `${name} ${accent} / ${surface} ${background}`).toBeGreaterThanOrEqual(4.5)
        expect(focusRatio, `${name} ${focus} / ${surface} ${background}`).toBeGreaterThanOrEqual(3)
      }

      // .grid-toolbar 实际是 94% raised 叠加 main 的 surface；不是假定为纯 raised。
      const toolbar = over(
        { ...parseColor(variable('--surface-raised')), a: 0.94 },
        parseColor(variable('--surface')),
      )
      const toolbarTextRatio = contrast(variable('--text-primary'), toolbar)
      const toolbarFocusRatio = contrast(focus, toolbar)
      minimumToolbarText = Math.min(minimumToolbarText, toolbarTextRatio)
      minimumFocus = Math.min(minimumFocus, toolbarFocusRatio)
      expect(toolbarTextRatio, `${name} toolbar 默认文字`).toBeGreaterThanOrEqual(4.5)
      expect(toolbarFocusRatio, `${name} toolbar 焦点`).toBeGreaterThanOrEqual(3)

      const densitySurface = mode === 'light' ? '--surface-raised' : '--surface-sunken'
      const densityRatio = contrast(variable('--text-secondary'), variable(densitySurface))
      minimumDensityText = Math.min(minimumDensityText, densityRatio)
      expect(densityRatio, `${name} 密度按钮默认文字 / ${densitySurface}`).toBeGreaterThanOrEqual(4.5)

      const hover = parseColor(variable('--control-hover-bg'))
      expect(hover.a, `${name} control-hover-bg 必须不透明`).toBe(1)
      // 普通 hover 与 aria-pressed=true 的 selected:hover 均按真实生产 selector 枚举。
      for (const state of ['.category-index-link:hover', '.density-toggle:hover', '.density-toggle[aria-pressed="true"]:hover'] as const) {
        const actualHover = over(hover, toolbar)
        const hoverTextRatio = contrast(accent, actualHover)
        const hoverFocusRatio = contrast(focus, actualHover)
        minimumHoverText = Math.min(minimumHoverText, hoverTextRatio)
        minimumFocus = Math.min(minimumFocus, hoverFocusRatio)
        expect(hoverTextRatio, `${name} ${state} accent / 真实叠底`).toBeGreaterThanOrEqual(4.5)
        expect(hoverFocusRatio, `${name} ${state} focus / 真实叠底`).toBeGreaterThanOrEqual(3)
      }
    }
    console.log(`11 主题实测最低对比度：accent ${minimumText.toFixed(2)}，hover ${minimumHoverText.toFixed(2)}，toolbar文字 ${minimumToolbarText.toFixed(2)}，焦点 ${minimumFocus.toFixed(2)}，密度默认文字 ${minimumDensityText.toFixed(2)}`)
  })

  it('实测默认空态与 11 主题添加按钮 normal/hover、焦点均达 AA', () => {
    // 先锁定生产 selector 实际引用的语义变量，再计算真实主题颜色，防止浅绿底白字回归。
    expect(cssDeclaration(emptyStateRules, '.bookmarks-empty', 'color')).toBe('var(--text-secondary)')
    expect(cssDeclaration(emptyStateRules, '.add-first-btn', 'color')).toBe('var(--text-inverse)')
    expect(cssDeclaration(emptyStateRules, '.add-first-btn', 'background')).toBe('var(--control-accent)')
    expect(cssDeclaration(emptyStateRules, '.add-first-btn:hover', 'background')).toBe('var(--control-accent)')
    expect(cssDeclaration(emptyStateRules, '.add-first-btn:focus-visible', 'outline')).toBe('2px solid var(--focus-ring)')

    // Lighthouse 报告使用默认暖灰白；空态按同一实际 main/surface 背景复算。
    const defaultVariable = themeVariables('light', 'theme-bg-7')
    const emptyTextRatio = contrast(defaultVariable('--text-secondary'), defaultVariable('--surface'))
    expect(emptyTextRatio, '默认暖灰白空态文字').toBeGreaterThanOrEqual(4.5)

    let minimumButtonText = Number.POSITIVE_INFINITY
    let minimumFocus = Number.POSITIVE_INFINITY
    for (const [mode, themeClass, name] of themes) {
      const variable = themeVariables(mode, themeClass)
      const surface = variable('--surface')
      const accent = variable('--control-accent')
      const buttonTextRatio = contrast(variable('--text-inverse'), accent)
      const focusRatio = contrast(variable('--focus-ring'), surface)
      minimumButtonText = Math.min(minimumButtonText, buttonTextRatio)
      minimumFocus = Math.min(minimumFocus, focusRatio)
      expect(buttonTextRatio, `${name} 添加按钮 normal/hover 文字`).toBeGreaterThanOrEqual(4.5)
      expect(focusRatio, `${name} 添加按钮焦点`).toBeGreaterThanOrEqual(3)
    }
    console.log(`空态与按钮实测最低对比度：默认空态文字 ${emptyTextRatio.toFixed(2)}，11 主题按钮 ${minimumButtonText.toFixed(2)}，焦点 ${minimumFocus.toFixed(2)}`)
  })
})

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function storedBookmark(id: number, sortOrder: number): Bookmark {
  return {
    id, user_id: 7, title: `Bookmark ${id}`, url: `https://example.com/${id}`,
    folder_id: 42, icon: null, sort_order: sortOrder,
    container: '', source: '[]', login_required: 1,
  }
}

function setupReorderStore() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const auth = useAuthStore()
  auth.token = 'cookie_auth'
  auth.user = { id: 7, username: 'queue-user' }
  const store = useBookmarksStore()
  store.bookmarks = [storedBookmark(1, 0), storedBookmark(2, 1)]
  return store
}

describe('书签排序服务端与串行队列', () => {
  it('reorder 兼容旧 payload 但只改 sort_order，真实 SQLite 保留 folder_id', async () => {
    reorderDb = new Database(':memory:')
    reorderDb.exec(`
      CREATE TABLE bookmarks (
        id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, folder_id INTEGER,
        sort_order INTEGER NOT NULL DEFAULT 0, updated_at INTEGER
      );
      INSERT INTO bookmarks VALUES (1, 7, 42, 0, 0), (2, 7, 42, 1, 0), (3, 8, 99, 4, 0);
    `)
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('readBody', vi.fn().mockResolvedValue({ items: [
      { id: 1, sort_order: 2, folder_id: null },
      { id: 2, sort_order: 3 },
      { id: 3, sort_order: 8, folder_id: null },
    ] }))
    vi.stubGlobal('createError', (input: Record<string, unknown>) => Object.assign(new Error('reorder error'), input))
    const { default: handler } = await import('../server/api/bookmarks/reorder.put')

    await handler({} as never)
    expect(reorderDb.prepare('SELECT id, folder_id, sort_order FROM bookmarks ORDER BY id').all()).toEqual([
      { id: 1, folder_id: 42, sort_order: 2 },
      { id: 2, folder_id: 42, sort_order: 3 },
      { id: 3, folder_id: 99, sort_order: 4 },
    ])
  })

  it('deferred A 未完成时 B 不发送，双成功后 server 与 VM 最终均为 B', async () => {
    const store = setupReorderStore()
    const serverOrders = new Map(store.bookmarks.map(item => [item.id, item.sort_order]))
    const requests: Array<{ items: Array<{ id: number; sort_order: number }>; pending: ReturnType<typeof deferred<{ success: boolean }>> }> = []
    const fetchMock = vi.fn().mockImplementation((url: string, options?: { body?: { items: Array<{ id: number; sort_order: number }> } }) => {
      expect(url).toBe('/api/bookmarks/reorder')
      const pending = deferred<{ success: boolean }>()
      const items = options?.body?.items || []
      requests.push({ items, pending })
      return pending.promise.then(result => {
        for (const item of items) serverOrders.set(item.id, item.sort_order)
        return result
      })
    })
    vi.stubGlobal('$fetch', fetchMock)

    const aItems = [{ id: 2, sort_order: 0 }, { id: 1, sort_order: 1 }]
    const bItems = [{ id: 1, sort_order: 0 }, { id: 2, sort_order: 1 }]
    const a = store.reorderBookmarks(aItems)
    const b = store.reorderBookmarks(bItems)
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    expect(fetchMock).toHaveBeenCalledTimes(1)

    requests[0]!.pending.resolve({ success: true })
    await vi.waitFor(() => expect(requests).toHaveLength(2))
    expect(requests[1]!.items).toEqual(bItems)
    requests[1]!.pending.resolve({ success: true })
    await Promise.all([a, b])

    expect(requests.map(request => request.items)).toEqual([aItems, bItems])
    expect(store.bookmarks.map(item => [item.id, item.sort_order])).toEqual([[1, 0], [2, 1]])
    expect([...serverOrders.entries()]).toEqual([[1, 0], [2, 1]])
  })

  it('A reject 后先在同队列完成 refetch 回滚，再发送 B 且只回滚一次', async () => {
    const store = setupReorderStore()
    const aRequest = deferred<{ success: boolean }>()
    const rollback = deferred<{ bookmarks: Bookmark[]; folders: [] }>()
    const bRequest = deferred<{ success: boolean }>()
    const putItems: Array<Array<{ id: number; sort_order: number }>> = []
    let getCount = 0
    const fetchMock = vi.fn().mockImplementation((url: string, options?: { body?: { items: Array<{ id: number; sort_order: number }> } }) => {
      if (url === '/api/bookmarks') {
        getCount++
        return rollback.promise
      }
      expect(url).toBe('/api/bookmarks/reorder')
      putItems.push(options?.body?.items || [])
      return putItems.length === 1 ? aRequest.promise : bRequest.promise
    })
    vi.stubGlobal('$fetch', fetchMock)

    const aItems = [{ id: 2, sort_order: 0 }, { id: 1, sort_order: 1 }]
    const bItems = [{ id: 1, sort_order: 0 }, { id: 2, sort_order: 1 }]
    const a = store.reorderBookmarks(aItems)
    const aRejection = expect(a).rejects.toThrow('A failed')
    const b = store.reorderBookmarks(bItems)
    await vi.waitFor(() => expect(putItems).toHaveLength(1))
    aRequest.reject(new Error('A failed'))

    await vi.waitFor(() => expect(getCount).toBe(1))
    expect(putItems).toHaveLength(1)
    rollback.resolve({ bookmarks: [storedBookmark(1, 0), storedBookmark(2, 1)], folders: [] })
    await vi.waitFor(() => expect(putItems).toHaveLength(2))
    await aRejection
    expect(putItems[1]).toEqual(bItems)

    bRequest.resolve({ success: true })
    await b
    expect(getCount).toBe(1)
    expect(store.bookmarks.map(item => [item.id, item.sort_order])).toEqual([[1, 0], [2, 1]])
  })
})

function collectionResponse(id: string) {
  return {
    collection: { id, name: `Collection ${id}` },
    categories: [{ id: 1, name: `Category ${id}`, parent_id: null }],
    bookmarks: [{ id: `${id}-bookmark`, category_id: 1, title: `Bookmark ${id}` }],
  }
}

describe('精选集乱序请求隔离', () => {
  it.each(['success', 'failure'] as const)('A→mine 后旧 A %s 不得覆盖或清空个人视图', async outcome => {
    const store = setupReorderStore()
    const loader = createHomeCollectionLoader(store)
    const a = deferred<ReturnType<typeof collectionResponse>>()
    const mine = { bookmarks: [storedBookmark(9, 0)], folders: [] }
    vi.stubGlobal('$fetch', vi.fn().mockImplementation((url: string) => {
      if (url === '/api/collections/A') return a.promise
      if (url === '/api/bookmarks') return Promise.resolve(mine)
      throw new Error(`unexpected request: ${url}`)
    }))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const aLoad = loader.load('A')
      await vi.waitFor(() => expect(store.isLoading).toBe(true))
      await loader.loadMine()

      // 用引用断言同时覆盖旧成功覆盖与旧 catch 清空两条路径。
      const currentData = { collection: { id: 'mine-marker' }, categories: [], bookmarks: [] }
      const currentCategories = [{ id: 9, name: 'Mine category' }]
      const currentBookmarks = [{ id: 'mine-bookmark' }]
      store.collectionData = currentData
      store.collectionCategories = currentCategories
      store.collectionBookmarks = currentBookmarks
      const currentDataRef = store.collectionData
      const currentCategoriesRef = store.collectionCategories
      const currentBookmarksRef = store.collectionBookmarks

      if (outcome === 'success') a.resolve(collectionResponse('A'))
      else a.reject(new Error('stale A failed'))
      await aLoad

      expect(store.viewMode).toBe('mine')
      expect(store.currentCollectionId).toBeNull()
      expect(store.bookmarks).toEqual(mine.bookmarks)
      expect(store.collectionData).toBe(currentDataRef)
      expect(store.collectionCategories).toBe(currentCategoriesRef)
      expect(store.collectionBookmarks).toBe(currentBookmarksRef)
      expect(store.isLoading).toBe(false)
    } finally {
      errorSpy.mockRestore()
    }
  })

  it.each(['success', 'failure'] as const)('A→B 后旧 A %s 不得覆盖或清空已提交的 B', async outcome => {
    const store = setupReorderStore()
    const loader = createHomeCollectionLoader(store)
    const a = deferred<ReturnType<typeof collectionResponse>>()
    const b = deferred<ReturnType<typeof collectionResponse>>()
    vi.stubGlobal('$fetch', vi.fn().mockImplementation((url: string) => {
      if (url === '/api/collections/A') return a.promise
      if (url === '/api/collections/B') return b.promise
      throw new Error(`unexpected request: ${url}`)
    }))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const aLoad = loader.load('A')
      const bLoad = loader.load('B')
      b.resolve(collectionResponse('B'))
      await bLoad

      const bData = store.collectionData
      const bCategories = store.collectionCategories
      const bBookmarks = store.collectionBookmarks
      expect(store.viewMode).toBe('collection')
      expect(store.currentCollectionId).toBe('B')
      expect(bData?.collection.id).toBe('B')

      if (outcome === 'success') a.resolve(collectionResponse('A'))
      else a.reject(new Error('stale A failed'))
      await aLoad

      expect(store.currentCollectionId).toBe('B')
      expect(store.viewMode).toBe('collection')
      expect(store.collectionData).toBe(bData)
      expect(store.collectionCategories).toBe(bCategories)
      expect(store.collectionBookmarks).toBe(bBookmarks)
      expect(store.isLoading).toBe(false)
    } finally {
      errorSpy.mockRestore()
    }
  })
})
