<template>
  <Teleport to="body">
    <div v-if="visible" :class="['modal-overlay', { active: visible }]" @click.self="emit('close')">
      <div class="modal" style="max-width: 800px; max-height: 85vh;">
        <div class="modal-header">
          <h3>批量导入书签 - {{ collection?.name }}</h3>
          <button class="modal-close" @click="emit('close')">&times;</button>
        </div>
        <div class="modal-body">
          <!-- 步骤指示 -->
          <div class="import-steps">
            <div class="step" :class="{ active: step === 1, done: step > 1 }">
              <span class="step-num">1</span>
              <span class="step-label">上传文件</span>
            </div>
            <div class="step-divider"></div>
            <div class="step" :class="{ active: step === 2, done: step > 2 }">
              <span class="step-num">2</span>
              <span class="step-label">预览数据</span>
            </div>
            <div class="step-divider"></div>
            <div class="step" :class="{ active: step === 3, done: step > 3 }">
              <span class="step-num">3</span>
              <span class="step-label">确认导入</span>
            </div>
          </div>

          <!-- 步骤 1: 上传 -->
          <div v-if="step === 1" class="import-step-content">
            <div class="fg">
              <label>上传 JSON 文件</label>
              <input
                ref="fileInput"
                type="file"
                accept=".json"
                @change="handleFileUpload"
                style="padding: 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface-raised); width: 100%;"
              >
            </div>
            <div class="fg">
              <label>或粘贴 JSON 内容</label>
              <textarea
                v-model="jsonInput"
                rows="12"
                placeholder='{"categories": [{"categoryName": "分类名", "sites": [...]}]}'
                style="font-family: monospace; font-size: 12px;"
              ></textarea>
            </div>
            <div class="format-hint">
              <strong>支持 DH_NavHub 格式：</strong>
              <pre style="margin-top: 8px; padding: 10px; background: var(--surface-sunken); border-radius: 6px; font-size: 11px; overflow-x: auto;">{
  "categories": [
    {
      "categoryName": "分类名",
      "categoryId": "category-id",
      "sites": [
        {
          "title": "网站标题",
          "url": "https://...",
          "icon": "https://.../favicon.ico",
          "desc": "描述"
        }
      ]
    }
  ]
}</pre>
            </div>
            <div class="form-btns">
              <button class="btn btn-ghost" @click="emit('close')">取消</button>
              <button class="btn btn-primary" @click="parseJSON" :disabled="!jsonInput && !uploadedFile">
                下一步
              </button>
            </div>
          </div>

          <!-- 步骤 2: 预览 -->
          <div v-if="step === 2" class="import-step-content">
            <div v-if="parseError" class="error-msg">
              <i class="ri-error-warning-line"></i>
              {{ parseError }}
            </div>
            <div v-else class="preview-summary">
              <div class="summary-item">
                <i class="ri-folder-line"></i>
                <span>分类数量: <strong>{{ parsedData.categories.length }}</strong></span>
              </div>
              <div class="summary-item">
                <i class="ri-bookmark-line"></i>
                <span>书签总数: <strong>{{ parsedData.totalBookmarks }}</strong></span>
              </div>
            </div>
            <div v-if="!parseError" class="preview-list">
              <div v-for="cat in parsedData.categories" :key="cat.categoryId" class="preview-category">
                <h4 class="preview-cat-title">
                  <i class="ri-folder-2-line"></i>
                  {{ cat.categoryName }}
                  <span class="preview-count">({{ cat.sites.length }})</span>
                </h4>
                <div class="preview-sites">
                  <div v-for="(site, idx) in cat.sites.slice(0, 5)" :key="idx" class="preview-site">
                    <i class="ri-links-line"></i>
                    <span class="site-title">{{ site.title }}</span>
                    <span class="site-url">{{ site.url }}</span>
                  </div>
                  <div v-if="cat.sites.length > 5" class="preview-more">
                    ... 还有 {{ cat.sites.length - 5 }} 个书签
                  </div>
                </div>
              </div>
            </div>
            <div class="form-btns">
              <button class="btn btn-ghost" @click="step = 1">上一步</button>
              <button class="btn btn-primary" @click="step = 3" :disabled="!!parseError">
                下一步
              </button>
            </div>
          </div>

          <!-- 步骤 3: 确认导入 -->
          <div v-if="step === 3" class="import-step-content">
            <div class="fg">
              <label>导入模式</label>
              <div class="import-mode-options">
                <label class="mode-option" :class="{ active: importMode === 'merge' }">
                  <input type="radio" v-model="importMode" value="merge">
                  <div class="mode-content">
                    <div class="mode-title">
                      <i class="ri-merge-cells-horizontal"></i>
                      合并模式
                    </div>
                    <div class="mode-desc">保留现有书签，新增不重复的书签</div>
                  </div>
                </label>
                <label class="mode-option" :class="{ active: importMode === 'replace' }">
                  <input type="radio" v-model="importMode" value="replace">
                  <div class="mode-content">
                    <div class="mode-title">
                      <i class="ri-refresh-line"></i>
                      替换模式
                    </div>
                    <div class="mode-desc">清空现有书签，导入全新书签</div>
                  </div>
                </label>
              </div>
            </div>
            <div v-if="importMode === 'replace'" class="warning-msg">
              <i class="ri-alert-line"></i>
              替换模式将删除该精选集的所有现有书签和分类，此操作不可恢复！
            </div>
            <div class="import-summary">
              <p><strong>即将导入：</strong></p>
              <ul>
                <li>{{ parsedData.categories.length }} 个分类</li>
                <li>{{ parsedData.totalBookmarks }} 个书签</li>
                <li>模式: {{ importMode === 'merge' ? '合并' : '替换' }}</li>
              </ul>
            </div>
            <div v-if="importing" class="import-progress">
              <div class="progress-bar">
                <div class="progress-fill" :style="{ width: progress + '%' }"></div>
              </div>
              <p class="progress-text">{{ progressText }}</p>
            </div>
            <div v-if="importResult" class="success-msg">
              <i class="ri-checkbox-circle-line"></i>
              导入成功！共导入 {{ importResult.bookmark_count }} 个书签，{{ importResult.category_count }} 个分类
            </div>
            <div class="form-btns">
              <button class="btn btn-ghost" @click="step = 2" :disabled="importing">上一步</button>
              <button
                v-if="!importResult"
                class="btn btn-primary"
                @click="doImport"
                :disabled="importing"
              >
                <i class="ri-upload-2-line"></i>
                {{ importing ? '导入中...' : '确认导入' }}
              </button>
              <button v-else class="btn btn-primary" @click="emit('imported'); emit('close')">
                完成
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
const props = defineProps<{
  visible: boolean
  collection: any
}>()

const emit = defineEmits<{
  close: []
  imported: []
}>()

const authStore = useAuthStore()

function getAuthHeaders(): Record<string, string> {
  return authStore.token && authStore.token !== 'cookie_auth' ? { Authorization: `Bearer ${authStore.token}` } : {}
}

const step = ref(1)
const jsonInput = ref('')
const uploadedFile = ref<File | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const parseError = ref('')
const parsedData = ref<any>({ categories: [], totalBookmarks: 0 })
const importMode = ref<'merge' | 'replace'>('merge')
const importing = ref(false)
const progress = ref(0)
const progressText = ref('')
const importResult = ref<any>(null)

// 重置状态
watch(() => props.visible, (val) => {
  if (val) {
    step.value = 1
    jsonInput.value = ''
    uploadedFile.value = null
    parseError.value = ''
    parsedData.value = { categories: [], totalBookmarks: 0 }
    importMode.value = 'merge'
    importing.value = false
    progress.value = 0
    progressText.value = ''
    importResult.value = null
  }
})

// 处理文件上传
async function handleFileUpload(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return

  uploadedFile.value = file
  const reader = new FileReader()
  reader.onload = (ev) => {
    jsonInput.value = ev.target?.result as string
  }
  reader.readAsText(file)
}

// 解析 JSON
function parseJSON() {
  if (!jsonInput.value.trim()) {
    parseError.value = '请先上传文件或粘贴 JSON 内容'
    return
  }

  try {
    const data = JSON.parse(jsonInput.value)

    // 验证格式
    if (!data.categories || !Array.isArray(data.categories)) {
      parseError.value = '格式错误：缺少 categories 数组'
      return
    }

    // 统计书签数
    let totalBookmarks = 0
    for (const cat of data.categories) {
      if (cat.sites && Array.isArray(cat.sites)) {
        totalBookmarks += cat.sites.length
      }
    }

    parsedData.value = {
      categories: data.categories,
      totalBookmarks
    }
    parseError.value = ''
    step.value = 2
  } catch (err: any) {
    parseError.value = '解析失败：' + err.message
  }
}

// 执行导入
async function doImport() {
  if (!props.collection?.id) return

  importing.value = true
  progress.value = 0
  progressText.value = '准备导入...'

  try {
    progress.value = 20
    progressText.value = '处理分类和书签...'

    const response = await $fetch(`/api/admin/collections/${props.collection.id}/batch-import`, {
      method: 'POST',
      headers: getAuthHeaders(),
      credentials: 'include',
      body: {
        data: parsedData.value,
        mode: importMode.value
      }
    })

    progress.value = 100
    progressText.value = '导入完成'

    importResult.value = response
  } catch (err: any) {
    parseError.value = '导入失败：' + (err?.data?.error || err?.message || '未知错误')
    importing.value = false
  } finally {
    importing.value = false
  }
}
</script>

<style scoped>
.import-steps {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 24px;
  padding: 16px;
  background: var(--surface-sunken);
  border-radius: 8px;
}

.step {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  opacity: 0.4;
  transition: opacity 0.2s;
}

.step.active {
  opacity: 1;
}

.step.done {
  opacity: 0.7;
}

.step-num {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--border);
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 14px;
  transition: all 0.2s;
}

.step.active .step-num {
  background: var(--primary);
  color: var(--text-inverse);
}

.step.done .step-num {
  background: var(--primary);
  color: var(--text-inverse);
}

.step-label {
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: 500;
}

.step-divider {
  width: 60px;
  height: 2px;
  background: var(--border);
  margin: 0 12px;
}

.import-step-content {
  max-height: 60vh;
  overflow-y: auto;
}

.format-hint {
  padding: 12px;
  background: var(--surface-sunken);
  border-radius: 6px;
  font-size: 13px;
  color: var(--text-secondary);
}

.error-msg {
  padding: 12px 16px;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 6px;
  color: var(--accent-red);
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
}

.warning-msg {
  padding: 12px 16px;
  background: rgba(251, 191, 36, 0.1);
  border: 1px solid rgba(251, 191, 36, 0.3);
  border-radius: 6px;
  color: var(--accent-yellow);
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
}

.success-msg {
  padding: 12px 16px;
  background: rgba(34, 197, 94, 0.1);
  border: 1px solid rgba(34, 197, 94, 0.3);
  border-radius: 6px;
  color: var(--primary);
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
}

.preview-summary {
  display: flex;
  gap: 24px;
  padding: 16px;
  background: var(--surface-sunken);
  border-radius: 8px;
  margin-bottom: 16px;
}

.summary-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: var(--text-secondary);
}

.summary-item i {
  font-size: 18px;
  color: var(--primary);
}

.preview-list {
  max-height: 400px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 12px;
}

.preview-category {
  margin-bottom: 20px;
}

.preview-category:last-child {
  margin-bottom: 0;
}

.preview-cat-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.preview-count {
  font-size: 12px;
  font-weight: normal;
  color: var(--text-tertiary);
}

.preview-sites {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-left: 20px;
}

.preview-site {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  background: var(--surface-sunken);
  border-radius: 4px;
  font-size: 12px;
}

.preview-site i {
  color: var(--text-tertiary);
  font-size: 14px;
}

.site-title {
  font-weight: 500;
  color: var(--text-primary);
  min-width: 120px;
}

.site-url {
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-more {
  padding: 6px 8px;
  font-size: 12px;
  color: var(--text-tertiary);
  font-style: italic;
}

.import-mode-options {
  display: flex;
  gap: 12px;
}

.mode-option {
  flex: 1;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 14px;
  border: 2px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.mode-option:hover {
  border-color: var(--primary);
}

.mode-option.active {
  border-color: var(--primary);
  background: rgba(var(--primary-rgb), 0.05);
}

.mode-option input[type="radio"] {
  margin-top: 2px;
}

.mode-content {
  flex: 1;
}

.mode-title {
  font-weight: 600;
  font-size: 14px;
  color: var(--text-primary);
  margin-bottom: 4px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.mode-desc {
  font-size: 12px;
  color: var(--text-secondary);
}

.import-summary {
  padding: 12px;
  background: var(--surface-sunken);
  border-radius: 6px;
  margin-top: 16px;
}

.import-summary p {
  margin-bottom: 8px;
  font-weight: 500;
}

.import-summary ul {
  list-style: none;
  padding: 0;
  margin: 0;
}

.import-summary li {
  padding: 4px 0;
  font-size: 13px;
  color: var(--text-secondary);
}

.import-progress {
  margin-top: 16px;
}

.progress-bar {
  width: 100%;
  height: 8px;
  background: var(--surface-sunken);
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 8px;
}

.progress-fill {
  height: 100%;
  background: var(--primary);
  transition: width 0.3s ease;
}

.progress-text {
  text-align: center;
  font-size: 13px;
  color: var(--text-secondary);
}

.form-btns {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}
</style>
