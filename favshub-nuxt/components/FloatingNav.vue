<template>
  <div class="floating-nav">
    <a v-if="settingsStore.get('showHistoryLink', true)" href="#" class="floating-nav-item" title="历史记录" @click.prevent="openChromePage('history')">
      <span class="floating-nav-icon">🕐</span>
      <span class="floating-nav-label">历史</span>
    </a>
    <a v-if="settingsStore.get('showDownloadsLink', true)" href="#" class="floating-nav-item" title="下载记录" @click.prevent="openChromePage('downloads')">
      <span class="floating-nav-icon">📥</span>
      <span class="floating-nav-label">下载</span>
    </a>
    <a v-if="settingsStore.get('showPasswordsLink', true)" href="#" class="floating-nav-item" title="密码管理" @click.prevent="openChromePage('passwords')">
      <span class="floating-nav-icon">🔑</span>
      <span class="floating-nav-label">密码</span>
    </a>
    <a v-if="settingsStore.get('showExtensionsLink', true)" href="#" class="floating-nav-item" title="扩展管理" @click.prevent="openChromePage('extensions')">
      <span class="floating-nav-icon">🧩</span>
      <span class="floating-nav-label">扩展</span>
    </a>
  </div>
</template>

<script setup lang="ts">
const settingsStore = useSettingsStore()

function openChromePage(page: string) {
  if (!import.meta.client) return

  // 扩展模式：通过 postMessage 中继到 content script -> background -> chrome.tabs.create
  if (document.documentElement.getAttribute('data-favshub-ext') === 'active') {
    const actionMap: Record<string, string> = {
      history: 'openHistory',
      downloads: 'openDownloads',
      passwords: 'openPasswords',
      extensions: 'openExtensions',
    }
    const action = actionMap[page]
    if (action) {
      sendExtensionMessage(action)
      return
    }
  }

  // 非扩展模式：直接 window.open（仅对非 chrome:// URL 有效）
  const urls: Record<string, string> = {
    history: 'chrome://history',
    downloads: 'chrome://downloads',
    passwords: 'chrome://password-manager/passwords',
    extensions: 'chrome://extensions',
  }
  const url = urls[page]
  if (url) window.open(url, '_blank')
}

function sendExtensionMessage(action: string, extraParams: Record<string, any> = {}): Promise<any> {
  return new Promise((resolve) => {
    const requestId = Date.now().toString() + Math.random().toString(36).slice(2)
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'favshub-ext-response' && event.data?.requestId === requestId) {
        window.removeEventListener('message', handler)
        resolve(event.data.payload)
      }
    }
    window.addEventListener('message', handler)
    window.postMessage({ type: 'favshub-ext-request', action, requestId, ...extraParams }, window.location.origin)
    setTimeout(() => { window.removeEventListener('message', handler); resolve(null) }, 3000)
  })
}
</script>

<style scoped>
.floating-nav {
  position: fixed;
  right: 16px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: transparent;
  padding: 0;
  z-index: 900;
}

@media (max-width: 1024px) {
  .floating-nav {
    display: none;
  }
}

.floating-nav-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 8px 10px;
  border-radius: 12px;
  cursor: pointer;
  transition: background 0.15s;
  text-decoration: none;
}

.floating-nav-item:hover {
  background: var(--surface-hover);
}

.floating-nav-icon {
  font-size: 22px;
  line-height: 1;
}

.floating-nav-label {
  font-size: 10px;
  color: var(--text-primary);
  text-align: center;
  white-space: nowrap;
}
</style>
