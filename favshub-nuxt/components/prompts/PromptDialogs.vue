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
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" @click="$emit('copy', viewingPrompt.content)">
            <i class="ri-file-copy-line"></i> 复制内容
          </button>
          <button class="btn btn-secondary" @click="$emit('view-versions', viewingPrompt)">
            <i class="ri-history-line"></i> 版本历史
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
                <select v-model="editForm.folder_id">
                  <option :value="null">未分类</option>
                  <option v-for="f in folders" :key="f.id" :value="f.id">{{ f.name }}</option>
                </select>
              </div>
              <div class="form-group">
                <label><i class="ri-price-tag-3-line"></i> 标签（空格分隔）</label>
                <input v-model="editForm.tagsInput" type="text" placeholder="标签1 标签2 ...">
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

    <!-- 版本历史模态框 -->
    <div class="modal" :class="{ active: showVersions }" @click.self="$emit('close-versions')">
      <div class="modal-content modal-large">
        <div class="modal-header">
          <h2>版本历史 — {{ versionsTitle }}</h2>
          <button class="modal-close" @click="$emit('close-versions')"><i class="ri-close-line"></i></button>
        </div>
        <div class="modal-body">
          <div v-if="versionsLoading" class="loading"><i class="ri-loader-4-line spin"></i><p>加载中...</p></div>
          <div v-else-if="versions.length === 0" class="empty-state"><i class="ri-file-warning-line"></i><p>暂无版本历史</p></div>
          <div v-else class="versions-timeline">
            <div v-for="(v, idx) in versions" :key="v.id" class="version-item" :class="{ latest: idx === 0 }">
              <div class="version-dot"></div>
              <div class="version-card">
                <div class="version-header">
                  <span class="version-num">v{{ v.version_number }}</span>
                  <span v-if="idx === 0" class="version-latest-badge">最新</span>
                  <span class="version-date"><i class="ri-time-line"></i> {{ formatTime(v.created_at) }}</span>
                  <span v-if="v.change_note" class="version-note">{{ v.change_note }}</span>
                  <button class="btn btn-secondary btn-sm" style="margin-left:auto;" @click="$emit('restore', v)">
                    <i class="ri-arrow-go-back-line"></i> 恢复此版本
                  </button>
                </div>
                <div class="version-content-wrap" @click="toggleVersionExpand(v.id)">
                  <pre class="version-content" :class="{ expanded: expandedVersions.has(v.id) }">{{ v.content }}</pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

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
}>()

defineEmits<{
  'close-view': []
  'close-edit': []
  'close-versions': []
  'close-folder': []
  save: []
  'save-folder': []
  'delete-folder': [folder: any]
  copy: [content: string]
  'view-versions': [prompt: any]
  edit: [prompt: any]
  delete: [prompt: any]
  restore: [version: any]
  'update:folder-name': [value: string]
  'update:folder-parent': [value: string | null]
  'update:folder-icon': [value: string]
}>()

const folderName_ = ref('')

const expandedVersions = ref(new Set<number>())
function toggleVersionExpand(id: number) {
  if (expandedVersions.value.has(id)) expandedVersions.value.delete(id)
  else expandedVersions.value.add(id)
  expandedVersions.value = new Set(expandedVersions.value)
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
/* Version history timeline */
.versions-timeline { position: relative; padding-left: 24px; }
.versions-timeline::before {
  content: ''; position: absolute; left: 8px; top: 0; bottom: 0;
  width: 2px; background: #e0e0e0;
}
.version-item { position: relative; margin-bottom: 16px; }
.version-dot {
  position: absolute; left: -20px; top: 12px;
  width: 10px; height: 10px; border-radius: 50%;
  background: #94a3b8; border: 2px solid #fff;
}
.version-item.latest .version-dot { background: #10b981; }
.version-card {
  background: var(--primary-light, #f8f9fa); border-radius: 10px;
  padding: 14px 16px; border: 1px solid #eee;
}
.version-header { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }
.version-num { font-weight: 700; font-size: 14px; color: #333; }
.version-latest-badge {
  font-size: 10px; padding: 2px 6px; border-radius: 4px;
  background: #10b981; color: #fff; font-weight: 600;
}
.version-date { font-size: 12px; color: #94a3b8; display: inline-flex; align-items: center; gap: 3px; }
.version-note { font-size: 12px; color: #667eea; font-style: italic; }
.version-content-wrap { cursor: pointer; }
.version-content {
  background: #fff; padding: 10px 12px; border-radius: 8px;
  white-space: pre-wrap; font-size: 13px; line-height: 1.5;
  max-height: 80px; overflow: hidden; position: relative;
  border: 1px solid #eee; transition: max-height 0.3s;
}
.version-content.expanded { max-height: 2000px; overflow-y: auto; }

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
  font-size: 13px !important; line-height: 1.6 !important;
  tab-size: 2;
}

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
