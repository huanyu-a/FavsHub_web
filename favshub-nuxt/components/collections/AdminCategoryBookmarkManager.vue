<template>
  <div class="acbm-container">
    <!-- 精选集选择器 -->
    <div class="acbm-toolbar">
      <label class="acbm-label">当前精选集：</label>
      <select v-model="selectedId" class="acbm-select" @change="onSelectCollection">
        <option v-for="c in collections" :key="c.id" :value="c.id">{{ c.icon || '📚' }} {{ c.name }}</option>
      </select>
      <button class="btn btn-ghost btn-sm" :disabled="!selectedId" @click="refresh">刷新</button>
      <span v-if="selectedCollection" class="acbm-info">({{ bookmarkCount }} 书签, {{ categories.length }} 分类)</span>
    </div>

    <div v-if="!selectedId" class="acbm-empty">请选择一个精选集</div>

    <template v-else>
      <div class="acbm-layout">
        <!-- 左侧：分类树 -->
        <div class="acbm-sidebar">
          <div class="acbm-sidebar-header">
            <h4>分类管理</h4>
            <button class="btn btn-ghost btn-sm" @click="addCategory(null)">+ 添加顶级分类</button>
          </div>
          <div v-if="catLoading" class="acbm-sidebar-loading">加载中...</div>
          <div v-else ref="catListRef" class="acbm-cat-list">
            <div
              v-for="cat in displayCategories"
              :key="cat.id"
              class="acbm-cat-item"
              :class="{ active: filterCategoryId === cat.id, 'is-child': cat._isChild }"
              :style="{ paddingLeft: (cat._isChild ? 24 : 8) + 'px' }"
              @click="filterCategoryId = cat.id"
            >
              <span class="acbm-cat-name">{{ cat.name }}</span>
              <span class="acbm-cat-count">({{ cat._bookmarkCount }})</span>
              <div class="acbm-cat-actions">
                <button class="btn-icon-xs" title="添加子分类" @click.stop="addCategory(cat.id)"><i class="ri-add-line"></i></button>
                <button class="btn-icon-xs" title="重命名" @click.stop="renameCategory(cat)"><i class="ri-edit-line"></i></button>
                <button class="btn-icon-xs danger" title="删除" @click.stop="deleteCategory(cat)"><i class="ri-delete-bin-line"></i></button>
              </div>
            </div>
            <div v-if="displayCategories.length === 0" class="acbm-sidebar-empty">暂无分类</div>
          </div>
        </div>

        <!-- 右侧：书签列表 -->
        <div class="acbm-main">
          <div class="acbm-main-header">
            <h4>书签列表</h4>
            <button class="btn btn-primary btn-sm" @click="openAddBookmark">+ 从书签池添加</button>
          </div>
          <div v-if="bmLoading" class="acbm-main-loading">加载中...</div>
          <div v-else-if="filteredBookmarks.length === 0" class="acbm-main-empty">暂无书签，点击「从书签池添加」</div>
          <div v-else ref="bmListRef" class="acbm-bm-list">
            <div v-for="bm in filteredBookmarks" :key="bm.id" class="acbm-bm-item" :data-id="bm.id">
              <span class="drag-handle" title="拖拽排序">⠿</span>
              <div class="acbm-bm-info">
                <div class="acbm-bm-title">{{ bm.title }}</div>
                <div class="acbm-bm-url">{{ bm.url }}</div>
              </div>
              <span class="acbm-bm-cat">{{ getCatName(bm.category_id) }}</span>
              <div class="acbm-bm-actions">
                <button class="btn-icon-xs" title="改分类" @click="changeCategory(bm)"><i class="ri-folder-transfer-line"></i></button>
                <button class="btn-icon-xs danger" title="移除" @click="removeBookmark(bm)"><i class="ri-close-line"></i></button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- 从书签池搜索添加 -->
    <div v-if="pickerVisible" class="acbm-modal-mask" @click.self="pickerVisible = false">
      <div class="acbm-modal">
        <div class="acbm-modal-header">
          <h3>从书签池添加</h3>
          <button class="btn-icon-xs" @click="pickerVisible = false"><i class="ri-close-line"></i></button>
        </div>
        <div class="acbm-modal-body">
          <input
            v-model="pickerQuery"
            class="acbm-search-input"
            type="search"
            placeholder="搜索标题或 URL…"
            @input="onPickerSearch"
          >
          <div v-if="pickerLoading" class="acbm-main-loading">搜索中…</div>
          <div v-else-if="pickerResults.length === 0" class="acbm-main-empty">
            {{ pickerQuery.trim() ? '无匹配书签' : '输入关键词搜索管理员书签池' }}
          </div>
          <div v-else class="acbm-picker-list">
            <label
              v-for="item in pickerResults"
              :key="item.id"
              class="acbm-picker-item"
              :class="{ disabled: isAlreadyAdded(item.id) }"
            >
              <input
                type="checkbox"
                :value="item.id"
                :disabled="isAlreadyAdded(item.id)"
                :checked="isAlreadyAdded(item.id) || pickerSelected.has(item.id)"
                @change="togglePicker(item.id, ($event.target as HTMLInputElement).checked)"
              >
              <div class="acbm-bm-info">
                <div class="acbm-bm-title">{{ item.title }}</div>
                <div class="acbm-bm-url">{{ item.url }}</div>
              </div>
              <span v-if="isAlreadyAdded(item.id)" class="acbm-bm-cat">已添加</span>
              <span v-else-if="item.label" class="acbm-bm-cat muted">个人</span>
              <span v-else class="acbm-bm-cat">公共池</span>
            </label>
          </div>
        </div>
        <div class="acbm-modal-footer">
          <span class="acbm-info">已选 {{ pickerSelected.size }} 项 → 分类：{{ getCatName(filterCategoryId) }}</span>
          <div class="acbm-modal-actions">
            <button class="btn btn-ghost" @click="pickerVisible = false">取消</button>
            <button class="btn btn-primary" :disabled="pickerSelected.size === 0 || pickerSaving" @click="confirmAddFromPool">
              {{ pickerSaving ? '添加中…' : '添加' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="msg" :class="['message', msgType]">{{ msg }}</div>
  </div>
</template>

<script setup lang="ts">
const authStore = useAuthStore()
function getAuthOpts(): Record<string, any> {
  const headers: Record<string, string> = {}
  if (authStore.token && authStore.token !== 'cookie_auth') headers.Authorization = `Bearer ${authStore.token}`
  return { headers, credentials: 'include' as const }
}

const props = defineProps<{ collections: any[] }>()
const emit = defineEmits<{ changed: [] }>()

const selectedId = ref('')
const selectedCollection = computed(() => props.collections.find(c => c.id === selectedId.value))

const categories = ref<any[]>([])
const bookmarks = ref<any[]>([])
const catLoading = ref(false)
const bmLoading = ref(false)
const filterCategoryId = ref<number | null>(null)
const msg = ref('')
const msgType = ref<'success' | 'error'>('success')
let msgTimer: any = null

function showMsg(text: string, type: 'success' | 'error') {
  msg.value = text; msgType.value = type
  clearTimeout(msgTimer); msgTimer = setTimeout(() => msg.value = '', 2500)
}

const bookmarkCount = computed(() => bookmarks.value.length)

const displayCategories = computed(() => {
  const result: any[] = []
  for (const c of categories.value) {
    if (!c.parent_id) {
      const count = bookmarks.value.filter(b => b.category_id === c.id).length
      result.push({ ...c, _isChild: false, _bookmarkCount: count })
      for (const child of categories.value) {
        if (child.parent_id === c.id) {
          const childCount = bookmarks.value.filter(b => b.category_id === child.id).length
          result.push({ ...child, _isChild: true, _bookmarkCount: childCount })
        }
      }
    }
  }
  return result
})

const filteredBookmarks = computed(() => {
  if (filterCategoryId.value === null) return bookmarks.value
  return bookmarks.value.filter(b => b.category_id === filterCategoryId.value)
})

function getCatName(cid: number | null) {
  if (!cid) return '未分类'
  return categories.value.find(c => c.id === cid)?.name || '未分类'
}

/** 统一序列化：始终传 bookmark_id 引用（绝不回退到 collection_bookmarks 行 id） */
function serializeBookmarks(list: any[]) {
  return list
    .map((b, i) => ({
      bookmark_id: b.bookmark_id,
      category_id: b.category_id ?? null,
      sort_order: b.sort_order ?? i,
    }))
    .filter(b => b.bookmark_id != null && !Number.isNaN(Number(b.bookmark_id)))
}

function serializeCategories(list: any[]) {
  return list.map(c => ({
    id: c.id,
    name: c.name,
    parent_id: c.parent_id || null,
    sort_order: c.sort_order || 0,
  }))
}

async function loadData() {
  if (!selectedId.value) return
  catLoading.value = true; bmLoading.value = true
  try {
    const r = await $fetch<any>(`/api/admin/collections/${selectedId.value}/bookmarks`, getAuthOpts())
    categories.value = r.categories || []
    // 保证每项都有 bookmark_id（API 已返回）
    bookmarks.value = (r.bookmarks || []).map((b: any) => ({
      ...b,
      bookmark_id: b.bookmark_id ?? b.id,
    }))
  } catch {
    showMsg('加载失败', 'error')
  } finally {
    catLoading.value = false; bmLoading.value = false
  }
}

function onSelectCollection() { filterCategoryId.value = null; loadData() }
function refresh() { loadData(); emit('changed') }

// ── 分类操作 ──
function addCategory(parentId: number | null) {
  const name = prompt(parentId ? '子分类名称：' : '分类名称：')
  if (!name?.trim()) return
  saveCategories([...categories.value, { name: name.trim(), parent_id: parentId, sort_order: categories.value.length }])
}

function renameCategory(cat: any) {
  const name = prompt('新名称：', cat.name)
  if (!name?.trim() || name.trim() === cat.name) return
  const updated = categories.value.map(c => c.id === cat.id ? { ...c, name: name.trim() } : c)
  saveCategories(updated)
}

async function deleteCategory(cat: any) {
  if (!confirm(`删除分类「${cat.name}」？该分类下的书签将变为未分类。`)) return
  const updated = categories.value.filter(c => c.id !== cat.id && c.parent_id !== cat.id)
  for (const bm of bookmarks.value) {
    if (bm.category_id === cat.id || bm.category_id && categories.value.find(c => c.id === bm.category_id)?.parent_id === cat.id) {
      // 子分类也会被删，一并置空
    }
    if (bm.category_id === cat.id) bm.category_id = null
    const childIds = categories.value.filter(c => c.parent_id === cat.id).map(c => c.id)
    if (childIds.includes(bm.category_id)) bm.category_id = null
  }
  await saveCategories(updated)
  await saveBookmarks()
}

async function saveCategories(newCats: any[]) {
  try {
    await $fetch(`/api/admin/collections/${selectedId.value}`, {
      method: 'PUT', ...getAuthOpts(),
      body: {
        categories: serializeCategories(newCats),
        bookmarks: serializeBookmarks(bookmarks.value),
      },
    })
    await loadData()
    showMsg('分类已保存', 'success')
  } catch (e: any) {
    showMsg('保存失败: ' + (e?.data?.error || e?.message), 'error')
  }
}

// ── 书签操作 ──
const pickerVisible = ref(false)
const pickerQuery = ref('')
const pickerResults = ref<any[]>([])
const pickerSelected = ref(new Set<number>())
const pickerLoading = ref(false)
const pickerSaving = ref(false)
let pickerTimer: any = null

function openAddBookmark() {
  pickerQuery.value = ''
  pickerResults.value = []
  pickerSelected.value = new Set()
  pickerVisible.value = true
}

function isAlreadyAdded(bookmarkId: number) {
  return bookmarks.value.some(b => Number(b.bookmark_id) === Number(bookmarkId))
}

function togglePicker(id: number, checked: boolean) {
  const next = new Set(pickerSelected.value)
  if (checked) next.add(id)
  else next.delete(id)
  pickerSelected.value = next
}

function onPickerSearch() {
  clearTimeout(pickerTimer)
  pickerTimer = setTimeout(runPickerSearch, 250)
}

async function runPickerSearch() {
  const q = pickerQuery.value.trim()
  if (!q) {
    pickerResults.value = []
    return
  }
  pickerLoading.value = true
  try {
    // 管理员书签池：/api/admin/bookmarks 返回当前用户书签（管理员即公共池所有者）
    const r = await $fetch<any>('/api/admin/bookmarks', {
      ...getAuthOpts(),
      query: { q, limit: 50, page: 1 },
    })
    pickerResults.value = r.bookmarks || []
  } catch {
    pickerResults.value = []
    showMsg('搜索失败', 'error')
  } finally {
    pickerLoading.value = false
  }
}

async function confirmAddFromPool() {
  if (pickerSelected.value.size === 0) return
  pickerSaving.value = true
  try {
    const catId = filterCategoryId.value
    const toAdd = pickerResults.value
      .filter(item => pickerSelected.value.has(item.id) && !isAlreadyAdded(item.id))
      .map((item, i) => ({
        id: 0,
        bookmark_id: item.id,
        title: item.title,
        url: item.url,
        icon: item.icon || '',
        description: item.description || '',
        category_id: catId,
        sort_order: bookmarks.value.length + i,
      }))

    if (toAdd.length === 0) {
      showMsg('所选书签均已在精选集中', 'error')
      return
    }

    bookmarks.value = [...bookmarks.value, ...toAdd]
    await saveBookmarks()
    pickerVisible.value = false
  } finally {
    pickerSaving.value = false
  }
}

function changeCategory(bm: any) {
  const names = categories.value.map(c => `${c.id}: ${c.parent_id ? '  ' : ''}${c.name}`).join('\n')
  const input = prompt(`输入目标分类 ID（留空=未分类）\n${names}`, bm.category_id ? String(bm.category_id) : '')
  if (input === null) return
  const val = input.trim()
  bm.category_id = val ? Number(val) : null
  if (val && Number.isNaN(bm.category_id)) {
    showMsg('无效的分类 ID', 'error')
    return
  }
  saveBookmarks()
}

async function removeBookmark(bm: any) {
  if (!confirm(`从精选集移除「${bm.title}」？\n（不会删除书签池中的原书签）`)) return
  bookmarks.value = bookmarks.value.filter(b => {
    if (bm.id) return b.id !== bm.id
    return (b.bookmark_id ?? b.id) !== (bm.bookmark_id ?? bm.id)
  })
  await saveBookmarks()
}

async function saveBookmarks() {
  try {
    await $fetch(`/api/admin/collections/${selectedId.value}`, {
      method: 'PUT', ...getAuthOpts(),
      body: {
        categories: serializeCategories(categories.value),
        bookmarks: serializeBookmarks(bookmarks.value),
      },
    })
    showMsg('书签已保存', 'success')
    emit('changed')
    await loadData()
  } catch (e: any) {
    showMsg('保存失败: ' + (e?.data?.error || e?.message), 'error')
  }
}
</script>

<style scoped>
.acbm-container { display: flex; flex-direction: column; gap: 16px; }
.acbm-toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.acbm-label { font-size: 14px; color: var(--text-secondary); }
.acbm-select { padding: 6px 10px; border: 1px solid var(--border); border-radius: 6px; font-size: 13px; background: var(--surface-raised); color: var(--text-primary); min-width: 200px; }
.acbm-info { font-size: 13px; color: var(--text-tertiary); }
.acbm-empty { text-align: center; padding: 40px; color: var(--text-secondary); }
.acbm-layout { display: flex; gap: 20px; min-height: 400px; }
.acbm-sidebar { width: 240px; flex-shrink: 0; background: var(--surface-sunken); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; }
.acbm-sidebar-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.acbm-sidebar-header h4 { margin: 0; font-size: 13px; }
.acbm-cat-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
.acbm-cat-item { display: flex; align-items: center; gap: 4px; padding: 6px 8px; border-radius: 6px; cursor: pointer; font-size: 13px; transition: background 0.15s; }
.acbm-cat-item:hover { background: var(--surface-hover); }
.acbm-cat-item.active { background: var(--primary-light); color: var(--primary); }
.acbm-cat-item.is-child { font-size: 12px; }
.acbm-cat-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.acbm-cat-count { font-size: 11px; color: var(--text-tertiary); }
.acbm-cat-actions { display: none; gap: 2px; }
.acbm-cat-item:hover .acbm-cat-actions { display: flex; }
.acbm-main { flex: 1; min-width: 0; }
.acbm-main-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.acbm-main-header h4 { margin: 0; font-size: 14px; }
.acbm-bm-list { display: flex; flex-direction: column; gap: 4px; }
.acbm-bm-item { display: flex; align-items: center; gap: 8px; padding: 8px 10px; background: var(--surface-sunken); border: 1px solid var(--border); border-radius: 6px; font-size: 13px; }
.acbm-bm-item:hover { background: var(--surface-hover); }
.acbm-bm-info { flex: 1; min-width: 0; }
.acbm-bm-title { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.acbm-bm-url { font-size: 11px; color: var(--text-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.acbm-bm-cat { font-size: 11px; color: var(--primary); background: var(--primary-light); padding: 2px 8px; border-radius: 4px; white-space: nowrap; }
.acbm-bm-cat.muted { color: var(--text-secondary); background: var(--surface-hover); }
.acbm-bm-actions { display: none; gap: 2px; }
.acbm-bm-item:hover .acbm-bm-actions { display: flex; }
.acbm-main-loading, .acbm-main-empty, .acbm-sidebar-loading, .acbm-sidebar-empty { text-align: center; padding: 20px; color: var(--text-tertiary); font-size: 13px; }
.btn-icon-xs { background: none; border: none; padding: 2px 4px; cursor: pointer; color: var(--text-secondary); border-radius: 4px; display: inline-flex; align-items: center; font-size: 14px; }
.btn-icon-xs:hover { background: var(--surface-hover); color: var(--primary); }
.btn-icon-xs.danger:hover { color: var(--accent-red); }
.drag-handle { cursor: grab; color: var(--text-tertiary); font-size: 14px; user-select: none; flex-shrink: 0; }
.message { margin-top: 8px; padding: 10px 14px; border-radius: 6px; font-size: 13px; text-align: center; }
.message.success { background: var(--primary-light); color: var(--primary-dark); }
.message.error { background: rgba(239,68,68,0.1); color: var(--accent-red); }

/* picker modal */
.acbm-modal-mask { position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 16px; }
.acbm-modal { background: var(--surface-raised); border-radius: 10px; width: min(560px, 100%); max-height: 80vh; display: flex; flex-direction: column; box-shadow: 0 12px 40px rgba(0,0,0,0.2); }
.acbm-modal-header { display: flex; justify-content: space-between; align-items: center; padding: 14px 16px; border-bottom: 1px solid var(--border); }
.acbm-modal-header h3 { margin: 0; font-size: 15px; }
.acbm-modal-body { padding: 12px 16px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 10px; }
.acbm-search-input { width: 100%; padding: 8px 12px; border: 1px solid var(--border); border-radius: 6px; font-size: 13px; background: var(--surface-sunken); color: var(--text-primary); }
.acbm-picker-list { display: flex; flex-direction: column; gap: 4px; max-height: 360px; overflow-y: auto; }
.acbm-picker-item { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 6px; cursor: pointer; border: 1px solid transparent; }
.acbm-picker-item:hover { background: var(--surface-hover); }
.acbm-picker-item.disabled { opacity: 0.55; cursor: default; }
.acbm-modal-footer { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 12px 16px; border-top: 1px solid var(--border); flex-wrap: wrap; }
.acbm-modal-actions { display: flex; gap: 8px; }

@media (max-width: 768px) {
  .acbm-layout { flex-direction: column; }
  .acbm-sidebar { width: 100%; max-height: 200px; }
}
</style>
