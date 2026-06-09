<template>
  <div id="sidebar-container" class="flex prompts-root">
    <!-- 侧边栏 -->
    <aside class="sidebar">
      <div class="sidebar-shell">
        <div class="sidebar-top" style="position:sticky;top:0;z-index:2;padding:0 0 0.25rem;display:flex;flex-direction:column;gap:0.65rem;">
          <NuxtLink to="/" class="sidebar-brand-card" title="PromptPro">
            <img src="/images/logo.svg" alt="Logo" class="sidebar-brand-logo">
            <div class="sidebar-brand-copy" style="display:flex;flex-direction:column;gap:2px;">
              <span class="sidebar-brand-title">PromptPro</span>
              <span class="sidebar-brand-subtitle">Prompt Manager</span>
            </div>
          </NuxtLink>
          <div class="sidebar-hub-nav">
            <NuxtLink to="/" class="sidebar-hub-link" title="主页">
              <span class="sidebar-hub-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
              </span>
              <span class="sidebar-hub-label">主页</span>
            </NuxtLink>
            <NuxtLink to="/prompts" class="sidebar-hub-link active" title="提示词管理">
              <span class="sidebar-hub-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/></svg>
              </span>
              <span class="sidebar-hub-label">提示词管理</span>
            </NuxtLink>
          </div>
        </div>

        <!-- 导航目录 -->
        <div class="sidebar-folders-panel">
          <div class="sidebar-panel-header">
            <span class="sidebar-section-kicker">导航目录</span>
            <div class="sidebar-panel-actions">
              <button class="sidebar-panel-action-btn client-only-user" title="新建文件夹" @click="showFolderDialog = true">
                <i class="ri-folder-add-line"></i>
              </button>
            </div>
          </div>
          <ul id="categories-list">
            <li
              class="cursor-pointer p-2 rounded-lg flex items-center folder-item"
              :class="{ 'bg-emerald-500': !activeFolderId }"
              @click="activeFolderId = null; loadPrompts()"
            >
              <i class="ri-folder-3-line" style="font-size:16px;color:#10B981;margin-right:8px;width:20px;text-align:center;"></i>
              <span>全部</span>
              <span class="ml-auto" style="font-size:11px;color:#94a3b8;">{{ allPromptCount }}</span>
            </li>
            <li
              class="cursor-pointer p-2 rounded-lg flex items-center folder-item"
              :class="{ 'bg-emerald-500': activeFolderId === '_favorites' }"
              @click="activeFolderId = '_favorites'; loadPrompts()"
            >
              <i class="ri-star-line" style="font-size:16px;color:#f59e0b;margin-right:8px;width:20px;text-align:center;"></i>
              <span>收藏</span>
            </li>
            <li
              v-for="folder in folders"
              :key="folder.id"
              class="cursor-pointer p-2 rounded-lg flex items-center folder-item"
              :class="{ 'bg-emerald-500': activeFolderId === folder.id }"
              @click="activeFolderId = folder.id; loadPrompts()"
            >
              <i class="ri-folder-3-line" style="font-size:16px;color:#10B981;margin-right:8px;width:20px;text-align:center;"></i>
              <span>{{ folder.name }}</span>
              <span class="ml-auto" style="font-size:11px;color:#94a3b8;">{{ folder.prompt_count || 0 }}</span>
            </li>
          </ul>
          <div class="tags-section-label">
            <span>标签</span>
            <button class="sidebar-panel-action-btn client-only-user" title="筛选标签"><i class="ri-price-tag-3-line"></i></button>
          </div>
          <div id="sidebar-tags-grid" class="sidebar-tags-grid">
            <span
              v-for="tag in tags"
              :key="tag.id"
              class="tag-chip"
              :class="{ active: activeTagIds.includes(tag.id) }"
              @click="toggleTag(tag.id)"
            >{{ tag.name }}</span>
            <span v-if="tags.length === 0" style="font-size:12px;color:#94a3b8;padding:4px;">暂无标签</span>
          </div>
        </div>
      </div>
    </aside>

    <!-- 右侧主内容 -->
    <main class="main-content">
      <div class="main-area">
        <div class="main-toolbar">
          <div class="search-box">
            <i class="ri-search-line"></i>
            <input v-model="searchQuery" type="text" placeholder="搜索提示词..." @input="debouncedSearch">
          </div>
          <button class="btn-favorite" :class="{ active: activeFolderId === '_favorites' }" title="收藏筛选" @click="toggleFavoritesView">
            <i :class="activeFolderId === '_favorites' ? 'ri-star-fill' : 'ri-star-line'"></i>
            <span>收藏</span>
          </button>
          <button class="btn btn-primary client-only-user" @click="openCreate">
            <i class="ri-add-line"></i>
            <span>新建提示词</span>
          </button>
        </div>

        <div class="prompts-container">
          <div v-if="!isLoading && prompts.length > 0" class="prompts-grid" id="promptsGrid">
            <div v-for="prompt in prompts" :key="prompt.id" class="prompt-card" @click="viewPrompt(prompt)">
              <div class="prompt-card-header">
                <h3 class="prompt-title">{{ prompt.title }}</h3>
                <div class="prompt-actions">
                  <button class="prompt-btn copy-btn" title="复制" @click.stop="copyContent(prompt.content)"><i class="ri-file-copy-line"></i></button>
                  <button v-if="!isGuest" class="prompt-btn edit-btn" title="编辑" @click.stop="openEdit(prompt)"><i class="ri-edit-line"></i></button>
                  <button class="prompt-btn fav-btn" :class="{ active: prompt.is_favorite === 1 }" title="收藏" @click.stop="toggleFavorite(prompt)"><i :class="prompt.is_favorite === 1 ? 'ri-star-fill' : 'ri-star-line'"></i></button>
                </div>
              </div>
              <p v-if="prompt.description" class="prompt-desc">{{ prompt.description }}</p>
              <div v-if="prompt.tags && prompt.tags.length" class="prompt-tags">
                <span v-for="tag in prompt.tags" :key="tag.id" class="prompt-tag">{{ tag.name }}</span>
              </div>
              <div class="prompt-card-footer">
                <span v-if="prompt.current_version" class="version-badge">v{{ prompt.current_version }}</span>
              </div>
            </div>
          </div>
          <div v-if="isLoading" class="loading" id="loading">
            <i class="ri-loader-4-line spin"></i>
            <p>加载中...</p>
          </div>
          <div v-if="!isLoading && prompts.length === 0" class="empty-state">
            <i class="ri-file-warning-line"></i>
            <p>暂无数据</p>
            <button v-if="!isGuest" class="btn btn-primary" @click="openCreate">创建第一个提示词</button>
          </div>
        </div>
      </div>
    </main>

    <ClientOnly>
      <PromptDialogs
        :viewing-prompt="viewingPrompt"
        :show-edit-dialog="showEditDialog"
        :is-creating="isCreating"
        :edit-form="editForm"
        :folders="folders"
        :show-versions="showVersions"
        :versions-title="versionsTitle"
        :versions="versions"
        :versions-loading="versionsLoading"
        :show-folder-dialog="showFolderDialog"
        :is-guest="isGuest"
        @close-view="viewingPrompt = null"
        @close-edit="showEditDialog = false"
        @close-versions="showVersions = false"
        @close-folder="showFolderDialog = false"
        @save="savePrompt"
        @save-folder="createFolder"
        @copy="copyContent"
        @view-versions="viewVersions"
        @edit="(p) => { openEdit(p); viewingPrompt = null }"
        @delete="deletePrompt"
        @restore="restoreVersion"
        @update:folder-name="(v) => newFolderName = v"
      />
    </ClientOnly>
  </div>
</template>

<script setup lang="ts">
import PromptDialogs from '~/components/prompts/PromptDialogs.vue'

definePageMeta({ layout: 'default' })

useHead({
  title: 'PromptPro - 提示词管理',
  link: [
    { rel: 'stylesheet', href: '/css/promptpro-bundle.css' },
    { rel: 'stylesheet', href: '/css/promptpro-card-styles.css' },
    { rel: 'stylesheet', href: '/css/promptpro-light-theme.css' },
    { rel: 'stylesheet', href: '/css/promptpro-dark-theme.css' },
    { rel: 'stylesheet', href: '/css/promptpro-page.css' },
  ],
})

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

function toggleFavoritesView() {
  activeFolderId.value = activeFolderId.value === '_favorites' ? null : '_favorites'
  loadPrompts()
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
  viewingPrompt.value = null
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

onMounted(async () => {
  await Promise.all([loadPrompts(), loadFolders(), loadTags()])
})
</script>

<style scoped>
/* 整个页面的视觉样式（侧边栏、工具栏、卡片、弹窗、暗色模式、响应式）
   全部来自 promptpro-*.css（通过 useHead 注入，仅本页生效）。
   .prompts-root 仅确保占满视口高度。 */
.prompts-root {
  height: 100vh;
  overflow: hidden;
}
</style>
