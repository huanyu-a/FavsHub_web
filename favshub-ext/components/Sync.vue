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
import { t } from '@/i18n';

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
  // 幽灵状态检测：running 但心跳超过 15 秒未更新，说明预热循环已随弹窗关闭而中断
  const stale = s.running && Date.now() - (s.beat || 0) > 15_000;
  if (s.running && stale) {
    faviconWarming.value = false;
    faviconWarmingProgress.value = '';
    await faviconWarmingStateStorage.setValue({
      running: false, paused: false, total: 0, current: 0, progressMsg: '', beat: Date.now(),
    });
    return;
  }
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
    beat: Date.now(),
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
    message.warning(t('ui.sync.no_bookmarks_to_warm'));
    return;
  }

  faviconWarming.value = true;
  faviconWarmingStopped.value = false;
  faviconWarmingPaused.value = false;
  faviconWarmingTotal.value = urls.length;
  faviconWarmingCurrent.value = 0;
  faviconWarmingProgress.value = t('ui.sync.warming_start', { n: urls.length });
  syncState();

  const BATCH = 5;
  const LOAD_MS = 3000;

  outer:
  for (let i = 0; i < urls.length; i += BATCH) {
    if (faviconWarmingStopped.value) break;

    const batch = urls.slice(i, i + BATCH);
    faviconWarmingProgress.value = t('ui.sync.warming_progress', { current: Math.min(i + BATCH, urls.length), total: urls.length });
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
        faviconWarmingProgress.value = t('ui.sync.warming_paused', { current: faviconWarmingCurrent.value, total: faviconWarmingTotal.value });
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
    ? t('ui.sync.warming_stopped', { current: faviconWarmingCurrent.value, total: faviconWarmingTotal.value })
    : t('ui.sync.warming_done', { n: faviconWarmingTotal.value });
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
    message.error(t('ui.sync.login_required'));
    return;
  }

  isDownloading.value = true;
  downloadResult.value = '';

  try {
    const stats = await syncFavsHubToBrowser();
    const parts: string[] = [];
    if (stats.added > 0) parts.push(t('ui.sync.stats_added', { n: stats.added }));
    if (stats.updated > 0) parts.push(t('ui.sync.stats_updated', { n: stats.updated }));
    if (stats.removed > 0) parts.push(t('ui.sync.stats_removed', { n: stats.removed }));
    if (parts.length === 0) {
      downloadResult.value = t('ui.sync.download_up_to_date');
    } else if (stats.isFirstSync) {
      downloadResult.value = t('ui.sync.download_first_done', { stats: parts.join(t('ui.sync.separator')) });
    } else {
      downloadResult.value = t('ui.sync.download_done', { stats: parts.join(t('ui.sync.separator')) });
    }
    message.success(downloadResult.value);
  } catch (error) {
    downloadResult.value = t('ui.sync.failed', { reason: error instanceof Error ? error.message : t('ui.sync.unknown_error') });
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
    message.error(t('ui.sync.login_required'));
    return;
  }

  isSyncing.value = true;
  syncResult.value = '';
  faviconProgress.value = '';

  try {
    const bookmarkTree = await chrome.bookmarks.getTree();
    // icon 字段不随同步上传（避免 Google URL 污染服务端书签表），
    // 图标统一走下方的 base64 上传路径
    const bookmarks = flattenBookmarks(bookmarkTree, () => '');

    if (!bookmarks.length) {
      message.warning(t('ui.sync.no_browser_bookmarks'));
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
    if (result.added > 0) parts.push(t('ui.sync.stats_added', { n: result.added }));
    if (result.updated > 0) parts.push(t('ui.sync.stats_updated', { n: result.updated }));
    if (result.deleted > 0) parts.push(t('ui.sync.stats_removed', { n: result.deleted }));
    if (parts.length === 0) {
      syncResult.value = t('ui.sync.upload_no_changes', { n: result.total });
    } else {
      syncResult.value = t('ui.sync.upload_done', { n: result.total, stats: parts.join(t('ui.sync.separator')) });
    }

    // 图标阶段独立容错：书签已同步成功，图标失败不应覆盖成功结果
    try {
      const favicons: { url: string; base64: string }[] = [];
      // 去重 + 跳过非法 URL（单个坏数据不应中断整个同步）
      const hostSeen = new Set<string>();
      const uniqueBookmarks = bookmarks.filter((bm) => {
        try {
          const hostname = new URL(bm.url).hostname;
          if (hostSeen.has(hostname)) return false;
          hostSeen.add(hostname);
          return true;
        } catch {
          return false;
        }
      });

      // 并发下载图标（批 6），带进度提示
      const CONCURRENCY = 6;
      for (let i = 0; i < uniqueBookmarks.length; i += CONCURRENCY) {
        const batch = uniqueBookmarks.slice(i, i + CONCURRENCY);
        faviconProgress.value = t('ui.sync.favicon_download_progress', { current: Math.min(i + CONCURRENCY, uniqueBookmarks.length), total: uniqueBookmarks.length });
        const results = await Promise.all(batch.map((bm) => fetchExtensionFavicon(bm.url)));
        results.forEach((b64, idx) => {
          if (b64) favicons.push({ url: batch[idx].url, base64: b64 });
        });
      }

      if (favicons.length > 0) {
        faviconProgress.value = t('ui.sync.favicon_uploading', { n: favicons.length });
        await request('/api/sync/favicons', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ favicons }),
        });
        syncResult.value += t('ui.sync.favicon_uploaded_suffix', { n: favicons.length });
      }
    } catch (iconError) {
      syncResult.value += t('ui.sync.icon_upload_failed', { reason: iconError instanceof Error ? iconError.message : t('ui.sync.unknown_error') });
    }

    message.success(syncResult.value);
  } catch (error) {
    syncResult.value = t('ui.sync.failed', { reason: error instanceof Error ? error.message : t('ui.sync.unknown_error') });
    message.error(syncResult.value);
  } finally {
    isSyncing.value = false;
    faviconProgress.value = '';
  }
}
</script>

<template>
  <PopupLayout>
    <PageTitle :title="t('ui.sync.title')" />

    <main class="min-h-0 flex-1 overflow-y-auto px-3 py-3">
      <div class="space-y-3">
        <section class="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 shadow-sm">
          <div class="font-semibold">{{ t('ui.sync.notice_title') }}</div>
          <p class="mt-1 leading-6">{{ t('ui.sync.notice_desc') }}</p>
        </section>

        <section class="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/80">
          <div class="mb-3">
            <h2 class="text-sm font-semibold text-slate-900">{{ t('ui.sync.upload_section') }}</h2>
            <p class="mt-1 text-xs leading-5 text-slate-500">
              {{ t('ui.sync.upload_desc') }}
            </p>
          </div>

          <n-button type="primary" block :loading="isSyncing" @click="handleSync">
            <template #icon>
              <n-icon :component="CloudUploadOutline" />
            </template>
            {{ t('ui.sync.upload_button') }}
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
            <h2 class="text-sm font-semibold text-slate-900">{{ t('ui.sync.download_section') }}</h2>
            <p class="mt-1 text-xs leading-5 text-slate-500">
              {{ t('ui.sync.download_desc') }}
            </p>
          </div>

          <n-button type="info" block :loading="isDownloading" @click="handleDownloadToBrowser">
            <template #icon>
              <n-icon :component="CloudDownloadOutline" />
            </template>
            {{ t('ui.sync.download_button') }}
          </n-button>

          <div v-if="downloadResult" class="mt-3 text-center text-xs text-slate-500">
            {{ downloadResult }}
          </div>
        </section>

        <section class="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200/80">
          <div class="mb-3">
            <h2 class="text-sm font-semibold text-slate-900">{{ t('ui.sync.warm_section') }}</h2>
            <p class="mt-1 text-xs leading-5 text-slate-500">
              {{ t('ui.sync.warm_desc') }}
            </p>
          </div>

          <n-button
            v-if="!faviconWarming"
            type="warning" block @click="handleWarmFavicons"
          >
            {{ t('ui.sync.warm_button') }}
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
                {{ t('ui.sync.pause') }}
              </n-button>
              <n-button
                v-else
                size="tiny" type="primary" secondary @click="resumeFaviconWarming"
              >
                {{ t('ui.sync.resume') }}
              </n-button>
              <n-button size="tiny" type="error" secondary @click="stopFaviconWarming">
                {{ t('ui.sync.stop') }}
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
