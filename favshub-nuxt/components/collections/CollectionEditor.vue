<template>
  <Teleport to="body">
    <div v-if="visible" :class="['modal-overlay', { active: visible }]" @click.self="emit('close')">
      <div class="modal collection-editor-modal">
        <div class="modal-header">
          <h3>{{ isEdit ? '编辑精选集' : '新建精选集' }}</h3>
          <button class="modal-close" @click="emit('close')">&times;</button>
        </div>
        <div class="modal-body">
          <div class="editor-layout">
            <!-- 左侧：基本信息 -->
            <div class="editor-main">
              <div class="fg">
                <label>名称 *</label>
                <input v-model="form.name" type="text" placeholder="精选集名称" class="form-input">
              </div>

              <div class="fg">
                <label>描述</label>
                <textarea v-model="form.description" rows="3" placeholder="简短介绍这个精选集" class="form-textarea"></textarea>
              </div>

              <div class="fg">
                <label>图标</label>
                <IconPicker v-model="form.icon" />
              </div>

              <!-- TDK 配置（可折叠） -->
              <div class="fg tdk-section">
                <div class="tdk-header" @click="tdkExpanded = !tdkExpanded">
                  <label>SEO 配置（可选）</label>
                  <i :class="tdkExpanded ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'"></i>
                </div>
                <div v-if="tdkExpanded" class="tdk-fields">
                  <div class="fg">
                    <label>页面标题</label>
                    <input v-model="form.meta_title" type="text" placeholder="留空则使用精选集名称" class="form-input">
                  </div>
                  <div class="fg">
                    <label>页面描述</label>
                    <input v-model="form.meta_description" type="text" placeholder="留空则使用精选集描述" class="form-input">
                  </div>
                  <div class="fg">
                    <label>关键词</label>
                    <input v-model="form.meta_keywords" type="text" placeholder="逗号分隔，如：工具,设计,开发" class="form-input">
                  </div>
                </div>
              </div>

              <div class="fg-row">
                <div class="fg toggle-row">
                  <label>公开状态</label>
                  <label class="switch">
                    <input type="checkbox" v-model="form.is_public" :true-value="1" :false-value="0">
                    <span class="slider round"></span>
                  </label>
                </div>
                <div v-if="authStore.isAdmin" class="fg toggle-row">
                  <label>官方推荐</label>
                  <label class="switch">
                    <input type="checkbox" v-model="form.is_official" :true-value="1" :false-value="0">
                    <span class="slider round"></span>
                  </label>
                </div>
              </div>

            </div>
          </div>

          <div v-if="errorMsg" class="error-msg">
            <i class="ri-error-warning-line"></i>
            {{ errorMsg }}
          </div>

          <div v-if="saving" class="saving-msg">
            <i class="ri-loader-4-line spin"></i>
            保存中...
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn btn-ghost" @click="emit('close')" :disabled="saving">取消</button>
          <button class="btn btn-primary" @click="save" :disabled="saving">
            <i class="ri-save-line"></i>
            {{ saving ? '保存中...' : '保存' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import IconPicker from '~/components/common/IconPicker.vue'

const props = defineProps<{
  visible: boolean
  collection: any | null
}>()

const emit = defineEmits<{
  close: []
  saved: []
}>()

const authStore = useAuthStore()

function getAuthHeaders(): Record<string, string> {
  return authStore.token && authStore.token !== 'cookie_auth' ? { Authorization: `Bearer ${authStore.token}` } : {}
}

const isEdit = computed(() => !!props.collection?.id)

// 表单数据
const form = reactive({
  name: '',
  description: '',
  icon: '',
  meta_title: '',
  meta_description: '',
  meta_keywords: '',
  is_public: 1,
  is_official: 0
})

const tdkExpanded = ref(false)
const saving = ref(false)
const errorMsg = ref('')

// 监听 visible 变化，加载数据（immediate: true 确保以 visible=true 挂载时也触发）
watch(() => props.visible, async (val) => {
  if (val) {
    await loadData()
  } else {
    resetForm()
  }
}, { immediate: true })

// 加载数据
async function loadData() {
  if (props.collection?.id) {
    // 编辑模式：先用已有填充基础字段，再拉完整数据
    const pc = props.collection as any
    Object.assign(form, {
      name: pc.name || '', description: pc.description || '', icon: pc.icon || '',
      meta_title: pc.meta_title || '', meta_description: pc.meta_description || '', meta_keywords: pc.meta_keywords || '',
      is_public: pc.is_public ?? 1, is_official: pc.is_official ?? 0
    })
    try {
      const res = await $fetch<any>(`/api/admin/collections/${props.collection.id}/bookmarks`, {
        headers: getAuthHeaders(),
        credentials: 'include'
      })

      const col = res.collection
      Object.assign(form, {
        name: col.name || '',
        description: col.description || '',
        icon: col.icon || '',
        meta_title: col.meta_title || '',
        meta_description: col.meta_description || '',
        meta_keywords: col.meta_keywords || '',
        is_public: col.is_public ?? 1,
        is_official: col.is_official ?? 0
      })
    } catch (e) {
      console.error('加载精选集失败', e)
      errorMsg.value = '加载数据失败'
    }
  } else {
    // 新建模式：重置表单
    resetForm()
  }
}

// 重置表单
function resetForm() {
  Object.assign(form, {
    name: '',
    description: '',
    icon: '',
    meta_title: '',
    meta_description: '',
    meta_keywords: '',
    is_public: 1,
    is_official: 0
  })
  errorMsg.value = ''
  tdkExpanded.value = false
}

// 保存（仅元数据，分类和书签在 Tab 2 管理）
async function save() {
  errorMsg.value = ''

  if (!form.name.trim()) {
    errorMsg.value = '请输入精选集名称'
    return
  }

  saving.value = true

  try {
    const body = {
      name: form.name.trim(),
      description: form.description || '',
      icon: form.icon || '',
      meta_title: form.meta_title || null,
      meta_description: form.meta_description || null,
      meta_keywords: form.meta_keywords || null,
      is_public: form.is_public ? 1 : 0,
      is_official: form.is_official ? 1 : 0,
    }

    if (isEdit.value) {
      await $fetch(`/api/admin/collections/${props.collection.id}`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        credentials: 'include',
        body
      })
    } else {
      await $fetch('/api/admin/collections', {
        method: 'POST',
        headers: getAuthHeaders(),
        credentials: 'include',
        body
      })
    }

    emit('saved')
    emit('close')
  } catch (e: any) {
    errorMsg.value = '保存失败：' + (e?.data?.error || e?.message || '未知错误')
  } finally {
    saving.value = false
  }
}

// 注：拖拽排序与分类/书签管理已迁移至 AdminCategoryBookmarkManager，此编辑器仅保留元数据表单
</script>

<style scoped>
/* 弹窗入场动效：v-if 挂载时类即就位，全局 transition 不触发，用 animation 补入场（与全局 .modal-overlay 过渡时长/缓动一致） */
.modal-overlay.active {
  animation: ce-fade-in 240ms cubic-bezier(0.22, 1, 0.36, 1);
}
.modal-overlay.active .modal {
  animation: ce-modal-in 240ms cubic-bezier(0.22, 1, 0.36, 1);
}
@keyframes ce-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes ce-modal-in {
  from { opacity: 0; transform: translateY(8px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.collection-editor-modal {
  max-width: 900px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
}

.modal-body {
  overflow-y: auto;
  flex: 1;
}

.editor-layout {
  display: flex;
  flex-direction: column;
}

.editor-main {
  flex: 1;
}

.form-input,
.form-textarea {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 13px;
  background: var(--surface-raised);
  color: var(--text-primary);
  font-family: inherit;
  transition: border-color 120ms cubic-bezier(0.22, 1, 0.36, 1);
}

.form-input:focus-visible,
.form-textarea:focus-visible {
  outline: none;
  border-color: var(--primary);
}

.form-textarea {
  resize: vertical;
}

.tdk-section {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 12px;
  background: var(--surface-sunken);
}

.tdk-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  user-select: none;
}

.tdk-header label {
  cursor: pointer;
  margin: 0;
}

.tdk-header i {
  transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
}

.tdk-fields {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}

.section-divider {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 24px 0 12px;
  padding-bottom: 8px;
  border-bottom: 2px solid var(--border);
  font-weight: 600;
  font-size: 14px;
  color: var(--text-primary);
}

.section-divider i {
  font-size: 18px;
  color: var(--primary);
}

.error-msg {
  padding: 12px 16px;
  background: var(--danger-soft);
  border: 1px solid color-mix(in srgb, var(--danger) 30%, transparent);
  border-radius: 6px;
  color: var(--danger);
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
}

.saving-msg {
  padding: 12px 16px;
  background: var(--primary-light);
  border: 1px solid color-mix(in srgb, var(--primary) 30%, transparent);
  border-radius: 6px;
  color: var(--primary);
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
}

/* 开关行：label 与开关紧凑，两组之间加间隔 */
.fg-row .toggle-row {
  justify-content: flex-start;
  gap: 12px;
}
.fg-row {
  gap: 32px;
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* 开关样式 */
.switch {
  position: relative;
  display: inline-block;
  width: 44px;
  height: 24px;
}

.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.switch input:focus-visible + .slider {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}

.slider {
  position: absolute;
  cursor: pointer;
  inset: 0;
  background-color: var(--border);
  transition: background-color 180ms cubic-bezier(0.22, 1, 0.36, 1);
}

.slider.round {
  border-radius: 999px;
}

.slider:before {
  position: absolute;
  content: "";
  height: 18px;
  width: 18px;
  left: 3px;
  bottom: 3px;
  background-color: var(--surface-raised);
  transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
  border-radius: 50%;
}

.slider:active:before {
  transform: scale(0.92);
}

input:checked + .slider {
  background-color: var(--primary);
}

input:checked + .slider:before {
  transform: translateX(20px);
}

input:checked + .slider:active:before {
  transform: translateX(20px) scale(0.92);
}
</style>
