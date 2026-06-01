import { request } from '@/utils/request';
import { resolveContainerByType } from '@/utils/container-sync';

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

type SyncStats = { folders: number; bookmarks: number };

const CONTAINER_NAMES = new Set([
  '书签栏', '其他书签', '移动设备书签',
  'Bookmarks bar', 'Bookmarks Bar', 'Other bookmarks', 'Other Bookmarks',
  'Mobile bookmarks', 'Mobile Bookmarks',
  '书签工具栏', '书签菜单', 'Bookmarks Toolbar', 'Bookmarks Menu',
  '收藏夹栏', '其他收藏夹',
]);

export async function syncZMarkToBrowser(): Promise<SyncStats> {
  const [foldersRes, bmRes] = await Promise.all([
    request<{ folders: FavsHubFolder[] }>('/api/folders'),
    request<{ bookmarks: FavsHubBookmark[] }>('/api/bookmarks'),
  ]);
  const folders = foldersRes.folders || [];
  const bookmarks = bmRes.bookmarks || [];
  if (!folders.length && !bookmarks.length) throw new Error('服务器暂无书签数据');

  // folder map
  const folderMap = new Map<number, FavsHubFolder>();
  for (const f of folders) folderMap.set(f.id, f);

  // parent_id → children
  const subFolders = new Map<number | null, FavsHubFolder[]>();
  for (const f of folders) {
    const k = f.parent_id;
    if (!subFolders.has(k)) subFolders.set(k, []);
    subFolders.get(k)!.push(f);
  }

  // folder_id → bookmarks
  const bmByFolder = new Map<number | null, FavsHubBookmark[]>();
  for (const bm of bookmarks) {
    const k = bm.folder_id;
    if (!bmByFolder.has(k)) bmByFolder.set(k, []);
    bmByFolder.get(k)!.push(bm);
  }

  // 找出每个顶层文件夹下首个书签的 container 类型
  function getFolderContainer(folderId: number): string {
    const bms = bmByFolder.get(folderId) || [];
    for (const bm of bms) {
      if (bm.container) return bm.container;
    }
    // 递归查找子文件夹
    for (const child of (subFolders.get(folderId) || [])) {
      const ct = getFolderContainer(child.id);
      if (ct) return ct;
    }
    return 'bar'; // 默认书签栏
  }

  // 获取当前浏览器容器
  const containerMap = new Map<string, browser.bookmarks.BookmarkTreeNode>();
  const tree = await browser.bookmarks.getTree();
  for (const c of (tree[0]?.children ?? [])) containerMap.set(c.title, c);
  for (const c of containerMap.values()) {
    const children = await browser.bookmarks.getChildren(c.id);
    for (const ch of children) {
      if (ch.url) await browser.bookmarks.remove(ch.id);
      else await browser.bookmarks.removeTree(ch.id);
    }
  }
  const fallback = resolveContainerByType('bar', containerMap) ?? [...containerMap.values()][0];

  let folderCount = 0;
  let bookmarkCount = 0;

  // 递归创建文件夹 + 书签
  async function createTree(parentBrowserId: string, folderDbId: number) {
    const folder = folderMap.get(folderDbId);
    if (!folder) return;
    const bf = await browser.bookmarks.create({ parentId: parentBrowserId, title: folder.name });
    folderCount++;

    const bms = bmByFolder.get(folderDbId) || [];
    for (const bm of bms) {
      await browser.bookmarks.create({ parentId: bf.id, title: bm.title, url: bm.url });
      bookmarkCount++;
    }
    for (const child of (subFolders.get(folderDbId) || [])) {
      await createTree(bf.id, child.id);
    }
  }

  // ===== 1. 未分类书签 → 按 container 路由到浏览器容器 =====
  for (const bm of bookmarks) {
    if (bm.folder_id !== null) continue;
    const c = resolveContainerByType(bm.container || 'bar', containerMap);
    await browser.bookmarks.create({ parentId: c?.id ?? fallback.id, title: bm.title, url: bm.url });
    bookmarkCount++;
  }

  // ===== 2. 顶级文件夹 → 按 container 路由 =====
  const topFolders = subFolders.get(null) || [];
  for (const f of topFolders) {
    if (CONTAINER_NAMES.has(f.name)) {
      // 容器文件夹 → 跳过自身，直接在其子文件夹下递归
      const children = subFolders.get(f.id) || [];
      const ct = getFolderContainer(f.id);
      const c = resolveContainerByType(ct, containerMap);
      const targetId = c?.id ?? fallback.id;
      for (const child of children) {
        await createTree(targetId, child.id);
      }
    } else {
      // 普通顶级文件夹 → 根据其书签的 container 路由
      const ct = getFolderContainer(f.id);
      const c = resolveContainerByType(ct, containerMap);
      const targetId = c?.id ?? fallback.id;
      await createTree(targetId, f.id);
    }
  }

  return { folders: folderCount, bookmarks: bookmarkCount };
}