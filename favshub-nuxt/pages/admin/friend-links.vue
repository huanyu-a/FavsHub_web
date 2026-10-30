<template>
  <div class="admin-page">
    <header class="page-header">
      <h1>友情链接管理</h1>
      <p>管理站点的友情链接列表，前台页脚将自动展示状态为启用的友链</p>
    </header>

    <div class="card">
      <div class="card-header">
        <div class="header-left">
          <h3>友情链接列表 ({{ filteredLinks.length }})</h3>
        </div>
        <div class="header-actions">
          <input
            v-model="searchQuery"
            type="text"
            class="search-input"
            placeholder="搜索友链名称或网址..."
          />
          <button class="btn btn-primary btn-sm" @click="openCreate">
            <i class="ri-add-line"></i> 添加友链
          </button>
          <button class="btn btn-ghost btn-sm" @click="fetchLinks">
            <i class="ri-refresh-line"></i> 刷新
          </button>
        </div>
      </div>

      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th style="width: 60px;">ID</th>
              <th style="width: 60px;">Logo</th>
              <th>网站名称</th>
              <th>链接地址</th>
              <th>网站简介</th>
              <th style="width: 80px;">排序</th>
              <th style="width: 90px;">状态</th>
              <th style="width: 140px;">更新时间</th>
              <th style="width: 140px; text-align: right;">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td colspan="9" class="empty-state">加载中...</td>
            </tr>
            <tr v-else-if="filteredLinks.length === 0">
              <td colspan="9" class="empty-state">暂无友情链接</td>
            </tr>
            <tr v-for="item in filteredLinks" :key="item.id">
              <td>{{ item.id }}</td>
              <td class="icon-cell">
                <img
                  v-if="item.logo"
                  :src="item.logo"
                  class="link-logo"
                  @error="(e) => (e.target as HTMLElement).style.display = 'none'"
                />
                <span v-else class="icon-placeholder"><i class="ri-links-line"></i></span>
              </td>
              <td class="name-cell">
                <strong>{{ item.name }}</strong>
              </td>
              <td class="url-cell">
                <a :href="item.url" target="_blank" rel="noopener noreferrer" class="link-url">
                  {{ item.url }} <i class="ri-external-link-line"></i>
                </a>
              </td>
              <td class="desc-cell" :title="item.description">
                {{ item.description || '-' }}
              </td>
              <td>{{ item.sort_order }}</td>
              <td>
                <span
                  class="badge"
                  :class="item.status === 'active' ? 'badge-public' : 'badge-private'"
                >
                  {{ item.status === 'active' ? '展示中' : '已隐藏' }}
                </span>
              </td>
              <td class="time-cell">{{ formatDate(item.updated_at || item.created_at) }}</td>
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
      <div class="modal">
        <div class="modal-header">
          <h3>{{ isNew ? '添加友情链接' : '编辑友情链接' }}</h3>
          <button class="modal-close" @click="modalVisible = false">&times;</button>
        </div>
        <div class="modal-body">
          <div class="fg">
            <label>网站名称 <span class="required">*</span></label>
            <input v-model="form.name" type="text" placeholder="例如：FavsHub 导航" />
          </div>

          <div class="fg">
            <label>网站链接 (URL) <span class="required">*</span></label>
            <input v-model="form.url" type="text" placeholder="https://example.com" />
          </div>

          <div class="fg">
            <label>Logo / 图标地址</label>
            <div class="logo-input-wrap">
              <input v-model="form.logo" type="text" placeholder="https://example.com/favicon.ico" />
              <div v-if="form.logo" class="logo-preview">
                <img :src="form.logo" alt="预览" @error="(e) => (e.target as HTMLElement).style.display = 'none'" />
              </div>
            </div>
            <span class="help-text">支持 PNG/SVG/ICO 网址，留空将显示默认链接图标</span>
          </div>

          <div class="fg">
            <label>网站简介</label>
            <input v-model="form.description" type="text" placeholder="简短描述该网站特点" />
          </div>

          <div class="form-row">
            <div class="fg" style="flex: 1;">
              <label>排序权重</label>
              <input v-model.number="form.sort_order" type="number" placeholder="0" />
              <span class="help-text">数值越小排越前</span>
            </div>

            <div class="fg" style="flex: 1;">
              <label>展示状态</label>
              <select v-model="form.status">
                <option value="active">展示中</option>
                <option value="hidden">隐藏</option>
              </select>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" @click="modalVisible = false">取消</button>
          <button class="btn btn-primary" :disabled="submitting" @click="saveLink">
            {{ submitting ? '保存中...' : '保存' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'

definePageMeta({
  layout: 'admin',
  middleware: ['admin'],
})

useHead({
  title: '友情链接管理',
})

interface FriendLinkItem {
  id: number
  name: string
  url: string
  logo?: string
  description?: string
  sort_order: number
  status: 'active' | 'hidden'
  created_at: number
  updated_at: number
}

const loading = ref(false)
const submitting = ref(false)
const links = ref<FriendLinkItem[]>([])
const searchQuery = ref('')
const modalVisible = ref(false)
const isNew = ref(true)
const currentId = ref<number | null>(null)

const form = ref({
  name: '',
  url: '',
  logo: '',
  description: '',
  sort_order: 0,
  status: 'active' as 'active' | 'hidden',
})

const filteredLinks = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return links.value
  return links.value.filter(item =>
    item.name.toLowerCase().includes(q) ||
    item.url.toLowerCase().includes(q) ||
    (item.description && item.description.toLowerCase().includes(q))
  )
})

async function fetchLinks() {
  loading.value = true
  try {
    const res = await $fetch<{ code: number; data: FriendLinkItem[] }>('/api/admin/friend-links')
    if (res.code === 200) {
      links.value = res.data || []
    }
  } catch (err: any) {
    alert(err?.data?.message || err?.message || '获取友情链接失败')
  } finally {
    loading.value = false
  }
}

function openCreate() {
  isNew.value = true
  currentId.value = null
  form.value = {
    name: '',
    url: '',
    logo: '',
    description: '',
    sort_order: links.value.length ? Math.max(...links.value.map(l => l.sort_order)) + 1 : 1,
    status: 'active',
  }
  modalVisible.value = true
}

function openEdit(item: FriendLinkItem) {
  isNew.value = false
  currentId.value = item.id
  form.value = {
    name: item.name,
    url: item.url,
    logo: item.logo || '',
    description: item.description || '',
    sort_order: item.sort_order,
    status: item.status,
  }
  modalVisible.value = true
}

async function saveLink() {
  if (!form.value.name.trim()) {
    alert('请填写网站名称')
    return
  }
  if (!form.value.url.trim() || (!form.value.url.startsWith('http://') && !form.value.url.startsWith('https://'))) {
    alert('请填写合法的网址（以 http:// 或 https:// 开头）')
    return
  }

  submitting.value = true
  try {
    if (isNew.value) {
      await $fetch('/api/admin/friend-links', {
        method: 'POST',
        body: form.value,
      })
    } else {
      await $fetch(`/api/admin/friend-links/${currentId.value}`, {
        method: 'PUT',
        body: form.value,
      })
    }
    modalVisible.value = false
    await fetchLinks()
  } catch (err: any) {
    alert(err?.data?.message || err?.message || '保存失败')
  } finally {
    submitting.value = false
  }
}

async function confirmDelete(item: FriendLinkItem) {
  if (!confirm(`确定要删除友情链接「${item.name}」吗？`)) return
  try {
    await $fetch(`/api/admin/friend-links/${item.id}`, { method: 'DELETE' })
    await fetchLinks()
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
  fetchLinks()
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
.table-container {
  overflow-x: auto;
}
.link-logo {
  width: 22px;
  height: 22px;
  border-radius: 4px;
  object-fit: contain;
}
.icon-placeholder {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  background: var(--surface-sunken);
  color: var(--text-tertiary);
  font-size: 14px;
}
.name-cell {
  color: var(--text-primary);
  font-size: 14px;
}
.url-cell {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.link-url {
  color: var(--primary);
  text-decoration: none;
  font-size: 13px;
}
.link-url:hover {
  text-decoration: underline;
}
.desc-cell {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-secondary);
  font-size: 13px;
}
.time-cell {
  color: var(--text-tertiary);
  font-size: 12px;
}
.required {
  color: var(--danger, #ef4444);
}
.logo-input-wrap {
  display: flex;
  gap: 8px;
  align-items: center;
}
.logo-input-wrap input {
  flex: 1;
}
.logo-preview {
  width: 32px;
  height: 32px;
  border: 1px solid var(--border);
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--surface-sunken);
  flex-shrink: 0;
}
.logo-preview img {
  max-width: 24px;
  max-height: 24px;
  object-fit: contain;
}
.help-text {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-top: 4px;
  display: block;
}
.form-row {
  display: flex;
  gap: 16px;
}
</style>
