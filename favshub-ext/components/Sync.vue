<script lang="ts" setup>
import { CloudUploadOutline, CloudDownloadOutline } from '@vicons/ionicons5';
import BottomNav from '@/components/BottomNav.vue';
import PopupLayout from '@/components/PopupLayout.vue';
import PageTitle from '@/components/title.vue';
import { request } from '@/utils/request';
import { tokenStorage } from '@/utils/storage';
import { faviconWarmingStateStorage } from '@/utils/storage-session';
import { syncFavsHubToBrowser } from '@/utils/browser-sync';
import { flattenBookmarks } from '@/utils/flatten-bookmarks';

const message = useMessage();
const isSyncing = ref(false);
const syncResult = ref('');
const faviconProgress = ref('');

// ===== favicon 预加载（状态持久化到 session storage，跨 tab 共享）=====
const faviconWarming = ref(false);
const faviconWarmingProgress = ref('');
const faviconWarmingTotal = ref(0);
const faviconWarmingCurrent = ref(0);
const faviconWarmingPaused = ref(false);
const faviconWarmingStopped = ref(false);

// 挂载时恢复状态
onMounted(async () => {
  const s = await faviconWarmingStateStorage.getValue();
  if (s.running) {
    faviconWarming.value = true;
    faviconWarmingTotal.value = s.total;
    faviconWarmingCurrent.value = s.current;
    faviconWarmingPaused.value = s.paused;
    faviconWarmingProgress.value = s.progressMsg;
  }
});

// 状态变更时写入 storage
function syncState() {
  faviconWarmingStateStorage.setValue({
    running: faviconWarming.value,
    paused: faviconWarmingPaused.value,
    total: faviconWarmingTotal.value,
    current: faviconWarmingCurrent.value,
    progressMsg: faviconWarmingProgress.value,
  });
}

function pauseFaviconWarming() {
  faviconWarmingPaused.value = true;
  syncState();
}
function resumeFaviconWarming() {
  faviconWarmingPaused.value = false;
  syncState();
}
function stopFaviconWarming() {
  faviconWarmingStopped.value = true;
  faviconWarmingPaused.value = false;
}

function waitIfPaused(): Promise<boolean> {
  return new Promise(resolve => {
    const check = () => {
      if (faviconWarmingStopped.value) return resolve(true);
      if (!faviconWarmingPaused.value) return resolve(false);
      setTimeout(check, 200);
    };
    check();
  });
}

function getFaviconUrl(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`;
  } catch {
    return '';
  }
}

async function handleWarmFavicons() {
  const bookmarkTree = await chrome.bookmarks.getTree();
  const bookmarks = flattenBookmarks(bookmarkTree, getFaviconUrl);

  const seen = new Set<string>();
  const urls: string[] = [];
  for (const bm of bookmarks) {
    try {
      const hostname = new URL(bm.url).hostname;
      if (seen.has(hostname)) continue;
      seen.add(hostname);
      urls.push(bm.url);
    } catch { /* skip */ }
  }

  if (!urls.length) {
    message.warning('没有可预加载的书签');
    return;
  }

  faviconWarming.value = true;
  faviconWarmingStopped.value = false;
  faviconWarmingPaused.value = false;
  faviconWarmingTotal.value = urls.length;
  faviconWarmingCurrent.value = 0;
  faviconWarmingProgress.value = `正在预加载 ${urls.length} 个站点图标...`;
  syncState();

  const BATCH = 5;
  const LOAD_MS = 3000;

  outer:
  for (let i = 0; i < urls.length; i += BATCH) {
    if (faviconWarmingStopped.value) break;

    const batch = urls.slice(i, i + BATCH);
    faviconWarmingProgress.value = `正在预加载 ${Math.min(i + BATCH, urls.length)}/${urls.length}...`;
    syncState();

    const tabIds: number[] = [];
    for (const url of batch) {
      if (faviconWarmingStopped.value) break outer;
      // 安全检查：仅打开 http/https 页面，防止 javascript:/file: 等协议
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
      } catch { continue; }
      try {
        const tab = await chrome.tabs.create({ url, active: false });
        if (tab.id) tabIds.push(tab.id);
      } catch { /* skip */ }
    }

    const end = Date.now() + LOAD_MS;
    while (Date.now() < end) {
      if (faviconWarmingStopped.value) break outer;
      if (faviconWarmingPaused.value) {
        faviconWarmingProgress.value = `已暂停 ${faviconWarmingCurrent.value}/${faviconWarmingTotal.value}`;
        syncState();
        if (await waitIfPaused()) break outer;
        faviconWarmingProgress.value = '';
        syncState();
      }
      await new Promise(r => setTimeout(r, 200));
    }

    for (const id of tabIds) {
      try { await chrome.tabs.remove(id); } catch { /* already closed */ }
    }

    faviconWarmingCurrent.value = Math.min(i + BATCH, urls.length);
    syncState();
  }

  const finalMsg = faviconWarmingStopped.value
    ? `已停止，完成 ${faviconWarmingCurrent.value}/${faviconWarmingTotal.value}`
    : `预加载完成，共 ${faviconWarmingTotal.value} 个站点`;
  faviconWarmingProgress.value = finalMsg;
  syncState();
  setTimeout(() => {
    faviconWarmingProgress.value = '';
    faviconWarming.value = false;
    syncState();
  }, 3000);
}

// ===== 服务器 → 浏览器 =====
const isDownloading = ref(false);
const downloadResult = ref('');

async function handleDownloadToBrowser() {
  const token = await tokenStorage.getValue();
  if (!token) {
    message.error('请先在设置页登录');
    return;
  }

  isDownloading.value = true;
  downloadResult.value = '';

  try {
    const stats = await syncFavsHubToBrowser();
    const parts: string[] = [];
    if (stats.added > 0) parts.push(`新增 ${stats.added}`);
    if (stats.updated > 0) parts.push(`更新 ${stats.updated}`);
    if (stats.removed > 0) parts.push(`删除 ${stats.removed}`);
    if (parts.length === 0) {
      downloadResult.value = '书签已是最新，无需同步';
    } else if (stats.isFirstSync) {
      downloadResult.value = `首次同步完成：${parts.join('、')}（本地新增的书签已保留）`;
    } else {
      downloadResult.value = `同步完成：${parts.join('、')}`;
    }
    message.success(downloadResult.value);
  } catch (error) {
    downloadResult.value = '同步失败：' + (error instanceof Error ? error.message : '未知错误');
    message.error(downloadResult.value);
  } finally {
    isDownloading.value = false;
  }
}

// ===== 浏览器 → 服务器 =====
async function fetchExtensionFavicon(pageUrl: string): Promise<string | null> {
  try {
    const faviconUrl = new URL(chrome.runtime.getURL('/_favicon/'));
    faviconUrl.searchParams.set('pageUrl', pageUrl);
    faviconUrl.searchParams.set('size', '32');
    const resp = await fetch(faviconUrl.toString());
    if (!resp.ok) return null;
    const blob = await resp.blob();
    if (blob.size < 50) return null;
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

async function handleSync() {
  const token = await tokenStorage.getValue();
  if (!token) {
    message.error('请先在设置页登录');
    return;
  }

  isSyncing.value = true;
  syncResult.value = '';
  faviconProgress.value = '';

  try {
    const bookmarkTree = await chrome.bookmarks.getTree();
    const bookmarks = flattenBookmarks(bookmarkTree, getFaviconUrl);

    if (!bookmarks.length) {
      message.warning('未读取到可同步的浏览器书签');
      return;
    }

    const result = await request<{
      success: boolean;
      added: number;
      updated: number;
      deleted: number;
      total: number;
    }>('/api/sync/bookmarks', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookmarks }),
    });

    const parts: string[] = [];
    if (result.added > 0) parts.push(`新增 ${result.added}`);
    if (result.updated > 0) parts.push(`更新 ${result.updated}`);
    if (result.deleted > 0) parts.push(`删除 ${result.deleted}`);
    if (parts.length === 0) {
      syncResult.value = `共 ${result.total} 条书签，无需变更`;
    } else {
      syncResult.value = `已合并 ${result.total} 条书签：${parts.join('、')}`;
    }

    faviconProgress.value = '正在下载书签图标...';
    const favicons: { url: string; base64: string }[] = [];
    const urlSet = new Set<string>();

    for (let i = 0; i < bookmarks.length; i++) {
      const bm = bookmarks[i];
      const hostname = new URL(bm.url).hostname;
      if (urlSet.has(hostname)) continue;
      urlSet.add(hostname);

      const b64 = await fetchExtensionFavicon(bm.url);
      if (b64) {
        favicons.push({ url: bm.url, base64: b64 });
      }
    }

    if (favicons.length > 0) {
      faviconProgress.value = `正在上传 ${favicons.length} 个图标到服务器...`;
      await request('/api/sync/favicons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ favicons }),
      });
      syncResult.value += `，已上传 ${favicons.length} 个图标`;
    }

    message.success(syncResult.value);
  } catch (error) {
    syncResult.value = '同步失败：' + (error instanceof Error ? error.message : '未知错误');
    message.error(syncResult.value);
  } finally {
    isSyncing.value = false;
    faviconProgress.value = '';
  }
}
</script>

<template>
  <PopupLayout>
    <PageTitle title="同步数据" />

    <main class="min-h-0 flex-1 overflow-y-auto px-3 py-3">
      <div class="space-y-3">
        <section class="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 shadow-sm">
          <div class="font-semibold">温馨提示</div>
          <p class="mt-1 leading-6">同步采用增量合并策略，不会删除对方新增的数据。</p>
        </section>

        <section class="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/80">
          <div class="mb-3">
            <h2 class="text-sm font-semibold text-slate-900">浏览器书签同步到 FavsHub</h2>
            <p class="mt-1 text-xs leading-5 text-slate-500">
              增量合并浏览器书签到服务器，不会删除服务端其他来源的数据，并自动上传图标到服务器本地。
            </p>
          </div>

          <n-button type="primary" block :loading="isSyncing" @click="handleSync">
            <template #icon>
              <n-icon :component="CloudUploadOutline" />
            </template>
            开始同步（含图标上传）
          </n-button>

          <div v-if="faviconProgress" class="mt-2 text-center text-xs text-blue-500">
            {{ faviconProgress }}
          </div>
          <div v-if="syncResult" class="mt-3 text-center text-xs text-slate-500">
            {{ syncResult }}
          </div>
        </section>

        <section class="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/80">
          <div class="mb-3">
            <h2 class="text-sm font-semibold text-slate-900">服务器书签拉取到浏览器</h2>
            <p class="mt-1 text-xs leading-5 text-slate-500">
              增量合并服务器书签到浏览器书签栏，不会删除本地新增的书签。首次同步仅添加缺失的书签。
            </p>
          </div>

          <n-button type="info" block :loading="isDownloading" @click="handleDownloadToBrowser">
            <template #icon>
              <n-icon :component="CloudDownloadOutline" />
            </template>
            拉取到浏览器书签栏
          </n-button>

          <div v-if="downloadResult" class="mt-3 text-center text-xs text-slate-500">
            {{ downloadResult }}
          </div>
        </section>

        <section class="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/80">
          <div class="mb-3">
            <h2 class="text-sm font-semibold text-slate-900">预加载书签图标</h2>
            <p class="mt-1 text-xs leading-5 text-slate-500">
              后台打开各站点页面让 Chrome 自动获取并缓存 favicon，完成后书签栏将显示网站图标。
            </p>
          </div>

          <n-button
            v-if="!faviconWarming"
            type="warning" block @click="handleWarmFavicons"
          >
            开始预加载图标
          </n-button>

          <template v-else>
            <n-progress
              type="line"
              :percentage="faviconWarmingTotal ? Math.round(faviconWarmingCurrent / faviconWarmingTotal * 100) : 0"
              :show-indicator="true"
              status="info"
            />
            <div class="mt-2 flex items-center justify-center gap-2">
              <n-button
                v-if="!faviconWarmingPaused"
                size="tiny" secondary @click="pauseFaviconWarming"
              >
                ⏸ 暂停
              </n-button>
              <n-button
                v-else
                size="tiny" type="primary" secondary @click="resumeFaviconWarming"
              >
                ▶ 继续
              </n-button>
              <n-button size="tiny" type="error" secondary @click="stopFaviconWarming">
                ⏹ 停止
              </n-button>
            </div>
          </template>

          <div v-if="faviconWarmingProgress" class="mt-2 text-center text-xs text-blue-500">
            {{ faviconWarmingProgress }}
          </div>
        </section>
      </div>
    </main>

    <BottomNav class="shrink-0" />
  </PopupLayout>
</template>
