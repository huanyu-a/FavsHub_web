import { request } from '@/utils/request';
import { tokenStorage } from '@/utils/storage';

interface FavsHubFolder {
  id: number;
  name: string;
  parent_id: number | null;
}

const ROOT_MENU_ID = 'favshub:add';
const MENU_ID_PREFIX = 'favshub:folder';
const MENU_CONTEXTS: ['page', 'link'] = ['page', 'link'];
let rebuildLock = false;

async function showNotification(title: string, message: string) {
  await browser.notifications.create({
    type: 'basic',
    iconUrl: browser.runtime.getURL('/icon/128.png'),
    title,
    message,
  });
}

async function isLoggedIn(): Promise<boolean> {
  const token = await tokenStorage.getValue();
  return !!token.trim();
}

async function fetchFolders(): Promise<FavsHubFolder[]> {
  try {
    const result = await request<{ folders: FavsHubFolder[] }>('/api/folders');
    return result.folders || [];
  } catch {
    return [];
  }
}

async function rebuildContextMenus() {
  // 防止并发重复构建
  if (rebuildLock) return;
  rebuildLock = true;

  try {
    // 必须 await removeAll，否则后续 create 会遇到旧 ID 冲突
    await browser.contextMenus.removeAll();

    const loggedIn = await isLoggedIn();

    if (!loggedIn) {
      await browser.contextMenus.create({
        id: `${ROOT_MENU_ID}:need-login`,
        title: '添加到 FavsHub（请先登录）',
        contexts: MENU_CONTEXTS,
      });
      return;
    }

    const folders = await fetchFolders();

    if (!folders.length) {
      await browser.contextMenus.create({
        id: ROOT_MENU_ID,
        title: '添加到 FavsHub',
        contexts: MENU_CONTEXTS,
      });
      await browser.contextMenus.create({
        id: `${ROOT_MENU_ID}:no-folders`,
        parentId: ROOT_MENU_ID,
        title: '暂无文件夹，请先在扩展弹窗中同步书签',
        contexts: MENU_CONTEXTS,
      });
      await browser.contextMenus.create({
        id: `${ROOT_MENU_ID}:save-root`,
        parentId: ROOT_MENU_ID,
        title: '直接保存到书签根目录',
        contexts: MENU_CONTEXTS,
      });
      return;
    }

    // 有文件夹：构建完整树形菜单
    await browser.contextMenus.create({
      id: ROOT_MENU_ID,
      title: '添加到 FavsHub',
      contexts: MENU_CONTEXTS,
    });

    const childrenMap = new Map<number | null, FavsHubFolder[]>();
    for (const f of folders) {
      const parentKey = f.parent_id;
      if (!childrenMap.has(parentKey)) childrenMap.set(parentKey, []);
      childrenMap.get(parentKey)!.push(f);
    }

    async function createMenuItems(
      parentMenuId: string,
      items: FavsHubFolder[],
      visited: Set<number> = new Set()
    ) {
      for (const folder of items) {
        if (visited.has(folder.id)) continue;
        visited.add(folder.id);

        const menuId = `${MENU_ID_PREFIX}:${folder.id}`;
        const children = childrenMap.get(folder.id) || [];

        if (children.length > 0) {
          await browser.contextMenus.create({
            id: menuId,
            parentId: parentMenuId,
            title: folder.name,
            contexts: MENU_CONTEXTS,
          });
          await browser.contextMenus.create({
            id: `${menuId}:add`,
            parentId: menuId,
            title: `添加到此文件夹`,
            contexts: MENU_CONTEXTS,
          });
          await createMenuItems(menuId, children, visited);
        } else {
          await browser.contextMenus.create({
            id: `${menuId}:add`,
            parentId: parentMenuId,
            title: folder.name,
            contexts: MENU_CONTEXTS,
          });
        }
      }
    }

    const rootFolders = childrenMap.get(null) || [];
    await createMenuItems(ROOT_MENU_ID, rootFolders);

    if (rootFolders.length > 0) {
      await browser.contextMenus.create({
        id: `${ROOT_MENU_ID}:separator`,
        type: 'separator',
        parentId: ROOT_MENU_ID,
        contexts: MENU_CONTEXTS,
      });
    }
    await browser.contextMenus.create({
      id: `${ROOT_MENU_ID}:save-root`,
      parentId: ROOT_MENU_ID,
      title: '保存到书签根目录',
      contexts: MENU_CONTEXTS,
    });
  } finally {
    rebuildLock = false;
  }
}

async function getActiveTabForWindow(windowId?: number) {
  const tabs = await browser.tabs.query({ active: true, windowId });
  return tabs[0] ?? null;
}

async function addCurrentPageToFolder(folderId: number | null, windowId?: number) {
  const activeTab = await getActiveTabForWindow(windowId);
  const url = activeTab?.url?.trim() ?? '';
  const title = activeTab?.title?.trim() ?? '';

  if (!url) throw new Error('读取当前页面地址失败');

  const body: Record<string, unknown> = { title, url };
  if (folderId !== null) body.folder_id = folderId;

  await request('/api/bookmarks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  return title || url;
}

function openPopup() {
  browser.action.openPopup().catch(() => {
    showNotification('FavsHub', '请点击浏览器工具栏的 FavsHub 图标打开弹窗');
  });
}

export default defineBackground(() => {
  console.log('Background ready', { id: browser.runtime.id });

  rebuildContextMenus();

  tokenStorage.watch(() => {
    rebuildContextMenus();
  });

  browser.runtime.onInstalled.addListener(() => {
    rebuildContextMenus();
  });

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (typeof info.menuItemId !== 'string') return;

    if (info.menuItemId === `${ROOT_MENU_ID}:need-login`) {
      openPopup();
      return;
    }

    if (info.menuItemId === `${ROOT_MENU_ID}:no-folders`) {
      openPopup();
      return;
    }

    if (info.menuItemId === `${ROOT_MENU_ID}:save-root`) {
      addCurrentPageToFolder(null, tab?.windowId)
        .then((pageTitle) => showNotification('FavsHub', `已保存：${pageTitle}`))
        .catch((error) => showNotification('FavsHub', `保存失败：${error.message}`));
      return;
    }

    const match = info.menuItemId.match(new RegExp(`^${MENU_ID_PREFIX}:(\\d+):add$`));
    if (match) {
      const folderId = parseInt(match[1]);
      addCurrentPageToFolder(folderId, tab?.windowId)
        .then((pageTitle) => showNotification('FavsHub', `已保存：${pageTitle}`))
        .catch((error) => showNotification('FavsHub', `保存失败：${error.message}`));
    }
  });
});