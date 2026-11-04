/**
 * Deal favorites composable — 通告收藏（本地）
 *
 * 与 useMobile 同款思路：**模块级单例 state**，所有调用方共享同一份 `ref`，
 * 因而任意组件里 toggle 一次，其它组件的徽标/筛选立即同步（跨组件响应式）。
 *
 * SSR 安全：
 *  - 服务端（以及 hydration 渲染阶段）`favorites` 恒为 `[]`，`isFavorite()` 一律 false，
 *    使 SSR 与首帧客户端标记一致 → 不会 hydration mismatch（同 useMobile 的踩坑注释）。
 *  - 真正的 localStorage 读取推迟到 `onMounted`（hydration 之后）再执行，
 *    这次翻转只产生一次正常的响应式重渲染。
 *
 * 持久化 key：`favshub:deal-favorites`，值为 `string[]`（通告 id）。
 * 存储不可用（隐私模式 / 配额满 / 存量脏数据）一律静默降级为「不持久化」，绝不抛错。
 */

const FAVORITES_STORAGE_KEY = 'favshub:deal-favorites'

// 模块级单例：跨组件共享同一份响应式状态
const favorites = ref<string[]>([])

/** 只做一次：读盘 + 挂持久化 watcher + 跨标签页同步 */
let favoritesInitialized = false

/** 从 localStorage 读回收藏；任何异常/脏数据都退化为空数组 */
function readFavoritesFromStorage(): string[] {
  if (!import.meta.client) return []
  try {
    const raw = window.localStorage.getItem(FAVORITES_STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // 过滤掉非字符串/空串，避免脏数据把 includes() 判断带偏
    return parsed.filter((item): item is string => typeof item === 'string' && item.length > 0)
  } catch {
    return []
  }
}

/** 写回 localStorage；配额满 / 隐私模式下静默失败 */
function writeFavoritesToStorage(list: string[]): void {
  if (!import.meta.client) return
  try {
    window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(list))
  } catch {
    /* 忽略：不能因为存不上就让交互炸掉 */
  }
}

function initFavorites(): void {
  if (favoritesInitialized || !import.meta.client) return
  favoritesInitialized = true

  favorites.value = readFavoritesFromStorage()

  // 只在初始化之后挂 watcher：否则首帧的空数组会被写回、把存量收藏清空
  watch(favorites, (next) => writeFavoritesToStorage(next), { deep: true })

  // 多标签页同步：另一个标签改了收藏，本页跟着更新
  window.addEventListener('storage', (event) => {
    if (event.key !== FAVORITES_STORAGE_KEY) return
    favorites.value = readFavoritesFromStorage()
  })
}

export function useDealFavorites(): {
  favorites: Ref<string[]>
  isFavorite: (id: string) => boolean
  toggleFavorite: (id: string) => void
} {
  // 每次调用都注册：谁先挂载谁完成初始化，后续调用直接复用
  onMounted(() => {
    initFavorites()
  })

  function isFavorite(id: string): boolean {
    if (!id) return false
    return favorites.value.includes(id)
  }

  function toggleFavorite(id: string): void {
    if (!id) return
    const index = favorites.value.indexOf(id)
    if (index >= 0) {
      // 换新数组而非 splice：让 watch 的浅比较也能稳定触发
      favorites.value = favorites.value.filter((item) => item !== id)
    } else {
      favorites.value = [...favorites.value, id]
    }
  }

  return { favorites, isFavorite, toggleFavorite }
}
