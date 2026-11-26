import { request } from '@/utils/request';
import { resolveContainerByType, containerTypeFromTitle } from '@/utils/container-sync';
import { saveSnapshot, loadSnapshot } from '@/utils/sync-snapshot';
import { type SyncSnapshot } from '@/utils/storage';
import {
  isSameSyncExecutionContext,
  readSyncExecutionContext,
  syncRequestOptions,
  type SyncExecutionContext,
} from '@/utils/sync-context';
import { encodeKeySegment, type DiffResult } from '@/utils/diff-engine';
import {
  buildDownloadPreview,
  type DownloadPreview,
  type SyncServerSnapshot,
} from '@/utils/sync-preview';

export type SyncStage = 'read-token' | 'read-server' | 'read-browser' | 'compute-diff' | 'write-browser' | 'write-snapshot';

export interface SyncWriteFailure {
  operation: 'create-folder' | 'create-bookmark' | 'update-title' | 'remove-bookmark' | 'remove-folder';
  id?: string;
  message: string;
}

export interface SyncStats {
  added: number;
  updated: number;
  moved: number;
  removed: number;
  foldersAdded: number;
  foldersRemoved: number;
  isFirstSync: boolean;
  succeeded: number;
  failed: number;
  failures: SyncWriteFailure[];
  snapshotSaved: boolean;
}

export interface DownloadExecutionOptions {
  preview?: DownloadPreview;
  /** UI 预览时捕获；执行重取仍使用该上下文，并在写前复核 storage 未切换。 */
  context?: SyncExecutionContext;
}

export class SyncStageError extends Error {
  constructor(
    readonly stage: SyncStage,
    readonly code: string,
    readonly originalError?: unknown,
  ) {
    super(code);
    this.name = 'SyncStageError';
  }
}

export class SyncWriteError extends SyncStageError {
  constructor(readonly stats: SyncStats) {
    super('write-browser', 'SYNC_WRITE_PARTIAL');
    this.name = 'SyncWriteError';
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function atStage<T>(stage: SyncStage, callback: () => Promise<T>): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    if (error instanceof SyncStageError) throw error;
    throw new SyncStageError(stage, errorMessage(error), error);
  }
}

async function readLocalState() {
  return atStage('read-browser', async () => {
    const [snapshot, tree] = await Promise.all([loadSnapshot(), browser.bookmarks.getTree()]);
    return { snapshot, tree };
  });
}

async function fetchServerSnapshot(context: SyncExecutionContext) {
  return atStage('read-server', () => request<SyncServerSnapshot>('/api/sync/snapshot', syncRequestOptions(context)));
}

function collectBrowserMaps(tree: chrome.bookmarks.BookmarkTreeNode[]) {
  const folderMap = new Map<string, { browserId: string }>();
  const urlById = new Map<string, string>();
  const walk = (node: chrome.bookmarks.BookmarkTreeNode, container: string, parentPath: string) => {
    for (const child of node.children || []) {
      if (child.url) {
        urlById.set(child.id, child.url);
      } else {
        const segment = encodeKeySegment(child.title);
        const path = parentPath ? `${parentPath}/${segment}` : segment;
        folderMap.set(`${container}/${path}`, { browserId: child.id });
        walk(child, container, path);
      }
    }
  };
  for (const container of tree[0]?.children || []) {
    walk(container, containerTypeFromTitle(container.title) || 'bar', '');
  }
  return { folderMap, urlById };
}

function normalizeUrl(url: string): string {
  let normalized = (url || '').trim();
  while (normalized.length > 1 && normalized.endsWith('/') && !normalized.endsWith('://')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

function finalizeMovedStats(
  stats: SyncStats,
  diff: DiffResult,
  successfulAdds: Set<number>,
  successfulRemovals: Set<number>,
  browserUrlById: Map<string, string>,
) {
  const additionsByUrl = new Map<string, number[]>();
  diff.toAddBookmarks.forEach((action, index) => {
    if (!successfulAdds.has(index)) return;
    const url = normalizeUrl(action.serverEntry.url);
    const indexes = additionsByUrl.get(url) || [];
    indexes.push(index);
    additionsByUrl.set(url, indexes);
  });
  let moved = 0;
  diff.toRemoveBookmarks.forEach((action, index) => {
    if (!successfulRemovals.has(index)) return;
    const url = browserUrlById.get(action.browserId);
    if (!url) return;
    const addIndex = additionsByUrl.get(normalizeUrl(url))?.shift();
    if (addIndex === undefined) return;
    moved++;
  });
  stats.moved = moved;
  stats.added = successfulAdds.size - moved;
  stats.removed = successfulRemovals.size - moved;
}

async function applyDownloadDiff(preview: DownloadPreview, tree: chrome.bookmarks.BookmarkTreeNode[]): Promise<SyncStats> {
  const { diff } = preview;
  const stats: SyncStats = {
    added: 0,
    updated: 0,
    moved: 0,
    removed: 0,
    foldersAdded: 0,
    foldersRemoved: 0,
    isFirstSync: diff.isFirstSync,
    succeeded: 0,
    failed: 0,
    failures: [],
    snapshotSaved: false,
  };
  const fail = (operation: SyncWriteFailure['operation'], error: unknown, id?: string) => {
    stats.failed++;
    stats.failures.push({ operation, id, message: errorMessage(error) });
  };

  const containerMap = new Map<string, chrome.bookmarks.BookmarkTreeNode>();
  for (const container of tree[0]?.children || []) containerMap.set(container.title, container);
  const fallback = resolveContainerByType('bar', containerMap) ?? [...containerMap.values()][0];
  const { folderMap: browserFolderMap, urlById } = collectBrowserMaps(tree);
  const createdFolderIds = new Map<string, string>();
  const successfulAdds = new Set<number>();
  const successfulRemovals = new Set<number>();

  const sortedFolders = [...diff.toAddFolders].sort((a, b) => a.key.split('/').length - b.key.split('/').length);
  for (const folder of sortedFolders) {
    const containerType = folder.key.split('/')[0] || 'bar';
    const containerNode = resolveContainerByType(containerType, containerMap);
    let parentId: string | undefined;
    if (folder.parentKey && createdFolderIds.has(folder.parentKey)) {
      parentId = createdFolderIds.get(folder.parentKey);
    } else if (folder.parentKey && browserFolderMap.has(folder.parentKey)) {
      parentId = browserFolderMap.get(folder.parentKey)!.browserId;
    } else if (!folder.parentKey) {
      parentId = containerNode?.id ?? fallback?.id;
    }
    if (!parentId) {
      fail('create-folder', new Error('SYNC_BROWSER_PARENT_MISSING'), folder.key);
      continue;
    }
    try {
      const created = await browser.bookmarks.create({ parentId, title: folder.name });
      createdFolderIds.set(folder.key, created.id);
      stats.foldersAdded++;
      stats.succeeded++;
    } catch (error) {
      fail('create-folder', error, folder.key);
    }
  }

  for (const [index, action] of diff.toAddBookmarks.entries()) {
    const entry = action.serverEntry;
    const containerType = entry.container || 'bar';
    const folderKey = `${containerType}/${entry.folderPath}`;
    let parentId: string | undefined;
    if (createdFolderIds.has(folderKey)) parentId = createdFolderIds.get(folderKey);
    else if (browserFolderMap.has(folderKey)) parentId = browserFolderMap.get(folderKey)!.browserId;
    else if (!entry.folderPath) {
      parentId = resolveContainerByType(containerType, containerMap)?.id ?? fallback?.id;
    }
    if (!parentId) {
      fail('create-bookmark', new Error('SYNC_BROWSER_PARENT_MISSING'), entry.key);
      continue;
    }
    try {
      await browser.bookmarks.create({ parentId, title: entry.title, url: entry.url });
      successfulAdds.add(index);
      stats.succeeded++;
    } catch (error) {
      fail('create-bookmark', error, entry.key);
    }
  }

  for (const action of diff.toUpdateTitles) {
    try {
      await browser.bookmarks.get(action.browserId);
      await browser.bookmarks.update(action.browserId, { title: action.newTitle });
      stats.updated++;
      stats.succeeded++;
    } catch (error) {
      fail('update-title', error, action.browserId);
    }
  }

  for (const [index, action] of diff.toRemoveBookmarks.entries()) {
    try {
      await browser.bookmarks.get(action.browserId);
      await browser.bookmarks.remove(action.browserId);
      successfulRemovals.add(index);
      stats.succeeded++;
    } catch (error) {
      fail('remove-bookmark', error, action.browserId);
    }
  }

  const sortedRemoveFolders = [...diff.toRemoveFolders].sort((a, b) => b.key.split('/').length - a.key.split('/').length);
  for (const action of sortedRemoveFolders) {
    try {
      const children = await browser.bookmarks.getChildren(action.browserId);
      if (children.length) throw new Error('SYNC_BROWSER_FOLDER_NOT_EMPTY');
      await browser.bookmarks.removeTree(action.browserId);
      stats.foldersRemoved++;
      stats.succeeded++;
    } catch (error) {
      fail('remove-folder', error, action.browserId);
    }
  }

  finalizeMovedStats(stats, diff, successfulAdds, successfulRemovals, urlById);
  if (stats.failed) throw new SyncWriteError(stats);
  return stats;
}

function buildSnapshotFromTree(tree: chrome.bookmarks.BookmarkTreeNode[]): SyncSnapshot {
  const bookmarks: SyncSnapshot['bookmarks'] = [];
  const folders: SyncSnapshot['folders'] = [];
  const walk = (node: chrome.bookmarks.BookmarkTreeNode, container: string, parentPath: string) => {
    for (const child of node.children || []) {
      if (child.url) {
        bookmarks.push({ key: `${container}/${parentPath}/${child.url}`, title: child.title });
      } else {
        const segment = encodeKeySegment(child.title);
        const path = parentPath ? `${parentPath}/${segment}` : segment;
        folders.push({ key: `${container}/${path}` });
        walk(child, container, path);
      }
    }
  };
  for (const container of tree[0]?.children || []) {
    walk(container, containerTypeFromTitle(container.title) || 'bar', '');
  }
  return { bookmarks, folders, timestamp: Date.now() };
}

/** 下载执行；传入 preview 时，写浏览器前精确复核 revision、完整 diff、树和快照。 */
export async function syncFavsHubToBrowser(options: DownloadExecutionOptions = {}): Promise<SyncStats> {
  const context = options.context
    ?? await atStage('read-token', () => readSyncExecutionContext());
  const server = await fetchServerSnapshot(context);
  const local = await readLocalState();
  const current = await atStage('compute-diff', async () => buildDownloadPreview({
    revision: server.revision,
    folders: server.folders || [],
    bookmarks: server.bookmarks || [],
    snapshot: local.snapshot,
    tree: local.tree,
  }));

  if (options.context) {
    const latestContext = await atStage('read-token', () => readSyncExecutionContext());
    if (!isSameSyncExecutionContext(context, latestContext)) {
      throw new SyncStageError('compute-diff', 'SYNC_PREVIEW_STALE');
    }
  }
  if (options.preview && (current.revision !== options.preview.revision
    || current.planSignature !== options.preview.planSignature)) {
    throw new SyncStageError('compute-diff', 'SYNC_PREVIEW_STALE');
  }

  const stats = await atStage('write-browser', () => applyDownloadDiff(current, local.tree));
  const latestTree = await atStage('read-browser', () => browser.bookmarks.getTree());
  await atStage('write-snapshot', async () => {
    await saveSnapshot(buildSnapshotFromTree(latestTree));
  });
  stats.snapshotSaved = true;
  return stats;
}
