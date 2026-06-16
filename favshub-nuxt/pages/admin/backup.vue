<template>
  <div class="admin-page">
    <header class="page-header">
      <h1 class="page-title">备份管理</h1>
    </header>
    <!-- 备份信息 -->
    <div class="info-grid">
      <div class="card info-card">
        <h3>备份信息</h3>
        <div v-if="info" class="info-list">
          <div class="info-item"><span class="info-label">数据库大小</span><span>{{ info.dbSizeFormatted || '-' }}</span></div>
          <div class="info-item"><span class="info-label">最后修改</span><span>{{ formatDate(info.lastModified) }}</span></div>
          <div class="info-item"><span class="info-label">书签数</span><span>{{ info.stats?.bookmarks || 0 }}</span></div>
          <div class="info-item"><span class="info-label">提示词数</span><span>{{ info.stats?.prompts || 0 }}</span></div>
          <div class="info-item"><span class="info-label">用户数</span><span>{{ info.stats?.users || 0 }}</span></div>
          <div class="info-item"><span class="info-label">文件夹数</span><span>{{ info.stats?.folders || 0 }}</span></div>
        </div>
        <div v-else class="loading-sm">加载中...</div>
      </div>
      <div class="card info-card">
        <h3>备份计划</h3>
        <div class="form-group">
          <label>自动备份</label>
          <select v-model="schedule.enabled">
            <option :value="true">启用</option>
            <option :value="false">禁用</option>
          </select>
        </div>
        <div class="form-group">
          <label>执行时间</label>
          <div class="time-picker">
            <input v-model.number="schedule.hour" type="number" min="0" max="23" placeholder="时"> :
            <input v-model.number="schedule.minute" type="number" min="0" max="59" placeholder="分">
          </div>
        </div>
        <div class="form-group">
          <label>保留份数</label>
          <input v-model.number="schedule.keepCopies" type="number" min="1">
        </div>
        <div v-if="schedule.lastBackupDate" class="info-item" style="margin-bottom: 14px;">
          <span class="info-label">上次备份</span><span>{{ formatDate(schedule.lastBackupDate) }}</span>
        </div>
        <button v-if="isAdmin" class="btn btn-primary" @click="saveSchedule">保存计划</button>
      </div>
    </div>
    <!-- 手动备份 -->
    <div v-if="isAdmin" class="card" style="margin-top: 20px;">
      <div class="card-header">
        <h3>手动操作</h3>
        <div class="header-actions">
          <button class="btn btn-primary" @click="manualBackup" :disabled="backupLoading">
            {{ backupLoading ? '备份中...' : '立即备份' }}
          </button>
          <button class="btn btn-ghost" @click="downloadBackup">下载最新备份</button>
          <button class="btn btn-ghost" @click="downloadFavicons">下载 Favicon</button>
          <button class="btn btn-ghost" @click="retryFavicons">重试失败图标</button>
        </div>
      </div>
    </div>
    <!-- 备份文件列表 -->
    <div class="card" style="margin-top: 20px;">
      <div class="card-header">
        <h3>备份文件</h3>
        <button class="btn btn-ghost btn-sm" @click="refreshFiles">刷新</button>
      </div>
      <div v-if="filesLoading" class="loading-sm" style="padding: 20px;">加载中...</div>
      <div v-else-if="backupFiles.length === 0" class="empty-state">暂无备份文件</div>
      <table v-else class="data-table">
        <thead>
          <tr><th>文件名</th><th>大小</th><th>创建时间</th><th>操作</th></tr>
        </thead>
        <tbody>
          <tr v-for="file in backupFiles" :key="file.name">
            <td class="filename">{{ file.name }}</td>
            <td>{{ file.sizeFormatted || '-' }}</td>
            <td>{{ formatDate(file.time) }}</td>
            <td>
              <button class="btn btn-ghost btn-sm" @click="downloadFile(file.name)">下载</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="message" :class="['message', messageType]">{{ message }}</div>
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
useHead({ title: '备份管理' })
const authStore = useAuthStore()
const isAdmin = computed(() => authStore.isAdmin)
const info = ref<any>(null)
const schedule = reactive({ enabled: true, hour: 3, minute: 0, keepCopies: 7, lastBackupDate: null as string | null })
const backupFiles = ref<any[]>([])
const backupLoading = ref(false)
const filesLoading = ref(false)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
async function loadInfo() {
  try { info.value = await $fetch('/api/admin/backup/info') } catch {}
}
async function loadSchedule() {
  try {
    const data = await $fetch<any>('/api/admin/backup-schedule')
    if (data) Object.assign(schedule, data)
  } catch {}
}
async function loadFiles() {
  filesLoading.value = true
  try {
    const data = await $fetch<any>('/api/admin/backup-files')
    backupFiles.value = data?.files || []
  } catch { backupFiles.value = [] }
  filesLoading.value = false
}
async function saveSchedule() {
  try {
    await $fetch('/api/admin/backup-schedule', { method: 'PUT', body: schedule })
    showMessage('备份计划已保存')
  } catch { showMessage('保存失败', 'error') }
}
async function manualBackup() {
  backupLoading.value = true
  try {
    await $fetch('/api/admin/manual-backup', { method: 'POST' })
    showMessage('备份完成')
    await loadFiles()
  } catch { showMessage('备份失败', 'error') }
  backupLoading.value = false
}
function downloadBackup() {
  window.open('/api/admin/backup/download', '_blank')
}
function downloadFile(name: string) {
  window.open(`/api/admin/backup/download?file=${encodeURIComponent(name)}`, '_blank')
}
async function downloadFavicons() {
  try {
    const res = await $fetch<any>('/api/admin/download-favicons', { method: 'POST' })
    showMessage(`下载完成：${res?.downloaded || 0} 个`)
  } catch { showMessage('下载失败', 'error') }
}
async function retryFavicons() {
  try {
    const res = await $fetch<any>('/api/admin/retry-failed-favicons', { method: 'POST' })
    showMessage(`重试完成：${res?.retried || 0} 个`)
  } catch { showMessage('重试失败', 'error') }
}
function refreshFiles() { loadFiles() }
function showMessage(msg: string, type: 'success' | 'error' = 'success') {
  message.value = msg
  messageType.value = type
  setTimeout(() => { message.value = '' }, 3000)
}
function formatDate(ts?: number | string) {
  if (!ts) return '-'
  return new Date(ts).toLocaleString('zh-CN')
}
onMounted(() => {
  loadInfo()
  loadSchedule()
  loadFiles()
})
</script>
