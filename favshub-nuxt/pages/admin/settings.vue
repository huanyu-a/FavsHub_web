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
        <div class="setting-row">
          <label>默认主题</label>
          <select v-model="form.theme" @change="save">
            <option value="auto">跟随系统</option>
            <option value="light">浅色</option>
            <option value="dark">深色</option>
          </select>
        </div>

        <h4 class="section-title">纯色背景</h4>
        <div class="bg-options">
          <div
            v-for="bg in backgrounds"
            :key="bg.value"
            class="bg-option"
            :class="{ active: form.selectedBackground === bg.value }"
            :style="bg.style"
            :title="bg.label"
            @click="form.selectedBackground = bg.value; save()"
          />
          <div class="bg-option bg-none" :class="{ active: !form.selectedBackground }" title="无背景" @click="form.selectedBackground = ''; save()">无</div>
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
definePageMeta({ middleware: 'admin', layout: 'admin' })

useHead({ title: '个人设置' })

const backgrounds = [
  { value: 'gradient-background-1', label: '渐变1', style: { background: 'linear-gradient(0deg, #e2e8f0 0%, #d6deeb 50%, #cbd5e1 100%)' } },
  { value: 'gradient-background-2', label: '渐变2', style: { background: 'linear-gradient(0deg, #a5f3fc 0%, #b2e7fd 50%, #bfdbfe 100%)' } },
  { value: 'gradient-background-3', label: '渐变3', style: { background: 'linear-gradient(0deg, #fbcee8 0%, #f2d2f4 50%, #e9d5ff 100%)' } },
  { value: 'gradient-background-4', label: '渐变4', style: { background: 'linear-gradient(0deg, #b6e8a6 0%, #b6e8a6 100%)' } },
  { value: 'gradient-background-5', label: '渐变5', style: { background: 'linear-gradient(0deg, #efef42 0%, #efef42 100%)' } },
  { value: 'gradient-background-6', label: '渐变6', style: { background: 'linear-gradient(0deg, #d7c8eb 0%, #d7c8eb 100%)' } },
  { value: 'gradient-background-7', label: '渐变7', style: { background: 'linear-gradient(0deg, #fbebbc 0%, #fbebbc 100%)' } },
]

const settingsStore = useSettingsStore()

// 从 settingsStore 初始化表单
const form = reactive<Record<string, any>>({
  theme: settingsStore.get('theme', 'auto'),
  selectedBackground: settingsStore.get('selectedBackground', ''),
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
  settingsStore.setMany({ ...form })
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
.admin-page { max-width: 1200px; margin: 0 auto; padding: 32px; }
.page-header { margin-bottom: 24px; }
.page-header h1 { font-size: 22px; font-weight: 600; }
.page-header p { color: #888; font-size: 14px; margin-top: 4px; }
.settings-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; }
@media (max-width: 768px) { .settings-grid { grid-template-columns: 1fr; }
  .admin-page { padding: 16px; }
  .page-header h1 { font-size: 18px; }
  .setting-card { padding: 14px; }
  .setting-option { padding: 10px; }
}
.setting-card { background: #fff; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,.08); padding: 20px; }
.setting-card h3 { font-size: 16px; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 1px solid #f0f0f0; }
.section-title { font-size: 14px; font-weight: 600; color: #555; margin: 16px 0 10px; }
.setting-row { display: flex; align-items: center; justify-content: space-between; padding: 10px 0; }
.setting-row label { font-size: 14px; color: #555; flex: 1; }
.setting-row .val { font-size: 13px; color: #888; margin-left: 8px; min-width: 40px; text-align: right; }
.estimate { font-style: normal; color: #10b981; font-size: 12px; margin-left: 4px; }
.setting-option { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background: #f8f9fa; border-radius: 8px; margin-bottom: 6px; transition: background 0.2s; }
.setting-option:hover { background: #f0f2f5; }
.setting-option span { font-size: 14px; color: #555; }
select, input[type=range] { padding: 6px 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 13px; background: #fff; }
input[type=range] { width: 140px; cursor: pointer; }
.bg-options { display: flex; flex-wrap: wrap; gap: 10px; }
.bg-option { width: 36px; height: 36px; border-radius: 50%; cursor: pointer; border: 2px solid transparent; }
.bg-option:hover { transform: scale(1.08); border-color: #ccc; }
.bg-option.active { border-color: #10b981; }
.bg-option.bg-none { background: #f0f0f0; display: flex; align-items: center; justify-content: center; font-size: 11px; color: #999; }
.switch { position: relative; display: inline-block; width: 42px; height: 24px; }
.switch input { opacity: 0; width: 0; height: 0; }
.slider { position: absolute; inset: 0; background: #ccc; border-radius: 34px; cursor: pointer; transition: .4s; }
.slider:before { content: ''; position: absolute; height: 16px; width: 16px; left: 4px; bottom: 4px; background: #fff; border-radius: 50%; transition: .4s; }
.switch input:checked + .slider { background: #10b981; }
.switch input:checked + .slider:before { transform: translateX(16px); }
</style>
