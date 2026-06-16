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
            <td v-if="isAdmin" class="actions">
              <button class="btn btn-ghost btn-sm" @click="openEdit(user)">编辑</button>
              <button class="btn btn-ghost btn-sm" @click="resetPassword(user)">重置密码</button>
              <button v-if="!user.is_admin" class="btn btn-danger btn-sm" @click="deleteUser(user)">删除</button>
            </td>
            <td v-else>-</td>
          </tr>
        </tbody>
      </table>
      <div v-if="filteredUsers.length === 0" class="empty-state">暂无匹配用户</div>
    </div>
    <!-- 编辑弹窗 (仅管理员) -->
    <div v-if="editingUser && isAdmin" class="modal-overlay" @click.self="editingUser = null">
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
            <label>昵称</label>
            <input v-model="editForm.nickname" type="text" placeholder="可选">
          </div>
          <div class="form-group">
            <label>邮箱</label>
            <input v-model="editForm.email" type="email">
          </div>
          <div class="form-group toggle-row">
            <label>管理员权限</label>
            <label class="switch"><input type="checkbox" v-model="editForm.is_admin"><span class="slider round"></span></label>
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
/^<\/script>$/a
/^  }$/a
/^}$/a
/^    <\/header>$/a
/^    <\/template>$/a
/^    <\/div>$/a
<script setup lang="ts">
definePageMeta({ middleware: 'admin', layout: 'admin' })
useHead({ title: '用户管理' })
const authStore = useAuthStore()
const isAdmin = computed(() => authStore.isAdmin)
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
const editForm = reactive({ username: '', nickname: '', email: '', is_admin: false })
const filteredUsers = computed(() => {
  if (!searchQuery.value) return users.value
  const q = searchQuery.value.toLowerCase()
  return users.value.filter(u => u.username.toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q))
})
function openEdit(user: User) {
  editingUser.value = user
  editForm.username = user.username
  editForm.nickname = user.nickname || ''
  editForm.email = user.email || ''
  editForm.is_admin = !!user.is_admin
}
async function saveUser() {
  if (!editingUser.value) return
  await $fetch(`/api/admin/users/${editingUser.value.id}`, {
    method: 'PUT',
    body: { username: editForm.username, nickname: editForm.nickname, email: editForm.email, is_admin: editForm.is_admin ? 1 : 0 },
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
