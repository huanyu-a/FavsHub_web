<template>
  <div class="admin-page">
    <header class="page-header">
      <h1>搜索引擎管理</h1>
      <p>管理系统可用的搜索引擎列表</p>
    </header>
    <div class="card">
      <div class="card-header">
        <h3>搜索引擎列表</h3>
        <div>
          <button class="btn btn-primary btn-sm" @click="openCreate">添加引擎</button>
          <button class="btn btn-ghost btn-sm" @click="load">刷新</button>
        </div>
      </div>
      <table>
        <thead><tr><th>ID</th><th>名称</th><th>标签</th><th>URL</th><th>分类</th><th>默认</th><th>排序</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-if="loading"><td colspan="8" class="empty-state">加载中...</td></tr>
          <tr v-else-if="engines.length === 0"><td colspan="8" class="empty-state">暂无数据</td></tr>
          <tr v-for="e in engines" :key="e.id">
            <td>{{ e.id }}</td>
            <td>
              <img v-if="e.icon" :src="e.icon" width="16" height="16" style="vertical-align:middle;margin-right:4px;" @error="(ev) => (ev.target as HTMLElement).style.display='none'">
              {{ e.name }}
            </td>
            <td>{{ e.label || e.name }}</td>
            <td style="max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{{ e.url }}</td>
            <td><span class="badge" :class="'badge-' + (e.category || 'SEARCH').toLowerCase()">{{ e.category || 'SEARCH' }}</span></td>
            <td>{{ e.is_default ? '是' : '-' }}</td>
            <td>{{ e.sort_order || 0 }}</td>
            <td class="actions">
              <button class="btn btn-ghost btn-sm" @click="openEdit(e)">编辑</button>
              <button class="btn btn-danger btn-sm" @click="del(e)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 添加/编辑弹窗 -->
    <div v-if="modalVisible" class="modal-overlay" @click.self="modalVisible = false">
      <div class="modal">
        <div class="modal-header"><h3>{{ isNew ? '添加搜索引擎' : '编辑搜索引擎' }}</h3><button class="modal-close" @click="modalVisible = false">&times;</button></div>
        <div class="modal-body">
          <div class="fg"><label>名称 (英文标识)</label><input v-model="form.name" placeholder="google"></div>
          <div class="fg"><label>显示标签</label><input v-model="form.label" placeholder="谷歌"></div>
          <div class="fg"><label>搜索 URL (用 %s 代替搜索词)</label><input v-model="form.url" placeholder="https://www.google.com/search?q=%s"></div>
          <div class="fg"><label>图标 URL</label><input v-model="form.icon"></div>
          <div class="fg"><label>分类</label>
            <select v-model="form.category">
              <option value="SEARCH">通用搜索</option>
              <option value="AI">AI 搜索</option>
              <option value="SOCIAL">社交媒体</option>
            </select>
          </div>
          <div class="fg"><label>排序</label><input v-model.number="form.sort_order" type="number"></div>
          <div class="fg"><label><input type="checkbox" v-model="form.is_default" :true-value="1" :false-value="0"> 设为默认搜索引擎</label></div>
          <div class="form-btns"><button class="btn btn-ghost" @click="modalVisible = false">取消</button><button class="btn btn-primary" @click="save">保存</button></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'admin', layout: 'admin' })

const engines = ref<any[]>([])
const loading = ref(false)
const modalVisible = ref(false)
const isNew = ref(true)
const editingId = ref<number | null>(null)
const form = reactive({ name: '', label: '', url: '', icon: '', category: 'SEARCH', sort_order: 0, is_default: 0 })

async function load() {
  loading.value = true
  const d = await $fetch<{ engines: any[] }>('/api/admin/search-engines')
  engines.value = d.engines || []
  loading.value = false
}

function openCreate() {
  isNew.value = true; editingId.value = null
  Object.assign(form, { name: '', label: '', url: '', icon: '', category: 'SEARCH', sort_order: 0, is_default: 0 })
  modalVisible.value = true
}

function openEdit(e: any) {
  isNew.value = false; editingId.value = e.id
  Object.assign(form, { name: e.name, label: e.label || e.name, url: e.url, icon: e.icon || '', category: e.category || 'SEARCH', sort_order: e.sort_order || 0, is_default: e.is_default || 0 })
  modalVisible.value = true
}

async function save() {
  if (isNew.value) { await $fetch('/api/admin/search-engines', { method: 'POST', body: { ...form } }) }
  else { await $fetch(`/api/admin/search-engines/${editingId.value}`, { method: 'PUT', body: { ...form } }) }
  modalVisible.value = false; load()
}

async function del(e: any) { if (!confirm(`删除「${e.name}」？`)) return; await $fetch(`/api/admin/search-engines/${e.id}`, { method: 'DELETE' }); load() }

onMounted(load)
</script>

<style scoped>
.admin-page { max-width: 1200px; margin: 0 auto; padding: 32px; }
.page-header { margin-bottom: 24px; }
.page-header h1 { font-size: 22px; font-weight: 600; }
.page-header p { color: #888; font-size: 14px; margin-top: 4px; }
.card { background: #fff; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,.08); overflow: hidden; }
.card-header { padding: 16px 20px; border-bottom: 1px solid #f0f0f0; display: flex; justify-content: space-between; align-items: center; }
.card-header h3 { font-size: 16px; margin: 0; }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; padding: 12px 16px; font-size: 12px; color: #888; font-weight: 600; text-transform: uppercase; border-bottom: 1px solid #f0f0f0; background: #fafafa; }
td { padding: 12px 16px; font-size: 14px; border-bottom: 1px solid #f5f5f5; }
tr:hover { background: #fafafa; }
.actions { display: flex; gap: 4px; }
.btn { padding: 6px 14px; border-radius: 6px; font-size: 13px; cursor: pointer; border: none; transition: all 0.2s; }
.btn-primary { background: #667eea; color: #fff; }
.btn-primary:hover { background: #5a6fd6; }
.btn-danger { background: #e74c3c; color: #fff; }
.btn-danger:hover { background: #c0392b; }
.btn-sm { padding: 4px 10px; font-size: 12px; }
.btn-ghost { background: none; border: 1px solid #ddd; color: #666; }
.btn-ghost:hover { background: #f5f5f5; }
.badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; }
.badge-search { background: #e0e7ff; color: #3730a3; }
.badge-ai { background: #fef3c7; color: #92400e; }
.badge-social { background: #d1fae5; color: #065f46; }
.empty-state { text-align: center; padding: 40px; color: #888; }
.modal-overlay { display: flex; position: fixed; inset: 0; background: rgba(0,0,0,.4); z-index: 1000; align-items: center; justify-content: center; }
.modal { background: #fff; border-radius: 12px; width: 90%; max-width: 700px; max-height: 80vh; overflow-y: auto; box-shadow: 0 20px 60px rgba(0,0,0,.2); }
.modal-header { padding: 20px 24px; border-bottom: 1px solid #f0f0f0; display: flex; justify-content: space-between; align-items: center; }
.modal-header h3 { margin: 0; font-size: 16px; }
.modal-close { background: none; border: none; font-size: 20px; cursor: pointer; color: #888; }
.modal-body { padding: 20px 24px; }
.fg { margin-bottom: 12px; }
.fg label { display: block; font-size: 13px; color: #666; margin-bottom: 4px; }
.fg input, .fg select { width: 100%; padding: 8px 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; box-sizing: border-box; }
.form-btns { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
/* ── Mobile responsive ── */
@media (max-width: 768px) {
  .admin-page { padding: 16px; }
  .page-header h1 { font-size: 18px; }
  table { display: block; overflow-x: auto; -webkit-overflow-scrolling: touch; }
  th, td { padding: 8px 12px; font-size: 13px; white-space: nowrap; }
  .btn { padding: 8px 16px; font-size: 14px; }
  .btn-sm { padding: 6px 12px; font-size: 13px; }
  .modal { width: 95%; max-height: 90vh; }
  .modal-header { padding: 14px 16px; }
  .modal-body { padding: 14px 16px; }
  .card-header { padding: 12px 16px; }
  .card-header h3 { font-size: 14px; }
}
@media (max-width: 480px) {
  .admin-page { padding: 12px; }
  .page-header h1 { font-size: 16px; }
}
</style>
