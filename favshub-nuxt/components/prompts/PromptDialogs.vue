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
          <div class="form-group">
            <label>标题 *</label>
            <input v-model="editForm.title" type="text" placeholder="提示词标题">
          </div>
          <div class="form-group">
            <label>描述</label>
            <input v-model="editForm.description" type="text" placeholder="简短描述（可选）">
          </div>
          <div class="form-row">
            <div class="form-group">
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
          <div class="form-group">
            <label>内容 *</label>
            <textarea v-model="editForm.content" rows="16" placeholder="提示词内容"></textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" @click="$emit('close-edit')">取消</button>
          <button class="btn btn-primary" @click="$emit('save')">保存</button>
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
          <div v-else class="versions-list">
            <div v-for="v in versions" :key="v.id" class="version-item">
              <div class="version-header">
                <span class="version-num">v{{ v.version_number }}</span>
                <span class="version-date">{{ formatTime(v.created_at) }}</span>
                <button class="btn btn-secondary btn-sm" @click="$emit('restore', v)">恢复</button>
              </div>
              <pre class="version-content">{{ v.content }}</pre>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 新建文件夹模态框 -->
    <div class="modal" :class="{ active: showFolderDialog }" @click.self="$emit('close-folder')">
      <div class="modal-content">
        <div class="modal-header">
          <h2>新建文件夹</h2>
          <button class="modal-close" @click="$emit('close-folder')"><i class="ri-close-line"></i></button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>文件夹名称</label>
            <input :value="folderName_" type="text" placeholder="输入文件夹名称" @input="$emit('update:folder-name', ($event.target as HTMLInputElement).value)">
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" @click="$emit('close-folder')">取消</button>
          <button class="btn btn-primary" @click="$emit('save-folder')">保存</button>
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
  folders: { id: string; name: string }[]
  showVersions: boolean
  versionsTitle: string
  versions: any[]
  versionsLoading: boolean
  showFolderDialog: boolean
  isGuest?: boolean
}>()

defineEmits<{
  'close-view': []
  'close-edit': []
  'close-versions': []
  'close-folder': []
  save: []
  'save-folder': []
  copy: [content: string]
  'view-versions': [prompt: any]
  edit: [prompt: any]
  delete: [prompt: any]
  restore: [version: any]
  'update:folder-name': [value: string]
}>()

const folderName_ = ref('')

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
/* .modal / .modal-content / .modal-header / .modal-body / .modal-footer / .btn / .form-group /
   .versions-list / .detail-* 全部来自 promptpro-bundle.css（含暗色模式）。 */
.version-item { margin-bottom: 12px; }
.version-header { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
.version-content {
  background: var(--primary-light, #f5f5f5);
  padding: 10px;
  border-radius: 8px;
  white-space: pre-wrap;
  font-size: 13px;
  max-height: 200px;
  overflow-y: auto;
}
</style>
