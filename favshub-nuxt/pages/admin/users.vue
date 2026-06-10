<template>
  <div class="admin-page">
    <header class="page-header">
      <h1 class="page-title">用户管理</h1>
      <div class="header-actions">
        <input v-model="searchQuery" type="text" class="search-input" placeholder="搜索用户名或邮箱...">
      </div>
    </header>

    <div v-if="isLoading" class="loading">加载中...</div>
    <div v-else class="card">
      <table class="data-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>用户名</th>
            <th>昵称</th>
            <th>邮箱</th>
            <th>书签数</th>
            <th>提示词数</th>
            <th>角色</th>
            <th>注册时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="user in filteredUsers" :key="user.id">
            <td>{{ user.id }}</td>
            <td>{{ user.username }}</td>
            <td>{{ user.nickname || '-' }}</td>
            <td>{{ user.email || '-' }}</td>
            <td>{{ user.bookmark_count ?? 0 }}</td>
            <td>{{ user.prompt_count ?? 0 }}</td>
            <td>
              <span :class="user.is_admin ? 'badge badge-admin' : 'badge badge-user'">
                {{ user.is_admin ? '管理员' : '用户' }}
              </span>
            </td>
            <td>{{ formatDate(user.created_at) }}</td>
            <td class="actions">
              <button class="btn btn-ghost btn-sm" @click="openEdit(user)">编辑</button>
              <button class="btn btn-ghost btn-sm" @click="resetPassword(user)">重置密码</button>
              <button v-if="!user.is_admin" class="btn btn-danger btn-sm" @click="deleteUser(user)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="filteredUsers.length === 0" class="empty-state">暂无匹配用户</div>
    </div>

    <!-- 编辑弹窗 -->
    <div v-if="editingUser" class="modal-overlay" @click.self="editingUser = null">
      <div class="modal">
        <div class="modal-header">
          <h3>编辑用户</h3>
          <button class="modal-close" @click="editingUser = null">&times;</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label>用户名</label>
            <input v-model="editForm.username" type="text">
          </div>
          <div class="form-group">
            <label>邮箱</label>
            <input v-model="editForm.email" type="email">
          </div>
          <div class="form-group">
            <label>
              <input type="checkbox" v-model="editForm.is_admin">
              管理员权限
            </label>
          </div>
          <div class="form-buttons">
            <button class="btn btn-ghost" @click="editingUser = null">取消</button>
            <button class="btn btn-primary" @click="saveUser">保存</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'admin', layout: 'admin' })

interface User {
  id: number
  username: string
  nickname?: string
  email?: string
  is_admin: number
  created_at?: number
  bookmark_count?: number
  prompt_count?: number
}

const { data, pending: isLoading, refresh } = await useFetch<{ users: User[] }>('/api/admin/users')
const users = computed(() => data.value?.users || [])
const searchQuery = ref('')
const editingUser = ref<User | null>(null)
const editForm = reactive({ username: '', email: '', is_admin: false })

const filteredUsers = computed(() => {
  if (!searchQuery.value) return users.value
  const q = searchQuery.value.toLowerCase()
  return users.value.filter(u => u.username.toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q))
})

function openEdit(user: User) {
  editingUser.value = user
  editForm.username = user.username
  editForm.email = user.email || ''
  editForm.is_admin = !!user.is_admin
}

async function saveUser() {
  if (!editingUser.value) return
  await $fetch(`/api/admin/users/${editingUser.value.id}`, {
    method: 'PUT',
    body: { username: editForm.username, email: editForm.email, is_admin: editForm.is_admin ? 1 : 0 },
  })
  editingUser.value = null
  await refresh()
}

async function resetPassword(user: User) {
  if (!confirm(`确定重置 ${user.username} 的密码为 123456？`)) return
  await $fetch(`/api/admin/users/${user.id}`, {
    method: 'PUT',
    body: { password: '123456' },
  })
  alert('密码已重置为 123456')
}

async function deleteUser(user: User) {
  if (!confirm(`确定删除用户 ${user.username}？`)) return
  await $fetch(`/api/admin/users/${user.id}`, { method: 'DELETE' })
  await refresh()
}

function formatDate(ts?: number) {
  if (!ts) return '-'
  return new Date(typeof ts === 'number' && ts < 1e12 ? ts * 1000 : ts).toLocaleDateString('zh-CN')
}
</script>

<style scoped>
.admin-page { max-width: 1200px; margin: 0 auto; padding: 32px; }
.page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; flex-wrap: wrap; gap: 12px; }
.page-title { font-size: 22px; font-weight: 600; margin: 0; color: #333; }
.search-input { padding: 8px 14px; border: 1.5px solid #e0e0e0; border-radius: 8px; font-size: 14px; outline: none; min-width: 250px; }
.search-input:focus { border-color: #667eea; }
.card { background: #fff; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); overflow: hidden; }
.data-table { width: 100%; border-collapse: collapse; }
th { text-align: left; padding: 12px 16px; font-size: 12px; color: #888; font-weight: 600; text-transform: uppercase; border-bottom: 1px solid #f0f0f0; background: #fafafa; }
td { padding: 12px 16px; font-size: 14px; border-bottom: 1px solid #f5f5f5; }
tr:hover { background: #fafafa; }
.actions { display: flex; gap: 6px; }
.badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; }
.badge-admin { background: #fef3c7; color: #92400e; }
.badge-user { background: #e0e7ff; color: #3730a3; }
.btn { padding: 6px 14px; border-radius: 6px; font-size: 13px; cursor: pointer; border: none; transition: all 0.2s; }
.btn-primary { background: #667eea; color: #fff; }
.btn-primary:hover { background: #5a6fd6; }
.btn-danger { background: #e74c3c; color: #fff; }
.btn-danger:hover { background: #c0392b; }
.btn-sm { padding: 4px 10px; font-size: 12px; }
.btn-ghost { background: none; border: 1px solid #ddd; color: #666; }
.btn-ghost:hover { background: #f5f5f5; }
.modal-overlay { display: flex; position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 1000; align-items: center; justify-content: center; }
.modal { background: #fff; border-radius: 12px; width: 90%; max-width: 700px; max-height: 80vh; overflow-y: auto; box-shadow: 0 20px 60px rgba(0,0,0,0.2); }
.modal-header { padding: 20px 24px; border-bottom: 1px solid #f0f0f0; display: flex; justify-content: space-between; align-items: center; }
.modal-header h3 { font-size: 16px; margin: 0; }
.modal-close { background: none; border: none; font-size: 20px; cursor: pointer; color: #888; }
.modal-body { padding: 20px 24px; }
.form-group { margin-bottom: 14px; }
.form-group label { display: block; font-size: 13px; color: #666; margin-bottom: 6px; }
.form-group input[type="text"],
.form-group input[type="email"] { width: 100%; padding: 10px 12px; border: 1.5px solid #e0e0e0; border-radius: 8px; font-size: 14px; outline: none; }
.form-group input[type="text"]:focus,
.form-group input[type="email"]:focus { border-color: #667eea; }
.form-group input[type="checkbox"] { margin-right: 6px; }
.form-buttons { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
.loading { text-align: center; padding: 60px; color: #999; }
.empty-state { text-align: center; padding: 40px; color: #888; }
/* ── Mobile responsive ── */
@media (max-width: 768px) {
  .admin-page { padding: 16px; }
  .page-title { font-size: 18px; }
  .search-input { min-width: 180px; font-size: 13px; }
  table { display: block; overflow-x: auto; -webkit-overflow-scrolling: touch; }
  th, td { padding: 8px 12px; font-size: 13px; white-space: nowrap; }
  .btn { padding: 8px 16px; font-size: 14px; }
  .btn-sm { padding: 6px 12px; font-size: 13px; }
  .modal { width: 95%; max-height: 90vh; }
  .modal-header { padding: 14px 16px; }
  .modal-body { padding: 14px 16px; }
}
@media (max-width: 480px) {
  .admin-page { padding: 12px; }
  .page-title { font-size: 16px; }
  .page-header { flex-direction: column; align-items: flex-start; }
  .search-input { min-width: 100%; }
}
</style>
