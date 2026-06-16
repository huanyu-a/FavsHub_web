<template>
  <div class="admin-page">
    <header class="page-header">
      <h1>提示词管理</h1>
      <p>查看和管理所有用户的提示词、标签和文件夹</p>
    </header>
    <div class="stats-grid">
      <div class="stat-card"><div class="label">提示词</div><div class="value blue">{{ promptStats.total }}</div></div>
      <div class="stat-card"><div class="label">文件夹</div><div class="value green">{{ promptStats.folders }}</div></div>
      <div class="stat-card"><div class="label">标签</div><div class="value purple">{{ promptStats.tags }}</div></div>
      <div class="stat-card"><div class="label">版本</div><div class="value orange">{{ promptStats.versions }}</div></div>
    </div>
    <div class="tab-nav">
      <button :class="{ active: tab === 'prompts' }" @click="tab = 'prompts'">提示词列表</button>
      <button :class="{ active: tab === 'folders' }" @click="tab = 'folders'">文件夹管理</button>
      <button :class="{ active: tab === 'tags' }" @click="tab = 'tags'">标签管理</button>
      <button :class="{ active: tab === 'history' }" @click="tab = 'history'">历史记录</button>
      <button :class="{ active: tab === 'tdk' }" @click="tab = 'tdk'">TDK 设置</button>
    </div>
    <!-- 提示词列表 -->
    <div v-if="tab === 'prompts'" class="card">
      <div class="card-header"><h3>提示词列表</h3>
        <div>
          <button class="btn btn-ghost btn-sm" @click="exportJSON">导出JSON</button>
          <button class="btn btn-ghost btn-sm" @click="triggerImport">导入JSON</button>
          <input ref="importFile" type="file" accept=".json" style="display:none" @change="importJSON">
          <button class="btn btn-ghost btn-sm" @click="loadPrompts">刷新</button>
        </div>
      </div>
      <table>
        <thead><tr><th>标题</th><th>描述</th><th>文件夹</th><th>标签</th><th>用户</th><th>版本</th><th>更新时间</th><th>可见性</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-if="pLoading"><td colspan="10" class="empty-state">加载中...</td></tr>
          <tr v-else-if="prompts.length === 0"><td colspan="10" class="empty-state">暂无数据</td></tr>
          <tr v-for="p in prompts" :key="p.id">
            <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{{ p.title }}</td>
            <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{{ p.description || '-' }}</td>
            <td>{{ p.folder_name || '-' }}</td>
            <td><span v-for="t in (p.tags || [])" :key="t.id || t" class="tag-chip" :style="{ background: (typeof t === 'object' ? t.color : null) || '#e0e7ff' }">{{ typeof t === 'object' ? t.name : t }}</span></td>
            <td>{{ p.username || p.user_id }}</td>
            <td>{{ p.current_version || '1.0.0' }}</td>
            <td>{{ p.updated_at ? new Date(p.updated_at).toLocaleString() : '-' }}</td>
            <td><span class="badge" :class="p.login_required ? 'badge-locked' : 'badge-public'">{{ p.login_required ? '登录可见' : '公开' }}</span></td>
            <td class="actions">
              <button class="btn btn-ghost btn-sm" @click="viewHistory(p)">历史</button>
              <button class="btn btn-ghost btn-sm" @click="openEdit(p)">编辑</button>
              <button v-if="isAdmin" class="btn btn-danger btn-sm" @click="delPrompt(p)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
      <div class="pagination" v-if="pTotalPages > 1">
        <button :disabled="pPage <= 1" @click="pPage--; loadPrompts()">上一页</button>
        <button v-for="n in pPages" :key="n" :class="{ active: n === pPage }" @click="pPage = n; loadPrompts()">{{ n }}</button>
        <button :disabled="pPage >= pTotalPages" @click="pPage++; loadPrompts()">下一页</button>
      </div>
    </div>
    <!-- 文件夹 -->
    <div v-if="tab === 'folders'" class="card">
      <div class="card-header"><h3>提示词文件夹</h3>
        <div>
          <button class="btn btn-primary btn-sm" @click="createPFolder">新建文件夹</button>
          <button class="btn btn-ghost btn-sm" @click="toggleAllPFolders">{{ allPExpanded ? '全部收缩' : '全部展开' }}</button>
          <button class="btn btn-ghost btn-sm" @click="loadPFolders">刷新</button>
        </div>
      </div>
      <table>
        <thead><tr><th>名称</th><th>父文件夹</th><th>用户</th><th>提示词数</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-if="pfLoading"><td colspan="5" class="empty-state">加载中...</td></tr>
          <tr v-else-if="displayPFolders.length === 0"><td colspan="5" class="empty-state">暂无数据</td></tr>
          <tr v-for="f in displayPFolders" :key="f.id">
            <td :style="{ paddingLeft: (f._depth * 20 + 16) + 'px' }">
              <span v-if="f._hasChildren" class="expand-btn" @click="pCollapsedIds.has(f.id) ? pCollapsedIds.delete(f.id) : pCollapsedIds.add(f.id)">{{ pCollapsedIds.has(f.id) ? '▶' : '▼' }}</span>
              <span v-else style="display:inline-block;width:16px;"></span>
              <i v-if="f.icon" :class="f.icon" style="margin-right:4px;font-size:14px;color:#667eea;"></i>
              {{ f.name }}
            </td>
            <td>{{ f.parent_name || '-' }}</td>
            <td>{{ f.username || f.user_id }}</td>
            <td>{{ f.prompt_count || 0 }}</td>
            <td class="actions">
              <button v-if="isAdmin || f.user_id === currentUserId" class="btn btn-ghost btn-sm" @click="openFolderEdit(f)">编辑</button>
              <button v-if="isAdmin || f.user_id === currentUserId" class="btn btn-danger btn-sm" @click="delPFolder(f)">删除</button>
              <span v-if="!isAdmin && f.user_id !== currentUserId" style="color:#aaa;font-size:12px;">🔒 只读</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <!-- 标签 -->
    <div v-if="tab === 'tags'" class="card">
      <div class="card-header"><h3>标签管理</h3>
        <button class="btn btn-primary btn-sm" @click="createTag">新建标签</button>
      </div>
      <table>
        <thead><tr><th>名称</th><th>颜色</th><th>用户</th><th>使用次数</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-if="tagLoading"><td colspan="5" class="empty-state">加载中...</td></tr>
          <tr v-else-if="tags.length === 0"><td colspan="5" class="empty-state">暂无数据</td></tr>
          <tr v-for="t in tags" :key="t.id">
            <td><span class="tag-chip" :style="{ background: t.color || '#e0e7ff' }">{{ t.name }}</span></td>
            <td>{{ t.color || '-' }}</td><td>{{ t.username || t.user_id }}</td>
            <td>{{ t.prompt_count || 0 }}</td>
            <td class="actions">
              <button v-if="isAdmin || t.user_id === currentUserId" class="btn btn-danger btn-sm" @click="delTag(t)">删除</button>
              <span v-if="!isAdmin && t.user_id !== currentUserId" style="color:#aaa;font-size:12px;">🔒 只读</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <!-- 历史记录 -->
    <div v-if="tab === 'history'" class="card">
      <div class="card-header"><h3>版本历史记录</h3>
        <button class="btn btn-ghost btn-sm" @click="loadHistory">刷新</button>
      </div>
      <table>
        <thead><tr><th>提示词</th><th>版本号</th><th>用户</th><th>创建时间</th><th>预览</th></tr></thead>
        <tbody>
          <tr v-if="hLoading"><td colspan="5" class="empty-state">加载中...</td></tr>
          <tr v-else-if="history.length === 0"><td colspan="5" class="empty-state">暂无数据</td></tr>
          <tr v-for="h in history" :key="h.id">
            <td>{{ h.prompt_title || '-' }}</td><td>{{ h.version_number }}</td>
            <td>{{ h.username || h.user_id }}</td>
            <td>{{ h.created_at ? new Date(h.created_at).toLocaleString() : '-' }}</td>
            <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{{ h.content?.slice(0, 80) || '-' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <!-- TDK -->
    <div v-if="tab === 'tdk'" class="setting-card">
      <h3>提示词页面 TDK 设置</h3>
      <p class="hint">留空则使用系统 TDK 设置</p>
      <div class="fg"><label>页面标题</label><input v-model="tdk.promptproTitle" placeholder="PromptPro - 提示词管理" @input="saveTdk"></div>
      <div class="fg"><label>页面描述</label><input v-model="tdk.promptproDescription" placeholder="AI提示词管理平台" @input="saveTdk"></div>
      <div class="fg"><label>关键词</label><input v-model="tdk.promptproKeywords" placeholder="提示词,AI,prompt" @input="saveTdk"></div>
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
              <option v-for="f in flatPFolders.filter(x => x.id !== folderEditId)" :key="f.id" :value="f.id">{{ '│  '.repeat(f._depth) }}{{ f.name }}</option>
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
        <div class="modal-header"><h3>编辑提示词</h3><button class="modal-close" @click="editVisible = false">&times;</button></div>
        <div class="modal-body">
          <div class="fg"><label>标题</label><input v-model="ef.title" type="text"></div>
          <div class="fg"><label>描述</label><input v-model="ef.description" type="text"></div>
          <div class="fg"><label>内容</label><textarea v-model="ef.content" rows="6"></textarea></div>
          <div class="fg"><label>文件夹</label><select v-model="ef.folder_id"><option :value="null">未分类</option><option v-for="f in flatPFolders" :key="f.id" :value="f.id">{{ '│  '.repeat(f._depth) }}{{ f.name }}</option></select></div>
          <div class="fg toggle-row"><label>登录可见</label><label class="switch"><input type="checkbox" v-model="ef.login_required" :true-value="1" :false-value="0"><span class="slider round"></span></label></div>
          <div class="form-btns"><button class="btn btn-ghost" @click="editVisible = false">取消</button><button class="btn btn-primary" @click="saveEdit">保存</button></div>
        </div>
      </div>
    </div>
  </div>
</template>
/^<\/script>$/a
/^  }$/a
/^}$/a
/^    <\/header>$/a
/^    <\/template>$/a
/^    <\/div>$/a
<script setup lang="ts">
definePageMeta({ middleware: 'admin', layout: 'admin' })
useHead({ title: '提示词管理' })
const authStore = useAuthStore()
const isAdmin = computed(() => authStore.isAdmin)
const currentUserId = computed(() => authStore.user?.id)
function getAuthHeaders(): Record<string, string> {
  return authStore.token ? { Authorization: `Bearer ${authStore.token}` } : {}
}
const tab = ref('prompts')
// Prompts list
const prompts = ref<any[]>([])
const pLoading = ref(false)
const pTotal = ref(0)
const pPage = ref(1)
const pPageSize = 30
const pTotalPages = computed(() => Math.max(1, Math.ceil(pTotal.value / pPageSize)))
const pPages = computed(() => { const a: number[] = []; for (let i = Math.max(1, pPage.value - 2); i <= Math.min(pTotalPages.value, pPage.value + 2); i++) a.push(i); return a })
const promptStats = reactive({ total: 0, folders: 0, tags: 0, versions: 0 })
async function loadPrompts() {
  pLoading.value = true
  const r = await $fetch<any>(`/api/admin/prompts?page=${pPage.value}&limit=${pPageSize}`, { headers: getAuthHeaders() })
  prompts.value = r.prompts || []
  pTotal.value = r.total || r.prompts?.length || 0
  pLoading.value = false
}
async function loadStats() {
  const d = await $fetch<any>('/api/admin/stats', { headers: getAuthHeaders() })
  promptStats.total = d.prompts || 0
  promptStats.folders = d.promptFolders || 0
  promptStats.tags = d.tags || 0
  promptStats.versions = d.promptVersions || 0
}
// Folders
const pFolders = ref<any[]>([])
const pfLoading = ref(false)
const folderEditVisible = ref(false)
const folderEditId = ref<string | null>(null)
const folderEditForm = reactive({ name: '', parent_id: null as string | null, icon: '', user_id: null as number | null })
import IconPicker from '~/components/common/IconPicker.vue'
// Users list (for create mode)
const users = ref<any[]>([])
async function loadUsers() { try { const r = await $fetch<any>('/api/admin/users'); users.value = r.users || [] } catch { users.value = [] } }
// Tree building for prompt folders (string IDs)
interface PFolderNode { id: string; name: string; parent_id?: string | null; parent_name?: string; username?: string; user_id?: number; prompt_count?: number; icon?: string; _depth: number; _hasChildren: boolean; children: PFolderNode[] }
function buildPTree(list: any[]): PFolderNode[] {
  const map = new Map<string, PFolderNode>()
  const roots: PFolderNode[] = []
  for (const f of list) map.set(f.id, { ...f, _depth: 0, children: [], _hasChildren: false })
  for (const n of map.values()) {
    const pid = n.parent_id
    if (pid && map.has(pid)) { map.get(pid)!.children.push(n); map.get(pid)!._hasChildren = true }
    else roots.push(n)
  }
  return roots
}
function flattenPTree(nodes: PFolderNode[], depth: number): PFolderNode[] {
  let r: PFolderNode[] = []
  for (const n of nodes) { n._depth = depth; r.push(n); if (n.children.length > 0) r = r.concat(flattenPTree(n.children, depth + 1)) }
  return r
}
const flatPFolders = computed(() => flattenPTree(buildPTree(pFolders.value), 0))
// Collapse/expand state
const allPExpanded = ref(true)
const pCollapsedIds = ref(new Set<string>())
const displayPFolders = computed(() => {
  const tree = buildPTree(pFolders.value)
  const result: PFolderNode[] = []
  function walk(nodes: PFolderNode[], depth: number) {
    for (const n of nodes) {
      n._depth = depth
      result.push(n)
      if (!pCollapsedIds.value.has(n.id) && n.children.length) walk(n.children, depth + 1)
    }
  }
  walk(tree, 0)
  return result
})
function toggleAllPFolders() {
  allPExpanded.value = !allPExpanded.value
  if (allPExpanded.value) {
    pCollapsedIds.value = new Set()
  } else {
    const ids = new Set<string>()
    const tree = buildPTree(pFolders.value)
    function walk(nodes: PFolderNode[]) { for (const n of nodes) { if (n.children.length > 0) { ids.add(n.id); walk(n.children) } } }
    walk(tree)
    pCollapsedIds.value = ids
  }
}
async function loadPFolders() { pfLoading.value = true; const d = await $fetch<{ folders: any[] }>('/api/admin/prompt-folders', { headers: getAuthHeaders() }); pFolders.value = d.folders || []; pfLoading.value = false }
function createPFolder() { Object.assign(folderEditForm, { name: '', parent_id: null, icon: '', user_id: users.value[0]?.id || null }); folderEditId.value = null; folderEditVisible.value = true }
function openFolderEdit(f: any) { Object.assign(folderEditForm, { name: f.name, parent_id: f.parent_id || null, icon: f.icon || '', user_id: f.user_id }); folderEditId.value = f.id; folderEditVisible.value = true }
async function saveFolderEdit() {
  if (!folderEditForm.name.trim()) return alert('请输入文件夹名称')
  if (folderEditId.value) {
    await $fetch(`/api/admin/prompt-folders/${folderEditId.value}`, { method: 'PUT', headers: getAuthHeaders(), body: { name: folderEditForm.name, parent_id: folderEditForm.parent_id, icon: folderEditForm.icon || null } })
  } else {
    if (!folderEditForm.user_id) return alert('请选择用户')
    await $fetch('/api/admin/prompt-folders', { method: 'POST', headers: getAuthHeaders(), body: { name: folderEditForm.name, parent_id: folderEditForm.parent_id, icon: folderEditForm.icon || null, user_id: folderEditForm.user_id } })
  }
  folderEditVisible.value = false
  loadPFolders()
}
async function delPFolder(f: any) { if (!confirm(`删除「${f.name}」？`)) return; await $fetch(`/api/admin/prompt-folders/${f.id}`, { method: 'DELETE', headers: getAuthHeaders() }); loadPFolders() }
// Tags
const tags = ref<any[]>([])
const tagLoading = ref(false)
async function loadTags() { tagLoading.value = true; const d = await $fetch<{ tags: any[] }>('/api/admin/tags', { headers: getAuthHeaders() }); tags.value = d.tags || []; tagLoading.value = false }
async function createTag() { const n = prompt('标签名称'); if (n) { await $fetch('/api/tags', { method: 'POST', headers: getAuthHeaders(), body: { name: n } }); loadTags() } }
async function delTag(t: any) { if (!confirm(`删除标签「${t.name}」？`)) return; await $fetch(`/api/tags/${t.id}`, { method: 'DELETE', headers: getAuthHeaders() }); loadTags() }
// History
const history = ref<any[]>([])
const hLoading = ref(false)
async function loadHistory() { hLoading.value = true; const d = await $fetch<any>('/api/admin/prompts/history', { headers: getAuthHeaders() }); history.value = d.versions || []; hLoading.value = false }
function viewHistory(p: any) { tab.value = 'history'; loadHistory() }
// TDK
const tdk = reactive({ promptproTitle: '', promptproDescription: '', promptproKeywords: '' })
async function loadTdk() { const d = await $fetch<any>('/api/tdk/promptpro', { headers: getAuthHeaders() }); Object.assign(tdk, { promptproTitle: d.promptproTitle || '', promptproDescription: d.promptproDescription || '', promptproKeywords: d.promptproKeywords || '' }) }
let tdkTimer: any = null
function saveTdk() { clearTimeout(tdkTimer); tdkTimer = setTimeout(async () => { try { await $fetch('/api/admin/config', { method: 'PUT', headers: getAuthHeaders(), body: { data: { ...tdk } } }) } catch (e) { console.error('保存 TDK 失败', e) } }, 500) }
// Edit modal
const editVisible = ref(false)
const ef = reactive({ id: '', title: '', description: '', content: '', folder_id: null as string | null, login_required: 0 })
function openEdit(p: any) { Object.assign(ef, { id: p.id, title: p.title, description: p.description || '', content: p.content || '', folder_id: p.folder_id ?? null, login_required: p.login_required || 0 }); editVisible.value = true }
async function saveEdit() { await $fetch(`/api/admin/prompts/${ef.id}`, { method: 'PUT', headers: getAuthHeaders(), body: { ...ef } }); editVisible.value = false; loadPrompts() }
async function delPrompt(p: any) { if (!confirm(`删除「${p.title}」？`)) return; await $fetch(`/api/admin/prompts/${p.id}`, { method: 'DELETE', headers: getAuthHeaders() }); loadPrompts(); loadStats() }
// Import/Export
const importFile = ref<HTMLInputElement | null>(null)
function triggerImport() { importFile.value?.click() }
async function exportJSON() { const d = await $fetch<any>('/api/admin/prompts?limit=10000', { headers: getAuthHeaders() }); const blob = new Blob([JSON.stringify(d.prompts || [], null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'prompts-export.json'; a.click() }
async function importJSON(e: Event) { const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return; const text = await f.text(); const items = JSON.parse(text); if (Array.isArray(items)) { await $fetch('/api/admin/sync-prompts', { method: 'POST', headers: getAuthHeaders(), body: { items } }); loadPrompts(); loadStats() } }
onMounted(() => { loadPrompts(); loadStats(); loadPFolders(); loadTags(); loadHistory(); loadTdk(); loadUsers() })
</script>
