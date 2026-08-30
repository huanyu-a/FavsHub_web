import { request } from '@/utils/request';
import { tokenStorage, baseUrlStorage, languageStorage } from '@/utils/storage';
import { isSafeUrl } from '@/utils/safe-url';
import { currentLanguage, translateWith, tr } from '@/utils/server-errors';

interface FavsHubFolder {
  id: number;
  name: string;
  parent_id: number | null;
}

interface HistorySearchQuery {
  text: string;
  maxResults?: number;
  startTime?: number;
  endTime?: number;
}

const ROOT_MENU_ID = 'favshub:add';
const MENU_ID_PREFIX = 'favshub:folder';
const MENU_CONTEXTS: ['page', 'link'] = ['page', 'link'];
let rebuildLock = false;
let rebuildQueued = false;

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
  // 失败时抛出而非吞错返回空数组，避免把"网络错误"误显示为"暂无文件夹"
  const result = await request<{ folders: FavsHubFolder[] }>('/api/folders');
  return result.folders || [];
}

async function rebuildContextMenus() {
  // 并发重入时排队：锁释放后补跑一轮，避免 token/folders 竞态导致菜单陈旧
  if (rebuildLock) {
    rebuildQueued = true;
    return;
  }
  rebuildLock = true;

  try {
    // 菜单文案取当次构建时的语言（语言切换会触发本函数重建）
    const lang = await currentLanguage();
    const tt = (key: string, params?: Record<string, string | number>) => translateWith(lang, key, params);

    // 必须 await removeAll，否则后续 create 会遇到旧 ID 冲突
    await browser.contextMenus.removeAll();

    const loggedIn = await isLoggedIn();

    if (!loggedIn) {
      await browser.contextMenus.create({
        id: `${ROOT_MENU_ID}:need-login`,
        title: tt('ui.ctx.need_login'),
        contexts: MENU_CONTEXTS,
      });
      return;
    }

    let folders: FavsHubFolder[] = [];
    let foldersFailed = false;
    try {
      folders = await fetchFolders();
    } catch {
      foldersFailed = true;
    }

    if (!folders.length) {
      await browser.contextMenus.create({
        id: ROOT_MENU_ID,
        title: tt('ui.ctx.menu_title'),
        contexts: MENU_CONTEXTS,
      });
      // 仅在服务端确实没有文件夹时提示；拉取失败不误导用户
      if (!foldersFailed) {
        await browser.contextMenus.create({
          id: `${ROOT_MENU_ID}:no-folders`,
          parentId: ROOT_MENU_ID,
          title: tt('ui.ctx.no_folders'),
          contexts: MENU_CONTEXTS,
        });
      }
      await browser.contextMenus.create({
        id: `${ROOT_MENU_ID}:save-root`,
        parentId: ROOT_MENU_ID,
          title: tt('ui.ctx.save_root_direct'),
        contexts: MENU_CONTEXTS,
      });
      return;
    }

    // 有文件夹：构建完整树形菜单
    await browser.contextMenus.create({
      id: ROOT_MENU_ID,
      title: tt('ui.ctx.menu_title'),
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
            title: tt('ui.ctx.add_to_folder'),
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
      title: tt('ui.ctx.save_root'),
      contexts: MENU_CONTEXTS,
    });
  } finally {
    rebuildLock = false;
    if (rebuildQueued) {
      rebuildQueued = false;
      void rebuildContextMenus();
    }
  }
}

async function getActiveTabForWindow(windowId?: number) {
  const tabs = await browser.tabs.query({ active: true, windowId });
  return tabs[0] ?? null;
}

async function addCurrentPageToFolder(folderId: number | null, windowId?: number, linkUrl?: string) {
  const activeTab = await getActiveTabForWindow(windowId);
  // 右键目标是链接时，优先保存被右键的链接 URL，而非当前页面 URL
  const url = linkUrl?.trim() || activeTab?.url?.trim() || '';
  const title = activeTab?.title?.trim() ?? '';

  if (!url) throw new Error(await tr('ui.err.read_page_failed'));
  // 安全检查：仅允许 http/https 协议的 URL 保存为书签
  if (!isSafeUrl(url)) throw new Error(await tr('ui.err.unsafe_protocol'));

  const body: Record<string, unknown> = { title, url };
  if (folderId !== null) body.folder_id = folderId;

  await request('/api/bookmarks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  return title || url;
}

// ===== 中继敏感操作的防线参数 =====
// relay 的 origin 校验只能保证消息来自配置的 FavsHub 站点本身，
// 无法限制该站点内嵌的第三方脚本，故敏感动作在此再加一层防线。
const HISTORY_MAX_RESULTS = 100;
let historyCalls = 0;
let historyWindowStart = 0;
function checkHistoryRateLimit(): boolean {
  const now = Date.now();
  if (now - historyWindowStart > 60_000) {
    historyWindowStart = now;
    historyCalls = 0;
  }
  historyCalls++;
  return historyCalls <= 10;
}

const PROXY_FETCH_TIMEOUT_MS = 60_000;
const PROXY_FETCH_MAX_CHARS = 5 * 1024 * 1024;

function openPopup() {
  browser.action.openPopup().catch(async () => {
    showNotification('FavsHub', await tr('ui.notify.open_popup_hint'));
  });
}

export default defineBackground(() => {

  rebuildContextMenus();

  // ===== 侧边栏配置 =====
  async function setupSidePanel() {
    if (!(browser.sidePanel && browser.sidePanel.setOptions)) return;
    const baseUrl = await baseUrlStorage.getValue();
    if (baseUrl?.trim() && isSafeUrl(baseUrl)) {
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

  // 语言切换后重建右键菜单，使菜单文案跟随界面语言
  languageStorage.watch(() => {
    rebuildContextMenus();
  });

  browser.runtime.onInstalled.addListener(() => {
    rebuildContextMenus();
    setupSidePanel();
  });

  // ===== 快捷键打开侧边栏 =====
  browser.commands.onCommand.addListener((command) => {
    if (command === 'open_side_panel') {
      (browser.sidePanel.open as any)({}).catch(() => {});
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
      addCurrentPageToFolder(null, tab?.windowId, info.linkUrl)
        .then(async (pageTitle) => showNotification('FavsHub', await tr('ui.notify.saved', { name: pageTitle })))
        .catch(async (error) => showNotification('FavsHub', await tr('ui.notify.save_failed', { reason: error.message })));
      return;
    }

    const match = info.menuItemId.match(new RegExp(`^${MENU_ID_PREFIX}:(\\d+):add$`));
    if (match) {
      const folderId = parseInt(match[1]);
      addCurrentPageToFolder(folderId, tab?.windowId, info.linkUrl)
        .then(async (pageTitle) => showNotification('FavsHub', await tr('ui.notify.saved', { name: pageTitle })))
        .catch(async (error) => showNotification('FavsHub', await tr('ui.notify.save_failed', { reason: error.message })));
    }
  });

  // ===== 快捷访问链接：消息处理器 =====
  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message?.action) return;

    switch (message.action) {
      case 'ping':
        sendResponse({ connected: true });
        return true;

      case 'proxyFetch': {
        // 允许 content script 通过 background 发起请求（绕过 CORS / Mixed Content）
        // 安全限制：仅允许 http/https 协议，且仅允许请求已配置的服务器地址
        const { url, options } = message;
        if (!url || !isSafeUrl(url)) {
          sendResponse({ error: 'Invalid URL: only http/https allowed' });
          return true;
        }
        // 限制请求目标为已配置的服务器 origin，防止 SSRF
        baseUrlStorage.getValue().then((baseUrl) => {
          let allowedOrigin = '';
          try {
            allowedOrigin = new URL(baseUrl).origin;
          } catch {
            sendResponse({ error: 'Server URL not configured' });
            return;
          }
          let requestOrigin = '';
          try {
            requestOrigin = new URL(url).origin;
          } catch {
            sendResponse({ error: 'Invalid URL' });
            return;
          }
          if (requestOrigin !== allowedOrigin) {
            sendResponse({ error: 'URL not allowed: target must match configured server' });
            return;
          }
          // 超时 + 响应体上限，防止消息通道悬挂或超大响应拖垮 SW
          fetch(url, { ...options, signal: AbortSignal.timeout(PROXY_FETCH_TIMEOUT_MS) })
            .then(async (resp) => {
              const len = Number(resp.headers.get('content-length') || '0');
              if (len > PROXY_FETCH_MAX_CHARS) {
                sendResponse({ error: 'Response too large' });
                return;
              }
              const body = await resp.text();
              if (body.length > PROXY_FETCH_MAX_CHARS) {
                sendResponse({ error: 'Response too large' });
                return;
              }
              sendResponse({ status: resp.status, body });
            })
            .catch((err) => sendResponse({ error: String(err) }));
        });
        return true;
      }

      case 'getIconUrl': {
        // 将图标转为 data URL，避免 content script 中 chrome-extension:// 加载失败
        // 安全限制：仅允许已知图标路径，防止读取任意扩展文件
        const ALLOWED_ICON_PATHS = new Set(['/icon/16.png', '/icon/32.png', '/icon/48.png', '/icon/128.png']);
        const iconPath = message.path || '/icon/48.png';
        if (!ALLOWED_ICON_PATHS.has(iconPath)) {
          sendResponse({ url: '' });
          return true;
        }
        try {
          const url = browser.runtime.getURL(iconPath);
          fetch(url)
            .then(r => r.arrayBuffer())
            .then(buf => {
              const bytes = new Uint8Array(buf);
              let binary = '';
              for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
              sendResponse({ url: 'data:image/png;base64,' + btoa(binary) });
            })
            .catch(() => sendResponse({ url: '' }));
        } catch {
          sendResponse({ url: '' });
        }
        return true;
      }

      case 'open_side_panel': {
        const winId = _sender.tab?.windowId;
        const openPromise = winId != null
          ? browser.sidePanel.open({ windowId: winId })
          : (browser.sidePanel.open as any)({});
        openPromise
          .then(() => sendResponse({ success: true }))
          .catch((err: any) => {
            // 回退：尝试不带 windowId 打开
            (browser.sidePanel.open as any)({})
              .then(() => sendResponse({ success: true }))
              .catch(() => sendResponse({ success: false, error: err?.message }));
          });
        return true;
      }

      case 'navigateHome': {
        const goHome = async () => {
          const baseUrl = await baseUrlStorage.getValue();
          if (baseUrl?.trim() && isSafeUrl(baseUrl) && browser.sidePanel.setOptions) {
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
        // 仅允许打开与 FavsHub 服务器同源的页面：
        // 侧边栏被用户视为扩展的可信界面，不得被指向任意站点（钓鱼风险）
        if (!message.url || !browser.sidePanel.setOptions) {
          sendResponse({ success: false, error: 'Invalid request' });
          return true;
        }
        (async () => {
          try {
            const parsed = new URL(message.url);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
              return { success: false, error: 'Invalid URL protocol' };
            }
            const baseUrl = await baseUrlStorage.getValue();
            const allowedOrigin = baseUrl?.trim() ? new URL(baseUrl.trim()).origin : '';
            if (!allowedOrigin || parsed.origin !== allowedOrigin) {
              return { success: false, error: 'URL not allowed: must match configured server' };
            }
            await browser.sidePanel.setOptions({ path: message.url });
            return { success: true };
          } catch {
            return { success: false, error: 'Invalid URL' };
          }
        })().then(sendResponse);
        return true;
      }

      // Chrome 内部页面操作：打开历史/下载/密码/扩展管理
      // 安全性由 content.ts relay 的 origin 校验 + action 白名单保证
      // proxyFetch / getIconUrl 等敏感操作不在 relay 白名单中，无法通过网站触发
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
        // 仅允许打开与 FavsHub 服务器同源的 URL，防止网站借中继进行标签页轰炸/钓鱼
        (async () => {
          try {
            const tabUrl = message.url;
            const parsed = new URL(tabUrl);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
              return { success: false, error: 'Invalid URL protocol' };
            }
            const baseUrl = await baseUrlStorage.getValue();
            const allowedOrigin = baseUrl?.trim() ? new URL(baseUrl.trim()).origin : '';
            if (!allowedOrigin || parsed.origin !== allowedOrigin) {
              return { success: false, error: 'URL not allowed: must match configured server' };
            }
            await browser.tabs.create({ url: tabUrl });
            return { success: true };
          } catch {
            return { success: false, error: 'Invalid URL' };
          }
        })().then(sendResponse);
        return true;
      }

      case 'searchHistory': {
        // 入参强校验 + 结果上限 + 速率限制（防御该站点内嵌第三方脚本滥用）
        if (!checkHistoryRateLimit()) {
          sendResponse({ success: false, error: 'rate_limited' });
          return true;
        }
        const { text, maxResults, startTime } = message;
        if (typeof text !== 'string' || text.length > 200) {
          sendResponse({ success: false, error: 'Invalid text' });
          return true;
        }
        if (maxResults !== undefined && (!Number.isFinite(maxResults) || maxResults < 1)) {
          sendResponse({ success: false, error: 'Invalid maxResults' });
          return true;
        }
        if (startTime !== undefined && !Number.isFinite(startTime)) {
          sendResponse({ success: false, error: 'Invalid startTime' });
          return true;
        }
        const keywords = text.split(/[\s\u3000]+/).filter((k: string) => k.length > 0);
        const limit = Math.min(Math.floor(maxResults || 50), HISTORY_MAX_RESULTS);

        if (keywords.length <= 1) {
          // 单关键词：直接搜索
          const searchOpts: HistorySearchQuery = { text: keywords[0] || '', maxResults: limit };
          if (startTime) searchOpts.startTime = startTime;
          browser.history.search(searchOpts)
            .then((items) => sendResponse({ success: true, items }))
            .catch((err) => sendResponse({ success: false, error: String(err) }));
        } else {
          // 多关键词：分别搜索，取交集（AND 逻辑）
          Promise.all(
            keywords.map((kw: string) => {
              const opts: HistorySearchQuery = { text: kw, maxResults: limit };
              if (startTime) opts.startTime = startTime;
              return browser.history.search(opts);
            })
          ).then((resultSets) => {
            // 以第一个关键词结果为基准，过滤出所有关键词都匹配的条目
            const urlSets = resultSets.map((items: any[]) => new Set(items.map((i: any) => i.url)));
            const merged = resultSets[0].filter((item: any) =>
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

    // 将 baseUrl 转为匹配模式（仅允许 http/https）
    let urlPattern: string;
    try {
      const url = new URL(baseUrl);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
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