/**
 * Chrome API Shim - 让扩展代码在普通浏览器中运行
 * 替换 chrome.* API 为 fetch API + localStorage
 */

var API_BASE = '/api';

// ===== Token 管理 =====
function getToken() {
  return localStorage.getItem('favshub_token');
}

function requireAuth() {
  if (!getToken()) {
    window.location.href = '/login.html';
    return false;
  }
  return true;
}

async function apiFetch(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (res.status === 401) {
    localStorage.removeItem('favshub_token');
    // 同步清除 chrome.storage.local 中的 token
    if (window.chrome && chrome.storage && chrome.storage.local) {
      chrome.storage.local.remove(['favshub_token', 'favshub_last_sync']);
    }
    window.location.href = '/login.html';
    throw new Error('未登录');
  }
  return res.json();
}

// ===== chrome.bookmarks =====
var _shimBookmarksCache = { tree: [], flat: [] };

async function refreshBookmarksCache() {
  try {
    const data = await apiFetch('/bookmarks');
    _shimBookmarksCache.flat = data.bookmarks || [];
    _shimBookmarksCache.tree = buildTree(_shimBookmarksCache.flat, data.folders || []);
  } catch (e) {
    
  }
}

function buildTree(bookmarks, folders) {
  const CONTAINER_NAMES = new Set([
    '书签栏', '其他书签', '移动设备书签',
    'Bookmarks bar', 'Bookmarks Bar', 'Other bookmarks', 'Other Bookmarks',
    'Mobile bookmarks', 'Mobile Bookmarks',
    '书签工具栏', '书签菜单', 'Bookmarks Toolbar', 'Bookmarks Menu',
    '收藏夹栏', '其他收藏夹',
  ]);

  const folderMap = {}; // key: dbId (数字字符串), value: node
  for (const f of folders) {
    folderMap[f.id] = {
      id: 'folder-' + f.id, dbId: f.id, title: f.name, url: undefined, children: [],
      parentDbId: f.parent_id || null,
      parentId: f.parent_id ? 'folder-' + f.parent_id : null,
      isContainer: CONTAINER_NAMES.has(f.name),
    };
  }

  // 嵌套子文件夹（用 dbId 做 key 查找）
  for (const f of Object.values(folderMap)) {
    if (f.parentDbId && folderMap[f.parentDbId]) {
      folderMap[f.parentDbId].children.push(f);
    }
  }

  // 书签 → 放入对应文件夹（有 folder_id 的）或归入未分类
  const unclassified = [];  // 在容器根目录的书签 → 归入常用推荐
  for (const bm of bookmarks) {
    const node = {
      id: 'bm-' + bm.id, dbId: bm.id, title: bm.title, url: bm.url, dateAdded: bm.created_at,
      parentId: bm.folder_id ? 'folder-' + bm.folder_id : null, parentDbId: bm.folder_id || null,
      icon: bm.icon || '', container: bm.container || '', sort_order: bm.sort_order || 0
    };
    if (bm.folder_id && folderMap[bm.folder_id]) {
      folderMap[bm.folder_id].children.push(node);
    } else {
      unclassified.push(node);
    }
  }

  // 归入容器根目录的书签也归入常用推荐
  for (const f of Object.values(folderMap)) {
    if (f.isContainer) {
      // 提取此容器下的直接书签 → 归入未分类
      const directBms = f.children.filter(c => c.url);
      const subFolders = f.children.filter(c => !c.url);
      for (const bm of directBms) {
        bm.parentId = null;
        bm.parentDbId = null;
        unclassified.push(bm);
      }
    }
  }

  // 按 sort_order 排序各文件夹 children
  for (const f of Object.values(folderMap)) {
    f.children.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  }
  unclassified.sort((a, b) => a.sort_order - b.sort_order);

  // 容器文件夹的直属于子文件夹 → 提升为顶级
  for (const f of Object.values(folderMap)) {
    if (f.isContainer) {
      for (const child of f.children) {
        if (!child.url) {
          child.parentId = null;
          child.parentDbId = null;
        }
      }
    }
  }

  // 收集根 children：常用推荐 + 所有顶级非容器文件夹
  const rootChildren = [];

  if (unclassified.length > 0) {
    rootChildren.push({ id: 'recommended', title: '常用推荐', children: unclassified });
  }

  for (const f of Object.values(folderMap)) {
    if (f.isContainer) continue;
    if (!f.parentDbId || !folderMap[f.parentDbId]) {
      rootChildren.push(f);
    }
  }

  return [{ id: '0', title: 'root', children: rootChildren }];
}

const bookmarksShim = {
  _dbId: function(id) {
    // 从 'bm-123' 或 'folder-123' 提取原始 DB 数字 ID；'recommended' 等虚拟节点返回 NaN（表示根目录）
    if (typeof id === 'number') return id;
    if (!id || id === '0' || id === 'recommended') return null;
    const m = String(id).match(/^(bm|folder)-(\d+)$/);
    return m ? parseInt(m[2]) : null;
  },
  _parentDbId: function(node) {
    // 从节点获取父级 DB ID
    if (!node) return null;
    if (node.parentDbId !== undefined) return node.parentDbId;
    if (node.parentId) return this._dbId(node.parentId);
    return null;
  },
  getTree: async function(callback) {
    await refreshBookmarksCache();
    if (callback) callback(_shimBookmarksCache.tree);
    return _shimBookmarksCache.tree;
  },
  get: async function(idOrIdList, callback) {
    await refreshBookmarksCache();
    const rawIds = Array.isArray(idOrIdList) ? idOrIdList : [idOrIdList];
    // 同时支持 shim 格式 ID（'folder-841'）和纯数字 ID（'841'）
    const ids = new Set(rawIds);
    const results = [];
    function find(nodes) {
      for (const n of nodes) {
        if (ids.has(n.id) || ids.has(String(n.dbId))) results.push(n);
        if (n.children) find(n.children);
      }
    }
    find(_shimBookmarksCache.tree);
    if (callback) callback(results);
    return results;
  },
  getChildren: async function(id, callback) {
    await refreshBookmarksCache();
    function find(nodes) {
      for (const n of nodes) {
        // 支持 shim ID（'folder-841'）和纯数字 ID（'841'）
        if (n.id === id || String(n.dbId) === String(id)) return n.children || [];
        if (n.children) { const r = find(n.children); if (r) return r; }
      }
      return null;
    }
    const children = find(_shimBookmarksCache.tree) || [];
    if (callback) callback(children);
    return children;
  },
  create: async function(bookmark, callback) {
    const data = await apiFetch('/bookmarks', {
      method: 'POST',
      body: JSON.stringify({
        title: bookmark.title, url: bookmark.url,
        folder_id: bookmark.parentDbId || (bookmark.parentId && bookmark.parentId !== '0' ? bookmarksShim._dbId(bookmark.parentId) : null)
      })
    });
    await refreshBookmarksCache();
    const result = { id: 'bm-' + data.bookmark.id, dbId: data.bookmark.id, title: data.bookmark.title, url: data.bookmark.url,
      parentId: data.bookmark.folder_id ? 'folder-' + data.bookmark.folder_id : '0', parentDbId: data.bookmark.folder_id || null };
    if (callback) callback(result);
    return result;
  },
  update: async function(id, changes, callback) {
    const serverChanges = {};
    if (changes.title !== undefined) serverChanges.title = changes.title;
    if (changes.url !== undefined) serverChanges.url = changes.url;
    if (changes.parentId !== undefined) serverChanges.folder_id = changes.parentId !== '0' ? bookmarksShim._dbId(changes.parentId) : null;
    if (changes.position !== undefined) serverChanges.sort_order = changes.position;
    await apiFetch(`/bookmarks/${bookmarksShim._dbId(id)}`, { method: 'PUT', body: JSON.stringify(serverChanges) });
    await refreshBookmarksCache();
    if (callback) callback();
  },
  move: async function(id, destination, callback) {
    const changes = {};
    if (destination.parentId !== undefined) changes.folder_id = destination.parentId !== '0' ? bookmarksShim._dbId(destination.parentId) : null;
    if (destination.index !== undefined) changes.sort_order = destination.index;
    await apiFetch(`/bookmarks/${bookmarksShim._dbId(id)}`, { method: 'PUT', body: JSON.stringify(changes) });
    await refreshBookmarksCache();
    if (callback) callback();
  },
  remove: async function(id, callback) {
    await apiFetch(`/bookmarks/${bookmarksShim._dbId(id)}`, { method: 'DELETE' });
    await refreshBookmarksCache();
    if (callback) callback();
  },
  removeTree: async function(id, callback) {
    const dbId = bookmarksShim._dbId(id);
    // 先删文件夹下的书签，再删文件夹
    try { await apiFetch(`/folders/${dbId}`, { method: 'DELETE' }); } catch {}
    await refreshBookmarksCache();
    if (callback) callback();
  },
  search: async function(query, callback) {
    await refreshBookmarksCache();
    const q = (query.query || '').toLowerCase();
    const results = _shimBookmarksCache.flat.filter(b => b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q));
    if (callback) callback(results.map(b => ({ id: String(b.id), title: b.title, url: b.url })));
    return results;
  },
  onCreated: { addListener: function() {} },
  onRemoved: { addListener: function() {} },
  onChanged: { addListener: function() {} },
  onMoved: { addListener: function() {} }
};

// ===== chrome.storage =====
function createStorageArea(prefix) {
  return {
    get: function(keys, callback) {
      const result = {};
      if (keys === null) {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k.startsWith(prefix)) {
            try { result[k.slice(prefix.length)] = JSON.parse(localStorage.getItem(k)); } catch { result[k.slice(prefix.length)] = localStorage.getItem(k); }
          }
        }
      } else if (typeof keys === 'string') {
        const v = localStorage.getItem(prefix + keys);
        if (v !== null) { try { result[keys] = JSON.parse(v); } catch { result[keys] = v; } }
      } else if (Array.isArray(keys)) {
        for (const k of keys) {
          const v = localStorage.getItem(prefix + k);
          if (v !== null) { try { result[k] = JSON.parse(v); } catch { result[k] = v; } }
        }
      } else if (typeof keys === 'object') {
        for (const [k, def] of Object.entries(keys)) {
          const v = localStorage.getItem(prefix + k);
          if (v !== null) { try { result[k] = JSON.parse(v); } catch { result[k] = v; } }
          else if (!(k in result)) result[k] = def;
        }
      }
      if (callback) callback(result);
      return Promise.resolve(result);
    },
    set: function(items, callback) {
      for (const [k, v] of Object.entries(items)) {
        localStorage.setItem(prefix + k, typeof v === 'string' ? v : JSON.stringify(v));
      }
      if (callback) callback();
      return Promise.resolve();
    },
    remove: function(keys, callback) {
      const keyList = Array.isArray(keys) ? keys : [keys];
      for (const k of keyList) localStorage.removeItem(prefix + k);
      if (callback) callback();
      return Promise.resolve();
    },
    clear: function(callback) {
      const toRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k.startsWith(prefix)) toRemove.push(k);
      }
      for (const k of toRemove) localStorage.removeItem(k);
      if (callback) callback();
      return Promise.resolve();
    }
  };
}

const storageShim = {
  sync: createStorageArea('fh_sync_'),
  local: createStorageArea('fh_local_'),
  session: createStorageArea('fh_session_'),
  onChanged: { addListener: function() {} }
};

// ===== chrome.tabs =====
const tabsShim = {
  create: function(options, callback) {
    const win = window.open(options.url || '', options.active !== false ? '_blank' : undefined);
    const tab = { id: Date.now(), url: options.url, active: true };
    if (callback) callback(tab);
    return Promise.resolve(tab);
  },
  query: function(queryInfo, callback) {
    const tab = { id: 1, url: window.location.href, active: true, windowId: 1 };
    if (callback) callback([tab]);
    return Promise.resolve([tab]);
  },
  sendMessage: function(tabId, message, callback) {
    // 在网页端，消息通过 postMessage 模拟
    if (callback) callback();
    return Promise.resolve();
  },
  update: function(tabId, options, callback) {
    if (options.url) window.location.href = options.url;
    if (callback) callback();
    return Promise.resolve();
  },
  group: function() {},
  onUpdated: { addListener: function() {} },
  onCreated: { addListener: function() {} }
};

// ===== chrome.history =====
const historyShim = {
  search: function(options, callback) {
    if (callback) callback([]);
    return Promise.resolve([]);
  },
  onVisited: { addListener: function() {} }
};

// ===== chrome.identity =====
const identityShim = {
  getRedirectURL: function(path) {
    return window.location.origin + '/oauth-callback.html';
  },
  launchWebAuthFlow: function(options, callback) {
    // 在网页端直接打开 OAuth 窗口
    const width = 600, height = 700;
    const left = (screen.width - width) / 2;
    const top = (screen.height - height) / 2;
    const popup = window.open(options.url, 'oauth', `width=${width},height=${height},left=${left},top=${top}`);

    const timer = setInterval(() => {
      try {
        if (popup.closed) {
          clearInterval(timer);
          callback(null);
        }
      } catch (e) {}
    }, 500);
  }
};

// ===== chrome.commands =====
const commandsShim = {
  getAll: function(callback) { if (callback) callback([]); return Promise.resolve([]); },
  onCommand: { addListener: function() {} }
};

// ===== chrome.action =====
const actionShim = {
  onClicked: { addListener: function() {} },
  setIcon: function() {},
  setBadgeText: function() {},
  setBadgeBackgroundColor: function() {}
};

// ===== chrome.runtime =====
const runtimeShim = {
  getURL: function(path) {
    return '/' + path.replace(/^src\//, '');
  },
  sendMessage: function(message, callback) {
    // 处理同步相关的消息
    if (message.action === 'loginSync' || message.action === 'logoutSync' || message.action === 'getSyncStatus') {
      if (callback) callback({ success: true });
      return;
    }
    if (message.action === 'manualSync') {
      // Web 端：验证登录状态并获取书签数量
      apiFetch('/bookmarks').then(data => {
        const count = (data.bookmarks || []).length;
        if (callback) callback({ success: true, count });
      }).catch(err => {
        if (callback) callback({ success: false, error: err.message });
      });
      return;
    }
    if (message.action === 'openMultipleTabsAndGroup') {
      // Web 端：使用 window.open 打开多个标签页（不支持标签组）
      try {
        const urls = message.urls || [];
        for (const url of urls) {
          window.open(url, '_blank');
        }
        if (callback) callback({ success: true });
      } catch (e) {
        if (callback) callback({ success: false, error: e.message });
      }
      return;
    }
    if (callback) callback();
  },
  onMessage: { addListener: function() {} },
  onInstalled: { addListener: function() {} },
  lastError: null,
  OnInstalledReason: { INSTALL: 'install', UPDATE: 'update' },
  getManifest: function() { return { version: '2.1.1-web' }; }
};

// ===== chrome.management =====
const managementShim = {
  getSelf: function(callback) {
    const info = { installType: 'development', id: 'favshub-web' };
    if (callback) callback(info);
    return Promise.resolve(info);
  }
};

// ===== chrome.sidePanel =====
const sidePanelShim = {
  setOptions: function() { return Promise.resolve(); },
  open: function() { return Promise.resolve(); },
  getOptions: function() { return Promise.resolve({}); }
};

// ===== chrome.favicon =====
// Web 环境统一使用 Google favicon 服务（chrome-extension:// URL 在 Web 中不可用）
function getFaviconUrl(url, size) {
  size = size || 32;
  try {
    const host = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${host}&sz=${size}`;
  } catch (e) {
    return '/images/placeholder-icon.svg';
  }
}

// 规范化 favicon URL：将 chrome-extension:// 和无效 URL 转为可用 URL
function normalizeFavicon(iconUrl, bookmarkUrl) {
  if (iconUrl && (iconUrl.startsWith('/images/') || iconUrl.startsWith('https://'))) return iconUrl;
  if (iconUrl && iconUrl.startsWith('data:')) return iconUrl;
  if (bookmarkUrl) return getFaviconUrl(bookmarkUrl, 32);
  return '/images/placeholder-icon.svg';
}

const faviconShim = {
  getFavicon: function(url, callback) {
    const faviconUrl = getFaviconUrl(url, 32);
    if (callback) callback(faviconUrl);
    return Promise.resolve(faviconUrl);
  }
};

// ===== chrome.i18n =====
// 异步加载语言文件
const _i18nMessages = {};
const _i18nReady = (async function loadLocaleMessages() {
  try {
    const res = await fetch('/_locales/zh_CN/messages.json');
    if (res.ok) {
      const data = await res.json();
      for (const [key, val] of Object.entries(data)) {
        _i18nMessages[key] = typeof val === 'object' && val.message ? val.message : val;
      }
    }
  } catch (e) {
    // 静默失败，getMessage 会回退到返回 key
  }
})();

const i18nShim = {
  getMessage: function(key, substitutions) {
    let msg = _i18nMessages[key] || key;
    // 处理 $1, $2 等占位符
    if (substitutions && Array.isArray(substitutions)) {
      substitutions.forEach((val, i) => {
        msg = msg.replace(`$${i + 1}`, val);
      });
    }
    return msg;
  },
  getUILanguage: function() { return navigator.language || 'zh-CN'; },
  getAcceptLanguages: function(callback) { if (callback) callback(['zh-CN']); return Promise.resolve(['zh-CN']); }
};

// ===== chrome.management =====
// ===== 构建完整的 chrome 对象 =====
window.getFaviconUrl = getFaviconUrl;
window.normalizeFavicon = normalizeFavicon;

// 检测是否在真实扩展环境中运行（content script 在 document_start 注入此标记）
const _isExtensionMode = document.documentElement.getAttribute('data-favshub-ext') === 'active';
// 保存原生 chrome 引用（扩展模式下页面可能有部分原生 API，但普通标签页通常没有）
const _nativeChrome = _isExtensionMode ? window.chrome : null;

window.chrome = {
  bookmarks: (_isExtensionMode && _nativeChrome.bookmarks) ? _nativeChrome.bookmarks : bookmarksShim,
  storage: storageShim,
  tabs: (_isExtensionMode && _nativeChrome.tabs) ? _nativeChrome.tabs : tabsShim,
  history: (_isExtensionMode && _nativeChrome.history) ? _nativeChrome.history : historyShim,
  identity: identityShim,
  commands: commandsShim,
  action: (_isExtensionMode && _nativeChrome.action) ? _nativeChrome.action : actionShim,
  runtime: (_isExtensionMode && _nativeChrome.runtime) ? _nativeChrome.runtime : runtimeShim,
  management: managementShim,
  sidePanel: (_isExtensionMode && _nativeChrome.sidePanel) ? _nativeChrome.sidePanel : sidePanelShim,
  favicon: faviconShim,
  i18n: i18nShim
};

if (_isExtensionMode) {
  
}

// ===== Token 同步 =====
// 登录页用 localStorage.favshub_token，主页内联脚本用 chrome.storage.local.favshub_token
// 确保两者一致
(function syncToken() {
  const direct = localStorage.getItem('favshub_token');
  const shimmed = localStorage.getItem('fh_local_favshub_token');
  if (direct && !shimmed) {
    chrome.storage.local.set({ favshub_token: direct });
  } else if (!direct && shimmed) {
    localStorage.setItem('favshub_token', shimmed);
  }
})();

// ===== 登录检查（跳过登录/注册页面）=====
const _authExcludePaths = ['/login.html', '/register.html', '/oauth-callback.html'];
if (!_authExcludePaths.some(p => window.location.pathname.endsWith(p))) {
  if (!requireAuth()) {
    // 未登录会跳转到 login.html
    throw new Error('未登录');
  }
  // 异步刷新用户信息（含 nickname），确保 localStorage 中有最新数据
  if (!localStorage.getItem('favshub_user')) {
    apiFetch('/auth/me').then(data => {
      if (data && data.user) {
        localStorage.setItem('favshub_user', JSON.stringify(data.user));
      }
    }).catch(() => {});
  }
}

// ===== HTML 转义工具（原 escape-html.js） =====
/**
 * HTML 转义工具 — 防止 XSS 攻击
 * 将用户输入中的特殊字符替换为 HTML 实体，安全插入 DOM
 */
function escapeHtml(str) {
  if (str == null) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

// 挂载到全局，供所有模块使用
window.escapeHtml = escapeHtml;

// ===== 国际化支持（原 localization.js） =====
// 获取用户首选语言
function getUserLanguage() {
  try {
    if (chrome.i18n && typeof chrome.i18n.getUILanguage === 'function') {
      return chrome.i18n.getUILanguage();
    }
  } catch (e) {}
  return navigator.language || 'zh-CN';
}

window.getLocalizedMessage = function(messageName) {
  const userLang = getUserLanguage();
  let message = '';
  try {
    if (chrome.i18n && typeof chrome.i18n.getMessage === 'function') {
      message = chrome.i18n.getMessage(messageName);
    }
  } catch (e) {}

  // 如果没有找到消息，直接返回消息名称
  if (!message) {
    return messageName;
  }

  return message;
};

window.updateUILanguage = function() {
  const userLang = getUserLanguage();

  // 处理常规的 data-i18n 属性
  document.querySelectorAll('[data-i18n]').forEach((element) => {
    const messageName = element.getAttribute('data-i18n');
    const localizedMessage = window.getLocalizedMessage(messageName);
    element.textContent = localizedMessage;
  });

  // 处理 placeholder
  document.querySelectorAll('[data-i18n-placeholder]').forEach((element) => {
    const messageName = element.getAttribute('data-i18n-placeholder');
    element.placeholder = window.getLocalizedMessage(messageName);
  });

  // 处理 title
  document.querySelectorAll('[data-i18n-title]').forEach((element) => {
    const messageName = element.getAttribute('data-i18n-title');
    element.title = window.getLocalizedMessage(messageName);
  });
};

// 在文档加载完成后自动更新 UI 语言
document.addEventListener('DOMContentLoaded', window.updateUILanguage);

