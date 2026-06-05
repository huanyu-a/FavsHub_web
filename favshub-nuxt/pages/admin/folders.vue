<template>
  <div class="admin-page">
    <header class="page-header">
      <h1 class="page-title">文件夹管理</h1>
      <button class="btn btn-primary" @click="openCreate">新建文件夹</button>
    </header>

    <div v-if="isLoading" class="loading">加载中...</div>
    <div v-else class="card">
      <table class="data-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>名称</th>
            <th>书签数</th>
            <th>所属用户</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="folder in folders" :key="folder.id">
            <td>{{ folder.id }}</td>
            <td>{{ folder.name }}</td>
            <td>{{ folder.bookmark_count ?? '-' }}</td>
            <td>{{ folder.user_id }}</td>
            <td class="actions">
              <button class="btn btn-ghost btn-sm" @click="openEdit(folder)">编辑</button>
              <button class="btn btn-danger btn-sm" @click="deleteFolder(folder)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="folders.length === 0" class="empty-state">暂无文件夹</div>
    </div>

    <!-- 编辑/创建弹窗 -->
    <div v-if="showModal" class="modal-overlay" @click.self="showModal = false">
      <div class="modal">
        <div class="modal-header">
          <h3>{{ isCreating ? '新建文件夹' : '编辑文件夹' }}</h3>
          <button class="modal-close" @click="showModal = false">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>文件夹名称</label>
            <input v-model="form.name" type="text" placeholder="输入文件夹名称">
          </div>
          <div class="form-group">
            <label>所属用户 ID（留空为公共）</label>
            <input v-model="form.user_id" type="number" placeholder="可选">
          </div>
          <div class="form-buttons">
            <button class="btn btn-ghost" @click="showModal = false">取消</button>
            <button class="btn btn-primary" @click="saveFolder">保存</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'admin', layout: 'admin' })

interface Folder {
  id: number
  name: string
  user_id?: number
  bookmark_count?: number
}

const { data, pending: isLoading, refresh } = await useFetch<{ folders: Folder[] }>('/api/admin/folders')
const folders = computed(() => data.value?.folders || [])
const showModal = ref(false)
const isCreating = ref(true)
const editingFolder = ref<Folder | null>(null)
const form = reactive({ name: '', user_id: '' })

function openCreate() {
  isCreating.value = true
  editingFolder.value = null
  form.name = ''
  form.user_id = ''
  showModal.value = true
}

function openEdit(folder: Folder) {
  isCreating.value = false
  editingFolder.value = folder
  form.name = folder.name
  form.user_id = folder.user_id ? String(folder.user_id) : ''
  showModal.value = true
}

async function saveFolder() {
  if (!form.name.trim()) return alert('请输入文件夹名称')
  if (isCreating.value) {
    await $fetch('/api/admin/folders', {
      method: 'POST',
      body: { name: form.name, user_id: form.user_id ? Number(form.user_id) : undefined },
    })
  } else if (editingFolder.value) {
    await $fetch(`/api/admin/folders/${editingFolder.value.id}`, {
      method: 'PUT',
      body: { name: form.name },
    })
  }
  showModal.value = false
  await refresh()
}

async function deleteFolder(folder: Folder) {
  if (!confirm(`确定删除文件夹「${folder.name}」？`)) return
  await $fetch(`/api/admin/folders/${folder.id}`, { method: 'DELETE' })
  await refresh()
}
</script>

<style scoped>
.admin-page { max-width: 1200px; margin: 0 auto; padding: 32px; }
.page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
.page-title { font-size: 22px; font-weight: 600; margin: 0; color: #333; }
.card { background: #fff; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); overflow: hidden; }
.data-table { width: 100%; border-collapse: collapse; }
th { text-align: left; padding: 12px 16px; font-size: 12px; color: #888; font-weight: 600; text-transform: uppercase; border-bottom: 1px solid #f0f0f0; background: #fafafa; }
td { padding: 12px 16px; font-size: 14px; border-bottom: 1px solid #f5f5f5; }
tr:hover { background: #fafafa; }
.actions { display: flex; gap: 6px; }
.btn { padding: 6px 14px; border-radius: 6px; font-size: 13px; cursor: pointer; border: none; transition: all 0.2s; }
.btn-primary { background: #667eea; color: #fff; }
.btn-primary:hover { background: #5a6fd6; }
.btn-danger { background: #e74c3c; color: #fff; }
.btn-danger:hover { background: #c0392b; }
.btn-sm { padding: 4px 10px; font-size: 12px; }
.btn-ghost { background: none; border: 1px solid #ddd; color: #666; }
.btn-ghost:hover { background: #f5f5f5; }
.modal-overlay { display: flex; position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 1000; align-items: center; justify-content: center; }
.modal { background: #fff; border-radius: 12px; width: 90%; max-width: 480px; box-shadow: 0 20px 60px rgba(0,0,0,0.2); }
.modal-header { padding: 16px 20px; border-bottom: 1px solid #f0f0f0; display: flex; justify-content: space-between; align-items: center; }
.modal-header h3 { font-size: 16px; margin: 0; }
.modal-close { background: none; border: none; font-size: 20px; cursor: pointer; color: #888; }
.modal-body { padding: 20px; }
.form-group { margin-bottom: 14px; }
.form-group label { display: block; font-size: 13px; color: #666; margin-bottom: 6px; }
.form-group input { width: 100%; padding: 10px 12px; border: 1.5px solid #e0e0e0; border-radius: 8px; font-size: 14px; outline: none; }
.form-group input:focus { border-color: #667eea; }
.form-buttons { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
.loading { text-align: center; padding: 60px; color: #999; }
.empty-state { text-align: center; padding: 40px; color: #888; }
</style>
