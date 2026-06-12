<template>
  <div class="admin-page">
    <header class="page-header">
      <h1>书签管理</h1>
      <p>查看和管理所有用户的书签与文件夹</p>
    </header>

    <div class="tab-nav">
      <button :class="{ active: tab === 'list' }" @click="tab = 'list'">书签列表</button>
      <button :class="{ active: tab === 'folders' }" @click="tab = 'folders'">文件夹管理</button>
    </div>

    <!-- 书签列表 -->
    <div v-if="tab === 'list'">
      <div class="filter-bar">
        <select v-model="filterCategory" @change="onCategoryChange">
          <option :value="null">全部分类</option>
          <option v-for="cat in categories" :key="cat.id" :value="cat.id">{{ cat.name }}</option>
        </select>
        <select v-model="filterFolder" @change="loadBookmarks">
          <option :value="null">全部子文件夹</option>
          <option v-for="f in subFolders" :key="f.id" :value="f.id">{{ '│  '.repeat(f._depth) }}{{ f.name }}</option>
        </select>
        <input v-model="filterTitle" type="text" placeholder="搜索标题..." @input="debouncedLoad">
        <input v-model="filterUrl" type="text" placeholder="搜索URL..." @input="debouncedLoad">
        <span class="info">共 {{ total }} 条</span>
        <button class="btn btn-primary btn-sm" @click="loadBookmarks">刷新</button>
        <button v-if="isAdmin" class="btn btn-ghost btn-sm" @click="downloadAllFavicons">下载图标</button>
        <button v-if="isAdmin" class="btn btn-ghost btn-sm" @click="retryFailed">重试失败</button>
        <button v-if="isAdmin" class="btn btn-ghost btn-sm" @click="forceLocalize">强制本地化</button>
        <button v-if="isAdmin" class="btn btn-ghost btn-sm" @click="exportBookmarks">📥 导出书签</button>
      </div>
      <div class="card">
        <table>
          <thead><tr><th>ID</th><th>图标</th><th>标题</th><th>URL</th><th>文件夹</th><th>用户</th><th>可见性</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-if="loading"><td colspan="8" class="empty-state">加载中...</td></tr>
            <tr v-else-if="bookmarks.length === 0"><td colspan="8" class="empty-state">暂无数据</td></tr>
            <tr v-for="bm in bookmarks" :key="bm.id">
              <td>{{ bm.id }}</td>
              <td><img v-if="bm.icon" :src="bm.icon" width="20" height="20" style="object-fit:contain;" @error="(e) => (e.target as HTMLElement).style.display='none'"></td>
              <td><a :href="bm.url" target="_blank" rel="noopener" style="color:#667eea;">{{ bm.title }}</a></td>
              <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{{ bm.url }}</td>
              <td>{{ bm.folder_name || '-' }}</td>
              <td>{{ bm.username || bm.user_id }}</td>
              <td><span class="badge" :class="bm.login_required ? 'badge-locked' : 'badge-public'">{{ bm.login_required ? '登录可见' : '公开' }}</span></td>
              <td class="actions">
                <button class="btn btn-ghost btn-sm" @click="openEdit(bm)">编辑</button>
                <button v-if="isAdmin" class="btn btn-danger btn-sm" @click="delBm(bm)">删除</button>
                <button v-if="isAdmin" class="btn btn-ghost btn-sm" @click="downloadIcon(bm.id)">图标</button>
              </td>
            </tr>
          </tbody>
        </table>
        <div class="pagination" v-if="totalPages > 1">
          <button :disabled="page <= 1" @click="page--; loadBookmarks()">上一页</button>
          <button v-for="p in pages" :key="p" :class="{ active: p === page }" @click="page = p; loadBookmarks()">{{ p }}</button>
          <button :disabled="page >= totalPages" @click="page++; loadBookmarks()">下一页</button>
        </div>
      </div>
    </div>

    <!-- 文件夹管理 -->
    <div v-if="tab === 'folders'">
      <div class="card">
        <div class="card-header"><h3>文件夹管理</h3>
          <div>
            <button class="btn btn-primary btn-sm" @click="openFolderCreate">新建文件夹</button>
            <button class="btn btn-ghost btn-sm" @click="toggleAllFolders">{{ allExpanded ? '全部收缩' : '全部展开' }}</button>
            <button class="btn btn-ghost btn-sm" @click="loadFolders">刷新</button>
          </div>
        </div>
        <table>
          <thead><tr><th>名称</th><th>父文件夹</th><th>用户</th><th>书签数</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-if="folderLoading"><td colspan="5" class="empty-state">加载中...</td></tr>
            <tr v-else-if="displayFolders.length === 0"><td colspan="5" class="empty-state">暂无数据</td></tr>
            <tr v-for="f in displayFolders" :key="f.id">
              <td :style="{ paddingLeft: (f._depth * 20 + 16) + 'px' }">
                <span v-if="f._hasChildren" class="expand-btn" @click="collapsedIds.has(f.id) ? collapsedIds.delete(f.id) : collapsedIds.add(f.id)">{{ collapsedIds.has(f.id) ? '▶' : '▼' }}</span>
                <span v-else style="display:inline-block;width:16px;"></span>
                <i v-if="f.icon" :class="f.icon" style="margin-right:4px;font-size:14px;color:#667eea;"></i>
                {{ f.name }}
              </td>
              <td>{{ f.parent_name || '-' }}</td>
              <td>{{ f.username || f.user_id }}</td>
              <td>{{ f.bookmark_count || 0 }}</td>
              <td class="actions">
                <button v-if="isAdmin || f.user_id === currentUserId" class="btn btn-ghost btn-sm" @click="openFolderEdit(f)">编辑</button>
                <button v-if="isAdmin || f.user_id === currentUserId" class="btn btn-danger btn-sm" @click="delFolder(f)">删除</button>
                <span v-if="!isAdmin && f.user_id !== currentUserId" style="color:#aaa;font-size:12px;">🔒 只读</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 文件夹编辑弹窗 -->
    <div v-if="folderEditVisible" class="modal-overlay" @click.self="folderEditVisible = false">
      <div class="modal">
        <div class="modal-header"><h3>{{ folderEditId ? '编辑文件夹' : '新建文件夹' }}</h3><button class="modal-close" @click="folderEditVisible = false">&times;</button></div>
        <div class="modal-body">
          <div class="fg"><label>名称</label><input v-model="folderEditForm.name" type="text" placeholder="文件夹名称"></div>
          <div class="fg" v-if="!folderEditId"><label>用户</label>
            <select v-model="folderEditForm.user_id">
              <option v-for="u in users" :key="u.id" :value="u.id">{{ u.username }}</option>
            </select>
          </div>
          <div class="fg"><label>父文件夹</label>
            <select v-model="folderEditForm.parent_id">
              <option :value="null">无（顶级）</option>
              <option v-for="f in flatFolders.filter(x => x.id !== folderEditId)" :key="f.id" :value="f.id">{{ '│  '.repeat(f._depth) }}{{ f.name }}</option>
            </select>
          </div>
          <div class="fg"><label>图标</label>
            <IconPicker v-model="folderEditForm.icon" />
          </div>
          <div class="form-btns"><button class="btn btn-ghost" @click="folderEditVisible = false">取消</button><button class="btn btn-primary" @click="saveFolderEdit">保存</button></div>
        </div>
      </div>
    </div>

    <!-- 编辑弹窗 -->
    <div v-if="editVisible" class="modal-overlay" @click.self="editVisible = false">
      <div class="modal">
        <div class="modal-header"><h3>编辑书签</h3><button class="modal-close" @click="editVisible = false">&times;</button></div>
        <div class="modal-body">
          <div class="fg"><label>标题</label><input v-model="ef.title" type="text"></div>
          <div class="fg"><label>URL</label><input v-model="ef.url" type="url"></div>
          <div class="fg"><label>图标</label><input v-model="ef.icon" type="text"></div>
          <div class="fg"><label>文件夹</label>
            <select v-model="ef.folder_id">
              <option :value="null">未分类</option>
              <option v-for="f in flatFolders" :key="f.id" :value="f.id">{{ '│  '.repeat(f._depth) }}{{ f.name }}</option>
            </select>
          </div>
          <div class="fg toggle-row"><label>登录可见</label><label class="switch"><input type="checkbox" v-model="ef.login_required" :true-value="1" :false-value="0"><span class="slider round"></span></label></div>
          <div class="form-btns"><button class="btn btn-ghost" @click="editVisible = false">取消</button><button class="btn btn-primary" @click="saveEdit">保存</button></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'admin', layout: 'admin' })

useHead({ title: '书签管理' })

const authStore = useAuthStore()
const isAdmin = computed(() => authStore.isAdmin)
const currentUserId = computed(() => authStore.user?.id)

const tab = ref('list')

// Bookmark list state
const bookmarks = ref<any[]>([])
const loading = ref(false)
const total = ref(0)
const page = ref(1)
const pageSize = 50
const filterFolder = ref<number | null>(null)
const filterTitle = ref('')
const filterUrl = ref('')
const filterCategory = ref<number | null>(null)
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)))
const pages = computed(() => { const a: number[] = []; for (let i = Math.max(1, page.value - 2); i <= Math.min(totalPages.value, page.value + 2); i++) a.push(i); return a })

// Folder state
interface FolderNode { id: number; name: string; parent_id?: number | null; parent_name?: string; username?: string; user_id?: number; bookmark_count?: number; icon?: string; _depth: number; _hasChildren: boolean; _collapsed: boolean; children: FolderNode[] }
const folderAll = ref<any[]>([])
const folderLoading = ref(false)
const allExpanded = ref(true)
const collapsedIds = ref(new Set<number>())

// Folder edit state
const folderEditVisible = ref(false)
const folderEditId = ref<number | null>(null)
const folderEditForm = reactive({ name: '', parent_id: null as number | null, icon: '', user_id: null as number | null })
import IconPicker from '~/components/common/IconPicker.vue'

// Users list (for create mode)
const users = ref<any[]>([])
async function loadUsers() { try { const r = await $fetch<any>('/api/admin/users'); users.value = r.users || [] } catch { users.value = [] } }

function buildTree(list: any[]): FolderNode[] {
  const map = new Map<number, FolderNode>()
  const roots: FolderNode[] = []
  for (const f of list) map.set(f.id, { ...f, _depth: 0, children: [], _hasChildren: false, _collapsed: false })
  for (const n of map.values()) {
    const pid = n.parent_id
    if (pid && map.has(pid)) { map.get(pid)!.children.push(n); map.get(pid)!._hasChildren = true }
    else roots.push(n)
  }
  return roots
}

function flattenTree(nodes: FolderNode[], depth: number): FolderNode[] {
  let r: FolderNode[] = []
  for (const n of nodes) { n._depth = depth; r.push(n); if (n.children.length > 0) r = r.concat(flattenTree(n.children, depth + 1)) }
  return r
}

const flatFolders = computed(() => flattenTree(buildTree(folderAll.value), 0))

// 双层筛选：分类（顶级文件夹）和子文件夹
const categories = computed(() => folderAll.value.filter(f => !f.parent_id))

const subFolders = computed(() => {
  if (filterCategory.value === null) return flatFolders.value
  const catId = filterCategory.value
  // 收集该分类下所有后代 ID
  const descendantIds = new Set<number>([catId])
  let changed = true
  while (changed) {
    changed = false
    for (const f of folderAll.value) {
      if (f.parent_id && descendantIds.has(f.parent_id) && !descendantIds.has(f.id)) {
        descendantIds.add(f.id)
        changed = true
      }
    }
  }
  return flatFolders.value.filter(f => descendantIds.has(f.id))
})

function onCategoryChange() {
  filterFolder.value = null
  loadBookmarks()
}

const displayFolders = computed(() => {
  const tree = buildTree(folderAll.value)
  const result: FolderNode[] = []
  function walk(nodes: FolderNode[], depth: number) {
    for (const n of nodes) {
      n._depth = depth
      n._collapsed = collapsedIds.value.has(n.id)
      result.push(n)
      if (!n._collapsed && n.children.length) walk(n.children, depth + 1)
    }
  }
  walk(tree, 0)
  return result
})

async function loadBookmarks() {
  loading.value = true
  const p = new URLSearchParams({ page: String(page.value), limit: String(pageSize) })
  if (filterFolder.value) p.set('folder_id', String(filterFolder.value))
  if (filterTitle.value) p.set('q', filterTitle.value)
  if (filterUrl.value) p.set('url', filterUrl.value)
  const r = await $fetch<any>(`/api/admin/bookmarks?${p}`)
  bookmarks.value = r.bookmarks || []
  total.value = r.total || 0
  loading.value = false
}

let dt: any = null
function debouncedLoad() { clearTimeout(dt); dt = setTimeout(loadBookmarks, 400) }

async function loadFolders() {
  folderLoading.value = true
  const d = await $fetch<{ folders: any[] }>('/api/admin/folders')
  folderAll.value = d.folders || []
  folderLoading.value = false
}

function toggleAllFolders() {
  allExpanded.value = !allExpanded.value
  if (allExpanded.value) {
    collapsedIds.value = new Set()
  } else {
    // 把所有有子节点的文件夹 ID 加入 collapsedIds
    const ids = new Set<number>()
    const tree = buildTree(folderAll.value)
    function walk(nodes: FolderNode[]) {
      for (const n of nodes) {
        if (n.children.length > 0) { ids.add(n.id); walk(n.children) }
      }
    }
    walk(tree)
    collapsedIds.value = ids
  }
}

// Edit modal
const editVisible = ref(false)
const ef = reactive({ id: 0, title: '', url: '', icon: '', folder_id: null as number | null, login_required: 0 })
function openEdit(bm: any) { Object.assign(ef, { id: bm.id, title: bm.title, url: bm.url, icon: bm.icon || '', folder_id: bm.folder_id ?? null, login_required: bm.login_required || 0 }); editVisible.value = true }
async function saveEdit() { await $fetch(`/api/admin/bookmarks/${ef.id}`, { method: 'PUT', body: { ...ef } }); editVisible.value = false; loadBookmarks() }
async function delBm(bm: any) { if (!confirm(`删除「${bm.title}」？`)) return; await $fetch(`/api/admin/bookmarks/${bm.id}`, { method: 'DELETE' }); loadBookmarks() }
async function downloadIcon(id: number) { await $fetch(`/api/admin/download-favicon/${id}`, { method: 'POST' }); loadBookmarks() }
async function downloadAllFavicons() { await $fetch('/api/admin/download-favicons', { method: 'POST' }) }
async function retryFailed() { await $fetch('/api/admin/retry-failed-favicons', { method: 'POST' }) }
async function forceLocalize() { await $fetch('/api/admin/force-localize-icons', { method: 'POST' }) }

async function exportBookmarks() {
  try {
    const blob = await $fetch('/api/admin/bookmarks/export', {
      headers: { Authorization: `Bearer ${authStore.token}` },
      responseType: 'blob',
    })
    const url = URL.createObjectURL(blob as Blob)
    const a = document.createElement('a')
    a.href = url; a.download = `favshub-bookmarks-all-${Date.now()}.html`
    document.body.appendChild(a); a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  } catch { alert('导出失败') }
}

// Folder ops
function openFolderCreate() {
  folderEditId.value = null
  Object.assign(folderEditForm, { name: '', parent_id: null, icon: '', user_id: users.value[0]?.id || null })
  folderEditVisible.value = true
}
function openFolderEdit(f: any) {
  folderEditId.value = f.id
  Object.assign(folderEditForm, { name: f.name, parent_id: f.parent_id ?? null, icon: f.icon || '', user_id: f.user_id })
  folderEditVisible.value = true
}
async function saveFolderEdit() {
  if (!folderEditForm.name.trim()) return alert('名称不能为空')
  if (folderEditId.value) {
    // Edit mode — PUT
    await $fetch(`/api/admin/folders/${folderEditId.value}`, { method: 'PUT', body: { name: folderEditForm.name, parent_id: folderEditForm.parent_id, icon: folderEditForm.icon || null } })
  } else {
    // Create mode — POST
    if (!folderEditForm.user_id) return alert('请选择用户')
    await $fetch('/api/admin/folders', { method: 'POST', body: { name: folderEditForm.name, user_id: folderEditForm.user_id, parent_id: folderEditForm.parent_id, icon: folderEditForm.icon || null } })
  }
  folderEditVisible.value = false
  loadFolders()
}
async function delFolder(f: any) { if (!confirm(`删除「${f.name}」？`)) return; await $fetch(`/api/admin/folders/${f.id}`, { method: 'DELETE' }); loadFolders() }

onMounted(() => { loadBookmarks(); loadFolders(); loadUsers() })
</script>

<style scoped>
.admin-page { max-width: 1400px; margin: 0 auto; padding: 32px; }
.page-header { margin-bottom: 24px; }
.page-header h1 { font-size: 22px; font-weight: 600; }
.page-header p { color: #888; font-size: 14px; margin-top: 4px; }
.tab-nav { display: flex; gap: 0; margin-bottom: 16px; border-bottom: 2px solid #eee; }
.tab-nav button { padding: 10px 20px; border: none; background: none; font-size: 14px; cursor: pointer; color: #888; border-bottom: 2px solid transparent; margin-bottom: -2px; }
.tab-nav button.active { color: #667eea; border-bottom-color: #667eea; }
.filter-bar { display: flex; align-items: center; gap: 10px; padding: 12px 16px; background: #fff; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,.08); margin-bottom: 16px; flex-wrap: wrap; }
.filter-bar select, .filter-bar input { padding: 6px 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 13px; }
.filter-bar .info { font-size: 13px; color: #999; }
.card { background: #fff; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,.08); overflow: hidden; }
.card-header { padding: 16px 20px; border-bottom: 1px solid #f0f0f0; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }
.card-header h3 { font-size: 16px; margin: 0; }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; padding: 12px 16px; font-size: 12px; color: #888; font-weight: 600; text-transform: uppercase; border-bottom: 1px solid #f0f0f0; background: #fafafa; }
td { padding: 12px 16px; font-size: 14px; border-bottom: 1px solid #f5f5f5; }
tr:hover { background: #fafafa; }
.actions { display: flex; gap: 4px; flex-wrap: wrap; }
.btn { padding: 6px 14px; border-radius: 6px; font-size: 13px; cursor: pointer; border: none; transition: all 0.2s; }
.btn-primary { background: #667eea; color: #fff; }
.btn-primary:hover { background: #5a6fd6; }
.btn-danger { background: #e74c3c; color: #fff; }
.btn-danger:hover { background: #c0392b; }
.btn-sm { padding: 4px 10px; font-size: 12px; }
.btn-ghost { background: none; border: 1px solid #ddd; color: #666; }
.btn-ghost:hover { background: #f5f5f5; }
.badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; }
.badge-public { background: #f0fdf4; color: #166534; }
.badge-locked { background: #fef3c7; color: #92400e; }
.empty-state { text-align: center; padding: 40px; color: #888; }
.pagination { display: flex; align-items: center; justify-content: center; gap: 4px; padding: 16px; }
.pagination button { padding: 6px 12px; border: 1px solid #ddd; background: #fff; border-radius: 6px; cursor: pointer; font-size: 13px; }
.pagination button.active { background: #667eea; color: #fff; border-color: #667eea; }
.pagination button:disabled { opacity: .4; cursor: not-allowed; }
.expand-btn { cursor: pointer; width: 16px; display: inline-block; text-align: center; user-select: none; }
.modal-overlay { display: flex; position: fixed; inset: 0; background: rgba(0,0,0,.4); z-index: 1000; align-items: center; justify-content: center; }
.modal { background: #fff; border-radius: 12px; width: 90%; max-width: 700px; max-height: 80vh; overflow-y: auto; box-shadow: 0 20px 60px rgba(0,0,0,.2); }
.modal-header { padding: 20px 24px; border-bottom: 1px solid #f0f0f0; display: flex; justify-content: space-between; align-items: center; }
.modal-header h3 { margin: 0; font-size: 16px; }
.modal-close { background: none; border: none; font-size: 20px; cursor: pointer; color: #888; }
.modal-body { padding: 20px 24px; }
.fg { margin-bottom: 12px; }
.fg label { display: block; font-size: 13px; color: #666; margin-bottom: 4px; }
.fg input, .fg select { width: 100%; padding: 8px 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; box-sizing: border-box; }
.form-btns { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.toggle-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; }
.toggle-row > label:first-child { margin-bottom: 0; font-size: 13px; color: #666; }
.switch { position: relative; display: inline-block; width: 42px; height: 24px; flex-shrink: 0; }
.switch input { opacity: 0; width: 0; height: 0; }
.slider { position: absolute; inset: 0; background: #ccc; border-radius: 34px; cursor: pointer; transition: .4s; }
.slider:before { content: ''; position: absolute; height: 16px; width: 16px; left: 4px; bottom: 4px; background: #fff; border-radius: 50%; transition: .4s; }
.switch input:checked + .slider { background: #10b981; }
.switch input:checked + .slider:before { transform: translateX(16px); }
.icon-picker-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
.icon-pick-option { display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; border: 2px solid #e5e7eb; border-radius: 8px; cursor: pointer; font-size: 18px; color: #6b7280; transition: all .15s; }
.icon-pick-option:hover { border-color: #667eea; color: #667eea; background: #f0f1ff; }
.icon-pick-option.active { border-color: #667eea; color: #667eea; background: #eef2ff; }
/* ── Mobile responsive ── */
@media (max-width: 768px) {
  .admin-page { padding: 16px; }
  .page-header h1 { font-size: 18px; }
  .filter-bar { padding: 10px 12px; gap: 8px; }
  .filter-bar select, .filter-bar input { padding: 6px 8px; font-size: 12px; }
  table { display: block; overflow-x: auto; -webkit-overflow-scrolling: touch; }
  th, td { padding: 8px 12px; font-size: 13px; white-space: nowrap; }
  .btn { padding: 8px 16px; font-size: 14px; }
  .btn-sm { padding: 6px 12px; font-size: 13px; }
  .modal { width: 95%; max-height: 90vh; }
  .modal-header { padding: 14px 16px; }
  .modal-body { padding: 14px 16px; }
  .card-header { padding: 12px 16px; flex-wrap: wrap; gap: 8px; }
  .card-header h3 { font-size: 14px; }
}
@media (max-width: 480px) {
  .admin-page { padding: 12px; }
  .page-header h1 { font-size: 16px; }
}
</style>
