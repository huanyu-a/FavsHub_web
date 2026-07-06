<template>
  <div>
    <!-- 提示词详情模态框 -->
    <div class="modal" :class="{ active: !!viewingPrompt }" @click.self="$emit('close-view')">
      <div class="modal-content modal-large" v-if="viewingPrompt">
        <div class="modal-header">
          <h2>{{ viewingPrompt.title }}</h2>
          <button class="modal-close" @click="$emit('close-view')"><i class="ri-close-line"></i></button>
        </div>
        <div class="modal-body">
          <div class="prompt-detail">
            <div class="detail-meta">
              <span class="meta-item" v-if="folderName(viewingPrompt.folder_id)">
                <i class="ri-folder-line"></i>
                <span>{{ folderName(viewingPrompt.folder_id) }}</span>
              </span>
              <span class="meta-item" v-if="viewingPrompt.tags && viewingPrompt.tags.length">
                <i class="ri-price-tag-3-line"></i>
                <span>
                  <span v-for="tag in viewingPrompt.tags" :key="tag.id" class="detail-tag">{{ tag.name }}</span>
                </span>
              </span>
              <span class="meta-item" v-if="viewingPrompt.updated_at">
                <i class="ri-time-line"></i>
                <span>{{ formatTime(viewingPrompt.updated_at) }}</span>
              </span>
            </div>
            <div class="detail-description" v-if="viewingPrompt.description">
              <h4>描述</h4>
              <p>{{ viewingPrompt.description }}</p>
            </div>
            <div class="detail-content">
              <h4>内容</h4>
              <pre>{{ viewingPrompt.content }}</pre>
            </div>
            <!-- 内嵌版本历史（参考旧架构 #promptModal） -->
            <div class="detail-versions">
              <h4>版本历史</h4>
              <div class="versions-list">
                <div v-if="versionsLoading" class="loading"><i class="ri-loader-4-line spin"></i><p>加载中...</p></div>
                <p v-else-if="allVersions.length === 0" style="color: var(--text-secondary); padding: 0.5rem 0; font-size: 0.8125rem;">
                  <i class="ri-file-warning-line"></i> 无版本记录
                </p>
                <div v-else class="version-collapse">
                  <!-- vcol-header -->
                  <div class="vcol-header" @click.stop="toggleVersions">
                    <div class="vcol-left">
                      <i class="ri-git-commit-line"></i>
                      <span>版本历史</span>
                      <span class="vcol-badge">{{ allVersions.length }}</span>
                    </div>
                    <div class="vcol-right">
                      <button class="btn vcol-compare-btn" :class="{ active: compareEnabled }" :disabled="!compareEnabled" @click.stop="openCompare">
                        <i class="ri-git-repository-commits-line"></i>版本差异对比
                      </button>
                      <i class="ri-arrow-down-s-line vcol-arrow" :style="{ transform: versionsExpanded ? 'rotate(180deg)' : '' }"></i>
                    </div>
                  </div>
                  <!-- vcol-body -->
                  <div class="vcol-body" :class="{ open: versionsExpanded }">
                    <div class="vcol-grid">
                      <div
                        v-for="(v, idx) in allVersions"
                        :key="v.id || idx"
                        class="vcol-item"
                        :class="{ 'is-cur': v.is_current }"
                      >
                        <input type="checkbox" class="vcol-cb" :checked="checkedIndices.has(idx)" @change="toggleCheck(idx)">
                        <label class="vcol-label" @click="toggleCheck(idx)">
                          <span class="vcol-ver">
                            <span class="vtag" :class="{ cur: v.is_current }">v{{ v.version_number }}</span>
                            <span v-if="v.is_current" class="vtag-cur">当前</span>
                          </span>
                          <span class="vcol-time">{{ formatTime(v.created_at) }}</span>
                          <span class="vcol-size">{{ v.content ? (v.content.length / 1024).toFixed(1) : '0' }} KB</span>
                        </label>
                        <div class="vcol-actions">
                          <button class="btn-icon vcol-view" title="查看" @click.stop="showVersionDetail(v)">
                            <i class="ri-eye-line"></i>
                          </button>
                          <button v-if="!v.is_current" class="btn-icon vcol-restore" title="还原到此版本" @click.stop="confirmRestore(v)">
                            <i class="ri-history-line"></i>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" @click="$emit('copy', viewingPrompt.content)">
            <i class="ri-file-copy-line"></i> 复制内容
          </button>
          <button v-if="!isGuest && viewingPrompt.user_id === currentUserId" class="btn btn-primary" @click="$emit('edit', viewingPrompt)">
            <i class="ri-edit-line"></i> 编辑
          </button>
          <button v-if="!isGuest && viewingPrompt.user_id !== currentUserId && viewingPrompt.owner_is_admin == 1" class="btn btn-primary" @click="$emit('edit', viewingPrompt)" style="background:var(--warning);border-color:var(--warning);color:#1a1a2e;">
            <i class="ri-edit-line"></i> 申请修改
          </button>
          <button v-if="!isGuest && viewingPrompt.user_id === currentUserId" class="btn btn-danger" @click="$emit('delete', viewingPrompt)">
            <i class="ri-delete-bin-line"></i> 删除
          </button>
        </div>
      </div>
    </div>

    <!-- 创建/编辑提示词模态框 -->
    <div class="modal" :class="{ active: showEditDialog }" @click.self="$emit('close-edit')">
      <div class="modal-content modal-xlarge">
        <div class="modal-header">
          <h2>{{ isCreating ? '新建提示词' : isReviewMode ? '申请修改' : '编辑提示词' }}</h2>
          <button class="modal-close" @click="$emit('close-edit')"><i class="ri-close-line"></i></button>
        </div>
        <div class="modal-body">
          <div class="review-hint" v-if="isReviewMode">⚠️ 此提示词由管理员创建，修改将提交给管理员审核</div>
          <div class="edit-form-grid">
            <div class="form-group full-width">
              <label><i class="ri-edit-line"></i> 标题 *</label>
              <input v-model="editForm.title" type="text" placeholder="提示词标题" class="form-input-lg">
            </div>
            <div class="form-group full-width">
              <label><i class="ri-file-text-line"></i> 描述</label>
              <input v-model="editForm.description" type="text" placeholder="简短描述（可选）">
            </div>
            <div class="form-row-2col">
              <div class="form-group">
                <label><i class="ri-folder-line"></i> 文件夹</label>
                <!-- 文件夹选择器 -->
                <div id="folderSelect" class="custom-select" :class="{ open: folderSelectOpen }">
                  <div class="custom-select-trigger" :class="{ open: folderSelectOpen }" data-select-id="folderSelect" @click.stop="folderSelectOpen = !folderSelectOpen">
                    <span class="selected-text" :class="{ placeholder: !editForm.folder_id }">{{ selectedFolderName }}</span>
                    <i class="ri-arrow-down-s-line arrow"></i>
                  </div>
                  <div class="custom-select-dropdown" :class="{ open: folderSelectOpen }">
                    <div class="custom-select-option" :class="{ selected: !editForm.folder_id }" @click="editForm.folder_id = null; folderSelectOpen = false">
                      <i class="ri-folder-line folder-icon"></i>未选择文件夹
                    </div>
                    <div
                      v-for="f in folders"
                      :key="f.id"
                      class="custom-select-option"
                      :class="{ selected: editForm.folder_id === f.id }"
                      @click="editForm.folder_id = f.id; folderSelectOpen = false"
                    ><i class="ri-folder-line folder-icon"></i>{{ f.name }}</div>
                  </div>
                </div>
              </div>
              <div class="form-group">
                <label><i class="ri-git-branch-line"></i> 版本号</label>
                <input v-model="editForm.current_version" type="text" placeholder="1.0.0">
              </div>
            </div>
            <div class="form-group full-width">
              <label><i class="ri-price-tag-3-line"></i> 标签（回车添加）</label>
              <div class="tag-selector">
                <div class="tag-list">
                  <span v-for="(tag, i) in editForm.tags" :key="i" class="tag-item">
                    {{ tag.name || (tag as any).tag_name }}
                    <span class="tag-remove" @click="removeFormTag(i)"><i class="ri-close-line"></i></span>
                  </span>
                </div>
                <input
                  v-model="tagInputValue"
                  type="text"
                  placeholder="输入标签后回车"
                  class="tag-input"
                  @keydown.enter.prevent="addFormTag"
                  @input="onTagInput"
                >
                <div v-if="tagSuggestions.length" class="tag-suggestions">
                  <div v-for="s in tagSuggestions" :key="s.id" class="tag-suggestion" @mousedown.prevent="selectSuggestion(s)">
                    <i class="ri-price-tag-3-line"></i>
                    <span>{{ s.name }}</span>
                  </div>
                </div>
              </div>
            </div>
            <div class="form-group full-width">
              <label><i class="ri-code-line"></i> 内容 *</label>
              <textarea v-model="editForm.content" rows="18" placeholder="提示词内容" class="form-textarea-code"></textarea>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" @click="$emit('close-edit')">取消</button>
          <button class="btn btn-primary" @click="$emit('save')">
            <i class="ri-save-line"></i> {{ isCreating ? '创建' : '保存' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 版本详情查看弹窗 -->
    <Teleport to="body">
      <div v-if="viewingVersion" class="modal version-modal active" @click.self="viewingVersion = null">
        <div class="modal-content modal-large">
          <div class="modal-header">
            <h2>版本 v{{ viewingVersion.version_number }}</h2>
            <button class="modal-close" @click="viewingVersion = null"><i class="ri-close-line"></i></button>
          </div>
          <div class="modal-body">
            <div class="version-detail">
              <div class="version-header">
                <h3>版本 {{ viewingVersion.version_number }}</h3>
                <span class="version-time">{{ formatTime(viewingVersion.created_at) }}</span>
              </div>
              <pre class="version-content">{{ viewingVersion.content }}</pre>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" @click="copyVersionContent">
              <i class="ri-file-copy-line"></i> 复制内容
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 版本对比弹窗 -->
    <Teleport to="body">
      <div v-if="showCompare" class="modal active" @click.self="showCompare = false">
        <div class="modal-content modal-xlarge">
          <div class="modal-header">
            <h2>版本差异对比</h2>
            <button class="modal-close" @click="showCompare = false"><i class="ri-close-line"></i></button>
          </div>
          <div class="modal-body">
            <div class="compare-info">
              <div class="compare-version">
                <span class="label">旧版本</span>
                <span class="value">v{{ compareOld?.version_number }}</span>
                <span class="time">{{ formatTime(compareOld?.created_at) }}</span>
              </div>
              <span class="compare-arrow"><i class="ri-arrow-right-line"></i></span>
              <div class="compare-version">
                <span class="label">新版本</span>
                <span class="value">v{{ compareNew?.version_number }}</span>
                <span class="time">{{ formatTime(compareNew?.created_at) }}</span>
              </div>
            </div>
            <div class="compare-stats">
              <span class="stat added">+{{ addedCount }} 行</span>
              <span class="stat removed">-{{ removedCount }} 行</span>
              <span class="stat same">= {{ sameCount }} 行</span>
            </div>
            <div class="compare-diff">
              <div v-for="(line, i) in diffLines" :key="i" class="diff-line" :class="line.type">
                <span class="diff-line-num">{{ i + 1 }}</span>
                <span class="diff-line-content"><span class="diff-prefix">{{ line.prefix }}</span>{{ line.text }}</span>
              </div>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" @click="showCompare = false">关闭</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 还原确认弹窗 -->
    <Teleport to="body">
      <div v-if="restoreTarget" class="modal active" @click.self="restoreTarget = null">
        <div class="modal-content">
          <div class="modal-header">
            <h2>确认还原</h2>
            <button class="modal-close" @click="restoreTarget = null"><i class="ri-close-line"></i></button>
          </div>
          <div class="modal-body">
            <p style="margin-bottom: 1rem; color: var(--text-secondary);">
              确定要还原到版本 <strong>v{{ restoreTarget.version_number }}</strong> 吗？
            </p>
            <p style="color: var(--text-secondary); font-size: 0.875rem;">
              还原后，当前内容将被替换为该版本的内容，当前版本将作为历史版本保留。
            </p>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" @click="restoreTarget = null">取消</button>
            <button class="btn btn-primary" @click="doRestore">确认还原</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 新建/编辑文件夹模态框 -->
    <div class="modal" :class="{ active: showFolderDialog }" @click.self="$emit('close-folder')">
      <div class="modal-content">
        <div class="modal-header">
          <h2>{{ editingFolder ? '编辑文件夹' : '新建文件夹' }}</h2>
          <button class="modal-close" @click="$emit('close-folder')"><i class="ri-close-line"></i></button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>文件夹名称</label>
            <input :value="folderName ?? folderName_" type="text" placeholder="输入文件夹名称" @input="$emit('update:folder-name', ($event.target as HTMLInputElement).value)">
          </div>
          <div class="form-group">
            <label>父文件夹</label>
            <select :value="folderParentId" @change="$emit('update:folder-parent', ($event.target as HTMLSelectElement).value || null)">
              <option :value="null">无（顶级）</option>
              <option v-for="f in folders" :key="f.id" :value="f.id">{{ f.name }}</option>
            </select>
          </div>
          <div class="form-group">
            <label>图标（Remix Icon class）</label>
            <IconPicker :model-value="folderIcon || ''" @update:model-value="$emit('update:folder-icon', $event)" />
          </div>
        </div>
        <div class="modal-footer">
          <button v-if="editingFolder" class="btn btn-danger" @click="$emit('delete-folder', editingFolder)"><i class="ri-delete-bin-line"></i> 删除</button>
          <button class="btn btn-secondary" @click="$emit('close-folder')">取消</button>
          <button class="btn btn-primary" @click="$emit('save-folder')">{{ editingFolder ? '更新' : '保存' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
	const props = defineProps<{
	  viewingPrompt: any
	  showEditDialog: boolean
	  isCreating: boolean
	  isReviewMode?: boolean
	  editForm: any
  folders: { id: string; name: string; parent_id?: string; icon?: string }[]
  showVersions: boolean
  versionsTitle: string
  versions: any[]
  versionsLoading: boolean
  showFolderDialog: boolean
  editingFolder?: { id: string; name: string; parent_id?: string; icon?: string } | null
  folderParentId?: string | null
  folderIcon?: string
  folderName?: string
  isGuest?: boolean
  currentUserId?: number
  allTags?: { id: number; name: string; color?: string }[]
}>()

const emit = defineEmits<{
  'close-view': []
  'close-edit': []
  'close-versions': []
  'close-folder': []
  save: []
  'save-folder': []
  'delete-folder': [folder: any]
  copy: [content: string]
  edit: [prompt: any]
  delete: [prompt: any]
  restore: [version: any]
  'load-versions': [prompt: any]
  'update:folder-name': [value: string]
  'update:folder-parent': [value: string | null]
  'update:folder-icon': [value: string]
}>()

const folderName_ = ref('')
const folderSelectOpen = ref(false)

const selectedFolderName = computed(() => {
  if (!props.editForm.folder_id) return '未分类'
  const f = props.folders.find((f: any) => f.id === props.editForm.folder_id)
  return f ? f.name : '未分类'
})

// 点击外部关闭文件夹下拉
if (import.meta.client) {
  document.addEventListener('click', () => { folderSelectOpen.value = false })
}

// ── 版本历史相关 ────────────────────────────────────────────
const versionsExpanded = ref(false)
const checkedIndices = ref(new Set<number>())
const compareEnabled = computed(() => checkedIndices.value.size === 2)

// 构建含当前版本的完整版本列表
const allVersions = computed(() => {
  const p = props.viewingPrompt
  if (!p) return []
  const list = [...props.versions]
  const currentExists = list.some(v => v.version_number === p.current_version)
  if (!currentExists && p.content) {
    list.unshift({
      id: 'current', prompt_id: p.id, version_number: p.current_version || 'current',
      content: p.content, created_at: p.updated_at, is_current: true
    })
  } else if (currentExists) {
    const cv = list.find(v => v.version_number === p.current_version)
    if (cv) cv.is_current = true
  }
  return list
})

// 打开详情弹窗时自动加载版本并展开
watch(() => props.viewingPrompt, (p) => {
  if (p) {
    versionsExpanded.value = true
    checkedIndices.value = new Set()
    emit('load-versions', p)
  }
})

function toggleVersions() {
  versionsExpanded.value = !versionsExpanded.value
}

function toggleCheck(idx: number) {
  const s = new Set(checkedIndices.value)
  if (s.has(idx)) s.delete(idx)
  else if (s.size < 2) s.add(idx)
  else {
    // 已满 2 个，替换最早选中的
    const first = s.values().next().value
    s.delete(first!)
    s.add(idx)
  }
  checkedIndices.value = s
}

// ── 版本详情查看 ────────────────────────────────────────────
const viewingVersion = ref<any>(null)

function showVersionDetail(v: any) {
  viewingVersion.value = v
}

function copyVersionContent() {
  if (viewingVersion.value?.content && import.meta.client) {
    navigator.clipboard.writeText(viewingVersion.value.content).catch(() => {})
  }
}

// ── 还原确认 ────────────────────────────────────────────────
const restoreTarget = ref<any>(null)

function confirmRestore(v: any) {
  restoreTarget.value = v
}

function doRestore() {
  if (restoreTarget.value) {
    emit('restore', restoreTarget.value)
    restoreTarget.value = null
  }
}

// ── 版本对比 ────────────────────────────────────────────────
const showCompare = ref(false)
const compareOld = ref<any>(null)
const compareNew = ref<any>(null)
const diffLines = ref<{ type: string; prefix: string; text: string }[]>([])

const addedCount = computed(() => diffLines.value.filter(l => l.type === 'add').length)
const removedCount = computed(() => diffLines.value.filter(l => l.type === 'del').length)
const sameCount = computed(() => diffLines.value.filter(l => l.type === 'same').length)

function openCompare() {
  const indices = [...checkedIndices.value].sort((a, b) => a - b)
  if (indices.length !== 2) return
  const v1 = allVersions.value[indices[0]]
  const v2 = allVersions.value[indices[1]]
  // 按时间升序：旧版本在前
  const [old, newer] = (v1.created_at || 0) <= (v2.created_at || 0) ? [v1, v2] : [v2, v1]
  compareOld.value = old
  compareNew.value = newer
  diffLines.value = computeDiff(old.content || '', newer.content || '')
  showCompare.value = true
}

function computeDiff(oldText: string, newText: string) {
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')
  const result: { type: string; prefix: string; text: string }[] = []
  const maxLen = Math.max(oldLines.length, newLines.length)
  // Simple LCS-based line diff
  const m = oldLines.length, n = newLines.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = oldLines[i - 1] === newLines[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
  // Backtrack
  let i = m, j = n
  const ops: { type: 'same' | 'del' | 'add'; text: string }[] = []
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      ops.unshift({ type: 'same', text: oldLines[i - 1] })
      i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.unshift({ type: 'add', text: newLines[j - 1] })
      j--
    } else {
      ops.unshift({ type: 'del', text: oldLines[i - 1] })
      i--
    }
  }
  return ops.map(op => ({
    type: op.type,
    prefix: op.type === 'same' ? '  ' : op.type === 'add' ? '+ ' : '- ',
    text: op.text
  }))
}

// ── 编辑弹窗标签选择器 ──────────────────────────────────────
const tagInputValue = ref('')
const tagSuggestions = ref<{ id: number; name: string; color?: string }[]>([])

function addFormTag() {
  const name = tagInputValue.value.trim()
  if (!name) return
  const tags: any[] = props.editForm.tags || []
  const exists = tags.find((t: any) => (t.name || t.tag_name || '').toLowerCase() === name.toLowerCase())
  if (exists) { tagInputValue.value = ''; tagSuggestions.value = []; return }
  const allTags = props.allTags || []
  const existing = allTags.find(t => t.name.toLowerCase() === name.toLowerCase())
  tags.push(existing || { name, is_new: true })
  props.editForm.tags = [...tags]
  tagInputValue.value = ''
  tagSuggestions.value = []
}

function removeFormTag(index: number | string) {
  const tags: any[] = props.editForm.tags || []
  tags.splice(Number(index), 1)
  props.editForm.tags = [...tags]
}

function onTagInput() {
  const val = tagInputValue.value.trim().toLowerCase()
  if (!val) { tagSuggestions.value = []; return }
  const allTags = props.allTags || []
  const selected = props.editForm.tags || []
  tagSuggestions.value = allTags
    .filter(t => t.name.toLowerCase().includes(val) && !selected.some((ft: any) => ft.id === t.id))
    .slice(0, 5)
}

function selectSuggestion(s: { id: number; name: string; color?: string }) {
  const tags: any[] = props.editForm.tags || []
  tags.push(s)
  props.editForm.tags = [...tags]
  tagInputValue.value = ''
  tagSuggestions.value = []
}

import IconPicker from '~/components/common/IconPicker.vue'

function folderName(id?: string) {
  if (!id) return ''
  return props.folders.find(f => f.id === id)?.name || ''
}

function formatTime(ts?: number) {
  if (!ts) return '-'
  return new Date(ts).toLocaleString('zh-CN')
}
</script>

<style scoped>
.review-hint { background: rgba(251,191,36,0.12); border: 1px solid rgba(251,191,36,0.3); border-radius: 8px; padding: 10px 12px; margin-bottom: 12px; font-size: 13px; color: var(--text-primary); }
</style>
