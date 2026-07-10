<template>
  <div class="admin-page">
    <header class="page-header">
      <h1 class="page-title">备份管理</h1>
    </header>

    <!-- 管理员视图：全局备份 -->
    <template v-if="isAdmin">
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
          <button class="btn btn-primary" @click="saveSchedule">保存计划</button>
        </div>
      </div>
      <!-- 手动备份 -->
      <div class="card" style="margin-top: 20px;">
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
    </template>

    <!-- 普通用户视图：个人数据导出 -->
    <template v-else>
      <div class="export-section">
        <h3 class="settings-section-title">个人数据管理</h3>
        <div class="export-cards">
          <div class="export-card">
            <div class="export-card-header">
              <i class="ri-bookmark-line"></i>
              <span>导出我的书签</span>
            </div>
            <div class="export-card-body">
              <button class="btn btn-primary btn-sm" @click="exportMyBookmarks">📥 导出（HTML）</button>
              <p class="export-hint">Netscape HTML 格式，兼容浏览器导入</p>
            </div>
          </div>
          <div class="export-card">
            <div class="export-card-header">
              <i class="ri-chat-quote-line"></i>
              <span>导出我的提示词</span>
            </div>
            <div class="export-card-body">
              <button class="btn btn-primary btn-sm" @click="exportMyPrompts">📥 导出（JSON）</button>
              <p class="export-hint">JSON 格式（兼容 promptpro v2.0）</p>
            </div>
          </div>
          <div class="export-card">
            <div class="export-card-header">
              <i class="ri-upload-cloud-line"></i>
              <span>导入提示词</span>
            </div>
            <div class="export-card-body">
              <label class="btn btn-primary btn-sm" style="cursor:pointer;">
                📤 导入（JSON）
                <input type="file" accept=".json,application/json" style="display:none" @change="importPrompts">
              </label>
              <p class="export-hint">支持 promptpro / FavsHub 备份文件</p>
              <p v-if="importMsg" :class="['export-hint', importMsgType]">{{ importMsg }}</p>
            </div>
          </div>
        </div>
      </div>
    </template>

    <div v-if="message" :class="['message', messageType]">{{ message }}</div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'admin', layout: 'admin' })
useHead({ title: '备份管理' })
const authStore = useAuthStore()
const isAdmin = computed(() => authStore.isAdmin)
function getAuthHeaders() {
  return authStore.token && authStore.token !== 'cookie_auth' ? { Authorization: `Bearer ${authStore.token}` } : {}
}
const info = ref<any>(null)
const schedule = reactive({ enabled: true, hour: 3, minute: 0, keepCopies: 7, lastBackupDate: null as string | null })
const backupFiles = ref<any[]>([])
const backupLoading = ref(false)
const filesLoading = ref(false)
const message = ref('')
const messageType = ref<'success' | 'error'>('success')
const importMsg = ref('')
const importMsgType = ref<'success' | 'error'>('success')
async function loadInfo() {
  try { info.value = await $fetch('/api/admin/backup/info', { headers: getAuthHeaders() }) } catch {}
}
async function loadSchedule() {
  try {
    const data = await $fetch<any>('/api/admin/backup-schedule', { headers: getAuthHeaders() })
    if (data) Object.assign(schedule, data)
  } catch {}
}
async function loadFiles() {
  filesLoading.value = true
  try {
    const data = await $fetch<any>('/api/admin/backup-files', { headers: getAuthHeaders() })
    backupFiles.value = data?.files || []
  } catch { backupFiles.value = [] }
  filesLoading.value = false
}
async function saveSchedule() {
  try {
    await $fetch('/api/admin/backup-schedule', { method: 'PUT', headers: getAuthHeaders(), body: schedule })
    showMessage('备份计划已保存')
  } catch { showMessage('保存失败', 'error') }
}
async function manualBackup() {
  backupLoading.value = true
  try {
    await $fetch('/api/admin/manual-backup', { method: 'POST', headers: getAuthHeaders() })
    showMessage('备份完成')
    await loadFiles()
  } catch { showMessage('备份失败', 'error') }
  backupLoading.value = false
}
async function downloadBackup() {
  try {
    const blob = await $fetch('/api/admin/backup/download', {
      headers: getAuthHeaders(),
      credentials: 'include',
      responseType: 'blob',
    })
    downloadBlob(blob as Blob, `favshub-backup-${Date.now()}.db`)
  } catch (e: any) {
    showMessage('下载失败: ' + (e?.message || '未知错误'), 'error')
  }
}
async function downloadFile(name: string) {
  try {
    const blob = await $fetch(`/api/admin/backup/download?file=${encodeURIComponent(name)}`, {
      headers: getAuthHeaders(),
      credentials: 'include',
      responseType: 'blob',
    })
    downloadBlob(blob as Blob, name)
  } catch (e: any) {
    showMessage('下载失败: ' + (e?.message || '未知错误'), 'error')
  }
}
async function downloadFavicons() {
  try {
    const res = await $fetch<any>('/api/admin/download-favicons', { method: 'POST', headers: getAuthHeaders() })
    showMessage(`下载完成：${res?.downloaded || 0} 个`)
  } catch { showMessage('下载失败', 'error') }
}
async function retryFavicons() {
  try {
    const res = await $fetch<any>('/api/admin/retry-failed-favicons', { method: 'POST', headers: getAuthHeaders() })
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
// 个人数据导出
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
async function exportMyBookmarks() {
  try {
    const blob = await $fetch('/api/bookmarks/export', {
      headers: getAuthHeaders(),
      responseType: 'blob',
      credentials: 'include',
    })
    downloadBlob(blob as Blob, `favshub-bookmarks-${Date.now()}.html`)
  } catch { alert('导出失败') }
}
async function exportMyPrompts() {
  try {
    const blob = await $fetch('/api/prompts/export', {
      headers: getAuthHeaders(),
      responseType: 'blob',
      credentials: 'include',
    })
    downloadBlob(blob as Blob, `promptpro-backup-${Date.now()}.json`)
  } catch { alert('导出失败') }
}
async function importPrompts(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  if (!file.name.endsWith('.json') && file.type !== 'application/json') {
    importMsg.value = '请选择 JSON 文件'
    importMsgType.value = 'error'
    return
  }
  importMsg.value = '导入中...'
  importMsgType.value = 'success'
  try {
    const fd = new FormData()
    fd.append('file', file)
    const res = await $fetch<any>('/api/prompts/import', {
      method: 'POST',
      headers: getAuthHeaders(),
      credentials: 'include',
      body: fd,
    })
    importMsg.value = `导入成功：${res.imported.prompts} 条提示词、${res.imported.folders} 个文件夹、${res.imported.tags} 个标签${res.skipped_prompts ? `（跳过 ${res.skipped_prompts} 条重复）` : ''}`
    importMsgType.value = 'success'
  } catch (err: any) {
    importMsg.value = err?.data?.error || err?.message || '导入失败'
    importMsgType.value = 'error'
  } finally {
    input.value = ''
  }
}
onMounted(() => {
  if (isAdmin.value) {
    loadInfo()
    loadSchedule()
    loadFiles()
  }
})
</script>