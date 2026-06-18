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
              <button v-if="e._canEdit" class="btn btn-ghost btn-sm" @click="openEdit(e)">编辑</button>
              <button v-if="e._canDelete" class="btn btn-danger btn-sm" @click="del(e)">删除</button>
              <span v-if="!e._canEdit && !e._canDelete" style="color:var(--text-tertiary);font-size:12px;">🔒 只读</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <!-- 添加/编辑弹窗 -->
    <div v-show="modalVisible" :class="['modal-overlay', { active: modalVisible }]" @click.self="modalVisible = false">
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
          <div class="fg toggle-row"><label>设为默认搜索引擎</label><label class="switch"><input type="checkbox" v-model="form.is_default" :true-value="1" :false-value="0"><span class="slider round"></span></label></div>
          <div class="form-btns"><button class="btn btn-ghost" @click="modalVisible = false">取消</button><button class="btn btn-primary" @click="save">保存</button></div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'admin', layout: 'admin' })
useHead({ title: '搜索引擎' })
const authStore = useAuthStore()
const isAdmin = computed(() => authStore.isAdmin)
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
