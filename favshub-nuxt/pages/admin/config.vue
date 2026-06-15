<template>
  <div class="admin-page">
    <header class="page-header">
      <h1>系统配置</h1>
      <p>当前服务器运行配置</p>
    </header>

    <div class="config-grid">
      <div class="card">
        <div class="card-header"><h3>服务器信息</h3></div>
        <div class="config-list">
          <div class="config-item"><span class="key">Node.js</span><span class="val">{{ info.nodeVersion || '-' }}</span></div>
          <div class="config-item"><span class="key">平台</span><span class="val">{{ info.platform || '-' }}</span></div>
          <div class="config-item"><span class="key">数据库</span><span class="val">{{ info.dbPath || '-' }}</span></div>
          <div class="config-item"><span class="key">CORS</span><span class="val">{{ info.corsOrigin || '-' }}</span></div>
          <div class="config-item"><span class="key">运行时间</span><span class="val">{{ info.uptime || '-' }}</span></div>
        </div>
      </div>

      <div v-if="isAdmin" class="card">
        <div class="card-header"><h3>网站 TDK 设置</h3></div>
        <div style="padding:20px;">
          <p class="hint">设置网站的标题（Title）、描述（Description）和关键词（Keywords），用于 SEO 优化。</p>
          <div class="fg"><label>网站标题</label><input v-model="tdk.siteTitle" placeholder="FavsHub - 智能书签管理" @input="saveTdk"></div>
          <div class="fg"><label>网站描述</label><input v-model="tdk.siteDescription" placeholder="FavsHub 是一个智能书签管理和 AI 提示词管理平台" @input="saveTdk"></div>
          <div class="fg"><label>网站关键词</label><input v-model="tdk.siteKeywords" placeholder="书签管理,提示词,AI,收藏夹" @input="saveTdk"><small>多个关键词用英文逗号分隔</small></div>
        </div>
      </div>

      <div v-if="isAdmin" class="card">
        <div class="card-header"><h3>系统设置</h3></div>
        <div style="padding:20px;">
          <div class="toggle-row">
            <label>允许用户注册</label>
            <label class="switch">
              <input type="checkbox" v-model="sysSettings.allow_registration" @change="saveSysSettings">
              <span class="slider"></span>
            </label>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'admin', layout: 'admin' })

useHead({ title: '系统配置' })

const authStore = useAuthStore()
const isAdmin = computed(() => authStore.isAdmin)
function getAuthHeaders(): Record<string, string> {
  return authStore.token ? { Authorization: `Bearer ${authStore.token}` } : {}
}

const info = reactive({ nodeVersion: '', platform: '', dbPath: '', corsOrigin: '', uptime: '' })

const { data: configData } = await useFetch<any>('/api/admin/config', { headers: getAuthHeaders() })
const { data: statsData } = await useFetch<any>('/api/admin/stats', { headers: getAuthHeaders() })

watchEffect(() => {
  if (configData.value) {
    info.nodeVersion = configData.value.nodeVersion || ''
    info.platform = configData.value.platform || ''
    info.dbPath = configData.value.dbPath || ''
    info.corsOrigin = configData.value.corsOrigin || ''
    info.uptime = configData.value.uptime || ''
  }
})

const sysSettings = reactive({ allow_registration: true })
let sysTimer: any = null
function saveSysSettings() {
  clearTimeout(sysTimer)
  sysTimer = setTimeout(async () => {
    try {
      await $fetch('/api/admin/config', {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: { data: { allow_registration: sysSettings.allow_registration } }
      })
    } catch (e) { console.error('保存系统设置失败', e) }
  }, 300)
}

const tdk = reactive({ siteTitle: '', siteDescription: '', siteKeywords: '' })
let tdkTimer: any = null
function saveTdk() {
  clearTimeout(tdkTimer)
  tdkTimer = setTimeout(async () => {
    try {
      await $fetch('/api/admin/config', {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: { data: { ...tdk } }
      })
    } catch (e) { console.error('保存 TDK 失败', e) }
  }, 500)
}

onMounted(async () => {
  try {
    const d = await $fetch<any>('/api/tdk')
    Object.assign(tdk, { siteTitle: d.siteTitle || '', siteDescription: d.siteDescription || '', siteKeywords: d.siteKeywords || '' })
  } catch {}
  try {
    const d = await $fetch<any>('/api/admin/config', { headers: getAuthHeaders() })
    if (d.systemData) {
      sysSettings.allow_registration = d.systemData.allow_registration !== 'false'
    }
  } catch {}
})
</script>

<style scoped>
.admin-page { max-width: 1200px; margin: 0 auto; padding: 32px; }
.page-header { margin-bottom: 24px; }
.page-header h1 { font-size: 22px; font-weight: 600; }
.page-header p { color: #888; font-size: 14px; margin-top: 4px; }
.config-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
@media (max-width: 768px) { .config-grid { grid-template-columns: 1fr; } }
.card { background: #fff; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,.08); overflow: hidden; }
.card-header { padding: 16px 20px; border-bottom: 1px solid #f0f0f0; }
.card-header h3 { font-size: 16px; margin: 0; }
.config-list { padding: 20px; }
.config-item { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #f5f5f5; }
.config-item .key { font-size: 14px; font-weight: 500; }
.config-item .val { color: #888; font-size: 14px; font-family: monospace; }
.hint { font-size: 13px; color: #888; margin-bottom: 16px; }
.fg { margin-bottom: 12px; }
.fg label { display: block; font-size: 13px; color: #666; margin-bottom: 4px; }
.fg input { width: 100%; padding: 8px 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; box-sizing: border-box; }
.fg small { font-size: 11px; color: #94a3b8; display: block; margin-top: 2px; }
.toggle-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; }
.toggle-row > label:first-child { margin-bottom: 0; font-size: 13px; color: #666; }
.switch { position: relative; display: inline-block; width: 42px; height: 24px; flex-shrink: 0; }
.switch input { opacity: 0; width: 0; height: 0; }
.slider { position: absolute; inset: 0; background: #ccc; border-radius: 34px; cursor: pointer; transition: .4s; }
.slider:before { content: ''; position: absolute; height: 16px; width: 16px; left: 4px; bottom: 4px; background: #fff; border-radius: 50%; transition: .4s; }
.switch input:checked + .slider { background: #10b981; }
.switch input:checked + .slider:before { transform: translateX(16px); }
</style>
