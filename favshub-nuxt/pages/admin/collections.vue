<template>
  <div class="admin-page">
    <header class="page-header">
      <h1>精选集管理</h1>
      <p>管理和维护全平台精选集（主题书签集合）</p>
    </header>

    <!-- 统计面板 -->
    <CollectionStats
      :total="stats.total"
      :official="stats.official"
      :bookmarks="stats.bookmarks"
      :loading="statsLoading"
    />

    <div v-if="message" :class="['message', messageType]">{{ message }}</div>

    <!-- Tab 切换 -->
    <div class="tab-nav">
      <button :class="{ active: activeTab === 'list' }" @click="activeTab = 'list'">精选集列表</button>
      <button :class="{ active: activeTab === 'categories' }" @click="activeTab = 'categories'">分类与书签</button>
      <button v-if="isAdmin" :class="{ active: activeTab === 'tdk' }" @click="activeTab = 'tdk'">TDK 设置</button>
    </div>

    <!-- Tab 1: 精选集列表 -->
    <div class="card" v-show="activeTab === 'list'">
      <div class="card-header">
        <h3>精选集列表</h3>
        <div style="display: flex; align-items: center; gap: 12px;">
          <input
            v-model="searchQuery"
            type="text"
            placeholder="搜索精选集..."
            style="width: 200px; padding: 6px 10px; border: 1px solid var(--border); border-radius: 6px; font-size: 13px; background: var(--surface-raised); color: var(--text-primary);"
            @input="debouncedSearch"
          >
          <select v-model="filterType" @change="loadCollections" style="padding: 6px 10px; border: 1px solid var(--border); border-radius: 6px; font-size: 13px; background: var(--surface-raised); color: var(--text-primary);">
            <option value="">全部</option>
            <option value="public">公开</option>
            <option value="private">私有</option>
            <option value="official">官方推荐</option>
          </select>
          <button class="btn btn-primary btn-sm" @click="openCreateCollection">+ 创建精选集</button>
          <button class="btn btn-ghost btn-sm" @click="loadCollections">刷新</button>
        </div>
      </div>

      <div v-if="cLoading" class="empty-state">加载中...</div>
      <div v-else-if="collections.length === 0" class="empty-state">暂无精选集</div>

      <table v-else>
        <thead>
          <tr>
            <th>名称</th>
            <th>描述</th>
            <th style="width: 80px;">书签数</th>
            <th style="width: 80px;">公开</th>
            <th style="width: 100px;">官方推荐</th>
            <th style="width: 100px;">创建者</th>
            <th style="width: 140px;">创建时间</th>
            <th style="width: 220px;">操作</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="c in collections" :key="c.id">
            <tr>
              <td>
                <div style="display: flex; align-items: center; gap: 6px;">
                  <span v-if="c.icon && isEmoji(c.icon)" style="font-size: 18px;">{{ c.icon }}</span>
                  <i v-else-if="c.icon" :class="c.icon" style="font-size: 16px; color: var(--primary);"></i>
                  <i v-else class="ri-stack-line" style="font-size: 16px; color: var(--text-tertiary);"></i>
                  <span style="font-weight: 500;">{{ c.name }}</span>
                </div>
              </td>
              <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                {{ c.description || '-' }}
              </td>
              <td>{{ c.bookmark_count || 0 }}</td>
              <td>
                <label class="switch" style="width: 44px; height: 24px;">
                  <input
                    type="checkbox"
                    :checked="c.is_public === 1"
                    @change="togglePublic(c)"
                  >
                  <span class="slider round"></span>
                </label>
              </td>
              <td>
                <label class="switch" style="width: 44px; height: 24px;">
                  <input
                    type="checkbox"
                    :checked="c.is_official === 1"
                    @change="toggleOfficial(c)"
                    :disabled="!isAdmin"
                  >
                  <span class="slider round"></span>
                </label>
              </td>
              <td>{{ c.username || c.user_id || '-' }}</td>
              <td>{{ c.created_at ? new Date(c.created_at).toLocaleString() : '-' }}</td>
              <td class="actions">
                <button class="btn btn-ghost btn-sm" @click="openEditCollection(c)">编辑</button>
                <button class="btn btn-ghost btn-sm" @click="openBatchImport(c)">导入</button>
                <button v-if="canDelete(c)" class="btn btn-danger btn-sm" @click="delCollection(c)">删除</button>
              </td>
            </tr>
          </template>
        </tbody>
      </table>

      <div class="pagination" v-if="cTotalPages > 1">
        <button :disabled="cPage <= 1" @click="cPage--; loadCollections()">上一页</button>
        <button v-for="n in cPages" :key="n" :class="{ active: n === cPage }" @click="cPage = n; loadCollections()">{{ n }}</button>
        <button :disabled="cPage >= cTotalPages" @click="cPage++; loadCollections()">下一页</button>
      </div>
    </div>

    <!-- Tab 2: 分类与书签管理 -->
    <div class="card" v-show="activeTab === 'categories'" style="padding: 20px;">
      <AdminCategoryBookmarkManager :collections="collections" @changed="loadCollections(); loadStats()" />
    </div>

    <!-- Tab 3: TDK 设置 -->
    <div v-if="activeTab === 'tdk' && isAdmin" class="card" style="padding: 20px;">
      <h3>精选集页面 TDK 设置</h3>
      <p class="hint">设置精选集市场页面的标题、描述和关键词。页面标题会自动拼接 _FavsHub 后缀。</p>
      <div class="fg"><label>页面标题</label><input v-model="collTdk.collectionsTitle" placeholder="网址导航精选集" @input="saveCollTdk"></div>
      <div class="fg"><label>页面描述</label><input v-model="collTdk.collectionsDescription" placeholder="FavsHub 网址导航精选集..." @input="saveCollTdk"></div>
      <div class="fg"><label>页面关键词</label><input v-model="collTdk.collectionsKeywords" placeholder="网址导航,导航网站,工具导航..." @input="saveCollTdk"><small>多个关键词用英文逗号分隔</small></div>
    </div>

    <!-- 编辑弹窗 -->
    <CollectionEditor
      v-if="cEditVisible"
      :visible="cEditVisible"
      :collection="editingCollection"
      @close="cEditVisible = false"
      @saved="onCollectionSaved"
    />

    <!-- 批量导入弹窗 -->
    <BatchImportDialog
      v-if="importDialogVisible"
      :visible="importDialogVisible"
      :collection="importingCollection"
      @close="importDialogVisible = false"
      @imported="onImported"
    />
    <BackToTop />
  </div>
</template>

<script setup lang="ts">
import CollectionStats from '~/components/collections/CollectionStats.vue'
import CollectionEditor from '~/components/collections/CollectionEditor.vue'
import BatchImportDialog from '~/components/collections/BatchImportDialog.vue'
import AdminCategoryBookmarkManager from '~/components/collections/AdminCategoryBookmarkManager.vue'
import BackToTop from '~/components/BackToTop.vue'

definePageMeta({ middleware: 'admin', layout: 'admin' })
useHead({ title: '精选集管理' })

const authStore = useAuthStore()
const isAdmin = computed(() => authStore.isAdmin)
const currentUserId = computed(() => authStore.user?.id)

function getAuthHeaders(): Record<string, string> {
  return authStore.token && authStore.token !== 'cookie_auth' ? { Authorization: `Bearer ${authStore.token}` } : {}
}
function getAuthOpts(): Record<string, any> {
  return { headers: getAuthHeaders(), credentials: 'include' as const }
}

const activeTab = ref('list')

function isEmoji(v: string) {
  return /[\p{Emoji}]/u.test(v)
}

// ── 统计 ──────────────────────────────────────────────
const stats = reactive({ total: 0, official: 0, bookmarks: 0, subscribers: 0 })
const statsLoading = ref(false)

// 消息通知
const message = ref('')
const messageType = ref<'success' | 'error'>('error')
let messageTimer: ReturnType<typeof setTimeout> | null = null

function showMessage(msg: string, type: 'success' | 'error' = 'error') {
  if (messageTimer) clearTimeout(messageTimer)
  message.value = msg
  messageType.value = type
  messageTimer = setTimeout(() => { message.value = '' }, 3000)
}

async function loadStats() {
  statsLoading.value = true
  try {
    const r = await $fetch<any>('/api/admin/collections/stats', getAuthOpts())
    Object.assign(stats, {
      total: r.total || 0,
      official: r.official || 0,
      bookmarks: r.bookmarks || 0,
      subscribers: r.subscribers || 0
    })
  } catch (e) {
    console.error('加载统计失败', e)
  } finally {
    statsLoading.value = false
  }
}

// ── 列表 ──────────────────────────────────────────────
const collections = ref<any[]>([])
const cLoading = ref(false)
const cTotal = ref(0)
const cPage = ref(1)
const cPageSize = 30
const cTotalPages = computed(() => Math.max(1, Math.ceil(cTotal.value / cPageSize)))
const cPages = computed(() => {
  const a: number[] = []
  for (let i = Math.max(1, cPage.value - 2); i <= Math.min(cTotalPages.value, cPage.value + 2); i++) a.push(i)
  return a
})

const searchQuery = ref('')
const filterType = ref('')

let collectionsLoading = false
let collectionsReloadQueued = false
async function loadCollections() {
  if (collectionsLoading) {
    // M12: 请求去重；并发期间的新变更排队，待当前请求结束后重载
    collectionsReloadQueued = true
    return
  }
  collectionsLoading = true
  cLoading.value = true
  try {
    const params = new URLSearchParams({
      page: String(cPage.value),
      limit: String(cPageSize),
    })
    if (searchQuery.value) params.append('search', searchQuery.value)
    if (filterType.value) params.append('type', filterType.value)

    const r = await $fetch<any>(`/api/admin/collections?${params}`, getAuthOpts())
    collections.value = r.collections || []
    cTotal.value = r.pagination?.total || r.total || r.collections?.length || 0
  } catch (e) {
    console.error('加载精选集失败', e)
    collections.value = []
  } finally {
    cLoading.value = false
    collectionsLoading = false
    if (collectionsReloadQueued) {
      collectionsReloadQueued = false
      loadCollections()
    }
  }
}

let searchTimer: any = null
function debouncedSearch() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    cPage.value = 1
    loadCollections()
  }, 300)
}

// ── 操作 ──────────────────────────────────────────────
async function togglePublic(c: any) {
  const newValue = c.is_public === 1 ? 0 : 1
  try {
    await $fetch(`/api/admin/collections/${c.id}`, {
      method: 'PUT', ...getAuthOpts(),
      body: { is_public: newValue }
    })
    c.is_public = newValue
  } catch (e: any) {
    showMessage('更新失败: ' + (e?.data?.error || e?.message || '未知错误'), 'error')
  }
}

async function toggleOfficial(c: any) {
  if (!isAdmin.value) return
  const newValue = c.is_official === 1 ? 0 : 1
  try {
    await $fetch(`/api/admin/collections/${c.id}`, {
      method: 'PUT', ...getAuthOpts(),
      body: { is_official: newValue }
    })
    c.is_official = newValue
    loadStats()
  } catch (e: any) {
    showMessage('更新失败: ' + (e?.data?.error || e?.message || '未知错误'), 'error')
  }
}

function canDelete(c: any) {
  return isAdmin.value || c.user_id === currentUserId.value
}

async function delCollection(c: any) {
  if (!confirm(`确定删除精选集「${c.name}」？此操作将同时删除所有分类和书签，不可恢复。`)) return
  try {
    await $fetch(`/api/admin/collections/${c.id}`, { method: 'DELETE', ...getAuthOpts() })
    loadCollections()
    loadStats()
  } catch (e: any) {
    showMessage('删除失败: ' + (e?.data?.error || e?.message || '未知错误'), 'error')
  }
}

// ── 编辑器 ────────────────────────────────────────────
const cEditVisible = ref(false)
const editingCollection = ref<any>(null)

function openCreateCollection() {
  editingCollection.value = null
  cEditVisible.value = true
}

function openEditCollection(c: any) {
  editingCollection.value = c
  cEditVisible.value = true
}

function onCollectionSaved() {
  cEditVisible.value = false
  loadCollections()
  loadStats()
}

// ── 批量导入 ──────────────────────────────────────────
const importDialogVisible = ref(false)
const importingCollection = ref<any>(null)

function openBatchImport(c: any) {
  importingCollection.value = c
  importDialogVisible.value = true
}

function onImported() {
  importDialogVisible.value = false
  loadCollections()
  loadStats()
}

// ── 精选集 TDK ──────────────────────────────────────────
const collTdk = reactive({ collectionsTitle: '', collectionsDescription: '', collectionsKeywords: '' })
async function loadCollTdk() {
  try {
    const d = await $fetch<any>('/api/tdk/collections', { headers: getAuthHeaders() })
    Object.assign(collTdk, {
      collectionsTitle: d.collectionsTitle || '',
      collectionsDescription: d.collectionsDescription || '',
      collectionsKeywords: d.collectionsKeywords || ''
    })
  } catch (e) { console.error('加载精选集 TDK 失败', e) }
}
let collTdkTimer: ReturnType<typeof setTimeout> | null = null
function saveCollTdk() {
  if (collTdkTimer) clearTimeout(collTdkTimer)
  collTdkTimer = setTimeout(async () => {
    try {
      await $fetch('/api/admin/config', {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: { data: { ...collTdk } }
      })
      showMessage('精选集 TDK 已保存', 'success')
    } catch (e) { console.error('保存精选集 TDK 失败', e) }
  }, 500)
}

// ── 初始化 ──────────────────────────────────────────────
onMounted(() => {
  loadCollections()
  loadStats()
  loadCollTdk()
})

onBeforeUnmount(() => {
  if (messageTimer) clearTimeout(messageTimer)
  if (collTdkTimer) clearTimeout(collTdkTimer)
})
</script>

<style scoped>
.admin-page {
  padding: 24px;
}

.btn-icon {
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
}

.btn-icon:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.pagination {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  padding: 16px;
  border-top: 1px solid var(--border);
}

.pagination button {
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface-raised);
  color: var(--text-primary);
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s;
}

.pagination button:hover:not(:disabled) {
  background: var(--surface-hover);
  border-color: var(--primary);
}

.pagination button.active {
  background: var(--primary);
  color: var(--text-inverse);
  border-color: var(--primary);
}

.pagination button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
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

input:disabled + .slider {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
