<template>
  <div class="prompts-layout">
    <!-- 左侧导航 -->
    <aside class="prompts-sidebar">
      <div class="sidebar-section">
        <div class="section-header">
          <span>文件夹</span>
          <button v-if="!isGuest" class="icon-btn" @click="showFolderDialog = true" title="新建文件夹"><i class="ri-add-line"></i></button>
        </div>
        <ul class="folder-list">
          <li :class="{ active: !activeFolderId }" @click="activeFolderId = null; loadPrompts()">
            <i class="ri-folder-3-line"></i>
            <span>全部</span>
            <span class="count">{{ allPromptCount }}</span>
          </li>
          <li :class="{ active: activeFolderId === '_favorites' }" @click="activeFolderId = '_favorites'; loadPrompts()">
            <i class="ri-star-line"></i>
            <span>收藏</span>
          </li>
          <li
            v-for="folder in folders"
            :key="folder.id"
            :class="{ active: activeFolderId === folder.id }"
            @click="activeFolderId = folder.id; loadPrompts()"
          >
            <i class="ri-folder-3-line"></i>
            <span>{{ folder.name }}</span>
            <span class="count">{{ folder.prompt_count || 0 }}</span>
          </li>
        </ul>
      </div>
      <div class="sidebar-section">
        <div class="section-header">
          <span>标签</span>
        </div>
        <div class="tag-list">
          <span
            v-for="tag in tags"
            :key="tag.id"
            class="tag-chip"
            :class="{ active: activeTagIds.includes(tag.id) }"
            @click="toggleTag(tag.id)"
          >
            {{ tag.name }}
          </span>
          <span v-if="tags.length === 0" class="no-tags">暂无标签</span>
        </div>
      </div>
    </aside>

    <!-- 主内容区 -->
    <div class="prompts-main">
      <header class="prompts-header">
        <h1>提示词管理</h1>
        <div class="header-actions">
          <input v-model="searchQuery" type="text" class="search-input" placeholder="搜索提示词..." @input="debouncedSearch">
          <button v-if="!isGuest" class="btn btn-primary" @click="openCreate">
            <i class="ri-add-line"></i> 新建提示词
          </button>
        </div>
      </header>

      <div v-if="isLoading" class="loading">加载中...</div>
      <div v-else-if="prompts.length === 0" class="empty">
        <i class="ri-chat-quote-line empty-icon"></i>
        <p>暂无提示词</p>
        <button v-if="!isGuest" class="btn btn-primary" @click="openCreate">创建第一个提示词</button>
      </div>
      <div v-else class="prompts-grid">
        <div v-for="prompt in prompts" :key="prompt.id" class="prompt-card" @click="viewPrompt(prompt)">
          <div class="card-top">
            <h3>{{ prompt.title }}</h3>
            <div class="card-actions">
              <button class="icon-btn" @click.stop="toggleFavorite(prompt)" :title="prompt.is_favorite ? '取消收藏' : '收藏'">
                <i :class="prompt.is_favorite ? 'ri-star-fill fav-active' : 'ri-star-line'"></i>
              </button>
              <button v-if="!isGuest" class="icon-btn" @click.stop="openEdit(prompt)" title="编辑">
                <i class="ri-edit-line"></i>
              </button>
              <button v-if="!isGuest" class="icon-btn btn-danger-icon" @click.stop="deletePrompt(prompt)" title="删除">
                <i class="ri-delete-bin-line"></i>
              </button>
            </div>
          </div>
          <p v-if="prompt.description" class="card-desc">{{ prompt.description }}</p>
          <p class="card-content">{{ prompt.content }}</p>
          <div class="card-footer">
            <div class="card-tags">
              <span v-for="tag in (prompt.tags || [])" :key="tag.id" class="mini-tag" :style="tag.color ? { background: tag.color + '20', color: tag.color } : {}">
                {{ tag.name }}
              </span>
            </div>
            <span class="card-version">v{{ prompt.current_version || '1.0.0' }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 查看详情弹窗 -->
    <div v-if="viewingPrompt" class="modal-overlay" @click.self="viewingPrompt = null">
      <div class="modal modal-lg">
        <div class="modal-header">
          <h3>{{ viewingPrompt.title }}</h3>
          <div class="modal-header-actions">
            <button class="btn btn-ghost btn-sm" @click="copyContent(viewingPrompt.content)">
              <i class="ri-file-copy-line"></i> 复制
            </button>
            <button class="btn btn-ghost btn-sm" @click="viewVersions(viewingPrompt)">
              <i class="ri-history-line"></i> 历史
            </button>
            <button v-if="!isGuest" class="btn btn-ghost btn-sm" @click="openEdit(viewingPrompt); viewingPrompt = null">
              <i class="ri-edit-line"></i> 编辑
            </button>
            <button class="modal-close" @click="viewingPrompt = null">&times;</button>
          </div>
        </div>
        <div class="modal-body">
          <p v-if="viewingPrompt.description" class="detail-desc">{{ viewingPrompt.description }}</p>
          <pre class="detail-content">{{ viewingPrompt.content }}</pre>
          <div v-if="viewingPrompt.tags?.length" class="detail-tags">
            <span v-for="tag in viewingPrompt.tags" :key="tag.id" class="tag-chip-sm">{{ tag.name }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 创建/编辑弹窗 -->
    <div v-if="showEditDialog" class="modal-overlay" @click.self="showEditDialog = false">
      <div class="modal modal-lg">
        <div class="modal-header">
          <h3>{{ isCreating ? '新建提示词' : '编辑提示词' }}</h3>
          <button class="modal-close" @click="showEditDialog = false">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>标题 *</label>
            <input v-model="editForm.title" type="text" placeholder="提示词标题">
          </div>
          <div class="form-group">
            <label>描述</label>
            <input v-model="editForm.description" type="text" placeholder="简短描述（可选）">
          </div>
          <div class="form-group">
            <label>内容 *</label>
            <textarea v-model="editForm.content" rows="10" placeholder="提示词内容"></textarea>
          </div>
          <div class="form-row">
            <div class="form-group flex-1">
              <label>文件夹</label>
              <select v-model="editForm.folder_id">
                <option :value="null">未分类</option>
                <option v-for="f in folders" :key="f.id" :value="f.id">{{ f.name }}</option>
              </select>
            </div>
          </div>
          <div class="form-group">
            <label>标签（用空格分隔）</label>
            <input v-model="editForm.tagsInput" type="text" placeholder="标签1 标签2 ...">
          </div>
          <div class="form-buttons">
            <button class="btn btn-ghost" @click="showEditDialog = false">取消</button>
            <button class="btn btn-primary" @click="savePrompt">保存</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 版本历史弹窗 -->
    <div v-if="showVersions" class="modal-overlay" @click.self="showVersions = false">
      <div class="modal modal-lg">
        <div class="modal-header">
          <h3>版本历史 — {{ versionsTitle }}</h3>
          <button class="modal-close" @click="showVersions = false">&times;</button>
        </div>
        <div class="modal-body">
          <div v-if="versionsLoading" class="loading-sm">加载中...</div>
          <div v-else-if="versions.length === 0" class="empty-sm">暂无版本历史</div>
          <div v-else class="versions-list">
            <div v-for="v in versions" :key="v.id" class="version-item">
              <div class="version-header">
                <span class="version-num">v{{ v.version_number }}</span>
                <span class="version-date">{{ formatTime(v.created_at) }}</span>
                <button class="btn btn-ghost btn-sm" @click="restoreVersion(v)">恢复</button>
              </div>
              <pre class="version-content">{{ v.content }}</pre>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 文件夹弹窗 -->
    <div v-if="showFolderDialog" class="modal-overlay" @click.self="showFolderDialog = false">
      <div class="modal modal-sm">
        <div class="modal-header">
          <h3>新建文件夹</h3>
          <button class="modal-close" @click="showFolderDialog = false">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>文件夹名称</label>
            <input v-model="newFolderName" type="text" placeholder="输入名称">
          </div>
          <div class="form-buttons">
            <button class="btn btn-ghost" @click="showFolderDialog = false">取消</button>
            <button class="btn btn-primary" @click="createFolder">创建</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
useHead({ title: 'PromptPro - 提示词管理' })

const { isGuest } = useAuth()

interface Prompt {
  id: string
  title: string
  description?: string
  content: string
  folder_id?: string
  is_favorite?: number
  current_version?: string
  login_required?: number
  tags?: { id: number; name: string; color?: string }[]
  created_at?: number
  updated_at?: number
}

interface Folder {
  id: string
  name: string
  prompt_count?: number
}

interface Tag {
  id: number
  name: string
  color?: string
}

const prompts = ref<Prompt[]>([])
const folders = ref<Folder[]>([])
const tags = ref<Tag[]>([])
const isLoading = ref(false)
const searchQuery = ref('')
const activeFolderId = ref<string | null>(null)
const activeTagIds = ref<number[]>([])

const viewingPrompt = ref<Prompt | null>(null)
const showEditDialog = ref(false)
const isCreating = ref(true)
const editingPrompt = ref<Prompt | null>(null)
const showVersions = ref(false)
const versionsTitle = ref('')
const versions = ref<any[]>([])
const versionsLoading = ref(false)
const showFolderDialog = ref(false)
const newFolderName = ref('')

const editForm = reactive({
  title: '',
  description: '',
  content: '',
  folder_id: null as string | null,
  tagsInput: '',
})

const allPromptCount = computed(() => prompts.value.length)

let searchTimeout: ReturnType<typeof setTimeout>
function debouncedSearch() {
  clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => loadPrompts(), 300)
}

async function loadPrompts() {
  isLoading.value = true
  try {
    const params: Record<string, string> = {}
    if (searchQuery.value) params.search = searchQuery.value
    if (activeFolderId.value && activeFolderId.value !== '_favorites') params.folder_id = activeFolderId.value
    if (activeFolderId.value === '_favorites') params.favorites = '1'
    if (activeTagIds.value.length > 0) params.tag_ids = activeTagIds.value.join(',')

    const query = new URLSearchParams(params).toString()
    const data = await $fetch<{ prompts: Prompt[] }>(`/api/prompts${query ? '?' + query : ''}`)
    prompts.value = data?.prompts || []
  } catch { prompts.value = [] }
  isLoading.value = false
}

async function loadFolders() {
  try {
    const data = await $fetch<{ folders: Folder[] }>('/api/prompts/folders/all')
    folders.value = data?.folders || []
  } catch { folders.value = [] }
}

async function loadTags() {
  try {
    const data = await $fetch<{ tags: Tag[] }>('/api/tags')
    tags.value = data?.tags || []
  } catch { tags.value = [] }
}

function toggleTag(id: number) {
  const idx = activeTagIds.value.indexOf(id)
  if (idx >= 0) activeTagIds.value.splice(idx, 1)
  else activeTagIds.value.push(id)
  loadPrompts()
}

function viewPrompt(prompt: Prompt) {
  viewingPrompt.value = prompt
}

function openCreate() {
  isCreating.value = true
  editingPrompt.value = null
  editForm.title = ''
  editForm.description = ''
  editForm.content = ''
  editForm.folder_id = activeFolderId.value && activeFolderId.value !== '_favorites' ? activeFolderId.value : null
  editForm.tagsInput = ''
  showEditDialog.value = true
}

function openEdit(prompt: Prompt) {
  isCreating.value = false
  editingPrompt.value = prompt
  editForm.title = prompt.title
  editForm.description = prompt.description || ''
  editForm.content = prompt.content
  editForm.folder_id = prompt.folder_id || null
  editForm.tagsInput = (prompt.tags || []).map(t => t.name).join(' ')
  showEditDialog.value = true
}

async function savePrompt() {
  if (!editForm.title.trim() || !editForm.content.trim()) return alert('标题和内容不能为空')

  // 处理标签：查找或创建标签
  const tagNames = editForm.tagsInput.trim().split(/\s+/).filter(Boolean)
  const tagIds: number[] = []
  for (const name of tagNames) {
    const existing = tags.value.find(t => t.name === name)
    if (existing) {
      tagIds.push(existing.id)
    } else {
      try {
        const res = await $fetch<{ tag: Tag }>('/api/tags', { method: 'POST', body: { name } })
        if (res?.tag) {
          tagIds.push(res.tag.id)
          tags.value.push(res.tag)
        }
      } catch {}
    }
  }

  const body = {
    title: editForm.title,
    description: editForm.description,
    content: editForm.content,
    folder_id: editForm.folder_id || null,
    tags: tagIds,
  }

  if (isCreating.value) {
    await $fetch('/api/prompts', { method: 'POST', body })
  } else if (editingPrompt.value) {
    await $fetch(`/api/prompts/${editingPrompt.value.id}`, { method: 'PUT', body })
  }
  showEditDialog.value = false
  await Promise.all([loadPrompts(), loadFolders()])
}

async function toggleFavorite(prompt: Prompt) {
  await $fetch(`/api/prompts/${prompt.id}`, {
    method: 'PUT',
    body: { is_favorite: prompt.is_favorite ? 0 : 1 },
  })
  await loadPrompts()
}

async function deletePrompt(prompt: Prompt) {
  if (!confirm(`确定删除提示词「${prompt.title}」？`)) return
  await $fetch(`/api/prompts/${prompt.id}`, { method: 'DELETE' })
  await Promise.all([loadPrompts(), loadFolders()])
}

async function viewVersions(prompt: Prompt) {
  showVersions.value = true
  versionsTitle.value = prompt.title
  versionsLoading.value = true
  try {
    const data = await $fetch<{ versions: any[] }>(`/api/prompts/versions/${prompt.id}`)
    versions.value = data?.versions || []
  } catch { versions.value = [] }
  versionsLoading.value = false
}

async function restoreVersion(version: any) {
  if (!confirm(`确定恢复到 v${version.version_number}？`)) return
  await $fetch(`/api/prompts/${version.prompt_id}/restore`, { method: 'POST', body: { version_id: version.id } })
  showVersions.value = false
  await loadPrompts()
}

async function createFolder() {
  if (!newFolderName.value.trim()) return
  await $fetch('/api/prompts/folders', { method: 'POST', body: { name: newFolderName.value } })
  showFolderDialog.value = false
  newFolderName.value = ''
  await loadFolders()
}

function copyContent(content: string) {
  if (import.meta.client) navigator.clipboard.writeText(content)
}

function formatTime(ts?: number) {
  if (!ts) return '-'
  return new Date(ts).toLocaleString('zh-CN')
}

onMounted(async () => {
  await Promise.all([loadPrompts(), loadFolders(), loadTags()])
})
</script>

<style scoped>
.prompts-layout {
  display: flex;
  height: 100vh;
  overflow: hidden;
  background: #f5f5f7;
}
.prompts-sidebar {
  width: 240px;
  background: #fff;
  border-right: 1px solid #e8e8e8;
  overflow-y: auto;
  flex-shrink: 0;
  padding: 16px 0;
}
.sidebar-section { padding: 0 12px; margin-bottom: 16px; }
.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  font-weight: 600;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 0 8px 8px;
}
.folder-list { list-style: none; padding: 0; margin: 0; }
.folder-list li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  color: #555;
  transition: all 0.15s;
}
.folder-list li:hover { background: #f0f0f5; }
.folder-list li.active { background: #e3f2fd; color: #1976d2; }
.folder-list li .count { margin-left: auto; font-size: 11px; color: #aaa; }
.tag-list { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 8px; }
.tag-chip {
  padding: 3px 10px;
  border-radius: 12px;
  font-size: 12px;
  cursor: pointer;
  background: #f0f0f5;
  color: #666;
  transition: all 0.15s;
}
.tag-chip:hover { background: #e0e0e8; }
.tag-chip.active { background: #667eea; color: #fff; }
.no-tags { font-size: 12px; color: #bbb; }

.prompts-main {
  flex: 1;
  overflow-y: auto;
  padding: 24px 32px;
}
.prompts-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
  flex-wrap: wrap;
  gap: 12px;
}
.prompts-header h1 { font-size: 22px; font-weight: 600; color: #333; margin: 0; }
.header-actions { display: flex; gap: 10px; align-items: center; }
.search-input {
  padding: 8px 14px;
  border: 1.5px solid #e0e0e0;
  border-radius: 8px;
  font-size: 14px;
  outline: none;
  min-width: 220px;
}
.search-input:focus { border-color: #667eea; }

.prompts-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
}
.prompt-card {
  background: #fff;
  border: 1px solid #e8e8e8;
  border-radius: 10px;
  padding: 16px;
  cursor: pointer;
  transition: box-shadow 0.2s, transform 0.15s;
}
.prompt-card:hover { box-shadow: 0 4px 16px rgba(0,0,0,0.08); transform: translateY(-1px); }
.card-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px; }
.card-top h3 { font-size: 15px; font-weight: 600; margin: 0; color: #333; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card-actions { display: flex; gap: 2px; flex-shrink: 0; }
.icon-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  color: #999;
  font-size: 14px;
  display: flex;
  align-items: center;
}
.icon-btn:hover { background: rgba(0,0,0,0.06); color: #333; }
.btn-danger-icon:hover { color: #e74c3c; }
.fav-active { color: #f59e0b; }
.card-desc { font-size: 12px; color: #888; margin: 0 0 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card-content {
  font-size: 13px;
  color: #666;
  line-height: 1.5;
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.card-footer { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; }
.card-tags { display: flex; gap: 4px; flex-wrap: wrap; }
.mini-tag { padding: 1px 8px; border-radius: 10px; font-size: 11px; background: #f0f0f5; color: #666; }
.card-version { font-size: 11px; color: #bbb; }

.btn { padding: 8px 16px; border-radius: 8px; font-size: 14px; cursor: pointer; border: none; transition: all 0.2s; display: inline-flex; align-items: center; gap: 4px; }
.btn-primary { background: linear-gradient(135deg, #667eea, #764ba2); color: #fff; font-weight: 600; }
.btn-primary:hover { opacity: 0.9; }
.btn-ghost { background: none; border: 1px solid #ddd; color: #666; }
.btn-ghost:hover { background: #f5f5f5; }
.btn-sm { padding: 4px 10px; font-size: 12px; }

.modal-overlay { display: flex; position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 1000; align-items: center; justify-content: center; }
.modal { background: #fff; border-radius: 12px; width: 90%; max-width: 500px; max-height: 85vh; overflow-y: auto; box-shadow: 0 20px 60px rgba(0,0,0,0.2); }
.modal-lg { max-width: 700px; }
.modal-sm { max-width: 400px; }
.modal-header { padding: 16px 20px; border-bottom: 1px solid #f0f0f0; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }
.modal-header h3 { font-size: 16px; margin: 0; }
.modal-header-actions { display: flex; gap: 6px; align-items: center; }
.modal-close { background: none; border: none; font-size: 20px; cursor: pointer; color: #888; }
.modal-body { padding: 20px; }
.form-group { margin-bottom: 14px; }
.form-group label { display: block; font-size: 13px; color: #666; margin-bottom: 6px; }
.form-group input, .form-group textarea, .form-group select {
  width: 100%;
  padding: 10px 12px;
  border: 1.5px solid #e0e0e0;
  border-radius: 8px;
  font-size: 14px;
  outline: none;
  font-family: inherit;
}
.form-group input:focus, .form-group textarea:focus, .form-group select:focus { border-color: #667eea; }
.form-group textarea { resize: vertical; }
.form-row { display: flex; gap: 12px; }
.flex-1 { flex: 1; }
.form-buttons { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
.detail-desc { font-size: 14px; color: #888; margin: 0 0 12px; }
.detail-content { padding: 16px; background: #f9f9fb; border-radius: 8px; font-size: 14px; line-height: 1.6; white-space: pre-wrap; word-break: break-all; max-height: 400px; overflow-y: auto; margin: 0; }
.detail-tags { display: flex; gap: 6px; margin-top: 12px; }
.tag-chip-sm { padding: 2px 10px; border-radius: 10px; font-size: 12px; background: #e3f2fd; color: #1976d2; }

.versions-list { display: flex; flex-direction: column; gap: 12px; }
.version-item { border: 1px solid #e8e8e8; border-radius: 8px; overflow: hidden; }
.version-header { display: flex; align-items: center; gap: 12px; padding: 10px 14px; background: #fafafa; font-size: 13px; }
.version-num { font-weight: 600; color: #667eea; }
.version-date { color: #888; flex: 1; }
.version-content { padding: 12px 14px; margin: 0; font-size: 13px; white-space: pre-wrap; word-break: break-all; max-height: 150px; overflow-y: auto; }

.loading { text-align: center; padding: 60px; color: #999; }
.loading-sm { text-align: center; padding: 20px; color: #999; font-size: 13px; }
.empty { text-align: center; padding: 60px; color: #999; }
.empty-icon { font-size: 48px; margin-bottom: 12px; display: block; }
.empty-sm { text-align: center; padding: 30px; color: #999; }
</style>
