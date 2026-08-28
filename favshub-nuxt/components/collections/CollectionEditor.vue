<template>
  <Teleport to="body">
    <div v-if="visible" :class="['modal-overlay', { active: visible }]" @click.self="emit('close')">
      <div class="modal collection-editor-modal">
        <div class="modal-header">
          <h3>{{ isEdit ? '编辑精选集' : '新建精选集' }}</h3>
          <button class="modal-close" @click="emit('close')">&times;</button>
        </div>
        <div class="modal-body">
          <div class="editor-layout">
            <!-- 左侧：基本信息 -->
            <div class="editor-main">
              <div class="fg">
                <label>名称 *</label>
                <input v-model="form.name" type="text" placeholder="精选集名称" class="form-input">
              </div>

              <div class="fg">
                <label>描述</label>
                <textarea v-model="form.description" rows="3" placeholder="简短介绍这个精选集" class="form-textarea"></textarea>
              </div>

              <div class="fg">
                <label>图标</label>
                <IconPicker v-model="form.icon" />
              </div>

              <!-- TDK 配置（可折叠） -->
              <div class="fg tdk-section">
                <div class="tdk-header" @click="tdkExpanded = !tdkExpanded">
                  <label>SEO 配置（可选）</label>
                  <i :class="tdkExpanded ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'"></i>
                </div>
                <div v-if="tdkExpanded" class="tdk-fields">
                  <div class="fg">
                    <label>页面标题</label>
                    <input v-model="form.meta_title" type="text" placeholder="留空则使用精选集名称" class="form-input">
                  </div>
                  <div class="fg">
                    <label>页面描述</label>
                    <input v-model="form.meta_description" type="text" placeholder="留空则使用精选集描述" class="form-input">
                  </div>
                  <div class="fg">
                    <label>关键词</label>
                    <input v-model="form.meta_keywords" type="text" placeholder="逗号分隔，如：工具,设计,开发" class="form-input">
                  </div>
                </div>
              </div>

              <div class="fg-row">
                <div class="fg toggle-row">
                  <label>公开状态</label>
                  <label class="switch">
                    <input type="checkbox" v-model="form.is_public" :true-value="1" :false-value="0">
                    <span class="slider round"></span>
                  </label>
                </div>
                <div v-if="authStore.isAdmin" class="fg toggle-row">
                  <label>官方推荐</label>
                  <label class="switch">
                    <input type="checkbox" v-model="form.is_official" :true-value="1" :false-value="0">
                    <span class="slider round"></span>
                  </label>
                </div>
              </div>

            </div>
          </div>

          <div v-if="errorMsg" class="error-msg">
            <i class="ri-error-warning-line"></i>
            {{ errorMsg }}
          </div>

          <div v-if="saving" class="saving-msg">
            <i class="ri-loader-4-line spin"></i>
            保存中...
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn btn-ghost" @click="emit('close')" :disabled="saving">取消</button>
          <button class="btn btn-primary" @click="save" :disabled="saving">
            <i class="ri-save-line"></i>
            {{ saving ? '保存中...' : '保存' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import IconPicker from '~/components/common/IconPicker.vue'

const props = defineProps<{
  visible: boolean
  collection: any | null
}>()

const emit = defineEmits<{
  close: []
  saved: []
}>()

const authStore = useAuthStore()

function getAuthHeaders(): Record<string, string> {
  return authStore.token && authStore.token !== 'cookie_auth' ? { Authorization: `Bearer ${authStore.token}` } : {}
}

const isEdit = computed(() => !!props.collection?.id)

// 表单数据
const form = reactive({
  name: '',
  description: '',
  icon: '',
  meta_title: '',
  meta_description: '',
  meta_keywords: '',
  is_public: 1,
  is_official: 0
})

const tdkExpanded = ref(false)
const categories = ref<any[]>([])
const bookmarks = ref<any[]>([])
const filterCategory = ref<string | null>(null)
const saving = ref(false)
const errorMsg = ref('')

let nextCategoryId = 1
let nextBookmarkId = 1

// 过滤后的书签列表
const filteredBookmarks = computed(() => {
  if (!filterCategory.value) return bookmarks.value
  return bookmarks.value.filter(bm => bm.category_id === filterCategory.value)
})

// 监听 visible 变化，加载数据（immediate: true 确保以 visible=true 挂载时也触发）
watch(() => props.visible, async (val) => {
  if (val) {
    await loadData()
  } else {
    resetForm()
  }
}, { immediate: true })

// 加载数据
async function loadData() {
  if (props.collection?.id) {
    // 编辑模式：先用已有填充基础字段，再拉完整数据
    const pc = props.collection as any
    Object.assign(form, {
      name: pc.name || '', description: pc.description || '', icon: pc.icon || '',
      meta_title: pc.meta_title || '', meta_description: pc.meta_description || '', meta_keywords: pc.meta_keywords || '',
      is_public: pc.is_public ?? 1, is_official: pc.is_official ?? 0
    })
    try {
      const res = await $fetch<any>(`/api/admin/collections/${props.collection.id}/bookmarks`, {
        headers: getAuthHeaders(),
        credentials: 'include'
      })

      const col = res.collection
      Object.assign(form, {
        name: col.name || '',
        description: col.description || '',
        icon: col.icon || '',
        meta_title: col.meta_title || '',
        meta_description: col.meta_description || '',
        meta_keywords: col.meta_keywords || '',
        is_public: col.is_public ?? 1,
        is_official: col.is_official ?? 0
      })

      // 加载分类和书签（扁平数据结构，支持二级层级）
      if (res.categories && Array.isArray(res.categories)) {
        // 先建 db_id 与 temp_id 的映射，用于 parent_id 解析
        const dbToTemp = new Map<number, string>()
        const tempCats = res.categories.map((cat: any, idx: number) => {
          const tempId = `cat-${idx}`
          dbToTemp.set(cat.id, tempId)
          return { ...cat, _tempId: tempId, _idx: idx }
        })

        categories.value = tempCats.map((cat: any) => {
          const isChild = !!cat.parent_id
          return {
            id: cat.id,
            _id: cat._tempId,
            name: cat.name,
            parent_id: cat.parent_id ? (dbToTemp.get(cat.parent_id) || null) : null,
            _depth: isChild ? 1 : 0,
            sort_order: cat.sort_order ?? cat._idx
          }
        })

        nextCategoryId = categories.value.length + 1
      }

      if (res.bookmarks && Array.isArray(res.bookmarks)) {
        // 创建分类ID映射
        const catIdMap = new Map<number, string>()
        categories.value.forEach((cat, idx) => {
          if (cat.id) catIdMap.set(cat.id, cat._id)
        })

        bookmarks.value = res.bookmarks.map((bm: any, idx: number) => ({
          id: bm.id,
          _id: `bm-${idx}`,
          title: bm.title,
          url: bm.url,
          description: bm.description || '',
          icon: bm.icon || '',
          category_id: bm.category_id ? catIdMap.get(bm.category_id) || null : null,
          sort_order: bm.sort_order ?? idx
        }))

        nextBookmarkId = bookmarks.value.length + 1
      }
    } catch (e) {
      console.error('加载精选集失败', e)
      errorMsg.value = '加载数据失败'
    }
  } else {
    // 新建模式：重置表单
    resetForm()
  }
}

// 重置表单
function resetForm() {
  Object.assign(form, {
    name: '',
    description: '',
    icon: '',
    meta_title: '',
    meta_description: '',
    meta_keywords: '',
    is_public: 1,
    is_official: 0
  })
  categories.value = []
  bookmarks.value = []
  filterCategory.value = null
  errorMsg.value = ''
  tdkExpanded.value = false
  nextCategoryId = 1
  nextBookmarkId = 1
}

// 分类操作
function addCategory() {
  categories.value.push({
    _id: `cat-${nextCategoryId++}`,
    name: '',
    parent_id: null,
    _depth: 0,
    sort_order: categories.value.length
  })
}

function addSubCategory(parentIdx: number) {
  const parent = categories.value[parentIdx]
  categories.value.push({
    _id: `cat-${nextCategoryId++}`,
    name: '',
    parent_id: parent._id,
    _depth: (parent._depth || 0) + 1,
    sort_order: categories.value.length
  })
}

// 可用作父级的分组（排除自身以防止循环引用，且仅允许顶级分类作为父级）
function availableParents(currentIdx: number) {
  const current = categories.value[currentIdx]
  return categories.value.filter((cat, i) => {
    if (i === currentIdx) return false
    if (cat._id === current?.parent_id) return true  // 保留当前已选的父级
    if (cat.parent_id) return false  // 已有父级的子分类不能再作为父级
    return true
  })
}

function removeCategory(idx: number) {
  const cat = categories.value[idx]
  // 将该分类及其子分类下的书签移到未分类
  const removedIds = new Set([cat._id])
  for (const c of categories.value) {
    if (c.parent_id === cat._id) removedIds.add(c._id)
  }
  for (const bm of bookmarks.value) {
    if (removedIds.has(bm.category_id)) {
      bm.category_id = null
    }
  }
  // 同时移除子分类
  categories.value = categories.value.filter(c => !removedIds.has(c._id))
}

// 书签操作
function addBookmark() {
  bookmarks.value.push({
    _id: `bm-${nextBookmarkId++}`,
    title: '',
    url: '',
    description: '',
    icon: '',
    category_id: filterCategory.value || null,
    sort_order: bookmarks.value.length
  })
}

function removeBookmark(idx: number) {
  const actualIndex = bookmarks.value.findIndex(bm => bm._id === filteredBookmarks.value[idx]._id)
  if (actualIndex !== -1) {
    bookmarks.value.splice(actualIndex, 1)
  }
}

// 保存（仅元数据，分类和书签在 Tab 2 管理）
async function save() {
  errorMsg.value = ''

  if (!form.name.trim()) {
    errorMsg.value = '请输入精选集名称'
    return
  }

  saving.value = true

  try {
    const body = {
      name: form.name.trim(),
      description: form.description || '',
      icon: form.icon || '',
      meta_title: form.meta_title || null,
      meta_description: form.meta_description || null,
      meta_keywords: form.meta_keywords || null,
      is_public: form.is_public ? 1 : 0,
      is_official: form.is_official ? 1 : 0,
    }

    if (isEdit.value) {
      await $fetch(`/api/admin/collections/${props.collection.id}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        credentials: 'include',
        body
      })
    } else {
      await $fetch('/api/admin/collections', {
        method: 'POST',
        headers: getAuthHeaders(),
        credentials: 'include',
        body
      })
    }

    emit('saved')
    emit('close')
  } catch (e: any) {
    errorMsg.value = '保存失败：' + (e?.data?.error || e?.message || '未知错误')
  } finally {
    saving.value = false
  }
}

// 拖拽排序
const categoryListRef = ref<HTMLElement | null>(null)
const bookmarkListRef = ref<HTMLElement | null>(null)
let categorySortable: any = null
let bookmarkSortable: any = null

function initCategorySortable() {
  if (categorySortable) {
    categorySortable.destroy()
    categorySortable = null
  }

  const el = categoryListRef.value
  if (!el) return

  import('sortablejs').then(({ default: Sortable }) => {
    categorySortable = Sortable.create(el, {
      handle: '.drag-handle',
      animation: 200,
      ghostClass: 'sortable-ghost',
      onEnd(evt: any) {
        if (evt.oldIndex !== undefined && evt.newIndex !== undefined && evt.oldIndex !== evt.newIndex) {
          const [moved] = categories.value.splice(evt.oldIndex, 1)
          categories.value.splice(evt.newIndex, 0, moved)
        }
      }
    })
  })
}

function initBookmarkSortable() {
  if (bookmarkSortable) {
    bookmarkSortable.destroy()
    bookmarkSortable = null
  }

  const el = bookmarkListRef.value
  if (!el) return

  import('sortablejs').then(({ default: Sortable }) => {
    bookmarkSortable = Sortable.create(el, {
      handle: '.drag-handle',
      animation: 200,
      ghostClass: 'sortable-ghost',
      onEnd(evt: any) {
        if (evt.oldIndex !== undefined && evt.newIndex !== undefined && evt.oldIndex !== evt.newIndex) {
          const filtered = [...filteredBookmarks.value]
          const [moved] = filtered.splice(evt.oldIndex, 1)
          filtered.splice(evt.newIndex, 0, moved)

          // 更新原数组，保持分类间的原始相对顺序
          if (filterCategory.value) {
            const filteredIds = new Set(filtered.map((b: any) => b.id || b._id))
            bookmarks.value = bookmarks.value.map(bm =>
              (bm.category_id === filterCategory.value)
                ? filtered.find((f: any) => (f.id || f._id) === (bm.id || bm._id)) || bm
                : bm
            )
          } else {
            bookmarks.value = filtered
          }
        }
      }
    })
  })
}

watch(() => categories.value.length, () => {
  nextTick(initCategorySortable)
})

watch(() => [filteredBookmarks.value.length, filterCategory.value], () => {
  nextTick(initBookmarkSortable)
})

onMounted(() => {
  initCategorySortable()
  initBookmarkSortable()
})

onBeforeUnmount(() => {
  if (categorySortable) categorySortable.destroy()
  if (bookmarkSortable) bookmarkSortable.destroy()
})
</script>

<style scoped>
.collection-editor-modal {
  max-width: 900px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
}

.modal-body {
  overflow-y: auto;
  flex: 1;
}

.editor-layout {
  display: flex;
  flex-direction: column;
}

.editor-main {
  flex: 1;
}

.form-input,
.form-textarea {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 13px;
  background: var(--surface-raised);
  color: var(--text-primary);
  font-family: inherit;
}

.form-textarea {
  resize: vertical;
}

.tdk-section {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  background: var(--surface-sunken);
}

.tdk-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  user-select: none;
}

.tdk-header label {
  cursor: pointer;
  margin: 0;
}

.tdk-fields {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}

.section-divider {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 24px 0 12px;
  padding-bottom: 8px;
  border-bottom: 2px solid var(--border);
  font-weight: 600;
  font-size: 14px;
  color: var(--text-primary);
}

.section-divider i {
  font-size: 18px;
  color: var(--primary);
}

.categories-manager,
.bookmarks-manager {
  margin-bottom: 16px;
}

.categories-header,
.bookmarks-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.filter-select {
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 13px;
  background: var(--surface-raised);
  color: var(--text-primary);
}

.empty-hint {
  padding: 24px;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 13px;
  background: var(--surface-sunken);
  border-radius: 6px;
}

.categories-list,
.bookmarks-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.category-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: var(--surface-sunken);
  border: 1px solid var(--border);
  border-radius: 6px;
  transition: all 0.2s;
}

.category-item:hover {
  background: var(--surface-hover);
}

.drag-handle {
  cursor: grab;
  color: var(--text-tertiary);
  font-size: 14px;
  user-select: none;
  width: 16px;
  text-align: center;
  flex-shrink: 0;
}

.drag-handle:active {
  cursor: grabbing;
}

.cat-name-input {
  flex: 1;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 13px;
  background: var(--surface-raised);
  color: var(--text-primary);
}
.cat-parent-select {
  width: 110px;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 12px;
  background: var(--surface-raised);
  color: var(--text-secondary);
  flex-shrink: 0;
}

.btn-icon-sm {
  background: none;
  border: none;
  padding: 4px;
  cursor: pointer;
  color: var(--text-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: all 0.2s;
  flex-shrink: 0;
}

.btn-icon-sm:hover {
  background: var(--surface-hover);
  color: var(--accent-red);
}

.bookmark-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 12px;
  background: var(--surface-sunken);
  border: 1px solid var(--border);
  border-radius: 6px;
  transition: all 0.2s;
}

.bookmark-item:hover {
  background: var(--surface-hover);
}

.bookmark-fields {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.bookmark-row {
  display: flex;
  gap: 8px;
}

.bm-title-input {
  flex: 2;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 13px;
  background: var(--surface-raised);
  color: var(--text-primary);
}

.bm-url-input {
  flex: 3;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 13px;
  background: var(--surface-raised);
  color: var(--text-primary);
}

.bm-desc-input {
  flex: 2;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 13px;
  background: var(--surface-raised);
  color: var(--text-primary);
}

.bm-cat-select {
  flex: 1;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 13px;
  background: var(--surface-raised);
  color: var(--text-primary);
}

.error-msg {
  padding: 12px 16px;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 6px;
  color: var(--accent-red);
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
}

.saving-msg {
  padding: 12px 16px;
  background: rgba(59, 130, 246, 0.1);
  border: 1px solid rgba(59, 130, 246, 0.3);
  border-radius: 6px;
  color: var(--primary);
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
}

/* 开关行：label 与开关紧凑，两组之间加间隔 */
.fg-row .toggle-row {
  justify-content: flex-start;
  gap: 12px;
}
.fg-row {
  gap: 32px;
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.sortable-ghost {
  opacity: 0.4;
  background: var(--primary-light);
}

/* 开关样式 */
.switch {
  position: relative;
  display: inline-block;
  width: 44px;
  height: 24px;
}

.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  cursor: pointer;
  inset: 0;
  background-color: var(--border);
  transition: 0.3s;
}

.slider.round {
  border-radius: 24px;
}

.slider:before {
  position: absolute;
  content: "";
  height: 18px;
  width: 18px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  transition: 0.3s;
  border-radius: 50%;
}

input:checked + .slider {
  background-color: var(--primary);
}

input:checked + .slider:before {
  transform: translateX(20px);
}
</style>
