import { containerTypeFromTitle } from '@/utils/container-sync';
import {
  computeDiff,
  encodeKeySegment,
  type DiffBookmarkEntry,
  type DiffBrowserEntry,
  type DiffResult,
  type DiffSnapshotEntry,
} from '@/utils/diff-engine';
import type { FlatBookmark } from '@/utils/flatten-bookmarks';
import type { SyncSnapshot } from '@/utils/storage';

export interface SyncServerFolder {
  id: number;
  name: string;
  parent_id: number | null;
  sort_order?: number;
}

export interface SyncServerBookmark {
  id?: number;
  title: string;
  url: string;
  folder_id: number | null;
  container: string;
  sort_order?: number;
  label?: string | null;
}

export interface SyncServerSnapshot {
  revision: string;
  folders: SyncServerFolder[];
  bookmarks: SyncServerBookmark[];
  pool_protected_folder_ids: number[];
}

export interface ChangeSummary {
  added: number;
  updated: number;
  moved: number;
  deleted: number;
  foldersAdded: number;
  foldersDeleted: number;
}

export interface SyncUploadPreview {
  added: number;
  updated: number;
  deleted: number;
  foldersCreated: number;
  foldersDeleted: number;
  revision: string;
}

export interface DownloadPreview {
  revision: string;
  summary: ChangeSummary;
  isFirstSync: boolean;
  diff: DiffResult;
  /** 当前非空、已从本次删除计划剔除的文件夹数。 */
  foldersSkipped: number;
  planSignature: string;
}

export type SummaryTranslator = (key: string, count: number) => string;

const SUMMARY_KEYS = ['added', 'updated', 'moved', 'deleted', 'foldersAdded', 'foldersDeleted'] as const;

function toCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export function normalizeChangeSummary(
  summary: Partial<Record<keyof ChangeSummary, unknown>>,
): ChangeSummary {
  const normalized = {} as ChangeSummary;
  for (const key of SUMMARY_KEYS) normalized[key] = toCount(summary[key]);
  return normalized;
}

export function formatChangeSummary(summary: ChangeSummary, translate: SummaryTranslator): string {
  const value = normalizeChangeSummary(summary);
  const parts: string[] = [];
  if (value.added) parts.push(translate('added', value.added));
  if (value.updated) parts.push(translate('updated', value.updated));
  if (value.moved) parts.push(translate('moved', value.moved));
  if (value.deleted) parts.push(translate('deleted', value.deleted));
  if (value.foldersAdded) parts.push(translate('folders_added', value.foldersAdded));
  if (value.foldersDeleted) parts.push(translate('folders_deleted', value.foldersDeleted));
  return parts.length ? parts.join(' · ') : translate('none', 0);
}

function normalizeUrl(url: string): string {
  let normalized = (url || '').trim();
  while (normalized.length > 1 && normalized.endsWith('/') && !normalized.endsWith('://')) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

function createFolderPathResolver(folders: SyncServerFolder[], encoded: boolean) {
  const folderMap = new Map<number, SyncServerFolder>();
  const cache = new Map<number | null, string>();
  for (const folder of folders) folderMap.set(folder.id, folder);
  cache.set(null, '');

  return (folderId: number | null): string => {
    if (cache.has(folderId)) return cache.get(folderId)!;
    const parts: string[] = [];
    const visited = new Set<number>();
    let currentId = folderId;
    while (currentId !== null && !visited.has(currentId)) {
      visited.add(currentId);
      const folder = folderMap.get(currentId);
      if (!folder) break;
      parts.unshift(encoded ? encodeKeySegment(folder.name) : folder.name);
      currentId = folder.parent_id;
    }
    const path = parts.join('/');
    cache.set(folderId, path);
    return path;
  };
}

function summarizeDownloadDiff(diff: DiffResult, browserUrlById: Map<string, string>): ChangeSummary {
  const additionsByUrl = new Map<string, number[]>();
  diff.toAddBookmarks.forEach((action, index) => {
    const url = normalizeUrl(action.serverEntry.url);
    const indexes = additionsByUrl.get(url) || [];
    indexes.push(index);
    additionsByUrl.set(url, indexes);
  });

  let moved = 0;
  const movedAdditions = new Set<number>();
  const movedRemovals = new Set<number>();
  diff.toRemoveBookmarks.forEach((action, removeIndex) => {
    const browserUrl = browserUrlById.get(action.browserId);
    if (!browserUrl) return;
    const candidates = additionsByUrl.get(normalizeUrl(browserUrl));
    const addIndex = candidates?.shift();
    if (addIndex === undefined) return;
    moved++;
    movedAdditions.add(addIndex);
    movedRemovals.add(removeIndex);
  });

  return normalizeChangeSummary({
    added: diff.toAddBookmarks.length - movedAdditions.size,
    updated: diff.toUpdateTitles.length,
    moved,
    deleted: diff.toRemoveBookmarks.length - movedRemovals.size,
    foldersAdded: diff.toAddFolders.length,
    foldersDeleted: diff.toRemoveFolders.length,
  });
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined && typeof item !== 'function') result[key] = canonicalize(item);
    }
    return result;
  }
  return value;
}

/** 完整绑定 diff、浏览器树和快照；服务端数据由 revision 单独精确比较。 */
export function createDownloadPlanSignature(input: {
  diff: DiffResult;
  tree: chrome.bookmarks.BookmarkTreeNode[];
  snapshot: SyncSnapshot | null;
}): string {
  return JSON.stringify(canonicalize({
    diff: input.diff,
    tree: input.tree,
    snapshot: input.snapshot,
  }));
}

/** 上传确认绑定完整树与实际 PUT payload；任何浏览器变化都要求重新预览。 */
export function normalizeUploadBookmarks(bookmarks: FlatBookmark[]): FlatBookmark[] {
  return bookmarks.map(bookmark => ({ ...bookmark, url: normalizeUrl(bookmark.url) }));
}

export function createUploadPlanSignature(input: {
  tree: chrome.bookmarks.BookmarkTreeNode[];
  bookmarks: FlatBookmark[];
}): string {
  return JSON.stringify(canonicalize({ tree: input.tree, bookmarks: input.bookmarks }));
}

function pruneNonEmptyFolderRemovals(
  diff: DiffResult,
  tree: chrome.bookmarks.BookmarkTreeNode[],
): { diff: DiffResult; foldersSkipped: number } {
  const nonEmptyFolderIds = new Set<string>();
  const walk = (node: chrome.bookmarks.BookmarkTreeNode) => {
    if ((node.children || []).length > 0) nonEmptyFolderIds.add(node.id);
    for (const child of node.children || []) walk(child);
  };
  for (const node of tree) walk(node);
  const toRemoveFolders = diff.toRemoveFolders.filter(action => !nonEmptyFolderIds.has(action.browserId));
  return {
    diff: { ...diff, toRemoveFolders },
    foldersSkipped: diff.toRemoveFolders.length - toRemoveFolders.length,
  };
}

export function buildDownloadPreview(input: {
  revision?: string;
  folders: SyncServerFolder[];
  bookmarks: SyncServerBookmark[];
  snapshot: SyncSnapshot | null;
  tree: chrome.bookmarks.BookmarkTreeNode[];
}): DownloadPreview {
  const getFolderPath = createFolderPathResolver(input.folders, true);
  const folderMap = new Map<number, SyncServerFolder>();
  const subFolders = new Map<number | null, SyncServerFolder[]>();
  const bookmarksByFolder = new Map<number | null, SyncServerBookmark[]>();
  for (const folder of input.folders) {
    folderMap.set(folder.id, folder);
    const children = subFolders.get(folder.parent_id) || [];
    children.push(folder);
    subFolders.set(folder.parent_id, children);
  }
  for (const bookmark of input.bookmarks) {
    const siblings = bookmarksByFolder.get(bookmark.folder_id) || [];
    siblings.push(bookmark);
    bookmarksByFolder.set(bookmark.folder_id, siblings);
  }

  function getFolderContainer(folderId: number, visited = new Set<number>()): string {
    if (visited.has(folderId)) return 'bar';
    const nextVisited = new Set(visited).add(folderId);
    for (const bookmark of bookmarksByFolder.get(folderId) || []) {
      if (bookmark.container) return bookmark.container;
    }
    for (const child of subFolders.get(folderId) || []) {
      const container = getFolderContainer(child.id, nextVisited);
      if (container) return container;
    }
    return 'bar';
  }

  const serverMap = new Map<string, DiffBookmarkEntry>();
  for (const bookmark of input.bookmarks) {
    const container = bookmark.container || 'bar';
    const folderPath = bookmark.folder_id !== null ? getFolderPath(bookmark.folder_id) : '';
    const key = `${container}/${folderPath}/${bookmark.url}`;
    serverMap.set(key, {
      key,
      title: bookmark.title,
      url: bookmark.url,
      folderPath,
      container,
    });
  }

  const serverFolderKeys = new Set<string>();
  for (const folder of folderMap.values()) {
    serverFolderKeys.add(`${getFolderContainer(folder.id)}/${getFolderPath(folder.id)}`);
  }

  const browserMap = new Map<string, DiffBrowserEntry>();
  const browserFolderMap = new Map<string, { browserId: string }>();
  const browserUrlById = new Map<string, string>();
  function walk(node: chrome.bookmarks.BookmarkTreeNode, container: string, parentPath: string) {
    for (const child of node.children || []) {
      if (child.url) {
        const key = `${container}/${parentPath}/${child.url}`;
        browserMap.set(key, { key, title: child.title, browserId: child.id });
        browserUrlById.set(child.id, child.url);
      } else {
        const segment = encodeKeySegment(child.title);
        const folderPath = parentPath ? `${parentPath}/${segment}` : segment;
        browserFolderMap.set(`${container}/${folderPath}`, { browserId: child.id });
        walk(child, container, folderPath);
      }
    }
  }
  for (const containerNode of input.tree[0]?.children || []) {
    walk(containerNode, containerTypeFromTitle(containerNode.title) || 'bar', '');
  }

  const snapshotMap = input.snapshot
    ? new Map(input.snapshot.bookmarks.map(bookmark => [
      bookmark.key,
      { key: bookmark.key, title: bookmark.title } as DiffSnapshotEntry,
    ]))
    : null;
  const snapshotFolderMap = input.snapshot
    ? new Map(input.snapshot.folders.map(folder => [folder.key, {}]))
    : null;
  const rawDiff = computeDiff(
    serverMap,
    browserMap,
    snapshotMap,
    serverFolderKeys,
    browserFolderMap,
    snapshotFolderMap,
  );
  const { diff, foldersSkipped } = pruneNonEmptyFolderRemovals(rawDiff, input.tree);

  return {
    revision: input.revision || '',
    summary: summarizeDownloadDiff(diff, browserUrlById),
    isFirstSync: diff.isFirstSync,
    diff,
    foldersSkipped,
    planSignature: createDownloadPlanSignature({ diff, tree: input.tree, snapshot: input.snapshot }),
  };
}
