import { request } from '@/utils/request';
import { tokenStorage, baseUrlStorage } from '@/utils/storage';

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

  rebuildContextMenus();

  // ===== 侧边栏配置 =====
  async function setupSidePanel() {
    if (!(browser.sidePanel && browser.sidePanel.setOptions)) return;
    const baseUrl = await baseUrlStorage.getValue();
    if (baseUrl?.trim()) {
      const sidePanelUrl = baseUrl.replace(/\/+$/, '') + '/?context=side_panel';
      browser.sidePanel.setOptions({
        path: sidePanelUrl,
        enabled: true,
      }).catch(() => {});
    } else {
      // baseUrl 未设置时，确保侧边栏可用（使用 manifest 默认路径）
      browser.sidePanel.setOptions({ enabled: true }).catch(() => {});
    }
  }

  // 启动时配置侧边栏
  setupSidePanel();
  // baseUrl 变化时重新配置
  baseUrlStorage.watch(() => setupSidePanel());

  tokenStorage.watch(() => {
    rebuildContextMenus();
  });

  browser.runtime.onInstalled.addListener(() => {
    rebuildContextMenus();
    setupSidePanel();
  });

  // ===== 快捷键打开侧边栏 =====
  browser.commands.onCommand.addListener((command) => {
    if (command === 'open_side_panel') {
      browser.sidePanel.open().catch(() => {});
    }
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

  // ===== 快捷访问链接：消息处理器 =====
  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message?.action) return;

    switch (message.action) {
      case 'ping':
        sendResponse({ connected: true });
        return true;

      case 'open_side_panel':
        browser.sidePanel.open({ windowId: _sender.tab?.windowId })
          .then(() => sendResponse({ success: true }))
          .catch((err: any) => {
            // 回退：尝试不带 windowId 打开
            browser.sidePanel.open()
              .then(() => sendResponse({ success: true }))
              .catch(() => sendResponse({ success: false, error: err?.message }));
          });
        return true;

      case 'navigateHome': {
        const goHome = async () => {
          const baseUrl = await baseUrlStorage.getValue();
          if (baseUrl?.trim() && browser.sidePanel.setOptions) {
            const homeUrl = baseUrl + (baseUrl.includes('?') ? '&' : '?') + 'context=side_panel';
            await browser.sidePanel.setOptions({ path: homeUrl });
          }
        };
        goHome()
          .then(() => sendResponse({ success: true }))
          .catch(() => sendResponse({ success: false }));
        return true;
      }

      case 'openUrlInSidePanel': {
        const url = message.url;
        if (url && browser.sidePanel.setOptions) {
          // Validate URL protocol - only allow http/https
          try {
            const parsed = new URL(url);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
              sendResponse({ success: false, error: 'Invalid URL protocol' });
              return true;
            }
          } catch {
            sendResponse({ success: false, error: 'Invalid URL' });
            return true;
          }
          browser.sidePanel.setOptions({ path: url })
            .then(() => sendResponse({ success: true }))
            .catch(() => sendResponse({ success: false }));
        } else {
          sendResponse({ success: false });
        }
        return true;
      }

      case 'openHistory':
        browser.tabs.create({ url: 'chrome://history' })
          .then(() => sendResponse({ success: true }))
          .catch(() => sendResponse({ success: false }));
        return true;

      case 'openDownloads':
        browser.tabs.create({ url: 'chrome://downloads' })
          .then(() => sendResponse({ success: true }))
          .catch(() => sendResponse({ success: false }));
        return true;

      case 'openPasswords':
        browser.tabs.create({ url: 'chrome://settings/passwords' })
          .then(() => sendResponse({ success: true }))
          .catch(() => sendResponse({ success: false }));
        return true;

      case 'openExtensions':
        browser.tabs.create({ url: 'chrome://extensions' })
          .then(() => sendResponse({ success: true }))
          .catch(() => sendResponse({ success: false }));
        return true;

      case 'openTab': {
        // Validate URL protocol - only allow http/https
        const tabUrl = message.url;
        if (tabUrl) {
          try {
            const parsed = new URL(tabUrl);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
              sendResponse({ success: false, error: 'Invalid URL protocol' });
              return true;
            }
          } catch {
            sendResponse({ success: false, error: 'Invalid URL' });
            return true;
          }
        }
        browser.tabs.create({ url: tabUrl })
          .then(() => sendResponse({ success: true }))
          .catch(() => sendResponse({ success: false }));
        return true;
      }

      case 'searchHistory': {
        const { text, maxResults, startTime } = message;
        const keywords = (text || '').split(/[\s\u3000]+/).filter((k: string) => k.length > 0);
        const limit = maxResults || 2000;

        if (keywords.length <= 1) {
          // 单关键词：直接搜索
          const searchOpts: chrome.history.HistorySearchQuery = { text: keywords[0] || '', maxResults: limit };
          if (startTime) searchOpts.startTime = startTime;
          browser.history.search(searchOpts)
            .then((items) => sendResponse({ success: true, items }))
            .catch((err) => sendResponse({ success: false, error: String(err) }));
        } else {
          // 多关键词：分别搜索，取交集（AND 逻辑）
          Promise.all(
            keywords.map((kw: string) => {
              const opts: chrome.history.HistorySearchQuery = { text: kw, maxResults: limit };
              if (startTime) opts.startTime = startTime;
              return browser.history.search(opts);
            })
          ).then((resultSets) => {
            // 以第一个关键词结果为基准，过滤出所有关键词都匹配的条目
            const urlSets = resultSets.map((items) => new Set(items.map((i) => i.url)));
            const merged = resultSets[0].filter((item) =>
              urlSets.every((urlSet) => urlSet.has(item.url))
            );
            sendResponse({ success: true, items: merged.slice(0, limit) });
          }).catch((err) => sendResponse({ success: false, error: String(err) }));
        }
        return true; // 异步响应
      }

      default:
        // 未匹配的消息不做处理，避免通道挂起
        return false;
    }
  });

  // ===== 动态注册 content script 到 FavsHub 网站 =====
  const CONTENT_SCRIPT_ID = 'favshub-page-relay';

  async function registerContentScript() {
    const baseUrl = await baseUrlStorage.getValue();
    if (!baseUrl?.trim()) return;

    // 将 baseUrl 转为匹配模式
    let urlPattern: string;
    try {
      const url = new URL(baseUrl);
      urlPattern = `${url.origin}/*`;
    } catch {
      return;
    }

    // 先移除旧的注册
    try {
      await browser.scripting.unregisterContentScripts({ ids: [CONTENT_SCRIPT_ID] });
    } catch {}

    await browser.scripting.registerContentScripts([{
      id: CONTENT_SCRIPT_ID,
      matches: [urlPattern],
      js: ['content-scripts/content.js'],
      runAt: 'document_start',
    }]);
  }

  // 启动时注册 + URL 变化时重新注册
  registerContentScript();
  baseUrlStorage.watch(() => registerContentScript());
});