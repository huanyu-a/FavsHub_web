/**
 * 书签 Diff 引擎 - 纯函数，无副作用
 *
 * 支持两种模式：
 * - 首次同步（无快照）：仅添加服务端有而浏览器没有的，不删除
 * - 后续同步（有快照）：三次 diff，精确计算新增/更新/删除
 */

export interface DiffBookmarkEntry {
  key: string;
  title: string;
  url: string;
  folderPath: string;
  container: string;
}

export interface DiffBrowserEntry {
  key: string;
  title: string;
  browserId: string;
}

export interface DiffSnapshotEntry {
  key: string;
  title: string;
}

export interface AddBookmarkAction {
  serverEntry: DiffBookmarkEntry;
}

export interface RemoveBrowserAction {
  browserId: string;
  key: string;
}

export interface UpdateTitleAction {
  browserId: string;
  key: string;
  newTitle: string;
}

export interface AddFolderAction {
  key: string;
  name: string;
  parentKey: string | null;
}

export interface RemoveFolderAction {
  browserId: string;
  key: string;
}

export interface DiffResult {
  toAddBookmarks: AddBookmarkAction[];
  toRemoveBookmarks: RemoveBrowserAction[];
  toUpdateTitles: UpdateTitleAction[];
  toAddFolders: AddFolderAction[];
  toRemoveFolders: RemoveFolderAction[];
  isFirstSync: boolean;
}

/**
 * key 段转义：文件夹名中的 '/' 会与 key 分隔符歧义（"a/b" 与嵌套 "a→b" 同 key）。
 * 仅转义 '/' 与 '%'，不含这些字符的名称 key 保持不变（存量快照兼容）。
 */
export function encodeKeySegment(segment: string): string {
  return segment.replace(/%/g, '%25').replace(/\//g, '%2F');
}

export function decodeKeySegment(segment: string): string {
  return segment.replace(/%2F/gi, '/').replace(/%25/g, '%');
}

/**
 * 计算服务端书签与浏览器书签之间的差异
 *
 * @param serverMap - 服务端书签 Map (key → DiffBookmarkEntry)
 * @param browserMap - 浏览器书签 Map (key → DiffBrowserEntry)
 * @param snapshotMap - 上次同步快照 Map (key → DiffSnapshotEntry)，null 表示首次同步
 * @param serverFolderKeys - 服务端文件夹 key 集合
 * @param browserFolderMap - 浏览器文件夹 Map (key → { browserId })
 * @param snapshotFolderMap - 快照文件夹 Map (key → {})，null 表示首次
 */
export function computeDiff(
  serverMap: Map<string, DiffBookmarkEntry>,
  browserMap: Map<string, DiffBrowserEntry>,
  snapshotMap: Map<string, DiffSnapshotEntry> | null,
  serverFolderKeys: Set<string>,
  browserFolderMap: Map<string, { browserId: string }>,
  snapshotFolderMap: Map<string, object> | null,
): DiffResult {
  const isFirstSync = snapshotMap === null;

  const toAddBookmarks: AddBookmarkAction[] = [];
  const toRemoveBookmarks: RemoveBrowserAction[] = [];
  const toUpdateTitles: UpdateTitleAction[] = [];
  const toAddFolders: AddFolderAction[] = [];
  const toRemoveFolders: RemoveFolderAction[] = [];

  if (isFirstSync) {
    // ===== 首次同步：仅添加，不删除 =====
    for (const [key, entry] of serverMap) {
      if (!browserMap.has(key)) {
        toAddBookmarks.push({ serverEntry: entry });
      } else {
        // 已存在，检查 title 是否不同
        const browserEntry = browserMap.get(key)!;
        if (browserEntry.title !== entry.title) {
          toUpdateTitles.push({ browserId: browserEntry.browserId, key, newTitle: entry.title });
        }
      }
    }

    // 文件夹：添加服务端有而浏览器没有的
    for (const key of serverFolderKeys) {
      if (!browserFolderMap.has(key)) {
        const parts = key.split('/');
        const name = decodeKeySegment(parts[parts.length - 1]);
        const parentKey = parts.length > 2 ? parts.slice(0, -1).join('/') : null;
        toAddFolders.push({ key, name, parentKey });
      }
    }
  } else {
    // ===== 后续同步：三次 diff =====

    // 新增 = 服务端有、快照没有
    for (const [key, entry] of serverMap) {
      if (!snapshotMap!.has(key)) {
        if (!browserMap.has(key)) {
          toAddBookmarks.push({ serverEntry: entry });
        }
      }
    }

    // 删除 = 快照有、服务端没有
    for (const [key, snapEntry] of snapshotMap!) {
      if (!serverMap.has(key)) {
        const browserEntry = browserMap.get(key);
        if (browserEntry) {
          toRemoveBookmarks.push({ browserId: browserEntry.browserId, key });
        }
      }
    }

    // 更新 = 服务端和快照都有，但 title 变了
    for (const [key, entry] of serverMap) {
      const snapEntry = snapshotMap!.get(key);
      if (snapEntry && snapEntry.title !== entry.title) {
        const browserEntry = browserMap.get(key);
        if (browserEntry && browserEntry.title !== entry.title) {
          toUpdateTitles.push({ browserId: browserEntry.browserId, key, newTitle: entry.title });
        }
      }
    }

    // 文件夹 diff
    for (const key of serverFolderKeys) {
      if (!snapshotFolderMap!.has(key) && !browserFolderMap.has(key)) {
        const parts = key.split('/');
        const name = decodeKeySegment(parts[parts.length - 1]);
        const parentKey = parts.length > 2 ? parts.slice(0, -1).join('/') : null;
        toAddFolders.push({ key, name, parentKey });
      }
    }

    for (const [key] of snapshotFolderMap!) {
      if (!serverFolderKeys.has(key)) {
        const browserFolder = browserFolderMap.get(key);
        if (browserFolder) {
          toRemoveFolders.push({ browserId: browserFolder.browserId, key });
        }
      }
    }
  }

  return {
    toAddBookmarks,
    toRemoveBookmarks,
    toUpdateTitles,
    toAddFolders,
    toRemoveFolders,
    isFirstSync,
  };
}
