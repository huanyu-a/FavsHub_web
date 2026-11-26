<script lang="ts" setup>
import { CloudUploadOutline, CloudDownloadOutline, SyncOutline } from '@vicons/ionicons5';
import { storage } from '#imports';
import BottomNav from '@/components/BottomNav.vue';
import PopupLayout from '@/components/PopupLayout.vue';
import PageTitle from '@/components/title.vue';
import { request } from '@/utils/request';
import { faviconWarmingStateStorage } from '@/utils/storage-session';
import {
  isSameSyncExecutionContext,
  readSyncExecutionContext,
  syncRequestOptions,
  type SyncExecutionContext,
} from '@/utils/sync-context';
import {
  syncFavsHubToBrowser,
  SyncStageError,
  SyncWriteError,
  type SyncStage,
  type SyncStats,
} from '@/utils/browser-sync';
import { loadSnapshot } from '@/utils/sync-snapshot';
import { flattenBookmarks, type FlatBookmark } from '@/utils/flatten-bookmarks';
import {
  buildDownloadPreview,
  createUploadPlanSignature,
  formatChangeSummary,
  normalizeChangeSummary,
  normalizeUploadBookmarks,
  type ChangeSummary,
  type DownloadPreview,
  type SyncServerSnapshot,
  type SyncUploadPreview,
} from '@/utils/sync-preview';
import {
  loadSyncActivity,
  recordSyncSuccess,
  type SyncDirection,
  type SyncHistoryEntry,
} from '@/utils/sync-history';
import {
  consumeSyncOperation,
  createSyncOperation,
  SyncMutexError,
  withSyncOperationLock,
  type SyncOperation,
} from '@/utils/sync-mutex';
import { t } from '@/i18n';

const syncHistoryStorage = storage.defineItem<SyncHistoryEntry[]>('local:SYNC_HISTORY', { fallback: [] });
const message = useMessage();
const dialog = useDialog();
const isSyncing = ref(false);
const syncResult = ref('');
const faviconProgress = ref('');
const syncHistory = ref<SyncHistoryEntry[]>([]);
const lastSyncAt = ref(0);
const lastSyncText = computed(() => lastSyncAt.value
  ? formatHistoryTime(lastSyncAt.value)
  : t('ui.sync.no_history_time'));

function formatHistoryTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

function formatSummary(summary: ChangeSummary): string {
  return formatChangeSummary(summary, (key, count) => t(`ui.sync.summary_${key}`, { n: count }));
}

function formatHistorySummary(entry: SyncHistoryEntry): string {
  const summary = formatSummary(entry.summary);
  return entry.iconsUploaded > 0
    ? `${summary} · ${t('ui.sync.history_icons', { n: entry.iconsUploaded })}`
    : summary;
}

async function refreshSyncActivity() {
  const activity = await loadSyncActivity(syncHistoryStorage);
  syncHistory.value = activity.history;
  lastSyncAt.value = activity.lastSyncAt;
}

async function saveSyncActivity(direction: SyncDirection, summary: ChangeSummary, iconsUploaded = 0) {
  const activity = await recordSyncSuccess(syncHistoryStorage, direction, summary, iconsUploaded);
  syncHistory.value = activity.history;
  lastSyncAt.value = activity.lastSyncAt;
}

type UiSyncStage = SyncStage | 'upload-bookmarks';

function errorReason(error: unknown): string {
  const messageText = error instanceof Error ? error.message : String(error);
  if (messageText === 'SYNC_PREVIEW_STALE') return t('ui.sync.preview_stale');
  if (messageText.includes('409')) return t('ui.sync.revision_conflict');
  return messageText || t('ui.sync.unknown_error');
}

function statsSummary(stats: SyncStats): ChangeSummary {
  return normalizeChangeSummary({
    added: stats.added,
    updated: stats.updated,
    moved: stats.moved,
    deleted: stats.removed,
    foldersAdded: stats.foldersAdded,
    foldersDeleted: stats.foldersRemoved,
  });
}

function showStageError(direction: SyncDirection, fallbackStage: UiSyncStage, error: unknown) {
  if (error instanceof SyncWriteError) {
    const result = t('ui.sync.write_partial', {
      stats: formatSummary(statsSummary(error.stats)),
      failed: error.stats.failed,
    });
    if (direction === 'upload') syncResult.value = result;
    else downloadResult.value = result;
    message.error(result);
    return;
  }
  const stage = error instanceof SyncStageError ? error.stage : fallbackStage;
  const result = t(`ui.sync.stage_${stage}`, { reason: errorReason(error) });
  if (direction === 'upload') syncResult.value = result;
  else downloadResult.value = result;
  message.error(result);
}

function showOperationError(direction: SyncDirection, error: unknown) {
  if (error instanceof SyncMutexError) {
    message.warning(t(`ui.sync.${error.code === 'SYNC_BUSY' ? 'busy' : 'lock_unavailable'}`));
    return;
  }
  showStageError(direction, direction === 'upload' ? 'upload-bookmarks' : 'read-server', error);
}

async function atUiStage<T>(stage: UiSyncStage, callback: () => Promise<T>): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    if (error instanceof SyncStageError) throw error;
    throw new SyncStageError(stage as SyncStage, errorReason(error), error);
  }
}

async function captureExecutionContext(): Promise<SyncExecutionContext | null> {
  const context = await atUiStage('read-token', () => readSyncExecutionContext());
  if (context.token) return context;
  message.error(t('ui.sync.login_required'));
  return null;
}

function showSyncPreview(
  direction: SyncDirection,
  summary: ChangeSummary,
  operation: SyncOperation,
  foldersSkipped = 0,
): Promise<boolean> {
  const deletes = summary.deleted + summary.foldersDeleted;
  return new Promise((resolve) => {
    let settled = false;
    const settle = (confirmed: boolean) => {
      if (settled) return;
      settled = true;
      resolve(confirmed);
    };
    const content = deletes > 0
      ? t('ui.sync.preview_with_delete', {
        summary: formatSummary(summary),
        target: t(direction === 'upload' ? 'ui.sync.target_server' : 'ui.sync.target_browser'),
        bookmarks: summary.deleted,
        folders: summary.foldersDeleted,
      })
      : t('ui.sync.preview_without_delete', { summary: formatSummary(summary) });
    const skippedNote = foldersSkipped > 0 ? `\n${t('ui.sync.folders_skipped', { n: foldersSkipped })}` : '';
    dialog[deletes > 0 ? 'warning' : 'info']({
      title: t(direction === 'upload' ? 'ui.sync.upload_preview_title' : 'ui.sync.download_preview_title'),
      content: `${content}${skippedNote}`,
      positiveText: t(deletes > 0 ? 'ui.sync.confirm_delete' : 'ui.sync.confirm_execute'),
      negativeText: t('ui.sync.cancel'),
      onPositiveClick: () => {
        if (!consumeSyncOperation(operation)) return false;
        settle(true);
        return true;
      },
      onNegativeClick: () => settle(false),
      onClose: () => settle(false),
      onEsc: () => settle(false),
    });
  });
}

function showHistoryWriteError(direction: SyncDirection, error: unknown) {
  const suffix = t('ui.sync.history_save_failed', { reason: errorReason(error) });
  if (direction === 'upload') syncResult.value += suffix;
  else downloadResult.value += suffix;
  message.warning(t('ui.sync.history_save_warning'));
}

// ===== favicon 预加载（状态持久化到 session storage，跨 tab 共享）=====
const faviconWarming = ref(false);
const faviconWarmingProgress = ref('');
const faviconWarmingTotal = ref(0);
const faviconWarmingCurrent = ref(0);
const faviconWarmingPaused = ref(false);
const faviconWarmingStopped = ref(false);

// 挂载时恢复状态
onMounted(async () => {
  try {
    await refreshSyncActivity();
  } catch (error) {
    message.warning(t('ui.sync.history_load_failed', { reason: errorReason(error) }));
  }
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

async function executeDownload(preview: DownloadPreview, context: SyncExecutionContext) {
  const stats = await syncFavsHubToBrowser({ preview, context });
  const actualSummary = statsSummary(stats);
  const formatted = formatSummary(actualSummary);
  const hasChanges = Object.values(actualSummary).some(count => count > 0);
  if (!hasChanges) {
    downloadResult.value = t('ui.sync.download_up_to_date');
  } else if (stats.isFirstSync) {
    downloadResult.value = t('ui.sync.download_first_done', { stats: formatted });
  } else {
    downloadResult.value = t('ui.sync.download_done', { stats: formatted });
  }
  if (preview.foldersSkipped > 0) {
    downloadResult.value += ` · ${t('ui.sync.folders_skipped', { n: preview.foldersSkipped })}`;
  }

  try {
    await saveSyncActivity('download', actualSummary);
  } catch (error) {
    showHistoryWriteError('download', error);
    return;
  }
  message.success(downloadResult.value);
}

async function handleDownloadToBrowser() {
  if (isSyncing.value || isDownloading.value) {
    message.warning(t('ui.sync.busy'));
    return;
  }
  const operation = createSyncOperation('download');
  isDownloading.value = true;
  downloadResult.value = '';
  try {
    await withSyncOperationLock(operation, async () => {
      const context = await captureExecutionContext();
      if (!context) return;
      const server = await atUiStage('read-server', () => request<SyncServerSnapshot>(
        '/api/sync/snapshot', syncRequestOptions(context),
      ));
      const local = await atUiStage('read-browser', async () => {
        const [snapshot, tree] = await Promise.all([loadSnapshot(), chrome.bookmarks.getTree()]);
        return { snapshot, tree };
      });
      const preview = await atUiStage('compute-diff', async () => buildDownloadPreview({
        revision: server.revision,
        folders: server.folders || [],
        bookmarks: server.bookmarks || [],
        snapshot: local.snapshot,
        tree: local.tree,
      }));
      if (!await showSyncPreview('download', preview.summary, operation, preview.foldersSkipped)) return;
      await executeDownload(preview, context);
    });
  } catch (error) {
    showOperationError('download', error);
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
  if (isSyncing.value || isDownloading.value) {
    message.warning(t('ui.sync.busy'));
    return;
  }
  const operation = createSyncOperation('upload');
  isSyncing.value = true;
  syncResult.value = '';
  faviconProgress.value = '';
  try {
    await withSyncOperationLock(operation, async () => {
      const context = await captureExecutionContext();
      if (!context) return;
      const initial = await atUiStage('read-browser', async () => {
        const tree = await chrome.bookmarks.getTree();
        // 图标仍统一走 base64 上传，不污染书签 icon 字段。
        const bookmarks = normalizeUploadBookmarks(flattenBookmarks(tree, () => ''));
        return { tree, bookmarks };
      });
      if (!initial.bookmarks.length) {
        message.warning(t('ui.sync.no_browser_bookmarks'));
        return;
      }
      const planSignature = createUploadPlanSignature(initial);
      const preview = await atUiStage('read-server', () => request<SyncUploadPreview>('/api/sync/upload-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookmarks: initial.bookmarks }),
        ...syncRequestOptions(context),
      }));
      const summary = normalizeChangeSummary({
        added: preview.added,
        updated: preview.updated,
        deleted: preview.deleted,
        foldersAdded: preview.foldersCreated,
        foldersDeleted: preview.foldersDeleted,
      });
      if (!await showSyncPreview('upload', summary, operation)) return;

      const [current, latestContext] = await Promise.all([
        atUiStage('read-browser', async () => {
          const tree = await chrome.bookmarks.getTree();
          const bookmarks = normalizeUploadBookmarks(flattenBookmarks(tree, () => ''));
          return { tree, bookmarks };
        }),
        atUiStage('read-token', () => readSyncExecutionContext()),
      ]);
      if (!isSameSyncExecutionContext(context, latestContext)
        || createUploadPlanSignature(current) !== planSignature) {
        throw new SyncStageError('compute-diff', 'SYNC_PREVIEW_STALE');
      }
      // 只执行初次确认的原 payload；current 仅用于完整性复核。
      await executeUpload(initial.bookmarks, preview.revision, context);
    });
  } catch (error) {
    showOperationError('upload', error);
  } finally {
    isSyncing.value = false;
    faviconProgress.value = '';
  }
}

async function executeUpload(
  bookmarks: FlatBookmark[],
  revision: string,
  context: SyncExecutionContext,
) {
  const result = await atUiStage('upload-bookmarks', () => request<{
    success: boolean;
    added: number;
    updated: number;
    deleted: number;
    foldersCreated: number;
    foldersDeleted: number;
    total: number;
    revision: string;
  }>('/api/sync/bookmarks', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookmarks, expected_revision: revision }),
    ...syncRequestOptions(context),
  }));

  const actualSummary = normalizeChangeSummary({
    added: result.added,
    updated: result.updated,
    deleted: result.deleted,
    foldersAdded: result.foldersCreated,
    foldersDeleted: result.foldersDeleted,
  });
  const hasChanges = Object.values(actualSummary).some(count => count > 0);
  syncResult.value = hasChanges
    ? t('ui.sync.upload_done', { n: result.total, stats: formatSummary(actualSummary) })
    : t('ui.sync.upload_no_changes', { n: result.total });

  // 图标阶段独立容错：书签已同步成功，图标失败不应覆盖成功结果
  let uploadedFavicons = 0;
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
        // 分片上传：服务端要为每个域名远程下载一次图标，整批上传会顶到 request.ts 的 90s 超时；
        // 分片既避开超时，单片失败也只损失该片而非全部图标。
        // 取 15 是因为服务端单次远程下载最长 5s（AbortSignal.timeout），
        // 即使服务端仍是旧的串行实现，15×5s=75s 也在 90s 之内。
        const UPLOAD_CHUNK = 15;
        let uploaded = 0;
        let failedChunks = 0;
        let firstError = '';

        faviconProgress.value = t('ui.sync.favicon_uploading', { n: favicons.length });

        for (let i = 0; i < favicons.length; i += UPLOAD_CHUNK) {
          const chunk = favicons.slice(i, i + UPLOAD_CHUNK);
          if (i > 0) {
            faviconProgress.value = t('ui.sync.favicon_uploading_progress', {
              current: Math.min(i, favicons.length),
              total: favicons.length,
            });
          }
          try {
            const res = await request<{ count?: number }>('/api/sync/favicons', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ favicons: chunk }),
              ...syncRequestOptions(context),
            });
            // 服务端按域名去重并跳过无效图标，以其返回的实际落盘数为准
            uploaded += res?.count ?? chunk.length;
          } catch (chunkError) {
            failedChunks++;
            if (!firstError) {
              firstError = chunkError instanceof Error ? chunkError.message : t('ui.sync.unknown_error');
            }
          }
        }

        if (uploaded > 0) {
          uploadedFavicons = uploaded;
          syncResult.value += t('ui.sync.favicon_uploaded_suffix', { n: uploaded });
        }
        if (failedChunks > 0) {
          syncResult.value += t('ui.sync.icon_upload_partial_failed', {
            chunks: failedChunks,
            reason: firstError,
          });
        }
      }
  } catch (iconError) {
    syncResult.value += t('ui.sync.icon_upload_failed', { reason: iconError instanceof Error ? iconError.message : t('ui.sync.unknown_error') });
  }

  try {
    await saveSyncActivity('upload', actualSummary, uploadedFavicons);
  } catch (error) {
    showHistoryWriteError('upload', error);
    return;
  }
  message.success(syncResult.value);
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

        <section class="fh-surface-card p-4">
          <div class="mb-3 flex items-start gap-2.5">
            <span class="fh-icon-badge" aria-hidden="true">
              <n-icon :component="CloudUploadOutline" size="16" />
            </span>
            <div>
              <h2 class="text-sm font-semibold text-stone-900">{{ t('ui.sync.upload_section') }}</h2>
              <p class="mt-1 text-xs leading-5 text-stone-500">
                {{ t('ui.sync.upload_desc') }}
              </p>
            </div>
          </div>

          <n-button type="primary" block :loading="isSyncing" @click="handleSync">
            <template #icon>
              <n-icon :component="CloudUploadOutline" />
            </template>
            {{ t('ui.sync.upload_button') }}
          </n-button>

          <div v-if="faviconProgress" class="mt-2 text-center text-xs text-emerald-700">
            {{ faviconProgress }}
          </div>
          <div v-if="syncResult" class="mt-3 text-center text-xs text-stone-500">
            {{ syncResult }}
          </div>
        </section>

        <section class="fh-surface-card p-4">
          <div class="mb-3 flex items-start gap-2.5">
            <span class="fh-icon-badge" aria-hidden="true">
              <n-icon :component="CloudDownloadOutline" size="16" />
            </span>
            <div>
              <h2 class="text-sm font-semibold text-stone-900">{{ t('ui.sync.download_section') }}</h2>
              <p class="mt-1 text-xs leading-5 text-stone-500">
                {{ t('ui.sync.download_desc') }}
              </p>
            </div>
          </div>

          <n-button type="primary" secondary block :loading="isDownloading" @click="handleDownloadToBrowser">
            <template #icon>
              <n-icon :component="CloudDownloadOutline" />
            </template>
            {{ t('ui.sync.download_button') }}
          </n-button>

          <div v-if="downloadResult" class="mt-3 text-center text-xs text-stone-500">
            {{ downloadResult }}
          </div>
        </section>

        <section class="fh-surface-card p-4">
          <div class="mb-3">
            <h2 class="text-sm font-semibold text-stone-900">{{ t('ui.sync.history_title') }}</h2>
            <p class="mt-1 text-xs leading-5 text-stone-500">{{ t('ui.sync.last_sync_at', { time: lastSyncText }) }}</p>
          </div>
          <div v-if="syncHistory.length" class="space-y-2">
            <div
              v-for="(entry, index) in syncHistory"
              :key="`${entry.direction}-${entry.timestamp}-${index}`"
              class="rounded-xl bg-stone-50 px-3 py-2 text-xs text-stone-600"
            >
              <div class="flex items-center justify-between gap-2">
                <span class="font-medium text-stone-800">{{ t(entry.direction === 'upload' ? 'ui.sync.history_upload' : 'ui.sync.history_download') }}</span>
                <time class="shrink-0 text-stone-400">{{ formatHistoryTime(entry.timestamp) }}</time>
              </div>
              <p class="mt-1 leading-5">{{ formatHistorySummary(entry) }}</p>
            </div>
          </div>
          <p v-else class="text-xs text-stone-400">{{ t('ui.sync.history_empty') }}</p>
        </section>

        <section class="fh-surface-card p-4">
          <div class="mb-3 flex items-start gap-2.5">
            <span class="fh-icon-badge" aria-hidden="true">
              <n-icon :component="SyncOutline" size="16" />
            </span>
            <div>
              <h2 class="text-sm font-semibold text-stone-900">{{ t('ui.sync.warm_section') }}</h2>
              <p class="mt-1 text-xs leading-5 text-stone-500">
                {{ t('ui.sync.warm_desc') }}
              </p>
            </div>
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

          <div v-if="faviconWarmingProgress" class="mt-2 text-center text-xs text-emerald-700">
            {{ faviconWarmingProgress }}
          </div>
        </section>
      </div>
    </main>

    <BottomNav class="shrink-0" />
  </PopupLayout>
</template>
