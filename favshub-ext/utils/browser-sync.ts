import { request } from '@/utils/request';
import { resolveContainerByType, containerTypeFromTitle } from '@/utils/container-sync';
import { saveSnapshot, loadSnapshot } from '@/utils/sync-snapshot';
import type { SyncSnapshot } from '@/utils/storage';
import { computeDiff, type DiffBookmarkEntry, type DiffBrowserEntry, type DiffSnapshotEntry } from '@/utils/diff-engine';

interface FavsHubFolder {
  id: number;
  name: string;
  parent_id: number | null;
  sort_order: number;
}

interface FavsHubBookmark {
  id: number;
  title: string;
  url: string;
  folder_id: number | null;
  container: string;
  sort_order: number;
}

export type SyncStats = {
  added: number;
  updated: number;
  removed: number;
  isFirstSync: boolean;
};

const CONTAINER_NAMES = new Set([
  '书签栏', '其他书签', '移动设备书签',
  'Bookmarks bar', 'Bookmarks Bar', 'Other bookmarks', 'Other Bookmarks',
  'Mobile bookmarks', 'Mobile Bookmarks',
  '书签工具栏', '书签菜单', 'Bookmarks Toolbar', 'Bookmarks Menu',
  '收藏夹栏', '其他收藏夹',
]);

/**
 * 从服务端增量合并书签到浏览器（不再清空重建）
 */
export async function syncFavsHubToBrowser(): Promise<SyncStats> {
  // ===== 阶段 0：数据获取 =====
  const [foldersRes, bmRes] = await Promise.all([
    request<{ folders: FavsHubFolder[] }>('/api/folders'),
    request<{ bookmarks: FavsHubBookmark[] }>('/api/bookmarks'),
  ]);
  const folders = foldersRes.folders || [];
  const bookmarks = bmRes.bookmarks || [];
  if (!folders.length && !bookmarks.length) throw new Error('服务器暂无书签数据');

  const snapshot = await loadSnapshot();
  const tree = await browser.bookmarks.getTree();

  // ===== 辅助：构建服务端文件夹路径 Map =====
  const folderMap = new Map<number, FavsHubFolder>();
  for (const f of folders) folderMap.set(f.id, f);

  function getFolderPath(folderId: number | null): string {
    if (folderId === null) return '';
    const parts: string[] = [];
    let fid: number | null = folderId;
    while (fid !== null) {
      const f = folderMap.get(fid);
      if (!f) break;
      parts.unshift(f.name);
      fid = f.parent_id;
    }
    return parts.join('/');
  }

  // 找出每个文件夹的 container 类型
  const subFolders = new Map<number | null, FavsHubFolder[]>();
  for (const f of folders) {
    const k = f.parent_id;
    if (!subFolders.has(k)) subFolders.set(k, []);
    subFolders.get(k)!.push(f);
  }
  const bmByFolder = new Map<number | null, FavsHubBookmark[]>();
  for (const bm of bookmarks) {
    const k = bm.folder_id;
    if (!bmByFolder.has(k)) bmByFolder.set(k, []);
    bmByFolder.get(k)!.push(bm);
  }

  function getFolderContainer(folderId: number): string {
    const bms = bmByFolder.get(folderId) || [];
    for (const bm of bms) {
      if (bm.container) return bm.container;
    }
    for (const child of (subFolders.get(folderId) || [])) {
      const ct = getFolderContainer(child.id);
      if (ct) return ct;
    }
    return 'bar';
  }

  // ===== 阶段 1：构建比较 Map =====

  // 服务端书签 Map: key → DiffBookmarkEntry
  const serverMap = new Map<string, DiffBookmarkEntry>();
  for (const bm of bookmarks) {
    const container = bm.container || 'bar';
    const relativePath = bm.folder_id != null ? getFolderPath(bm.folder_id) : '';
    const key = `${container}/${relativePath}/${bm.url}`;
    serverMap.set(key, {
      key,
      title: bm.title,
      url: bm.url,
      folderPath: relativePath,
      container,
    });
  }

  // 服务端文件夹 key 集合
  const serverFolderKeys = new Set<string>();
  for (const f of folders) {
    const container = getFolderContainer(f.id);
    const path = getFolderPath(f.id);
    const key = `${container}/${path}`;
    serverFolderKeys.add(key);
  }

  // 浏览器书签 Map: key → DiffBrowserEntry
  const browserMap = new Map<string, DiffBrowserEntry>();
  const browserFolderMap = new Map<string, { browserId: string }>();

  const containerMap = new Map<string, chrome.bookmarks.BookmarkTreeNode>();
  for (const c of (tree[0]?.children ?? [])) containerMap.set(c.title, c);

  for (const containerNode of containerMap.values()) {
    const containerType = containerTypeFromTitle(containerNode.title) || 'bar';
    await walkBrowserTree(containerNode.id, containerType, '');
  }

  async function walkBrowserTree(parentId: string, containerType: string, parentPath: string) {
    const children = await browser.bookmarks.getChildren(parentId);
    for (const child of children) {
      if (child.url) {
        const key = `${containerType}/${parentPath}/${child.url}`;
        browserMap.set(key, { key, title: child.title, browserId: child.id });
      } else {
        const folderPath = parentPath ? `${parentPath}/${child.title}` : child.title;
        const folderKey = `${containerType}/${folderPath}`;
        browserFolderMap.set(folderKey, { browserId: child.id });
        await walkBrowserTree(child.id, containerType, folderPath);
      }
    }
  }

  // 快照 Map
  const snapshotMap = snapshot
    ? new Map(snapshot.bookmarks.map(b => [b.key, { key: b.key, title: b.title } as DiffSnapshotEntry]))
    : null;
  const snapshotFolderMap = snapshot
    ? new Map(snapshot.folders.map(f => [f.key, {}]))
    : null;

  // ===== 阶段 2：计算 Diff =====
  const diff = computeDiff(
    serverMap, browserMap, snapshotMap,
    serverFolderKeys, browserFolderMap, snapshotFolderMap,
  );

  // ===== 阶段 3：先添加文件夹和书签（安全优先） =====
  const fallback = resolveContainerByType('bar', containerMap) ?? [...containerMap.values()][0];
  let added = 0;
  let updated = 0;
  let removed = 0;

  // 创建新文件夹
  const createdFolderIds = new Map<string, string>(); // folderKey → browserId
  // 按路径深度排序，确保父文件夹先创建
  const sortedFolders = [...diff.toAddFolders].sort((a, b) => {
    const depthA = a.key.split('/').length;
    const depthB = b.key.split('/').length;
    return depthA - depthB;
  });

  for (const folder of sortedFolders) {
    let parentId: string;
    if (folder.parentKey && createdFolderIds.has(folder.parentKey)) {
      parentId = createdFolderIds.get(folder.parentKey)!;
    } else {
      // 找容器节点
      const containerType = folder.key.split('/')[0] || 'bar';
      const containerNode = resolveContainerByType(containerType, containerMap);
      parentId = containerNode?.id ?? fallback.id;

      // 尝试找到已有的中间文件夹
      if (folder.parentKey && browserFolderMap.has(folder.parentKey)) {
        parentId = browserFolderMap.get(folder.parentKey)!.browserId;
      }
    }

    try {
      const created = await browser.bookmarks.create({ parentId, title: folder.name });
      createdFolderIds.set(folder.key, created.id);
    } catch {
      // 创建失败则跳过
    }
  }

  // 创建新书签
  for (const action of diff.toAddBookmarks) {
    const entry = action.serverEntry;
    const containerType = entry.container || 'bar';

    // 找到父文件夹的浏览器 ID
    let parentId: string;
    const folderKey = `${containerType}/${entry.folderPath}`;
    if (createdFolderIds.has(folderKey)) {
      parentId = createdFolderIds.get(folderKey)!;
    } else if (browserFolderMap.has(folderKey)) {
      parentId = browserFolderMap.get(folderKey)!.browserId;
    } else {
      const containerNode = resolveContainerByType(containerType, containerMap);
      parentId = containerNode?.id ?? fallback.id;
    }

    try {
      await browser.bookmarks.create({ parentId, title: entry.title, url: entry.url });
      added++;
    } catch {
      // 创建失败则跳过
    }
  }

  // ===== 阶段 4：更新标题 =====
  for (const action of diff.toUpdateTitles) {
    try {
      // 验证 ID 仍存在
      await browser.bookmarks.get(action.browserId);
      await browser.bookmarks.update(action.browserId, { title: action.newTitle });
      updated++;
    } catch {
      // ID 失效则跳过
    }
  }

  // ===== 阶段 5：最后删除 =====
  for (const action of diff.toRemoveBookmarks) {
    try {
      await browser.bookmarks.get(action.browserId);
      await browser.bookmarks.remove(action.browserId);
      removed++;
    } catch {
      // ID 已不存在则跳过
    }
  }

  // 删除空文件夹（按路径深度倒序，先删子文件夹）
  const sortedRemoveFolders = [...diff.toRemoveFolders].sort((a, b) => {
    const depthA = a.key.split('/').length;
    const depthB = b.key.split('/').length;
    return depthB - depthA;
  });

  for (const action of sortedRemoveFolders) {
    try {
      const children = await browser.bookmarks.getChildren(action.browserId);
      if (children.length === 0) {
        await browser.bookmarks.removeTree(action.browserId);
      }
    } catch {
      // ID 已不存在则跳过
    }
  }

  // ===== 阶段 6：保存新快照 =====
  const newSnapshot = await buildSnapshot(containerMap);
  await saveSnapshot(newSnapshot);

  return { added, updated, removed, isFirstSync: diff.isFirstSync };
}

/**
 * 从当前浏览器书签树构建快照
 */
async function buildSnapshot(
  containerMap: Map<string, chrome.bookmarks.BookmarkTreeNode>,
): Promise<SyncSnapshot> {
  const bookmarks: SyncSnapshot['bookmarks'] = [];
  const folders: SyncSnapshot['folders'] = [];

  for (const containerNode of containerMap.values()) {
    const containerType = containerTypeFromTitle(containerNode.title) || 'bar';
    await walkForSnapshot(containerNode.id, containerType, '');
  }

  async function walkForSnapshot(parentId: string, containerType: string, parentPath: string) {
    const children = await browser.bookmarks.getChildren(parentId);
    for (const child of children) {
      if (child.url) {
        const key = `${containerType}/${parentPath}/${child.url}`;
        bookmarks.push({ key, title: child.title });
      } else {
        const folderPath = parentPath ? `${parentPath}/${child.title}` : child.title;
        const folderKey = `${containerType}/${folderPath}`;
        folders.push({ key: folderKey });
        await walkForSnapshot(child.id, containerType, folderPath);
      }
    }
  }

  return { bookmarks, folders, timestamp: Date.now() };
}
