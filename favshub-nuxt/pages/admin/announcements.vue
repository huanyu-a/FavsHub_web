<template>
  <div class="admin-page">
    <header class="page-header">
      <h1>公告管理</h1>
      <p>发布与管理全站前端悬浮公告，支持 HTML 与 Markdown 富文本及图片富媒体展示</p>
    </header>

    <div class="card">
      <div class="card-header">
        <div class="header-left">
          <h3>公告列表 ({{ filteredAnnouncements.length }})</h3>
        </div>
        <div class="header-actions">
          <input
            v-model="searchQuery"
            type="text"
            class="search-input"
            placeholder="搜索公告标题或内容..."
          />
          <button class="btn btn-primary btn-sm" @click="openCreate">
            <i class="ri-add-line"></i> 发布公告
          </button>
          <button class="btn btn-ghost btn-sm" @click="fetchAnnouncements">
            <i class="ri-refresh-line"></i> 刷新
          </button>
        </div>
      </div>

      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th style="width: 60px;">ID</th>
              <th style="width: 80px;">置顶</th>
              <th>公告标题</th>
              <th style="width: 100px;">格式</th>
              <th style="width: 100px;">状态</th>
              <th style="width: 150px;">发布时间</th>
              <th style="width: 150px; text-align: right;">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td colspan="7" class="empty-state">加载中...</td>
            </tr>
            <tr v-else-if="filteredAnnouncements.length === 0">
              <td colspan="7" class="empty-state">暂无公告</td>
            </tr>
            <tr v-for="item in filteredAnnouncements" :key="item.id">
              <td>{{ item.id }}</td>
              <td>
                <span v-if="item.pinned" class="badge badge-pinned" title="置顶公告">
                  <i class="ri-pushpin-2-fill"></i> 置顶
                </span>
                <span v-else style="color: var(--text-tertiary); font-size: 12px;">普通</span>
              </td>
              <td class="name-cell">
                <strong>{{ item.title }}</strong>
              </td>
              <td>
                <span class="badge badge-type">{{ item.content_type?.toUpperCase() || 'MARKDOWN' }}</span>
              </td>
              <td>
                <span
                  class="badge"
                  :class="item.status === 'published' ? 'badge-public' : (item.status === 'draft' ? 'badge-pending' : 'badge-private')"
                >
                  {{ item.status === 'published' ? '已发布' : (item.status === 'draft' ? '草稿' : '已下线') }}
                </span>
              </td>
              <td class="time-cell">{{ formatDate(item.created_at) }}</td>
              <td class="actions" style="text-align: right;">
                <button class="btn btn-ghost btn-sm" @click="openEdit(item)">编辑</button>
                <button class="btn btn-danger btn-sm" @click="confirmDelete(item)">删除</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 添加 / 编辑弹窗 -->
    <div v-if="modalVisible" :class="['modal-overlay', { active: modalVisible }]" @click.self="modalVisible = false">
      <div class="modal modal-large">
        <div class="modal-header">
          <h3>{{ isNew ? '新建公告' : '编辑公告' }}</h3>
          <button class="modal-close" @click="modalVisible = false">&times;</button>
        </div>
        <div class="modal-body">
          <div class="fg">
            <label>公告标题 <span class="required">*</span></label>
            <input v-model="form.title" type="text" placeholder="例如：FavsHub 系统更新公告" />
          </div>

          <div class="form-row">
            <div class="fg" style="flex: 1;">
              <label>发布状态</label>
              <select v-model="form.status">
                <option value="published">正式发布（前端立即展示）</option>
                <option value="draft">存为草稿（仅后台可见）</option>
                <option value="offline">下线停用</option>
              </select>
            </div>

            <div class="fg" style="flex: 1;">
              <label>内容格式</label>
              <select v-model="form.content_type">
                <option value="markdown">Markdown 模式（支持混编 HTML 与图片）</option>
                <option value="html">纯 HTML 模式</option>
              </select>
            </div>

            <div class="fg" style="width: 120px; display: flex; flex-direction: column; justify-content: center;">
              <label>置顶显示</label>
              <label class="checkbox-label">
                <input v-model="form.pinned" type="checkbox" />
                <span>置顶显示</span>
              </label>
            </div>
          </div>

          <div class="fg">
            <div class="editor-header">
              <label>公告正文 <span class="required">*</span></label>
              <div class="editor-tabs">
                <button
                  type="button"
                  class="tab-btn"
                  :class="{ active: editorTab === 'edit' }"
                  @click="editorTab = 'edit'"
                >
                  <i class="ri-edit-line"></i> 编辑正文
                </button>
                <button
                  type="button"
                  class="tab-btn"
                  :class="{ active: editorTab === 'preview' }"
                  @click="editorTab = 'preview'"
                >
                  <i class="ri-eye-line"></i> 实时预览
                </button>
              </div>
            </div>

            <div v-if="editorTab === 'edit'" class="editor-edit-wrap">
              <textarea
                v-model="form.content"
                rows="12"
                placeholder="支持 Markdown 语法与 HTML 标签，支持插入图片：![图片描述](https://...) 或 <img src='...' />"
              ></textarea>
              <span class="help-text">支持标题(#)、列表(-)、粗体(**)、链接([文本](url))、图片以及表格、代码块等富媒体元素</span>
            </div>

            <div v-else class="editor-preview-wrap">
              <div class="announcement-rendered" v-html="renderedPreview"></div>
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn btn-ghost" @click="modalVisible = false">取消</button>
          <button class="btn btn-primary" :disabled="submitting" @click="saveAnnouncement">
            {{ submitting ? '保存中...' : '保存' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { marked } from 'marked'

definePageMeta({
  layout: 'admin',
  middleware: ['admin'],
})

useHead({
  title: '公告管理',
})

interface AnnouncementItem {
  id: number
  title: string
  content: string
  content_type: 'markdown' | 'html'
  status: 'published' | 'draft' | 'offline'
  pinned: number | boolean
  created_at: number
  updated_at: number
}

const loading = ref(false)
const submitting = ref(false)
const announcements = ref<AnnouncementItem[]>([])
const searchQuery = ref('')
const modalVisible = ref(false)
const isNew = ref(true)
const currentId = ref<number | null>(null)
const editorTab = ref<'edit' | 'preview'>('edit')

const form = ref({
  title: '',
  content: '',
  content_type: 'markdown' as 'markdown' | 'html',
  status: 'published' as 'published' | 'draft' | 'offline',
  pinned: false,
})

const filteredAnnouncements = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return announcements.value
  return announcements.value.filter(item =>
    item.title.toLowerCase().includes(q) ||
    item.content.toLowerCase().includes(q)
  )
})

const renderedPreview = computed(() => {
  const raw = form.value.content || ''
  if (!raw.trim()) return '<p style="color:var(--text-tertiary);">暂无内容，请在左侧编辑</p>'
  try {
    return marked.parse(raw, { async: false }) as string
  } catch (err: any) {
    return `<div style="color:red;">Markdown 解析错误: ${err?.message || ''}</div>`
  }
})

async function fetchAnnouncements() {
  loading.value = true
  try {
    const res = await $fetch<{ code: number; data: AnnouncementItem[] }>('/api/admin/announcements')
    if (res.code === 200) {
      announcements.value = res.data || []
    }
  } catch (err: any) {
    alert(err?.data?.message || err?.message || '获取公告列表失败')
  } finally {
    loading.value = false
  }
}

function openCreate() {
  isNew.value = true
  currentId.value = null
  editorTab.value = 'edit'
  form.value = {
    title: '',
    content: '### 公告标题\n\n欢迎使用 FavsHub！这里是公告内容，支持 **Markdown** 与 HTML，可插入图片：\n\n![示例图片](/images/og-cover.png)',
    content_type: 'markdown',
    status: 'published',
    pinned: false,
  }
  modalVisible.value = true
}

function openEdit(item: AnnouncementItem) {
  isNew.value = false
  currentId.value = item.id
  editorTab.value = 'edit'
  form.value = {
    title: item.title,
    content: item.content,
    content_type: item.content_type || 'markdown',
    status: item.status || 'published',
    pinned: !!item.pinned,
  }
  modalVisible.value = true
}

async function saveAnnouncement() {
  if (!form.value.title.trim()) {
    alert('请填写公告标题')
    return
  }
  if (!form.value.content.trim()) {
    alert('请填写公告内容')
    return
  }

  submitting.value = true
  try {
    if (isNew.value) {
      await $fetch('/api/admin/announcements', {
        method: 'POST',
        body: form.value,
      })
    } else {
      await $fetch(`/api/admin/announcements/${currentId.value}`, {
        method: 'PUT',
        body: form.value,
      })
    }
    modalVisible.value = false
    await fetchAnnouncements()
  } catch (err: any) {
    alert(err?.data?.message || err?.message || '保存失败')
  } finally {
    submitting.value = false
  }
}

async function confirmDelete(item: AnnouncementItem) {
  if (!confirm(`确定要删除公告「${item.title}」吗？`)) return
  try {
    await $fetch(`/api/admin/announcements/${item.id}`, { method: 'DELETE' })
    await fetchAnnouncements()
  } catch (err: any) {
    alert(err?.data?.message || err?.message || '删除失败')
  }
}

function formatDate(ts?: number) {
  if (!ts) return '-'
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

onMounted(() => {
  fetchAnnouncements()
})
</script>

<style scoped>
.header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.search-input {
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text-primary);
  font-size: 13px;
  width: 200px;
}
.modal-large {
  max-width: 760px;
  width: 90%;
}
.badge-pinned {
  background: color-mix(in srgb, var(--primary) 15%, transparent);
  color: var(--primary);
  font-weight: 600;
}
.badge-type {
  background: var(--surface-sunken);
  color: var(--text-secondary);
  font-size: 11px;
}
.checkbox-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--text-primary);
  cursor: pointer;
  margin-top: 6px;
}
.editor-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}
.editor-tabs {
  display: flex;
  gap: 6px;
}
.tab-btn {
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text-secondary);
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.tab-btn.active {
  background: var(--primary);
  color: var(--text-inverse, #fff);
  border-color: var(--primary);
}
.editor-edit-wrap textarea {
  width: 100%;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text-primary);
  font-family: inherit;
  font-size: 13px;
  line-height: 1.6;
  resize: vertical;
}
.editor-preview-wrap {
  min-height: 260px;
  max-height: 400px;
  overflow-y: auto;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-sunken);
}
.announcement-rendered :deep(h1),
.announcement-rendered :deep(h2),
.announcement-rendered :deep(h3),
.announcement-rendered :deep(h4) {
  margin-top: 12px;
  margin-bottom: 8px;
  color: var(--text-primary);
}
.announcement-rendered :deep(p) {
  margin-bottom: 8px;
  line-height: 1.6;
  color: var(--text-primary);
}
.announcement-rendered :deep(img) {
  max-width: 100%;
  border-radius: 6px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
  margin: 8px 0;
}
.announcement-rendered :deep(blockquote) {
  border-left: 3px solid var(--primary);
  margin: 10px 0;
  padding: 6px 12px;
  background: color-mix(in srgb, var(--primary) 8%, transparent);
  border-radius: 0 6px 6px 0;
}
.announcement-rendered :deep(code) {
  background: var(--surface);
  padding: 2px 5px;
  border-radius: 4px;
  font-size: 12px;
}
.announcement-rendered :deep(pre) {
  background: var(--surface);
  padding: 10px;
  border-radius: 6px;
  overflow-x: auto;
}
.announcement-rendered :deep(ul),
.announcement-rendered :deep(ol) {
  padding-left: 20px;
  margin-bottom: 8px;
}
.form-row {
  display: flex;
  gap: 16px;
}
.required {
  color: var(--danger, #ef4444);
}
.help-text {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-top: 4px;
  display: block;
}
</style>
