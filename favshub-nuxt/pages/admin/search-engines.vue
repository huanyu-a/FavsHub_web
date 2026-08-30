<template>
  <div class="admin-page">
    <header class="page-header">
      <h1>搜索引擎管理</h1>
      <p v-if="isAdmin">管理系统可用的搜索引擎列表</p>
      <p v-else>查看和自定义搜索引擎顺序</p>
    </header>
    <div class="card">
      <div class="card-header">
        <h3>搜索引擎列表</h3>
        <div>
          <button v-if="isAdmin" class="btn btn-primary btn-sm" @click="openCreate">添加引擎</button>
          <button v-else class="btn btn-ghost btn-sm" @click="openCreate">提交引擎</button>
          <button class="btn btn-ghost btn-sm" @click="load">刷新</button>
        </div>
      </div>
      <table>
        <thead><tr><th>ID</th><th>图标</th><th>名称</th><th>标签</th><th>URL</th><th>分类</th><th>默认</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>
          <tr v-if="loading"><td colspan="10" class="empty-state">加载中...</td></tr>
          <tr v-else-if="engines.length === 0"><td colspan="10" class="empty-state">暂无数据</td></tr>
          <tr v-for="e in engines" :key="e.id">
            <td>{{ e.id }}</td>
            <td class="icon-cell">
              <img v-if="e.icon" :src="e.icon" width="20" height="20" @error="(ev) => (ev.target as HTMLElement).style.display='none'">
              <span v-else class="icon-placeholder">—</span>
            </td>
            <td>{{ e.name }}</td>
            <td>{{ e.label || e.name }}</td>
            <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{{ e.url }}</td>
            <td><span class="badge" :class="'badge-' + (e.category || 'SEARCH').toLowerCase()">{{ e.category || 'SEARCH' }}</span></td>
            <td>{{ e.is_default ? '是' : '-' }}</td>
            <td>
              <span v-if="e.status === 'approved'" class="badge badge-public">启用</span>
              <span v-else-if="e.status === 'pending'" class="badge badge-pending">审核中</span>
              <span v-else-if="e.status === 'disabled'" class="badge badge-private">下线</span>
              <span v-else class="badge badge-user">{{ e.status || '-' }}</span>
            </td>
            <td class="actions">
              <button v-if="e._canEdit" class="btn btn-ghost btn-sm" @click="openEdit(e)">编辑</button>
              <button v-if="e._canDelete" class="btn btn-danger btn-sm" @click="del(e)">删除</button>
              <button v-if="!isAdmin && e.status === 'approved'" class="btn btn-ghost btn-sm" :class="{ active: myDefault === e.name }" @click="setMyDefault(e)"><i v-if="myDefault === e.name" class="ri-check-line"></i> {{ myDefault === e.name ? '默认' : '设为默认' }}</button>
              <!-- 管理员审核操作 -->
              <template v-if="isAdmin && e.status === 'pending'">
                <button class="btn btn-primary btn-sm" @click="reviewEngine(e, 'approved')">通过</button>
                <button class="btn btn-danger btn-sm" @click="reviewEngine(e, 'disabled')">拒绝</button>
              </template>
              <span v-if="!e._canEdit && !e._canDelete && e.status !== 'pending'" style="color:var(--text-tertiary);font-size:12px;"><i class="ri-lock-line"></i> 只读</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <!-- 添加/编辑弹窗 -->
    <div v-show="modalVisible" :class="['modal-overlay', { active: modalVisible }]" @click.self="modalVisible = false">
      <div class="modal">
        <div class="modal-header"><h3>{{ isNew ? (isAdmin ? '添加搜索引擎' : '提交搜索引擎') : '编辑搜索引擎' }}</h3><button class="modal-close" @click="modalVisible = false">&times;</button></div>
        <div class="modal-body">
          <div class="fg"><label>名称 (英文标识)</label><input v-model="form.name" placeholder="google" :disabled="!isNew && !isAdmin"></div>
          <div class="fg"><label>显示标签</label><input v-model="form.label" :placeholder="form.name"></div>
          <div class="fg"><label>搜索 URL (用 %s 代替搜索词)</label><input v-model="form.url" placeholder="https://www.google.com/search?q=%s"></div>
          <div class="fg"><label>图标 URL</label><input v-model="form.icon"></div>
          <div class="fg"><label>分类</label>
            <select v-model="form.category">
              <option value="SEARCH">通用搜索</option>
              <option value="AI">AI 搜索</option>
              <option value="SOCIAL">社交媒体</option>
            </select>
          </div>
          <div class="fg" v-if="isAdmin"><label>排序</label><input v-model.number="form.sort_order" type="number"></div>
          <div class="fg toggle-row" v-if="isAdmin"><label>设为默认搜索引擎</label><label class="switch"><input type="checkbox" v-model="form.is_default" :true-value="1" :false-value="0"><span class="slider round"></span></label></div>
          <p v-if="!isAdmin && isNew" class="hint" style="color:var(--accent-yellow);">引擎提交后将进入审核状态，需管理员审核通过后生效。</p>
          <div class="form-btns"><button class="btn btn-ghost" @click="modalVisible = false">取消</button><button class="btn btn-primary" @click="save">保存</button></div>
        </div>
      </div>
    </div>
    <BackToTop />
  </div>
</template>

<script setup lang="ts">
import BackToTop from '~/components/BackToTop.vue'
definePageMeta({ middleware: 'admin', layout: 'admin' })
useHead({ title: '搜索引擎' })
const authStore = useAuthStore()
const isAdmin = computed(() => authStore.isAdmin)
function getAuthHeaders() {
  return authStore.token && authStore.token !== 'cookie_auth' ? { Authorization: `Bearer ${authStore.token}` } : {}
}
const engines = ref<any[]>([])
const loading = ref(false)
const modalVisible = ref(false)
const isNew = ref(true)
const editingId = ref<number | null>(null)
const form = reactive({ name: '', label: '', url: '', icon: '', category: 'SEARCH', sort_order: 0, is_default: 0 })
const myDefault = ref('')
// 加载用户自定义默认引擎
async function loadMyDefault() {
  try {
    const r = await $fetch<any>('/api/settings', { headers: getAuthHeaders(), credentials: 'include' })
    myDefault.value = r?.data?.search_engine_default || ''
  } catch { myDefault.value = '' }
}
// 设置用户的默认引擎
async function setMyDefault(e: any) {
  const newDefault = myDefault.value === e.name ? '' : e.name
  try {
    await $fetch('/api/settings', { method: 'PUT', headers: getAuthHeaders(), body: { data: { search_engine_default: newDefault } }, credentials: 'include' })
    myDefault.value = newDefault
  } catch (err: any) {
    alert('设置失败: ' + (err?.data?.error || err?.message || '未知错误'))
  }
}
async function load() {
  loading.value = true
  try {
    const d = await $fetch<{ engines: any[] }>('/api/admin/search-engines', { headers: getAuthHeaders(), credentials: 'include' })
    // 待审核置顶（稳定排序：仅 pending 排前，其余保持原序）
    const all = d.engines || []
    all.sort((a: any, b: any) => {
      const aPending = a.status === 'pending' ? 0 : 1
      const bPending = b.status === 'pending' ? 0 : 1
      return aPending - bPending
    })
    engines.value = all
  } catch (e) {
    console.error('加载搜索引擎失败', e)
    engines.value = []
  } finally {
    loading.value = false
  }
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
  try {
    if (isNew.value) {
      const body: any = { ...form }
      // 非管理员提交时不发送管理专属字段
      if (!isAdmin.value) {
        delete body.sort_order
        delete body.is_default
      }
      const res = await $fetch<any>('/api/admin/search-engines', { method: 'POST', headers: getAuthHeaders(), body, credentials: 'include' })
      if (res?.status === 'pending') {
        alert('已提交审核，等待管理员审核通过后生效。')
      }
    } else {
      // 编辑：非管理员同样过滤管理专属字段
      const body: any = { ...form }
      if (!isAdmin.value) {
        delete body.sort_order
        delete body.is_default
      }
      await $fetch(`/api/admin/search-engines/${editingId.value}`, { method: 'PUT', headers: getAuthHeaders(), body, credentials: 'include' })
    }
    modalVisible.value = false; load()
  } catch (e: any) {
    alert('保存失败: ' + (e?.data?.error || e?.message || '未知错误'))
  }
}
async function del(e: any) {
  if (!confirm(`删除「${e.name}」？`)) return
  try {
    await $fetch(`/api/admin/search-engines/${e.id}`, { method: 'DELETE', headers: getAuthHeaders(), credentials: 'include' })
    load()
  } catch (err: any) {
    alert('删除失败: ' + (err?.data?.error || err?.message || '未知错误'))
  }
}
// 管理员审核引擎
async function reviewEngine(e: any, status: string) {
  const action = status === 'approved' ? '通过' : '拒绝'
  if (!confirm(`${action}「${e.name}」的审核？`)) return
  try {
    await $fetch(`/api/admin/search-engines/${e.id}`, { method: 'PUT', headers: getAuthHeaders(), body: { status }, credentials: 'include' })
    load()
  } catch (err: any) {
    alert('审核操作失败: ' + (err?.data?.error || err?.message || '未知错误'))
  }
}
onMounted(() => { load(); loadMyDefault() })
</script>

<style scoped>
.icon-cell {
  text-align: center;
  vertical-align: middle;
}
.icon-cell img {
  display: inline-block;
  object-fit: contain;
}
.icon-placeholder {
  color: var(--text-tertiary, #999);
  font-size: 12px;
}
</style>