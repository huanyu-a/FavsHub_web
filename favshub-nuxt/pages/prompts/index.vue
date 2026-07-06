<template>
  <div id="sidebar-container" class="flex prompts-root">
    <!-- 侧边栏 -->
    <aside class="custom-width p-4 overflow-auto relative">
      <div class="sidebar-shell">
        <div class="sidebar-top">
          <NuxtLink to="/" class="sidebar-brand-card" title="PromptPro">
            <img src="/images/logo.svg" alt="Logo" class="sidebar-brand-logo">
            <div class="sidebar-brand-copy">
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
          <ul id="categories-list">
            <!-- 全部：icon + name + count + 展开收缩箭头 -->
            <li
              class="folder-item"
              :class="{ 'bg-emerald-500': !activeFolderId }"
              style="cursor:pointer;padding:8px;border-radius:8px;display:flex;align-items:center;position:relative;"
              @click="selectAndToggleAll"
              @contextmenu.prevent="onAllContextMenu"
            >
              <i class="ri-apps-line" style="font-size:16px;color:var(--primary);flex-shrink:0;width:20px;text-align:center;"></i>
              <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-right:60px;">全部</span>
              <span class="item-count" style="position:absolute;right:8px;">{{ allPromptCount }}</span>
              <span
                style="cursor:pointer;display:inline-flex;align-items:center;position:absolute;right:30px;"
                @click.stop="toggleAllFolders"
              >
                <svg v-if="allFoldersExpanded" xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 -960 960 960" width="18px" fill="currentColor"><path d="M480-541.85 317.08-378.92q-8.31 8.3-20.89 8.5-12.57.19-21.27-8.5-8.69-8.7-8.69-21.08 0-12.38 8.69-21.08l179.77-179.77q10.85-10.84 25.31-10.84 14.46 0 25.31 10.84l179.77 179.77q8.3 8.31 8.5 20.89.19 12.57-8.5 21.27-8.7 8.69-21.08 8.69-12.38 0-21.08-8.69L480-541.85Z"/></svg>
                <svg v-else xmlns="http://www.w3.org/2000/svg" height="18px" viewBox="0 -960 960 960" width="18px" fill="currentColor"><path d="M517.85-480 354.92-642.92q-8.3-8.31-8.5-20.89-.19-12.57 8.5-21.27 8.7-8.69 21.08-8.69 12.38 0 21.08 8.69l179.77 179.77q5.61 5.62 7.92 11.85 2.31 6.23 2.31 13.46t-2.31 13.46q-2.31 6.23-7.92 11.85L397.08-274.92q-8.31 8.3-20.89 8.5-12.57.19-21.27-8.5-8.69-8.69-8.69-21.08 0-12.38 8.69-21.08L517.85-480Z"/></svg>
              </span>
            </li>
            <!-- 收藏 -->
            <li
              class="folder-item"
              :class="{ 'bg-emerald-500': activeFolderId === '_favorites' }"
              style="cursor:pointer;padding:8px;border-radius:8px;display:flex;align-items:center;position:relative;"
              @click="activeFolderId = '_favorites'; loadPrompts()"
            >
              <i class="ri-star-line" style="font-size:16px;color:var(--warning);flex-shrink:0;width:20px;text-align:center;"></i>
              <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">收藏</span>
            </li>
            <!-- 文件夹树：使用 FolderTreeItem 组件 -->
            <FolderTreeItem
              v-for="node in promptFolderTree"
              :key="node.id"
              :node="node"
              :current-folder-id="activeFolderId"
              :expanded-ids="expandedFolderIds"
              @select-folder="selectPromptFolder"
              @toggle-expand="toggleFolderExpand"
              @contextmenu-folder="onFolderContextMenu"
            />
          </ul>
          <div class="tags-section-label">
            <span>标签</span>
            <button class="sidebar-panel-action-btn client-only-user" title="筛选标签"><i class="ri-price-tag-3-line"></i></button>
          </div>
          <div id="sidebar-tags-grid" class="sidebar-tags-grid">
            <span
              v-for="tag in tags"
              :key="tag.id"
              class="sidebar-tag-chip"
              :class="{ active: activeTagIds.includes(tag.id) }"
              @click="toggleTag(tag.id)"
            >{{ tag.name }}</span>
            <span v-if="tags.length === 0" style="font-size:12px;color:var(--text-tertiary);padding:4px;">暂无标签</span>
          </div>
        </div>

        <!-- 用户面板 -->
        <UserPanel />
      </div>
    </aside>

    <!-- 文件夹右键菜单 -->
    <Teleport to="body">
      <div
        v-if="folderMenu.visible"
        class="folder-context-menu"
        :style="{ left: folderMenu.x + 'px', top: folderMenu.y + 'px' }"
        @click.stop
      >
        <template v-if="folderMenu.isAll">
          <div class="folder-context-item" @click="openCreateRootFolder">
            <i class="ri-folder-add-line"></i> 新建文件夹
          </div>
        </template>
        <template v-else>
          <div v-if="authStore.isAdmin" class="folder-context-item" @click="renamePromptFolder(folderMenu.folder!)">
            <i class="ri-edit-line"></i> 重命名
          </div>
          <div class="folder-context-item" @click="openCreateSubFolder(folderMenu.folder!)">
            <i class="ri-folder-add-line"></i> 新建子文件夹
          </div>
          <div v-if="authStore.isAdmin" class="folder-context-item danger" @click="deletePromptFolder(folderMenu.folder!)">
            <i class="ri-delete-bin-line"></i> 删除
          </div>
        </template>
      </div>
      <div v-if="folderMenu.visible" class="folder-context-overlay" @click="folderMenu.visible = false"></div>
    </Teleport>

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
            <div v-for="prompt in prompts" :key="prompt.id" class="prompt-card" :class="{ 'read-only': !isGuest && prompt.user_id !== currentUserId }" @click="viewPrompt(prompt)">
              <div class="prompt-card-header">
                <h3 class="prompt-title">{{ prompt.title }}</h3>
                <div class="prompt-actions">
                  <button class="prompt-btn copy-btn" title="复制" @click.stop="copyContent(prompt.content)"><i class="ri-file-copy-line"></i></button>
                  <button v-if="!isGuest && prompt.user_id === currentUserId" class="prompt-btn edit-btn" title="编辑" @click.stop="openEdit(prompt)"><i class="ri-edit-line"></i></button>
                  <button v-else-if="!isGuest && prompt.owner_is_admin == 1" class="prompt-btn edit-btn" title="申请修改" @click.stop="openEdit(prompt)"><i class="ri-edit-line" style="color:var(--warning);"></i></button>
                  <button class="prompt-btn fav-btn" :class="{ active: prompt.is_favorite === 1 }" title="收藏" @click.stop="toggleFavorite(prompt)"><i :class="prompt.is_favorite === 1 ? 'ri-star-fill' : 'ri-star-line'"></i></button>
                </div>
              </div>
              <p class="prompt-desc">{{ prompt.description ? truncate(prompt.description, 120) : truncate(prompt.content, 120) }}</p>
              <div v-if="prompt.tags && prompt.tags.length" class="prompt-tags">
                <span v-for="tag in prompt.tags" :key="tag.id" class="tag">{{ tag.name }}</span>
              </div>
              <div class="prompt-meta-footer">
                <div class="meta-left">
                  <span v-if="folderName(prompt.folder_id)" class="prompt-folder-tag"><i class="ri-folder-fill"></i> {{ folderName(prompt.folder_id) }}</span>
                  <span v-if="prompt.updated_at" class="meta-item date-item"><i class="ri-calendar-line"></i> {{ formatDate(prompt.updated_at) }}</span>
                </div>
                <div class="meta-right">
                  <span v-if="prompt.current_version" class="version-badge">v{{ prompt.current_version }}</span>
                </div>
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
        :is-review-mode="isReviewMode"
        :edit-form="editForm"
        :folders="folders"
        :show-versions="showVersions"
        :versions-title="versionsTitle"
        :versions="versions"
        :versions-loading="versionsLoading"
        :show-folder-dialog="showFolderDialog"
        :editing-folder="editingFolder"
        :folder-parent-id="folderFormParentId"
        :folder-icon="folderFormIcon"
        :folder-name="newFolderName"
        :is-guest="isGuest"
        :current-user-id="currentUserId"
        :all-tags="tags"
        @close-view="viewingPrompt = null"
        @close-edit="showEditDialog = false"
        @close-folder="closeFolderDialog"
        @save="savePrompt"
        @save-folder="saveFolder"
        @delete-folder="deleteFolder"
        @copy="copyContent"
        @load-versions="viewVersions"
        @edit="(p) => { openEdit(p); viewingPrompt = null }"
        @delete="deletePrompt"
        @restore="restoreVersion"
        @update:folder-name="(v) => newFolderName = v"
        @update:folder-parent="(v) => folderFormParentId = v"
        @update:folder-icon="(v) => folderFormIcon = v"
      />
    </ClientOnly>

    <!-- Copy success toast -->
    <Teleport to="body">
      <Transition name="toast-fade">
        <div v-if="copySuccess" class="copy-toast">
          <i class="ri-check-line"></i> 复制成功
        </div>
      </Transition>
    </Teleport>
    <ClientOnly>
      <BackToTop />
    </ClientOnly>
  </div>
</template>

<script setup lang="ts">
import PromptDialogs from '~/components/prompts/PromptDialogs.vue'
import FolderTreeItem from '~/components/sidebar/FolderTreeItem.vue'
import BackToTop from '~/components/BackToTop.vue'

definePageMeta({ layout: 'default' })

// Mobile header: show PromptPro action buttons
const { mobileActionsSlot } = useMobile()

onMounted(() => {
  mobileActionsSlot.value = () => [
    // Favorite filter button (uses .btn-favorite class for mobile-responsive CSS)
    h('button', {
      class: ['btn-favorite', { active: activeFolderId.value === '_favorites' }],
      title: '收藏筛选',
      onClick: () => toggleFavoritesView(),
    }, [
      h('i', { class: 'ri-star-line' }),
      h('span', null, '收藏'),
    ]),
    // New prompt button (uses .btn-primary class for mobile-responsive CSS)
    h('button', {
      class: 'btn btn-primary',
      title: '新建提示词',
      onClick: () => openCreate(),
    }, [
      h('i', { class: 'ri-add-line' }),
      h('span', null, '新建'),
    ]),
  ]
})
onUnmounted(() => {
  mobileActionsSlot.value = null
})

useHead({
  title: 'PromptPro - 提示词管理',
  titleTemplate: (title?: string) => title || 'PromptPro - 提示词管理', // 覆盖布局的 titleTemplate，使用原始标题
  link: [
    { rel: 'stylesheet', href: '/css/promptpro-bundle.css?v=20260703a' },
  ],
})

// PM8: Load TDK from API and apply to page head
const { data: pageTdk } = await useFetch('/api/tdk/promptpro', { server: true, lazy: false })

useHead({
  title: computed(() => pageTdk.value?.promptproTitle || 'PromptPro - 提示词管理'),
  meta: [
    { name: 'description', content: computed(() => pageTdk.value?.promptproDescription || '') },
    { name: 'keywords', content: computed(() => pageTdk.value?.promptproKeywords || '') },
  ],
})

const { isGuest } = useAuth()
const authStore = useAuthStore()
const currentUserId = computed(() => authStore.user?.id)

interface Prompt {
  id: string
  title: string
  description?: string
  content: string
  folder_id?: string
  user_id?: number
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
  parent_id?: string
  icon?: string
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
const activeFolderId = useState<string | null>('activePromptFolderId', () => null)
const activeTagIds = ref<number[]>([])
const expandedFolderIds = ref(new Set<string>())

const viewingPrompt = ref<Prompt | null>(null)
const showEditDialog = ref(false)
const isCreating = ref(true)
const isReviewMode = ref(false)
const editingPrompt = ref<Prompt | null>(null)
const showVersions = ref(false)
const versionsTitle = ref('')
const versions = ref<any[]>([])
const versionsLoading = ref(false)
const showFolderDialog = ref(false)
const newFolderName = ref('')
const editingFolder = ref<Folder | null>(null)
const folderFormParentId = ref<string | null>(null)
const folderFormIcon = ref('')

const editForm = reactive({
  title: '',
  description: '',
  content: '',
  folder_id: null as string | null,
  current_version: '1.0.0',
  tags: [] as any[],
})

const allPromptCount = computed(() => prompts.value.length)

// ── FolderTreeItem compatible types ─────────────────────────────
interface PromptFolderNode extends Folder {
  _depth: number
  _count: number
  _hasChildren: boolean
  children: PromptFolderNode[]
  prompt_count?: number
}

// Build folder tree compatible with FolderTreeItem
const promptFolderTree = computed(() => {
  const map = new Map<string, PromptFolderNode>()
  const roots: PromptFolderNode[] = []

  for (const f of folders.value) {
    map.set(f.id, {
      ...f,
      _depth: 0,
      _count: f.prompt_count || 0,
      _hasChildren: false,
      children: [],
    })
  }

  for (const node of map.values()) {
    const pid = node.parent_id
    if (pid && map.has(pid)) {
      map.get(pid)!.children.push(node)
      map.get(pid)!._hasChildren = true
    } else {
      roots.push(node)
    }
  }

  // Set depth
  function setDepth(nodes: PromptFolderNode[], depth: number) {
    for (const n of nodes) {
      n._depth = depth
      if (n.children.length) setDepth(n.children, depth + 1)
    }
  }
  setDepth(roots, 0)
  return roots
})

// Collect all folder IDs for expand-all toggle
const allFolderIds = computed(() => {
  const ids: string[] = []
  function walk(nodes: PromptFolderNode[]) {
    for (const n of nodes) {
      ids.push(n.id)
      if (n.children.length) walk(n.children)
    }
  }
  walk(promptFolderTree.value)
  return ids
})

// Whether all folders are expanded
const allFoldersExpanded = computed(() =>
  allFolderIds.value.length > 0 && allFolderIds.value.every(id => expandedFolderIds.value.has(id))
)

// Expand/collapse all folders
function toggleAllFolders() {
  if (allFoldersExpanded.value) {
    expandedFolderIds.value = new Set<string>()
  } else {
    expandedFolderIds.value = new Set(allFolderIds.value)
  }
}

function toggleFolderExpand(id: string | number) {
  const sid = String(id)
  if (expandedFolderIds.value.has(sid)) expandedFolderIds.value.delete(sid)
  else expandedFolderIds.value.add(sid)
  expandedFolderIds.value = new Set(expandedFolderIds.value)
}

function selectPromptFolder(folderId: string | number | null) {
  activeFolderId.value = folderId as string | null
  loadPrompts()
}

function selectAndToggleAll() {
  activeFolderId.value = null
  loadPrompts()
}

// ── Context menu state ──────────────────────────────────────────
const folderMenu = reactive({
  visible: false,
  x: 0,
  y: 0,
  folder: null as Folder | null,
  isAll: false,
})

function onAllContextMenu(event: MouseEvent) {
  folderMenu.x = event.clientX
  folderMenu.y = event.clientY
  folderMenu.folder = null
  folderMenu.isAll = true
  folderMenu.visible = true
}

function onFolderContextMenu(event: MouseEvent, folder: any) {
  event.preventDefault()
  folderMenu.x = event.clientX
  folderMenu.y = event.clientY
  folderMenu.folder = folder
  folderMenu.isAll = false
  folderMenu.visible = true
}

function openCreateRootFolder() {
  folderMenu.visible = false
  editingFolder.value = null
  newFolderName.value = ''
  folderFormParentId.value = null
  folderFormIcon.value = ''
  showFolderDialog.value = true
}

function openCreateSubFolder(parentFolder: Folder) {
  folderMenu.visible = false
  editingFolder.value = null
  newFolderName.value = ''
  folderFormParentId.value = parentFolder.id
  folderFormIcon.value = ''
  showFolderDialog.value = true
}

function renamePromptFolder(folder: Folder) {
  folderMenu.visible = false
  editingFolder.value = folder
  newFolderName.value = folder.name
  folderFormParentId.value = folder.parent_id || null
  folderFormIcon.value = folder.icon || ''
  showFolderDialog.value = true
}

async function deletePromptFolder(folder: Folder) {
  folderMenu.visible = false
  if (confirm(`确定删除文件夹「${folder.name}」？文件夹中的提示词不会被删除。`)) {
    await $fetch(`/api/prompts/folders/${folder.id}`, { method: 'DELETE' })
    expandedFolderIds.value.delete(folder.id)
    await Promise.all([loadFolders(), loadPrompts()])
  }
}

// Called from PromptDialogs @delete-folder event
async function deleteFolder(folder: any) {
  if (!folder) return
  if (!confirm(`确定删除文件夹「${folder.name}」？文件夹中的提示词不会被删除。`)) return
  await $fetch(`/api/prompts/folders/${folder.id}`, { method: 'DELETE' })
  expandedFolderIds.value.delete(folder.id)
  closeFolderDialog()
  await Promise.all([loadFolders(), loadPrompts()])
}

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
    let results = data?.prompts || []

    // 搜索时按相关性评分排序
    if (searchQuery.value && results.length > 0) {
      const keywords = searchQuery.value.toLowerCase().split(/\s+/).filter(Boolean)
      if (keywords.length > 0) {
        results = results.map(p => ({
          ...p,
          _relevance: calculatePromptScore(p, keywords),
        })).sort((a: any, b: any) => b._relevance - a._relevance)
      }
    }

    prompts.value = results
  } catch { prompts.value = [] }
  isLoading.value = false
}

/**
 * 多字段加权相关性评分
 * 支持 title/tags/description/folder_name/content 多字段匹配
 */
function calculatePromptScore(prompt: any, keywords: string[]): number {
  if (!keywords || keywords.length === 0) return 0

  const title = (prompt.title || '').toLowerCase()
  const desc = (prompt.description || '').toLowerCase()
  const content = (prompt.content || '').toLowerCase()
  const folder = (prompt.folder_name || '').toLowerCase()
  const tagNames: string[] = (prompt.tags || []).map((t: any) => (t.tag_name || t.name || '').toLowerCase())

  let totalScore = 0
  let titleMatchedCount = 0
  let tagMatchedCount = 0
  let descMatchedCount = 0
  let folderMatchedCount = 0

  for (const keyword of keywords) {
    // 标题匹配（权重最高）
    if (title.includes(keyword)) {
      if (title === keyword) totalScore += 10000
      else if (title.startsWith(keyword)) totalScore += 8000
      else totalScore += 5000
      titleMatchedCount++
    }

    // 标签匹配
    if (tagNames.some(tag => tag.includes(keyword))) {
      totalScore += 2000
      tagMatchedCount++
    }

    // 描述匹配
    if (desc.includes(keyword)) {
      if (desc.startsWith(keyword)) totalScore += 1500
      else totalScore += 1000
      descMatchedCount++
    }

    // 文件夹匹配
    if (folder.includes(keyword)) {
      totalScore += 800
      folderMatchedCount++
    }

    // 内容匹配（权重最低）
    if (content.includes(keyword)) {
      totalScore += 300
    }
  }

  // 标题中包含所有关键词时，给予极高奖励
  if (titleMatchedCount === keywords.length && keywords.length > 0) {
    totalScore += keywords.length * 5000
  }

  // 标签中包含所有关键词时，给予高奖励
  if (tagMatchedCount === keywords.length && keywords.length > 0) {
    totalScore += keywords.length * 3000
  }

  // 描述中包含所有关键词时，给予中等奖励
  if (descMatchedCount === keywords.length && keywords.length > 0) {
    totalScore += keywords.length * 1500
  }

  // 跨字段匹配奖励（标题+标签、标题+描述等）
  const fieldsMatched = [
    titleMatchedCount > 0,
    tagMatchedCount > 0,
    descMatchedCount > 0,
    folderMatchedCount > 0,
  ].filter(Boolean).length

  if (fieldsMatched >= 2 && keywords.length > 1) {
    totalScore += fieldsMatched * 1000
  }

  return totalScore
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
  editForm.current_version = '1.0.0'
  editForm.tags = []
  showEditDialog.value = true
}

function openEdit(prompt: Prompt) {
  if (prompt.user_id !== currentUserId.value && !prompt.owner_is_admin) return alert('无权编辑此提示词')
  isReviewMode.value = !!(prompt.owner_is_admin && prompt.user_id !== currentUserId.value)
  isCreating.value = false
  editingPrompt.value = prompt
  editForm.title = prompt.title
  editForm.description = prompt.description || ''
  editForm.content = prompt.content
  editForm.folder_id = prompt.folder_id || null
  editForm.current_version = prompt.current_version || '1.0.0'
  editForm.tags = (prompt.tags || []).map(t => ({ id: t.id, name: t.name, color: t.color }))
  showEditDialog.value = true
}

async function savePrompt() {
  if (!editForm.title.trim() || !editForm.content.trim()) return alert('标题和内容不能为空')

  // 使用 editForm.tags 数组（PromptDialogs 中的标签选择器已处理）
  const tagIds: number[] = []
  for (const tag of editForm.tags) {
    if (tag.id) {
      tagIds.push(tag.id)
    } else {
      // 新标签，需创建
      const name = tag.name || tag.tag_name
      if (!name) continue
      const existing = tags.value.find(t => t.name.toLowerCase() === name.toLowerCase())
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
    const res = await $fetch(`/api/prompts/${editingPrompt.value.id}`, { method: 'PUT', body })
    if (res?.review_required) {
      showEditDialog.value = false
      isReviewMode.value = false
      alert('✅ 修改已提交审核，等待管理员审批')
      return
    }
  }
  showEditDialog.value = false
  await Promise.all([loadPrompts(), loadFolders()])
}

async function toggleFavorite(prompt: Prompt) {
  if (prompt.user_id !== currentUserId.value) return
  await $fetch(`/api/prompts/${prompt.id}`, {
    method: 'PUT',
    body: { is_favorite: prompt.is_favorite ? 0 : 1 },
  })
  await loadPrompts()
}

async function deletePrompt(prompt: Prompt) {
  if (prompt.user_id !== currentUserId.value) return alert('无权删除此提示词')
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

async function saveFolder() {
  if (!newFolderName.value.trim()) return alert('请输入文件夹名称')
  if (editingFolder.value) {
    await $fetch(`/api/prompts/folders/${editingFolder.value.id}`, {
      method: 'PUT',
      body: { name: newFolderName.value, parent_id: folderFormParentId.value, icon: folderFormIcon.value },
    })
  } else {
    await $fetch('/api/prompts/folders', {
      method: 'POST',
      body: { name: newFolderName.value, parent_id: folderFormParentId.value, icon: folderFormIcon.value },
    })
  }
  closeFolderDialog()
  await Promise.all([loadFolders(), loadPrompts()])
}

function closeFolderDialog() {
  showFolderDialog.value = false
  editingFolder.value = null
  newFolderName.value = ''
  folderFormParentId.value = null
  folderFormIcon.value = ''
}

const copySuccess = ref(false)

function copyContent(content: string) {
  if (import.meta.client) {
    navigator.clipboard.writeText(content).then(() => {
      copySuccess.value = true
      setTimeout(() => { copySuccess.value = false }, 1500)
    })
  }
}

function truncate(text: string, max: number) {
  if (!text) return ''
  return text.length > max ? text.slice(0, max) + '...' : text
}

function folderName(id?: string) {
  if (!id) return ''
  return folders.value.find(f => f.id === id)?.name || ''
}

function formatDate(ts?: number) {
  if (!ts) return ''
  return new Date(ts).toLocaleDateString('zh-CN').replace(/\//g, '-')
}

// 监听文件夹变化（来自移动端底部导航）
watch(activeFolderId, () => {
  loadPrompts()
})

onMounted(async () => {
  await Promise.all([loadPrompts(), loadFolders(), loadTags()])
})
</script>

<style scoped>
</style>
