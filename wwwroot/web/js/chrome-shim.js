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
    const width = 600, height = 700;
    const left = (screen.width - width) / 2;
    const top = (screen.height - height) / 2;
    const popup = window.open(options.url, 'oauth', `width=${width},height=${height},left=${left},top=${top}`);

    if (typeof callback === 'function') {
      const timer = setInterval(() => {
        try { if (popup.closed) { clearInterval(timer); callback(null); } } catch (e) {}
      }, 500);
    } else {
      // Web 环境：popup 回调到同源管理后台，通过 postMessage 接收 token
      return new Promise((resolve, reject) => {
        if (!popup) { reject(new Error('AUTH_FAILED')); return; }
        function onMessage(e) {
          if (e.data && e.data.type === 'baidu-oauth-callback' && e.data.accessToken) {
            window.removeEventListener('message', onMessage);
            clearTimeout(timeout);
            resolve('http://oauth?access_token=' + e.data.accessToken + '&expires_in=' + (e.data.expiresIn || ''));
          }
        }
        window.addEventListener('message', onMessage);
        const timeout = setTimeout(() => {
          window.removeEventListener('message', onMessage);
          reject(new Error('AUTH_FAILED'));
        }, 300000);
      });
    }
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
const _i18nMessages = {
  extName: "FavsHub·标签导航",
  extDescription: "FavsHub 是一个基于书签的新标签页应用程序，帮助您高效地组织和访问您的书签。",
  welcomeMessage: "早上好",
  searchPlaceholder: "按 Enter 键搜索，或按 Cmd/Ctrl + Enter 键搜索所有搜索引擎",
  editDialogTitle: "编辑快捷链接",
  editNameLabel: "名称：",
  editUrlLabel: "网址：",
  saveButton: "保存",
  cancelButton: "取消",
  confirmDeleteMessage: "您确定要删除 \"$1\" 吗？",
  confirmDeleteButton: "删除",
  openInNewTab: "在新标签页中打开",
  openInNewWindow: "在新窗口中打开",
  openInIncognito: "在无痕窗口中打开",
  editQuickLink: "编辑",
  deleteQuickLink: "删除",
  copyLink: "复制链接",
  createQRCode: "创建二维码",
  extensionsLinkTitle: "扩展",
  settingsLinkTitle: "设置",
  settingsTitle: "设置",
  appearanceTab: "外观",
  floatingBallTab: "悬浮球",
  languageTab: "语言",
  backgroundColorTitle: "背景颜色",
  floatingBallSettingsTitle: "悬浮球设置",
  floatingBallDescription: "开启悬浮球后会在页面右上角显示一个可点击的悬浮图标，用于快速访问搜索引擎和书签。",
  enableFloatingBall: "启用悬浮球",
  promptPro: "提示词管理",
  adminPanel: "管理后台",
  openSidebar: "打开侧边栏",
  languageSettingsTitle: "语言 / Language",
  englishOption: "English",
  chineseOption: "中文（简体）",
  confirmDeleteBookmark: "您确定要删除书签 \"$1\" 吗？",
  rename: "重命名",
  "delete": "删除",
  setAsHomepage: "设为主页",
  confirmDeleteFolder: "您确定要删除文件夹 \"$1\" 吗？",
  categoryDeleted: "分类已删除",
  searchEngineIconNotFound: "未找到搜索引擎图标",
  folderDeleted: "文件夹已删除：ID=$1，标题=$2",
  morningGreeting: "早上好👋",
  afternoonGreeting: "下午好👋",
  eveningGreeting: "晚上好👋",
  linkCopied: "链接已复制到剪贴板",
  copyLinkFailed: "复制链接失败",
  invalidBookmark: "无效的书签或URL",
  download: "下载",
  copied: "已复制",
  confirmDeleteTitle: "确认删除",
  scanQRCode: "扫描二维码",
  doubaoTab: "豆包",
  metasoTab: "秘塔搜索",
  renameFolderTitle: "重命名文件夹",
  nameLabel: "名称",
  moreSearchSupportToast: "更多搜索支持即将推出",
  historyLinkTitle: "历史记录",
  downloadsLinkTitle: "下载",
  passwordsLinkTitle: "密码",
  confirmDeleteQuickLinkMessage: "您确定要删除快捷链接 \"$1\" 吗？，该链接将不会出现在快速链接列表中。",
  yearProgress: "年进度",
  searchTips: "本次使用:",
  baiduTab: "百度",
  searchEngineUpdateTip: "搜索引擎切换功能已更新",
  searchEngineUpdateDetail: "点击搜索图标可以设置默认搜索引擎，支持自定义搜索引擎，标签栏用于临时切换当次搜索",
  googleLabel: "谷歌",
  bingLabel: "必应",
  baidumLabel: "百度移动",
  baiduLabel: "百度",
  toutiaoLabel: "头条",
  sougouLabel: "搜狗",
  "360Label": "360",
  shenmaLabel: "神马",
  kimiLabel: "Kimi",
  doubaoLabel: "豆包",
  zhidaLabel: "知乎直答",
  qwenLabel: "千问",
  iflowLabel: "心流",
  chatgptLabel: "ChatGPT",
  feloLabel: "Felo",
  metasoLabel: "秘塔",
  backgroundTitle: "背景设置",
  solidBackgroundTitle: "纯色背景",
  pleaseUploadImage: "请上传图片文件",
  imageSizeExceeded: "图片大小超过限制（最大10MB），请选择较小的图片",
  fileReadError: "读取文件失败，请重试",
  lowResolutionWarning: "图片分辨率过低，建议使用至少 $1 x $2 的图片以获得最佳效果",
  imageLoadError: "图片加载失败，请尝试其他图片",
  storageError: "存储空间不足，请清理后重试",
  noValidImagesFound: "未找到有效的图片文件",
  aboutTab: "关于",
  aboutTitle: "关于 TabMark",
  aboutDescription: "TabMark 是一个简洁、高效的书签管理扩展，帮助您更好地组织和访问您的网络收藏。",
  sourceCode: "源代码",
  contactUs: "联系我们",
  version: "版本 $1",
  officialWebsite: "官方网站",
  feedback: "邮箱",
  settingsUpdateTip: "你可以在这里设置背景颜色、悬浮球、推荐网站、链接打开方式、清理失效书签...",
  deleteSuccess: "删除成功",
  quickLinksTab: "网站推荐",
  quickLinksSettings: "网站推荐设置",
  quickLinksDescription: "开启网站推荐后，将在搜索框下方显示您最常访问的网站，方便快速访问。访问新的网站时会自动更新推荐列表。",
  enableQuickLinks: "启用网站推荐",
  namePrompt: "我该怎么称呼你：",
  openAllBookmarks: "打开所有书签",
  bookmarkCleanupTitle: "书签清理",
  bookmarkCleanupNotInstalled: "您尚未安装书签清理插件。是否前往 Chrome 商店安装？",
  newFeatureTitle: "新功能提示",
  bookmarkCleanupFeature: "新增书签清理功能：点击侧边栏的设置图标，安装书签清理拓展，轻松清理重复和失效的书签，查看你的书签统计画像",
  bookmarkManagementTab: "书签整理",
  bookmarkCleanupSettingsTitle: "书签清理与统计",
  bookmarkCleanupSettingsDescription: "清理重复和失效的书签，查看书签使用统计数据，帮助您更好地管理书签。",
  openBookmarkCleanup: "打开书签清理工具",
  floatingBallClickTip: "点击",
  floatingBallClickDesc: "打开快速搜索",
  floatingBallAltClickTip: "Alt + 点击",
  floatingBallAltClickDesc: "打开侧边栏",
  floatingBallShortcutTip: "Alt/Command + B",
  floatingBallShortcutDesc: "快捷键打开侧边栏",
  doNotShowAgain: "不再显示此提示",
  linkOpeningTab: "链接打开方式",
  linkOpeningSettingsTitle: "链接打开方式设置",
  linkOpeningDescription: "设置在主页面中点击书签和快捷链接时的打开方式。",
  sidePanelLinkOpeningTitle: "侧边栏链接打开方式",
  sidePanelLinkOpeningDescription: "设置在侧边栏中点击书签和快捷链接时的打开方式",
  sidePanelOpenInNewTab: "在新标签页中打开",
  sidePanelOpenInSidepanel: "在侧边栏中打开",
  sidebarFeaturesFeature: "新增两项功能：\n1. 快捷侧边栏：\n在任意网页按下 Alt/Command + B，即可打开侧边栏，快速访问书签和搜索功能。\n\n2. 链接打开方式：\n在设置中可自定义书签和快捷链接的打开方式，选择是否在新标签页中打开。",
  layoutTab: "布局设置",
  layoutSettingsTitle: "布局设置",
  layoutSettingsDescription: "自定义书签和界面的布局显示方式",
  bookmarkWidthTitle: "书签宽度设置",
  previewText: "每行书签按钮数量：",
  bookmarkHeightTitle: "书签卡片高度",
  heightPreviewText: "调整书签卡片的高度",
  addSearchEngine: "添加",
  searchEnginesTitle: "搜索引擎设置",
  aiSearchEnginesTitle: "AI 搜索",
  generalSearchEnginesTitle: "通用搜索",
  socialSearchEnginesTitle: "社交媒体",
  customSearchEnginesTitle: "自定义搜索引擎",
  searchEngineNamePlaceholder: "搜索引擎名称",
  searchEngineUrlPlaceholder: "搜索 URL (使用 %s 作为搜索词占位符)",
  searchEngineIconPlaceholder: "图标 URL（可选，留空将自动获取）",
  addSearchEngineButton: "添加",
  searchEngineAddSuccess: "搜索引擎添加成功",
  searchEngineAddError: "添加搜索引擎失败，请重试",
  searchEngineDeleteConfirm: "确定要删除此搜索引擎吗？",
  searchEngineNameRequired: "请输入搜索引擎名称",
  searchEngineUrlRequired: "请输入搜索引擎URL",
  searchEngineUrlInvalid: "请输入有效的URL，需包含 %s 作为搜索词占位符",
  semanticscholarLabel: "Semantic",
  deepseekLabel: "Deepseek",
  yahooLabel: "雅虎",
  duckduckgoLabel: "DuckDuckGo",
  yandexLabel: "Yandex",
  xiaohongshuLabel: "小红书",
  jikeLabel: "即刻",
  zhihuLabel: "知乎",
  doubanLabel: "豆瓣",
  bilibiliLabel: "哔哩哔哩",
  githubLabel: "GitHub",
  perplexityLabel: "Perplexity",
  claudeLabel: "Claude",
  deleteFolderError: "删除文件夹失败，请重试",
  searchEngineUpdateFeature: "搜索引擎切换功能已更新：\n1. 点击搜索图标设置默认搜索引擎\n2. 支持自定义搜索引擎\n3. 使用标签栏进行临时切换",
  themeTitle: "主题设置",
  lightTheme: "浅色",
  darkTheme: "深色",
  autoTheme: "跟随系统",
  addToDefaultFolders: "固定到主页",
  removeFromDefaultFolders: "取消固定",
  addedToDefaultFolders: "已将 $1 固定到主页",
  removedFromDefaultFolders: "已取消固定 $1",
  maxDefaultFoldersReached: "最多只能固定8个文件夹",
  interfaceElementsTitle: "界面元素显示",
  showSearchBox: "显示搜索框",
  showWelcomeMessage: "显示欢迎语",
  showFooter: "显示页脚",
  quickAccessLinksTitle: "快捷访问链接",
  showHistoryLink: "显示历史记录",
  showDownloadsLink: "显示下载记录",
  showPasswordsLink: "显示密码管理",
  showExtensionsLink: "显示扩展管理",
  searchTab: "搜索设置",
  searchSettingsTitle: "搜索设置",
  searchSettingsDescription: "自定义搜索建议的显示内容和行为",
  searchSuggestionsTitle: "搜索建议设置",
  showHistorySuggestions: "显示历史记录建议",
  showBookmarkSuggestions: "显示书签建议",
  showPromptSuggestions: "显示提示词建议",
  containerWidthTitle: "书签容器宽度",
  containerWidthDescription: "调整书签容器在页面中的宽度比例",
  donateTab: "赞赏",
  donateTitle: "支持 TabMark 开发",
  donateDescription: "如果您觉得 TabMark 有用，请考虑支持它的持续开发。您的贡献将帮助我们改进扩展并添加新功能。",
  wechatDonateTitle: "微信支付",
  paypalDonateTitle: "PayPal",
  scanQRCodeToDonate: "扫描二维码赞赏",
  donateListLink: "查看赞赏列表",
  donateWithPaypal: "使用 PayPal 捐赠",
  thankYouForSupport: "感谢您的支持！",
  bookmarksPerRow: "$1 个/行",
  customTabFeature: "新增自定义标签页功能：\n1. 现在您可以自定义主页显示的内容，在设置中的「布局设置」选项卡下\n2. 可以选择隐藏或显示搜索框、欢迎语和页脚\n3. 可以自定义快捷访问链接的显示\n4. 调整书签容器宽度，获得最适合您的布局\n5. 在「搜索设置」中可以选择是否显示历史记录和书签建议\n6. 新增「赞赏」选项，如果您喜欢这个扩展，可以通过微信赞赏支持开发",
  grokLabel: "Grok",
  searchBoxDisplayTitle: "搜索框显示",
  shortcutsTab: "快捷键",
  wechatGroup: "微信群",
  feedbacks: "反馈建议",
  shortcutsSettingsTitle: "快捷键设置",
  shortcutsSettingsDescription: "自定义快捷键设置",
  sidebarShortcutName: "侧边栏快捷键",
  configureShortcuts: "配置快捷键",
  shortcutValue: "默认",
  shortcutsFeature: "新增功能：\n1. 侧边栏快捷键自定义：现在您可以在Chrome扩展快捷键设置中自定义打开侧边栏的快捷键\n2. 在设置 > 快捷键中可以快速跳转到Chrome快捷键设置页面\n3. 双向控制：按下相同的快捷键可以打开或关闭侧边栏，更加便捷\n\n自定义标签页功能：\n1. 现在您可以自定义主页显示的内容，在设置中的「布局设置」选项卡下\n2. 可以选择隐藏或显示搜索框、欢迎语和页脚\n3. 可以自定义快捷访问链接的显示\n4. 调整书签容器宽度，获得最适合您的布局\n5. 在「搜索设置」中可以选择是否显示历史记录和书签建议\n6. 新增「赞赏」选项，如果您喜欢这个扩展，可以通过微信赞赏支持开发",
  searchResultsOpeningTitle: "搜索结果打开方式",
  openSearchInNewTab: "在新标签页中打开搜索结果",
  searchSuggestionsFeature: "1.245版本更新：\n1. 修复全部搜索功能：现在使用Cmd/Ctrl+Enter搜索时会包含默认搜索引擎\n2. 新增搜索结果打开方式设置：可以选择在新标签页或当前页面打开搜索结果\n3. 新增书签卡片高度自定义：可以根据个人喜好调整书签卡片的高度\n4. 新增侧边栏链接打开方式自定义，可选择在侧边栏中打开链接\n5. 修复了多个UI界面问题，提升用户体验",
  bookmarkCardHeightTitle: "书签卡片高度",
  bookmarkCardHeightValue: "$1 像素",
  categoryLabel: "分类",
  backupTab: "数据备份",
  backupTitle: "自动备份 PromptPro 数据",
  backupDescription: "选择本地文件夹，自动备份 PromptPro 的提示词、文件夹、标签和版本历史。",
  selectBackupFolder: "选择文件夹",
  enableAutoBackup: "每日自动备份",
  manualBackupTitle: "手动备份",
  backupNow: "立即备份",
  neverBackedUp: "上次备份：未备份",
  backupFolderNotSelected: "未选择",
  backupSuccess: "备份成功：$1",
  backupFailed: "备份失败，请重试",
  folderSelected: "已选择：$1",
  baiduPanTitle: "百度网盘云端备份",
  baiduPanDescription: "将 PromptPro 数据备份到百度网盘，需要自行注册百度开放平台应用。",
  baiduPanConnect: "连接百度网盘",
  baiduPanDisconnect: "断开连接",
  baiduPanAutoBackup: "云端自动备份",
  baiduPanUploadNow: "立即上传",
  baiduPanCloudHistory: "云端备份记录",
  baiduPanNoHistory: "暂无云端备份记录",
  baiduPanConnected: "已连接",
  baiduPanDisconnected: "未连接",
  baiduPanTokenExpired: "登录已过期，请重新连接",
  baiduPanUploadSuccess: "云端备份成功：$1",
  baiduPanUploadFailed: "云端备份失败：$1"
};

const i18nShim = {
  getMessage: function(key, substitutions) {
    let msg = _i18nMessages[key] || key;
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

// ===== 国际化支持（已简化为硬编码中文） =====
window.getLocalizedMessage = function(messageName) {
  return _i18nMessages[messageName] || messageName;
};

