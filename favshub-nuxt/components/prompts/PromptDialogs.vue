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
                <p v-else-if="allVersions.length === 0" style="color: var(--text-secondary, #94a3b8); padding: 0.5rem 0; font-size: 0.8125rem;">
                  <i class="ri-file-warning-line"></i> 无版本记录
                </p>
                <div v-else class="version-collapse">
                  <!-- vcol-header -->
                  <div class="vcol-header" @click="versionsExpanded = !versionsExpanded">
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
          <button v-if="!isGuest" class="btn btn-primary" @click="$emit('edit', viewingPrompt)">
            <i class="ri-edit-line"></i> 编辑
          </button>
          <button v-if="!isGuest" class="btn btn-danger" @click="$emit('delete', viewingPrompt)">
            <i class="ri-delete-bin-line"></i> 删除
          </button>
        </div>
      </div>
    </div>

    <!-- 创建/编辑提示词模态框 -->
    <div class="modal" :class="{ active: showEditDialog }" @click.self="$emit('close-edit')">
      <div class="modal-content modal-xlarge">
        <div class="modal-header">
          <h2>{{ isCreating ? '新建提示词' : '编辑提示词' }}</h2>
          <button class="modal-close" @click="$emit('close-edit')"><i class="ri-close-line"></i></button>
        </div>
        <div class="modal-body">
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
                <div class="custom-select" :class="{ open: folderSelectOpen }">
                  <div class="custom-select-trigger" @click.stop="folderSelectOpen = !folderSelectOpen">
                    <span class="selected-text" :class="{ placeholder: !editForm.folder_id }">{{ selectedFolderName }}</span>
                    <i class="ri-arrow-down-s-line arrow"></i>
                  </div>
                  <div class="custom-select-dropdown" :class="{ open: folderSelectOpen }">
                    <div class="custom-select-option" :class="{ selected: !editForm.folder_id }" @click="editForm.folder_id = null; folderSelectOpen = false">未分类</div>
                    <div
                      v-for="f in folders"
                      :key="f.id"
                      class="custom-select-option"
                      :class="{ selected: editForm.folder_id === f.id }"
                      @click="editForm.folder_id = f.id; folderSelectOpen = false"
                    >{{ f.name }}</div>
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
            <div class="compare-header">
              <span class="compare-ver">v{{ compareOld?.version_number }}</span>
              <span>→</span>
              <span class="compare-ver">v{{ compareNew?.version_number }}</span>
            </div>
            <div class="compare-diff">
              <div v-for="(line, i) in diffLines" :key="i" class="diff-line" :class="line.type">
                <span class="diff-prefix">{{ line.prefix }}</span>{{ line.text }}
              </div>
            </div>
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
            <p style="margin-bottom: 1rem; color: var(--text-secondary, #64748b);">
              确定要还原到版本 <strong>v{{ restoreTarget.version_number }}</strong> 吗？
            </p>
            <p style="color: var(--text-secondary, #94a3b8); font-size: 0.875rem;">
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
            <div class="icon-picker-row">
              <span
                v-for="ic in folderIcons"
                :key="ic"
                class="icon-pick-option"
                :class="{ active: folderIcon === ic }"
                @click="$emit('update:folder-icon', ic)"
              ><i :class="ic"></i></span>
            </div>
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

const folderIcons = [
  'ri-folder-3-line', 'ri-folder-line', 'ri-folder-star-line',
  'ri-code-s-slash-line', 'ri-quill-pen-line', 'ri-lightbulb-line',
  'ri-book-open-line', 'ri-chat-3-line', 'ri-image-line',
  'ri-tools-line', 'ri-database-2-line', 'ri-rocket-line',
]

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
/* Version collapse accordion */
.version-collapse { border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
.vcol-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 14px; cursor: pointer; background: #f8f9fa; user-select: none;
}
.vcol-header:hover { background: #f1f5f9; }
.vcol-left { display: flex; align-items: center; gap: 6px; font-size: 13px; color: #475569; }
.vcol-badge {
  background: #667eea; color: #fff; font-size: 11px; font-weight: 700;
  padding: 1px 7px; border-radius: 10px;
}
.vcol-right { display: flex; align-items: center; gap: 8px; }
.vcol-compare-btn {
  font-size: 12px; padding: 3px 10px; border-radius: 6px; border: 1px solid #ddd;
  background: #fff; cursor: pointer; color: #64748b; transition: all 0.15s;
}
.vcol-compare-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.vcol-compare-btn.active { border-color: #667eea; color: #667eea; }
.vcol-arrow { font-size: 16px; color: #94a3b8; transition: transform 0.2s; }
.vcol-grid { display: flex; flex-direction: column; }
.vcol-item {
  display: flex; align-items: center; gap: 8px; padding: 8px 14px;
  border-bottom: 1px solid #f1f5f9; transition: background 0.1s;
}
.vcol-item:last-child { border-bottom: none; }
.vcol-item:hover { background: #f8fafc; }
.vcol-item.is-cur { background: #f0fdf4; }
.vcol-cb { width: 14px; height: 14px; cursor: pointer; accent-color: #667eea; flex-shrink: 0; }
.vcol-label { display: flex; align-items: center; gap: 8px; flex: 1; cursor: pointer; font-size: 13px; }
.vcol-ver { display: flex; align-items: center; gap: 4px; }
.vtag {
  font-size: 11px; font-weight: 700; padding: 1px 6px; border-radius: 4px;
  background: #e2e8f0; color: #475569;
}
.vtag.cur { background: #10b981; color: #fff; }
.vtag-cur {
  font-size: 10px; padding: 1px 5px; border-radius: 4px;
  background: #d1fae5; color: #065f46; font-weight: 600;
}
.vcol-time { font-size: 11px; color: #94a3b8; }
.vcol-size { font-size: 11px; color: #94a3b8; }
.vcol-actions { display: flex; gap: 4px; margin-left: auto; flex-shrink: 0; }
.btn-icon {
  background: none; border: none; cursor: pointer; padding: 4px 6px;
  border-radius: 6px; font-size: 14px; color: #64748b; transition: all 0.15s;
}
.btn-icon:hover { background: #e2e8f0; color: #334155; }
.vcol-restore:hover { color: #10b981; background: #d1fae5; }

/* Version detail modal */
.version-modal { display: flex; position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 10001; align-items: center; justify-content: center; }
.version-detail { }
.version-header { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.version-header h3 { margin: 0; font-size: 15px; }
.version-time { font-size: 12px; color: #94a3b8; }
.version-content {
  background: #f8f9fa; padding: 12px 14px; border-radius: 8px;
  white-space: pre-wrap; font-size: 13px; line-height: 1.6; max-height: 60vh;
  overflow-y: auto; border: 1px solid #e2e8f0;
}

/* Compare modal */
.compare-header { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; font-size: 14px; }
.compare-ver { font-weight: 700; color: #667eea; }
.compare-diff {
  background: #1e1e1e; color: #d4d4d4; padding: 12px; border-radius: 8px;
  font-family: 'Fira Code', monospace; font-size: 12px; line-height: 1.6;
  max-height: 60vh; overflow-y: auto;
}
.diff-line { white-space: pre-wrap; }
.diff-line.add { color: #4ade80; background: rgba(74,222,128,0.08); }
.diff-line.del { color: #f87171; background: rgba(248,113,113,0.08); }
.diff-line.same { color: #94a3b8; }
.diff-prefix { font-weight: 700; margin-right: 4px; }

/* Edit form grid */
.edit-form-grid { display: flex; flex-direction: column; gap: 12px; }
.form-row-2col { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.full-width { width: 100%; }
.form-group label {
  display: flex; align-items: center; gap: 4px;
  font-size: 13px; font-weight: 600; color: #555; margin-bottom: 4px;
}
.form-group label i { font-size: 14px; color: #10b981; }
.form-input-lg { font-size: 16px !important; font-weight: 600; }
.form-textarea-code {
  font-family: 'Fira Code', 'JetBrains Mono', 'Cascadia Code', monospace !important;
  font-size: 13px !important; line-height: 1.6 !important; tab-size: 2;
}

/* Tag selector */
.tag-selector {
  position: relative; display: flex; flex-wrap: wrap; gap: 6px; align-items: center;
  border: 1px solid #ddd; border-radius: 8px; padding: 6px 10px; min-height: 38px;
}
.tag-list { display: flex; flex-wrap: wrap; gap: 4px; }
.tag-item {
  display: inline-flex; align-items: center; gap: 4px;
  background: var(--primary-light, #e8f5e9); border-radius: 12px;
  padding: 2px 10px; font-size: 13px;
}
.tag-remove { cursor: pointer; color: #999; font-size: 14px; }
.tag-remove:hover { color: #e53e3e; }
.tag-input { border: none; outline: none; flex: 1; min-width: 100px; font-size: 13px; padding: 4px; }
.tag-suggestions {
  position: absolute; top: 100%; left: 0; right: 0; z-index: 10; background: #fff;
  border: 1px solid #eee; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);
  max-height: 150px; overflow-y: auto; margin-top: 4px;
}
.tag-suggestion {
  padding: 8px 12px; cursor: pointer; display: flex; align-items: center; gap: 6px; font-size: 13px;
}
.tag-suggestion:hover { background: #f0f0f0; }

/* Icon picker */
.icon-picker-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
.icon-pick-option {
  width: 36px; height: 36px; display: inline-flex; align-items: center; justify-content: center;
  border-radius: 8px; border: 1.5px solid #e0e0e0; cursor: pointer; font-size: 18px;
  color: #555; transition: all 0.15s;
}
.icon-pick-option:hover { border-color: #10b981; color: #10b981; }
.icon-pick-option.active { border-color: #10b981; background: rgba(16,185,129,0.08); color: #10b981; }

@media (max-width: 640px) {
  .form-row-2col { grid-template-columns: 1fr; }
}
</style>
