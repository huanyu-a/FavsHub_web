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
          <div class="fg" style="margin-top:12px;">
            <label>百度统计 App Key</label>
            <input v-model="sysSettings.baiduAppKey" placeholder="留空则不启用" @input="saveSysSettings">
          </div>
        </div>
      </div>
      <div v-if="isAdmin" class="card">
        <div class="card-header"><h3>安全设置</h3></div>
        <div style="padding:20px;">
          <p class="hint">JWT 令牌有效期、Cookie 过期时间、登录/注册频率限制和密码策略。</p>
          <div class="fg-row">
            <div class="fg"><label>JWT 有效期</label><input v-model="security.jwt_token_expiry" placeholder="7d" @input="saveSecurity"><small>如 7d, 24h, 30m</small></div>
            <div class="fg"><label>Cookie 有效期 (秒)</label><input v-model.number="security.cookie_max_age" type="number" min="60" @input="saveSecurity"><small>默认 604800 (7天)</small></div>
          </div>
          <div class="fg-row">
            <div class="fg"><label>密码最小长度</label><input v-model.number="security.min_password_length" type="number" min="4" max="64" @input="saveSecurity"></div>
          </div>
          <div class="fg-row">
            <div class="fg"><label>登录频率上限 (次)</label><input v-model.number="security.rate_limit_login_max" type="number" min="1" @input="saveSecurity"></div>
            <div class="fg"><label>登录频率窗口 (毫秒)</label><input v-model.number="security.rate_limit_login_window" type="number" min="1000" @input="saveSecurity"></div>
          </div>
          <div class="fg-row">
            <div class="fg"><label>注册频率上限 (次)</label><input v-model.number="security.rate_limit_register_max" type="number" min="1" @input="saveSecurity"></div>
            <div class="fg"><label>注册频率窗口 (毫秒)</label><input v-model.number="security.rate_limit_register_window" type="number" min="1000" @input="saveSecurity"></div>
          </div>
        </div>
      </div>
      <div v-if="isAdmin" class="card">
        <div class="card-header"><h3>Favicon 下载设置</h3></div>
        <div style="padding:20px;">
          <p class="hint">配置 Favicon 下载源、尺寸和超时时间。URL 中使用 <code>{domain}</code> 和 <code>{size}</code> 作为占位符。</p>
          <div class="fg"><label>下载源 URL</label><input v-model="favicon.favicon_source_url" placeholder="https://www.google.com/s2/favicons?domain={domain}&sz={size}" @input="saveFavicon"></div>
          <div class="fg-row">
            <div class="fg"><label>图标尺寸 (px)</label><input v-model.number="favicon.favicon_size" type="number" min="16" max="256" @input="saveFavicon"></div>
            <div class="fg"><label>下载超时 (毫秒)</label><input v-model.number="favicon.favicon_download_timeout" type="number" min="1000" @input="saveFavicon"></div>
            <div class="fg"><label>最大重定向次数</label><input v-model.number="favicon.favicon_max_redirects" type="number" min="0" max="10" @input="saveFavicon"></div>
          </div>
        </div>
      </div>
      <div v-if="isAdmin" class="card">
        <div class="card-header"><h3>数据限制</h3></div>
        <div style="padding:20px;">
          <p class="hint">控制书签同步和查询的数据量上限。</p>
          <div class="fg-row">
            <div class="fg"><label>单次同步上限 (条)</label><input v-model.number="limits.max_bookmarks_per_sync" type="number" min="100" @input="saveLimits"></div>
            <div class="fg"><label>书签查询 LIMIT</label><input v-model.number="limits.bookmarks_query_limit" type="number" min="50" @input="saveLimits"></div>
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
// ── 系统设置 ──────────────────────────────
const sysSettings = reactive({ allow_registration: true, baiduAppKey: '' })
let sysTimer: any = null
function saveSysSettings() {
  clearTimeout(sysTimer)
  sysTimer = setTimeout(async () => {
    try {
      await $fetch('/api/admin/config', {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: { data: { allow_registration: sysSettings.allow_registration, baiduAppKey: sysSettings.baiduAppKey } }
      })
    } catch (e) { console.error('保存系统设置失败', e) }
  }, 300)
}
// ── TDK ──────────────────────────────────
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
// ── 安全设置 ──────────────────────────────
const security = reactive({
  jwt_token_expiry: '7d',
  cookie_max_age: 604800,
  min_password_length: 8,
  rate_limit_login_max: 20,
  rate_limit_login_window: 60000,
  rate_limit_register_max: 10,
  rate_limit_register_window: 60000,
})
let secTimer: any = null
function saveSecurity() {
  clearTimeout(secTimer)
  secTimer = setTimeout(async () => {
    try {
      await $fetch('/api/admin/config', {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: { data: { ...security } }
      })
    } catch (e) { console.error('保存安全设置失败', e) }
  }, 500)
}
// ── Favicon 设置 ─────────────────────────
const favicon = reactive({
  favicon_source_url: 'https://www.google.com/s2/favicons?domain={domain}&sz={size}',
  favicon_size: 32,
  favicon_download_timeout: 10000,
  favicon_max_redirects: 3,
})
let favTimer: any = null
function saveFavicon() {
  clearTimeout(favTimer)
  favTimer = setTimeout(async () => {
    try {
      await $fetch('/api/admin/config', {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: { data: { ...favicon } }
      })
    } catch (e) { console.error('保存 Favicon 设置失败', e) }
  }, 500)
}
// ── 数据限制 ──────────────────────────────
const limits = reactive({
  max_bookmarks_per_sync: 20000,
  bookmarks_query_limit: 500,
})
let limTimer: any = null
function saveLimits() {
  clearTimeout(limTimer)
  limTimer = setTimeout(async () => {
    try {
      await $fetch('/api/admin/config', {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: { data: { ...limits } }
      })
    } catch (e) { console.error('保存数据限制失败', e) }
  }, 500)
}
// ── 初始化加载 ───────────────────────────
onMounted(async () => {
  // 加载 TDK
  try {
    const d = await $fetch<any>('/api/tdk')
    Object.assign(tdk, { siteTitle: d.siteTitle || '', siteDescription: d.siteDescription || '', siteKeywords: d.siteKeywords || '' })
  } catch {}
  // 加载所有系统配置
  try {
    const d = await $fetch<any>('/api/admin/config', { headers: getAuthHeaders() })
    if (d.systemData) {
      const s = d.systemData
      sysSettings.allow_registration = s.allow_registration !== 'false'
      sysSettings.baiduAppKey = s.baiduAppKey || ''
      security.jwt_token_expiry = s.jwt_token_expiry || '7d'
      security.cookie_max_age = parseInt(s.cookie_max_age) || 604800
      security.min_password_length = parseInt(s.min_password_length) || 8
      security.rate_limit_login_max = parseInt(s.rate_limit_login_max) || 20
      security.rate_limit_login_window = parseInt(s.rate_limit_login_window) || 60000
      security.rate_limit_register_max = parseInt(s.rate_limit_register_max) || 10
      security.rate_limit_register_window = parseInt(s.rate_limit_register_window) || 60000
      favicon.favicon_source_url = s.favicon_source_url || 'https://www.google.com/s2/favicons?domain={domain}&sz={size}'
      favicon.favicon_size = parseInt(s.favicon_size) || 32
      favicon.favicon_download_timeout = parseInt(s.favicon_download_timeout) || 10000
      favicon.favicon_max_redirects = parseInt(s.favicon_max_redirects) || 3
      limits.max_bookmarks_per_sync = parseInt(s.max_bookmarks_per_sync) || 20000
      limits.bookmarks_query_limit = parseInt(s.bookmarks_query_limit) || 500
    }
  } catch {}
})
</script>
