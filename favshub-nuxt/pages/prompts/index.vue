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
        <section class="prompts-hero">
          <h1 class="hero-title">提示词库</h1>
          <p class="hero-sub">沉淀可复用的提示词模板，搜索后一键复制即用。共 {{ allPromptsCache.length }} 条提示词。</p>
          <div class="hero-toolbar">
            <div class="search-box">
              <i class="ri-search-line"></i>
              <input v-model="searchQuery" type="text" placeholder="搜索提示词..." @input="debouncedSearch">
            </div>
            <button class="btn-favorite" :class="{ active: activeFolderId === '_favorites' }" title="收藏筛选" @click="toggleFavoritesView">
              <i :class="activeFolderId === '_favorites' ? 'ri-star-fill' : 'ri-star-line'"></i>
              <span>收藏</span>
            </button>
            <div class="sort-tabs" role="tablist" title="排序方式">
              <button
                v-for="opt in sortOptions"
                :key="opt.value"
                :class="{ active: sortBy === opt.value }"
                @click="setSortBy(opt.value)"
              >{{ opt.label }}</button>
            </div>
            <button v-if="!isGuest" class="btn-hero-create client-only-user" @click="openCreate">
              <i class="ri-add-line"></i>
              <span>新建提示词</span>
            </button>
          </div>
        </section>

        <div class="prompts-container">
          <div v-if="!isLoading && prompts.length > 0" class="prompts-grid" id="promptsGrid">
            <div v-for="prompt in prompts" :key="prompt.id" class="prompt-card" :class="{ 'read-only': !isGuest && prompt.user_id !== currentUserId }" @click="viewPrompt(prompt)">
              <div class="prompt-card-header">
                <h3 class="prompt-title">{{ prompt.title }}</h3>
                <div class="prompt-actions">
                  <!-- 回收站模式：还原 + 永久删除 -->
                  <template v-if="activeFolderId === '_recycle'">
                    <button class="prompt-btn" title="还原" @click.stop="restorePrompt(prompt)"><i class="ri-refresh-line"></i></button>
                    <button class="prompt-btn" title="永久删除" @click.stop="permanentDelete(prompt)"><i class="ri-delete-bin-2-line" style="color:var(--danger,#ef4444);"></i></button>
                  </template>
                  <!-- 正常模式 -->
                  <template v-else>
                    <button class="prompt-btn copy-btn" title="复制" @click.stop="copyContent(prompt.content, prompt.id)"><i class="ri-file-copy-line"></i></button>
                    <button v-if="!isGuest && prompt.user_id === currentUserId" class="prompt-btn edit-btn" title="编辑" @click.stop="openEdit(prompt)"><i class="ri-edit-line"></i></button>
                    <button v-else-if="!isGuest && prompt.owner_is_admin == 1" class="prompt-btn edit-btn" title="申请修改" @click.stop="openEdit(prompt)"><i class="ri-edit-line" style="color:var(--warning);"></i></button>
                    <button class="prompt-btn fav-btn" :class="{ active: prompt.is_favorite === 1 }" title="收藏" @click.stop="toggleFavorite(prompt)"><i :class="prompt.is_favorite === 1 ? 'ri-star-fill' : 'ri-star-line'"></i></button>
                  </template>
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
                  <span v-if="prompt.usage_count >= 50" class="usage-badge" :title="`已被使用 ${prompt.usage_count} 次`"><i class="ri-fire-line"></i> {{ prompt.usage_count }}</span>
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

    <!-- Template variable modal -->
    <TemplateVarModal
      :content="tplVarContent"
      :visible="tplVarModalVisible"
      @confirm="onTplVarConfirm"
      @cancel="onTplVarCancel"
    />
    <ClientOnly>
      <BackToTop />
    </ClientOnly>
  </div>
</template>

<script setup lang="ts">
import PromptDialogs from '~/components/prompts/PromptDialogs.vue'
import TemplateVarModal from '~/components/prompts/TemplateVarModal.vue'
import FolderTreeItem from '~/components/sidebar/FolderTreeItem.vue'
import BackToTop from '~/components/BackToTop.vue'
import { parseTemplateVariables } from '~/utils/template-variables'
import { searchPrompts } from '~/utils/pinyin'

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
    // Sort dropdown
    h('select', {
      class: 'mobile-sort-select',
      title: '排序方式',
      value: sortBy.value,
      onChange: (e: Event) => { sortBy.value = (e.target as HTMLSelectElement).value },
    }, [
      h('option', { value: 'updated' }, '最新'),
      h('option', { value: 'usage' }, '热度'),
      h('option', { value: 'created' }, '创建'),
      h('option', { value: 'title' }, '名称'),
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
  title: 'PromptPro-AI提示词管理与分享平台',
  titleTemplate: (title?: string) => title ? `${title}_FavsHub` : 'PromptPro-AI提示词管理与分享平台_FavsHub', // 覆盖布局的 titleTemplate，确保以_FavsHub结尾
  link: [
    { rel: 'stylesheet', href: '/css/promptpro-bundle.css?v=20260830b' },
  ],
})

// PM8: Load TDK from API and apply to page head
const { data: pageTdk } = await useFetch('/api/tdk/promptpro', { server: true, lazy: false })

const _promptsBase = (useRuntimeConfig().public.baseUrl as string) || 'https://favshub.com'
const promptProBaseUrl = computed(() => `${_promptsBase}/prompts`)

useHead({
  title: computed(() => pageTdk.value?.promptproTitle || 'PromptPro-AI提示词管理与分享平台'),
  meta: [
    { name: 'description', content: computed(() => pageTdk.value?.promptproDescription || '') },
    { name: 'keywords', content: computed(() => pageTdk.value?.promptproKeywords || '') },
    // Open Graph
    { property: 'og:title', content: computed(() => pageTdk.value?.promptproTitle || 'PromptPro-AI提示词管理与分享平台') },
    { property: 'og:description', content: computed(() => pageTdk.value?.promptproDescription || '') },
    { property: 'og:type', content: 'website' },
    { property: 'og:url', content: promptProBaseUrl },
    { property: 'og:locale', content: 'zh_CN' },
    // Twitter Card
    { name: 'twitter:card', content: 'summary' },
    { name: 'twitter:title', content: computed(() => pageTdk.value?.promptproTitle || 'PromptPro-AI提示词管理与分享平台') },
    { name: 'twitter:description', content: computed(() => pageTdk.value?.promptproDescription || '') },
  ],
  link: [
    { rel: 'canonical', href: promptProBaseUrl },
  ],
})

const { isGuest } = useAuth()
const authStore = useAuthStore()
const currentUserId = computed(() => authStore.user?.id)
const route = useRoute()

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
  usage_count?: number
  deleted_at?: number | null
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
const sortBy = useState<string>('promptSortBy', () => 'updated')
const sortOptions = [
  { value: 'updated', label: '最新' },
  { value: 'usage', label: '热度' },
  { value: 'created', label: '创建' },
  { value: 'title', label: '名称' },
] as const
function setSortBy(v: string) {
  sortBy.value = v
}
const expandedFolderIds = ref(new Set<string>())

// 全量缓存：用于客户端拼音搜索
const allPromptsCache = ref<Prompt[]>([])
// 回收站数量（用于 badge）
const recycleCount = ref(0)

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
  change_note: '',
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
}

function selectAndToggleAll() {
  activeFolderId.value = null
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
    try {
      await $fetch(`/api/prompts/folders/${folder.id}`, { method: 'DELETE' })
      expandedFolderIds.value.delete(folder.id)
      await Promise.all([loadFolders(), loadPrompts()])
    } catch (e: any) {
      alert('删除文件夹失败: ' + (e?.data?.error || e?.message || '未知错误'))
    }
  }
}

// Called from PromptDialogs @delete-folder event
async function deleteFolder(folder: any) {
  if (!folder) return
  if (!confirm(`确定删除文件夹「${folder.name}」？文件夹中的提示词不会被删除。`)) return
  try {
    await $fetch(`/api/prompts/folders/${folder.id}`, { method: 'DELETE' })
    expandedFolderIds.value.delete(folder.id)
    closeFolderDialog()
    await Promise.all([loadFolders(), loadPrompts()])
  } catch (e: any) {
    alert('删除文件夹失败: ' + (e?.data?.error || e?.message || '未知错误'))
  }
}

let searchTimeout: ReturnType<typeof setTimeout>
function debouncedSearch() {
  clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => applyClientSearch(), 200)
}

function toggleFavoritesView() {
  activeFolderId.value = activeFolderId.value === '_favorites' ? null : '_favorites'
}

/**
 * 客户端拼音搜索：在已缓存的全量数据中即时过滤
 */
function applyClientSearch() {
  const q = searchQuery.value.trim()
  if (!q) {
    prompts.value = allPromptsCache.value
    return
  }
  prompts.value = searchPrompts(allPromptsCache.value, q)
}

/**
 * 从后端加载提示词（folder/tag/sort/favorite 变化时调用）
 */
async function loadPrompts() {
  isLoading.value = true
  try {
    const params: Record<string, string> = {}

    // 回收站模式
    if (activeFolderId.value === '_recycle') {
      params.recycle = '1'
    } else {
      if (activeFolderId.value && activeFolderId.value !== '_favorites') params.folder_id = activeFolderId.value
      if (activeFolderId.value === '_favorites') params.favorites = '1'
      if (activeTagIds.value.length > 0) params.tag_ids = activeTagIds.value.join(',')
    }
    if (sortParamMap[sortBy.value]) params.sort = sortBy.value

    const query = new URLSearchParams(params).toString()
    const data = await $fetch<{ prompts: Prompt[] }>(`/api/prompts${query ? '?' + query : ''}`)
    const results = data?.prompts || []

    // 仅在非回收站模式时更新缓存（回收站数据不走搜索缓存）
    if (activeFolderId.value !== '_recycle') {
      allPromptsCache.value = results
    }

    // 有搜索词时走客户端拼音过滤（回收站内也支持搜索）
    if (searchQuery.value.trim()) {
      prompts.value = searchPrompts(results, searchQuery.value.trim())
    } else {
      prompts.value = results
    }
  } catch (e) {
    console.error('加载提示词失败', e)
    prompts.value = []
  } finally {
    isLoading.value = false
  }
}

/** 刷新回收站数量（在删除/还原操作后调用） */
async function refreshRecycleCount() {
  try {
    const data = await $fetch<{ prompts: Prompt[] }>('/api/prompts?recycle=1&limit=1000')
    recycleCount.value = data?.prompts?.length || 0
  } catch { recycleCount.value = 0 }
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
  editForm.change_note = ''
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
  editForm.change_note = ''
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
    change_note: editForm.change_note || undefined,
  }

  try {
  if (isCreating.value) {
    await $fetch('/api/prompts', { method: 'POST', body })
  } else if (editingPrompt.value) {
    const res = await $fetch(`/api/prompts/${editingPrompt.value.id}`, { method: 'PUT', body })
    if (res?.review_required) {
      showEditDialog.value = false
      isReviewMode.value = false
      alert('修改已提交审核，等待管理员审批')
      return
    }
  }
  showEditDialog.value = false
  await Promise.all([loadPrompts(), loadFolders()])
  } catch (e: any) {
    alert('保存失败: ' + (e?.data?.error || e?.message || '未知错误'))
  }
}

async function toggleFavorite(prompt: Prompt) {
  if (prompt.user_id !== currentUserId.value) return alert('仅作者可收藏自己的提示词')
  try {
    await $fetch(`/api/prompts/${prompt.id}`, {
      method: 'PUT',
      body: { is_favorite: prompt.is_favorite ? 0 : 1 },
    })
    await loadPrompts()
  } catch (e: any) {
    alert('操作失败: ' + (e?.data?.error || e?.message || '未知错误'))
  }
}

async function deletePrompt(prompt: Prompt) {
  if (prompt.user_id !== currentUserId.value) return alert('无权删除此提示词')
  if (!confirm(`确定删除提示词「${prompt.title}」？删除后将移入回收站。`)) return
  try {
    await $fetch(`/api/prompts/${prompt.id}`, { method: 'DELETE' })
    viewingPrompt.value = null
    await Promise.all([loadPrompts(), loadFolders(), refreshRecycleCount()])
  } catch (e: any) {
    alert('删除失败: ' + (e?.data?.error || e?.message || '未知错误'))
  }
}

/** 从回收站还原提示词 */
async function restorePrompt(prompt: Prompt) {
  try {
    await $fetch(`/api/prompts/${prompt.id}`, { method: 'PUT', body: { deleted_at: null } })
    await Promise.all([loadPrompts(), refreshRecycleCount()])
  } catch (e: any) {
    alert('还原失败: ' + (e?.data?.error || e?.message || '未知错误'))
  }
}

/** 永久删除提示词 */
async function permanentDelete(prompt: Prompt) {
  if (!confirm(`确定永久删除「${prompt.title}」？此操作不可恢复！`)) return
  try {
    await $fetch(`/api/prompts/${prompt.id}?permanent=1`, { method: 'DELETE' })
    await Promise.all([loadPrompts(), refreshRecycleCount()])
  } catch (e: any) {
    alert('删除失败: ' + (e?.data?.error || e?.message || '未知错误'))
  }
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
  try {
    await $fetch(`/api/prompts/${version.prompt_id}/restore`, { method: 'POST', body: { version_id: version.id } })
    showVersions.value = false
    await loadPrompts()
  } catch (e: any) {
    alert('恢复失败: ' + (e?.data?.error || e?.message || '未知错误'))
  }
}

async function saveFolder() {
  if (!newFolderName.value.trim()) return alert('请输入文件夹名称')
  try {
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
  } catch (e: any) {
    alert('保存文件夹失败: ' + (e?.data?.error || e?.message || '未知错误'))
  }
}

function closeFolderDialog() {
  showFolderDialog.value = false
  editingFolder.value = null
  newFolderName.value = ''
  folderFormParentId.value = null
  folderFormIcon.value = ''
}

const copySuccess = ref(false)

// 模板变量弹窗状态
const tplVarModalVisible = ref(false)
const tplVarContent = ref('')
const tplVarPromptId = ref<string | undefined>(undefined)

// 排序选项映射：前端值对应 API sort 参数
const sortParamMap: Record<string, string> = {
  updated: '',
  usage: 'usage',
  created: 'created',
  title: 'title',
}

/**
 * 复制提示词内容（带使用计数上报 + 模板变量检测）
 * @param content 提示词文本
 * @param promptId 可选 — 提供时上报 usage
 */
function copyContent(content: string, promptId?: string) {
  const vars = parseTemplateVariables(content)
  if (vars.length > 0) {
    // 有模板变量时打开填写弹窗
    tplVarContent.value = content
    tplVarPromptId.value = promptId
    tplVarModalVisible.value = true
    return
  }
  doCopy(content, promptId)
}

/** 实际执行复制 */
function doCopy(content: string, promptId?: string) {
  if (import.meta.client) {
    navigator.clipboard.writeText(content).then(() => {
      copySuccess.value = true
      setTimeout(() => { copySuccess.value = false }, 1500)
      if (promptId) {
        $fetch(`/api/prompts/${promptId}/usage`, { method: 'POST' }).catch(() => {})
      }
    })
  }
}

function onTplVarConfirm(filledContent: string) {
  doCopy(filledContent, tplVarPromptId.value)
  tplVarModalVisible.value = false
}

function onTplVarCancel() {
  tplVarModalVisible.value = false
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

// 排序变化时重新加载
watch(sortBy, () => loadPrompts())

onMounted(async () => {
  await Promise.all([loadPrompts(), loadFolders(), loadTags(), refreshRecycleCount()])
  // frontend #11：支持 ?prompt_id= 直达详情（首页搜索建议跳转携带）
  const promptId = route.query.prompt_id as string | undefined
  if (promptId) viewPromptById(promptId)
})

// 根据 ID 拉取单个提示词并打开详情（供 ?prompt_id= 直达）
async function viewPromptById(promptId: string) {
  try {
    const res = await $fetch<{ prompt: any }>(`/api/prompts/${encodeURIComponent(promptId)}`, {
      credentials: 'include',
    })
    if (res?.prompt) viewPrompt(res.prompt)
  } catch { /* 不存在或无权限时静默 */ }
}
</script>

<style scoped>
/* ── 主色横幅：页面视觉锚点（与精选集市场同语言） ── */
.prompts-hero {
  background: var(--primary, #10b981);
  border-radius: 20px;
  padding: 28px 28px 26px;
  margin-bottom: 20px;
  color: var(--text-inverse, #fff);
}
.hero-title {
  margin: 0 0 8px;
  font-size: 26px;
  font-weight: 800;
  letter-spacing: -0.022em;
  color: var(--text-inverse, #fff);
}
.hero-sub {
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
  color: color-mix(in srgb, var(--text-inverse, #fff) 80%, transparent);
}
.hero-toolbar {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-top: 20px;
  flex-wrap: wrap;
}
.hero-toolbar .search-box {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border: none;
  border-radius: 12px;
  background: var(--surface-raised, #fff);
  flex: 1;
  min-width: 220px;
  transition: box-shadow 0.18s;
}
.hero-toolbar .search-box i { color: var(--text-tertiary); font-size: 16px; transition: color 0.18s; }
.hero-toolbar .search-box:focus-within {
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--text-inverse, #fff) 45%, transparent);
}
.hero-toolbar .search-box:focus-within i { color: var(--primary); }
.hero-toolbar .search-box input {
  border: none;
  background: none;
  outline: none;
  font-size: 13.5px;
  width: 100%;
  color: var(--text-primary);
}
.hero-toolbar .search-box input::placeholder { color: var(--text-tertiary); }
.hero-toolbar .btn-favorite {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 15px;
  border: none;
  border-radius: 12px;
  background: color-mix(in srgb, var(--text-inverse, #fff) 18%, transparent);
  color: color-mix(in srgb, var(--text-inverse, #fff) 88%, transparent);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.18s, color 0.18s;
  white-space: nowrap;
}
.hero-toolbar .btn-favorite:hover { background: color-mix(in srgb, var(--text-inverse, #fff) 28%, transparent); color: var(--text-inverse, #fff); }
.hero-toolbar .btn-favorite.active {
  background: var(--surface-raised, #fff);
  color: var(--warning, #f59e0b);
  font-weight: 600;
}
.hero-toolbar .sort-tabs {
  display: flex;
  gap: 4px;
  padding: 4px;
  background: color-mix(in srgb, var(--text-inverse, #fff) 18%, transparent);
  border-radius: 12px;
}
.hero-toolbar .sort-tabs button {
  padding: 7px 14px;
  font-size: 12.5px;
  border: none;
  background: none;
  border-radius: 9px;
  cursor: pointer;
  color: color-mix(in srgb, var(--text-inverse, #fff) 88%, transparent);
  transition: all 0.18s;
  white-space: nowrap;
}
.hero-toolbar .sort-tabs button:hover { background: color-mix(in srgb, var(--text-inverse, #fff) 14%, transparent); }
.hero-toolbar .sort-tabs button.active {
  background: var(--surface-raised, #fff);
  color: var(--primary, #10b981);
  font-weight: 600;
}
.btn-hero-create {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 18px;
  border: none;
  border-radius: 12px;
  background: var(--surface-raised, #fff);
  color: var(--primary, #10b981);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: box-shadow 0.18s, transform 0.18s;
  white-space: nowrap;
}
.btn-hero-create:hover {
  box-shadow: 0 6px 14px -4px rgba(16, 24, 40, 0.28);
  transform: translateY(-1px);
}
@media (max-width: 1024px) {
  /* 移动端头部已提供收藏/排序/新建，横幅内仅保留搜索 */
  .hero-toolbar .btn-favorite,
  .hero-toolbar .sort-tabs,
  .btn-hero-create { display: none; }
  .hero-toolbar .search-box { flex: 1; min-width: 0; }
}
@media (max-width: 768px) {
  .prompts-hero { padding: 22px 20px 20px; border-radius: 16px; }
  .hero-title { font-size: 22px; }
}

.usage-badge {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px 6px;
  font-size: 11px;
  font-weight: 500;
  color: var(--warning, #f59e0b);
  background: color-mix(in srgb, var(--warning, #f59e0b) 10%, transparent);
  border-radius: 10px;
  white-space: nowrap;
}
</style>
