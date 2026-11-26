import { useAuthStore } from '~/stores/auth'

export type GlobalSearchType = 'bookmark' | 'collection' | 'prompt' | 'token'
export type GlobalSearchGroup = 'bookmarks' | 'collections' | 'prompts' | 'tokens'

export interface GlobalSearchResult {
  id: string
  type: GlobalSearchType
  title: string
  subtitle: string
  url: string
  external: boolean
  personal: boolean
}

interface RecentVisit extends GlobalSearchResult {
  visitedAt: number
}

interface SearchResponse {
  query: string
  limit: number
  total: number
  groups: Record<GlobalSearchGroup, GlobalSearchResult[]>
}

export interface GlobalSearchQuickLink {
  title: string
  subtitle: string
  url: string
  icon: string
}

const GROUP_ORDER: GlobalSearchGroup[] = ['bookmarks', 'collections', 'prompts', 'tokens']
const TYPE_BY_GROUP: Record<GlobalSearchGroup, GlobalSearchType> = {
  bookmarks: 'bookmark',
  collections: 'collection',
  prompts: 'prompt',
  tokens: 'token',
}
const MAX_QUERY_LENGTH = 80
const RECENT_LIMIT = 8
const DEBOUNCE_MS = 280

const quickLinks: GlobalSearchQuickLink[] = [
  { title: '书签首页', subtitle: '浏览个人书签与文件夹', url: '/', icon: 'ri-bookmark-3-line' },
  { title: '公开精选集', subtitle: '发现可订阅的书签合集', url: '/collections', icon: 'ri-book-2-line' },
  { title: 'PromptPro 提示词库', subtitle: '浏览可见提示词', url: '/prompts', icon: 'ri-chat-3-line' },
  { title: 'Token 白嫖通告', subtitle: '查看免费额度与活动情报', url: '/tokens', icon: 'ri-gift-' + '2-line' },
  { title: '福利 Key', subtitle: '查看公开脱敏的福利资源', url: '/tokens/keys', icon: 'ri-key-2-line' },
]

function emptyGroups(): Record<GlobalSearchGroup, GlobalSearchResult[]> {
  return { bookmarks: [], collections: [], prompts: [], tokens: [] }
}

function safeUrl(value: unknown, external: boolean): string {
  const url = String(value ?? '').trim()
  if (!url || /[\u0000-\u001f\u007f]/.test(url)) return ''

  if (!external) {
    return url.startsWith('/') && !url.startsWith('//') && !url.includes('\\') ? url : ''
  }

  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol)) return ''
    if (parsed.username || parsed.password) return ''
    return parsed.toString()
  } catch {
    return ''
  }
}

function sanitizeResult(value: unknown, expectedType?: GlobalSearchType): GlobalSearchResult | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  const type = String(item.type || '') as GlobalSearchType
  if (!Object.values(TYPE_BY_GROUP).includes(type)) return null
  if (expectedType && type !== expectedType) return null

  const external = type === 'bookmark' && item.external === true
  const url = safeUrl(item.url, external)
  const id = String(item.id ?? '').trim()
  const title = String(item.title ?? '').trim()
  if (!id || !title || !url) return null

  return {
    id: Array.from(id).slice(0, 160).join(''),
    type,
    title: Array.from(title).slice(0, 160).join(''),
    subtitle: Array.from(String(item.subtitle ?? '').trim()).slice(0, 240).join(''),
    url,
    external,
    personal: item.personal === true,
  }
}

export function useGlobalSearch() {
  const router = useRouter()
  const authStore = useAuthStore()
  const { isMobile, closeDrawer, closeSearchSheet } = useMobile()

  const isOpen = ref(false)
  const query = ref('')
  const groups = ref<Record<GlobalSearchGroup, GlobalSearchResult[]>>(emptyGroups())
  const loading = ref(false)
  const errorMessage = ref('')
  const activeIndex = ref(-1)
  const recentSearches = ref<string[]>([])
  const recentVisits = ref<RecentVisit[]>([])

  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let abortController: AbortController | null = null
  let requestSequence = 0
  let identityGeneration = 0

  const storageNamespace = computed(() => authStore.user?.id ? `user-${authStore.user.id}` : 'guest')
  const flatResults = computed(() => GROUP_ORDER.flatMap(group => groups.value[group]))
  const total = computed(() => flatResults.value.length)
  const hasResults = computed(() => total.value > 0)
  const normalizedQuery = computed(() => query.value.replace(/\s+/g, ' ').trim())
  const noResults = computed(() => (
    !!normalizedQuery.value && !loading.value && !errorMessage.value && !hasResults.value
  ))
  const activeResult = computed(() => flatResults.value[activeIndex.value] || null)
  const activeDescendantId = computed(() => (
    activeResult.value ? `global-search-option-${activeIndex.value}` : undefined
  ))

  function storageKey(kind: 'searches' | 'visits'): string {
    return `favshub:global-search:${kind}:${storageNamespace.value}`
  }

  function loadRecentSearches() {
    if (!import.meta.client) return
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey('searches')) || '[]')
      recentSearches.value = Array.isArray(parsed)
        ? parsed
            .filter((item): item is string => typeof item === 'string')
            .map(item => item.replace(/\s+/g, ' ').trim())
            .filter(item => item && Array.from(item).length <= MAX_QUERY_LENGTH)
            .slice(0, RECENT_LIMIT)
        : []
    } catch {
      recentSearches.value = []
    }
  }

  function loadRecentVisits() {
    if (!import.meta.client) return
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey('visits')) || '[]')
      recentVisits.value = Array.isArray(parsed)
        ? parsed.map(item => {
            const result = sanitizeResult(item)
            if (!result) return null
            return {
              ...result,
              visitedAt: Number((item as Record<string, unknown>).visitedAt) || 0,
            }
          }).filter((item): item is RecentVisit => !!item).slice(0, RECENT_LIMIT)
        : []
    } catch {
      recentVisits.value = []
    }
  }

  function loadRecents() {
    loadRecentSearches()
    loadRecentVisits()
  }

  function writeStorage(kind: 'searches' | 'visits', value: unknown) {
    if (!import.meta.client) return
    try {
      localStorage.setItem(storageKey(kind), JSON.stringify(value))
    } catch {
      // Storage can be unavailable in private browsing; search remains functional.
    }
  }

  function rememberSearch(value: string) {
    const term = value.replace(/\s+/g, ' ').trim()
    if (!term || Array.from(term).length > MAX_QUERY_LENGTH) return
    recentSearches.value = [term, ...recentSearches.value.filter(item => item !== term)].slice(0, RECENT_LIMIT)
    writeStorage('searches', recentSearches.value)
  }

  function rememberVisit(result: GlobalSearchResult) {
    const visit: RecentVisit = { ...result, visitedAt: Date.now() }
    recentVisits.value = [
      visit,
      ...recentVisits.value.filter(item => !(item.type === result.type && item.id === result.id)),
    ].slice(0, RECENT_LIMIT)
    writeStorage('visits', recentVisits.value)
  }

  function cancelPendingSearch() {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = null
    abortController?.abort()
    abortController = null
    requestSequence += 1
    loading.value = false
  }

  function clearResults() {
    groups.value = emptyGroups()
    errorMessage.value = ''
    activeIndex.value = -1
  }

  async function runSearch(remember = false) {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = null
    const q = normalizedQuery.value
    if (!q) {
      cancelPendingSearch()
      clearResults()
      return
    }
    if (Array.from(q).length > MAX_QUERY_LENGTH) {
      errorMessage.value = `搜索关键词不能超过 ${MAX_QUERY_LENGTH} 个字符`
      return
    }

    abortController?.abort()
    const controller = new AbortController()
    abortController = controller
    const sequence = ++requestSequence
    const generation = identityGeneration
    const tokenSnapshot = authStore.token
    const requestIsCurrent = () => (
      sequence === requestSequence
      && generation === identityGeneration
      && tokenSnapshot === authStore.token
    )
    loading.value = true
    errorMessage.value = ''

    const headers: Record<string, string> = {}
    if (tokenSnapshot && tokenSnapshot !== 'cookie_auth') {
      headers.Authorization = `Bearer ${tokenSnapshot}`
    }

    try {
      const response = await $fetch<SearchResponse>('/api/search', {
        query: { q, limit: 6 },
        headers,
        credentials: 'include',
        signal: controller.signal,
      })
      if (!requestIsCurrent()) return

      const nextGroups = emptyGroups()
      for (const group of GROUP_ORDER) {
        const rows = response?.groups?.[group]
        nextGroups[group] = Array.isArray(rows)
          ? rows.map(row => sanitizeResult(row, TYPE_BY_GROUP[group]))
              .filter((row): row is GlobalSearchResult => !!row)
              .slice(0, 6)
          : []
      }
      groups.value = nextGroups
      activeIndex.value = flatResults.value.length ? 0 : -1
      if (remember) rememberSearch(q)
    } catch (err: any) {
      if (!requestIsCurrent() || err?.name === 'AbortError') return
      groups.value = emptyGroups()
      activeIndex.value = -1
      const status = Number(err?.statusCode || err?.response?.status || 0)
      errorMessage.value = status === 400
        ? String(err?.data?.error || '搜索参数不正确')
        : '搜索暂时不可用，请稍后重试'
    } finally {
      if (requestIsCurrent()) {
        loading.value = false
        abortController = null
      }
    }
  }

  function scheduleSearch() {
    cancelPendingSearch()
    clearResults()
    if (!normalizedQuery.value) return
    loading.value = true
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      void runSearch()
    }, DEBOUNCE_MS)
  }

  function open() {
    closeDrawer()
    closeSearchSheet()
    cancelPendingSearch()
    query.value = ''
    clearResults()
    loadRecents()
    isOpen.value = true
  }

  function close() {
    isOpen.value = false
    cancelPendingSearch()
    query.value = ''
    clearResults()
  }

  function applyRecentSearch(term: string) {
    rememberSearch(term)
    query.value = term
  }

  function clearRecentSearches() {
    recentSearches.value = []
    writeStorage('searches', [])
  }

  function clearRecentVisits() {
    recentVisits.value = []
    writeStorage('visits', [])
  }

  function moveSelection(direction: 1 | -1) {
    const count = flatResults.value.length
    if (!count) return
    activeIndex.value = activeIndex.value < 0
      ? (direction === 1 ? 0 : count - 1)
      : (activeIndex.value + direction + count) % count
  }

  async function selectResult(result: GlobalSearchResult) {
    const safeResult = sanitizeResult(result)
    if (!safeResult) return
    rememberVisit(safeResult)
    if (normalizedQuery.value) rememberSearch(normalizedQuery.value)
    close()

    if (safeResult.external) {
      if (isMobile.value) {
        window.location.assign(safeResult.url)
      } else {
        window.open(safeResult.url, '_blank', 'noopener,noreferrer')
      }
      return
    }
    await router.push(safeResult.url)
  }

  async function openQuickLink(link: GlobalSearchQuickLink) {
    close()
    await router.push(link.url)
  }

  function handleInputKeydown(event: KeyboardEvent) {
    if (event.isComposing) return
    if (event.key === 'ArrowDown') {
      if (hasResults.value) {
        event.preventDefault()
        moveSelection(1)
      }
    } else if (event.key === 'ArrowUp') {
      if (hasResults.value) {
        event.preventDefault()
        moveSelection(-1)
      }
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (activeResult.value) {
        void selectResult(activeResult.value)
      } else if (normalizedQuery.value) {
        rememberSearch(normalizedQuery.value)
        void runSearch(true)
      }
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
    }
  }

  function handleGlobalKeydown(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault()
      event.stopPropagation()
      if (event.repeat) return
      if (isOpen.value) close()
      else open()
      return
    }
    if (event.key === 'Escape' && isOpen.value) {
      event.preventDefault()
      event.stopPropagation()
      close()
    }
  }

  watch(query, scheduleSearch)
  watch([storageNamespace, () => authStore.token], () => {
    identityGeneration += 1
    cancelPendingSearch()
    clearResults()
    loadRecents()
    // Cookie clearing is asynchronous during logout; wait for explicit input before searching again.
  }, { flush: 'sync' })
  watch(activeIndex, () => {
    if (!import.meta.client || activeIndex.value < 0) return
    nextTick(() => {
      document.getElementById(`global-search-option-${activeIndex.value}`)
        ?.scrollIntoView({ block: 'nearest' })
    })
  })

  onBeforeUnmount(() => {
    cancelPendingSearch()
  })

  return {
    isOpen,
    query,
    groups,
    loading,
    errorMessage,
    activeIndex,
    activeDescendantId,
    recentSearches,
    recentVisits,
    total,
    hasResults,
    noResults,
    quickLinks,
    open,
    close,
    applyRecentSearch,
    clearRecentSearches,
    clearRecentVisits,
    selectResult,
    openQuickLink,
    handleInputKeydown,
    handleGlobalKeydown,
  }
}
