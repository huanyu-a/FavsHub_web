<template>
  <div class="admin-page">
    <header class="page-header">
      <h1>全局默认设置</h1>
      <p>所有用户生效（个人设置优先于全局默认）</p>
    </header>
    <div class="settings-grid">
      <!-- 主题与外观 -->
      <div class="setting-card">
        <h3>主题与外观</h3>
        <h4 class="section-title">浅色主题</h4>
        <div class="bg-options">
          <div
            v-for="bg in lightThemes"
            :key="bg.value"
            class="bg-option theme-swatch"
            :class="{ active: form.selectedBackground === bg.value }"
            :style="bg.style"
            :title="bg.label"
            @click="form.selectedBackground = bg.value; form.backgroundType = 'theme'; save()"
          >
            <span class="theme-accent-dot" :style="{ background: bg.accent }"></span>
          </div>
        </div>
        <h4 class="section-title">深色主题</h4>
        <div class="bg-options">
          <div
            v-for="bg in darkThemes"
            :key="bg.value"
            class="bg-option theme-swatch"
            :class="{ active: form.selectedBackground === bg.value }"
            :style="bg.style"
            :title="bg.label"
            @click="form.selectedBackground = bg.value; form.backgroundType = 'theme'; save()"
          >
            <span class="theme-accent-dot" :style="{ background: bg.accent }"></span>
          </div>
          <div class="bg-option bg-none" :class="{ active: !form.selectedBackground }" title="无主题" @click="form.selectedBackground = ''; form.backgroundType = 'none'; save()">无</div>
        </div>
        <h4 class="section-title">界面元素</h4>
        <div class="setting-option"><span>显示搜索框</span><label class="switch"><input type="checkbox" v-model="form.showSearchBox" @change="save"><span class="slider round"></span></label></div>
        <div class="setting-option"><span>显示欢迎消息</span><label class="switch"><input type="checkbox" v-model="form.showWelcomeMessage" @change="save"><span class="slider round"></span></label></div>
        <div class="setting-option"><span>显示页脚</span><label class="switch"><input type="checkbox" v-model="form.showFooter" @change="save"><span class="slider round"></span></label></div>
        <div class="setting-option"><span>新标签页打开链接</span><label class="switch"><input type="checkbox" v-model="form.openInNewTab" @change="save"><span class="slider round"></span></label></div>
        <h4 class="section-title">快捷链接</h4>
        <div class="setting-option"><span>历史记录</span><label class="switch"><input type="checkbox" v-model="form.showHistoryLink" @change="save"><span class="slider round"></span></label></div>
        <div class="setting-option"><span>下载记录</span><label class="switch"><input type="checkbox" v-model="form.showDownloadsLink" @change="save"><span class="slider round"></span></label></div>
        <div class="setting-option"><span>密码管理</span><label class="switch"><input type="checkbox" v-model="form.showPasswordsLink" @change="save"><span class="slider round"></span></label></div>
        <div class="setting-option"><span>扩展管理</span><label class="switch"><input type="checkbox" v-model="form.showExtensionsLink" @change="save"><span class="slider round"></span></label></div>
      </div>
      <!-- 搜索与布局 -->
      <div style="display:flex;flex-direction:column;gap:20px;">
        <div class="setting-card">
          <h3>搜索设置</h3>
          <div class="setting-option"><span>显示搜索建议</span><label class="switch"><input type="checkbox" v-model="form.showSearchSuggestions" @change="save"><span class="slider round"></span></label></div>
          <div class="setting-option"><span>历史记录建议</span><label class="switch"><input type="checkbox" v-model="form.showHistorySuggestions" @change="save"><span class="slider round"></span></label></div>
          <div class="setting-option"><span>书签建议</span><label class="switch"><input type="checkbox" v-model="form.showBookmarkSuggestions" @change="save"><span class="slider round"></span></label></div>
          <div class="setting-option"><span>提示词建议</span><label class="switch"><input type="checkbox" v-model="form.showPromptSuggestions" @change="save"><span class="slider round"></span></label></div>
          <div class="setting-option"><span>新标签页打开搜索结果</span><label class="switch"><input type="checkbox" v-model="form.openSearchInNewTab" @change="save"><span class="slider round"></span></label></div>
        </div>
        <div class="setting-card">
          <h3>书签布局</h3>
          <div class="setting-row">
            <label>卡片宽度</label>
            <input type="range" min="100" max="300" step="10" v-model.number="form.bookmarkWidth" @change="save">
            <span class="val">{{ form.bookmarkWidth }}px <em class="estimate">≈{{ cardsPerRow }}个/行</em></span>
          </div>
          <div class="setting-row">
            <label>卡片高度</label>
            <input type="range" min="36" max="80" step="2" v-model.number="form.bookmarkCardHeight" @change="save">
            <span class="val">{{ form.bookmarkCardHeight }}px</span>
          </div>
          <div class="setting-row">
            <label>容器宽度</label>
            <input type="range" min="50" max="100" step="5" v-model.number="form.bookmarkContainerWidth" @change="save">
            <span class="val">{{ form.bookmarkContainerWidth }}%</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: 'admin', layout: 'admin', ssr: false })
useHead({ title: '个人设置' })

// ── 15 套主题配色（11 浅 + 4 深）──

// 浅色主题（11 套）
const lightThemes = [
  { value: 'theme-bg-1', label: '薄雾灰', accent: '#0D9488', style: { background: '#CBD5E1' } },
  { value: 'theme-bg-2', label: '天空白', accent: '#2563EB', style: { background: '#BFDBFE' } },
  { value: 'theme-bg-3', label: '淡紫薰', accent: '#9333EA', style: { background: '#E9D5FF' } },
  { value: 'theme-bg-4', label: '薄荷绿', accent: '#059669', style: { background: '#F2F8F0' } },
  { value: 'theme-bg-5', label: '米白纸', accent: '#D97706', style: { background: '#FCFCF7' } },
  { value: 'theme-bg-6', label: '淡藤紫', accent: '#7C3AED', style: { background: '#F4F1F8' } },
  { value: 'theme-bg-7', label: '暖灰白', accent: '#4F46E5', style: { background: '#F8F7F4' } },
  { value: 'theme-bg-chen-guang', label: '晨光', accent: '#3b82f6', style: { background: '#ffffff' } },
  { value: 'theme-bg-tian-qing', label: '天青', accent: '#3b82f6', style: { background: '#f8fafc' } },
  { value: 'theme-bg-hu-po', label: '琥珀', accent: '#D97757', style: { background: '#FAF9F5' } },
  { value: 'theme-bg-na-tie', label: '霜华', accent: '#1e66f5', style: { background: '#eff1f5' } },
]

// 深色主题（4 套）
const darkThemes = [
  { value: 'theme-bg-mo-ye', label: '墨夜', accent: '#60a5fa', style: { background: '#0f172a' } },
  { value: 'theme-bg-xing-yun', label: '星云', accent: '#61afef', style: { background: '#282c34' } },
  { value: 'theme-bg-ji-guang', label: '极光', accent: '#88c0d0', style: { background: '#2e3440' } },
  { value: 'theme-bg-zi-teng', label: '紫藤', accent: '#BD93F9', style: { background: '#282A36' } },
]

const settingsStore = useSettingsStore()

// 确保设置已加载（auth-init 插件已 fetch，此处兜底）
if (!settingsStore.isLoading && Object.keys(settingsStore.settings).length === 0) {
  const auth = useAuthStore()
  await settingsStore.fetchSettings(auth.token && auth.token !== 'cookie_auth' ? auth.token : undefined)
}

// 从 settingsStore 初始化表单（兼容旧 gradient-background-* 值）
function normalizeBg(bg: string): string {
  if (!bg) return ''
  const m = bg.match(/^gradient-background-(\d+)$/)
  if (m) return `theme-bg-${m[1]}`
  return bg
}

const form = reactive<Record<string, any>>({
  selectedBackground: normalizeBg(settingsStore.get('selectedBackground', 'theme-bg-7')),
  backgroundType: settingsStore.get('backgroundType', 'none'),
  showSearchBox: settingsStore.get('showSearchBox', true),
  showWelcomeMessage: settingsStore.get('showWelcomeMessage', true),
  showFooter: settingsStore.get('showFooter', true),
  openInNewTab: settingsStore.get('openInNewTab', true),
  showHistoryLink: settingsStore.get('showHistoryLink', true),
  showDownloadsLink: settingsStore.get('showDownloadsLink', true),
  showPasswordsLink: settingsStore.get('showPasswordsLink', true),
  showExtensionsLink: settingsStore.get('showExtensionsLink', true),
  showSearchSuggestions: settingsStore.get('showSearchSuggestions', true),
  showHistorySuggestions: settingsStore.get('showHistorySuggestions', true),
  showBookmarkSuggestions: settingsStore.get('showBookmarkSuggestions', true),
  showPromptSuggestions: settingsStore.get('showPromptSuggestions', true),
  openSearchInNewTab: settingsStore.get('openSearchInNewTab', true),
  bookmarkWidth: settingsStore.get('bookmarkWidth', 200),
  bookmarkCardHeight: settingsStore.get('bookmarkCardHeight', 50),
  bookmarkContainerWidth: settingsStore.get('bookmarkContainerWidth', 85),
})
function save() {
  settingsStore.setManyNow({ ...form })
}
// 每行卡片数量预估（基于 1440px 视口宽度）
const cardsPerRow = computed(() => {
  const viewportWidth = 1440
  const containerPx = viewportWidth * (form.bookmarkContainerWidth || 85) / 100
  const cardWidth = form.bookmarkWidth || 200
  const gap = 16
  return Math.max(1, Math.floor((containerPx + gap) / (cardWidth + gap)))
})
</script>

<style scoped>
.theme-swatch {
  position: relative;
  overflow: hidden;
}
.theme-accent-dot {
  position: absolute;
  bottom: 4px;
  right: 4px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 1px solid rgba(255,255,255,0.3);
  box-shadow: 0 1px 2px rgba(0,0,0,0.2);
}
.bg-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
</style>
