let bookmarkTreeNodes = [];
let defaultSearchEngine = 'google';
let contextMenu = null;
let currentBookmark = null;

// 使用单一的状态变量
let itemToDelete = null;

// Define and initialize the variables
let bookmarkFolderContextMenu = null;
let currentBookmarkFolder = null;
let lastStorageWrite = 0;
let pendingWrite = null;
let sidebarSortableInstances = [];
const STORAGE_WRITE_INTERVAL = 1000; // 1秒的节流间隔

// ===== 扩展通信：快捷访问链接 =====
let _extConnected = undefined; // undefined = 未检测, true/false = 已检测

function sendExtensionMessage(action, extraParams = {}) {
  return new Promise((resolve) => {
    const requestId = Date.now().toString() + Math.random().toString(36).slice(2);
    const handler = (event) => {
      if (event.data?.type === 'favshub-ext-response' && event.data?.requestId === requestId) {
        window.removeEventListener('message', handler);
        resolve(event.data.payload);
      }
    };
    window.addEventListener('message', handler);
    window.postMessage({ type: 'favshub-ext-request', action, requestId, ...extraParams }, '*');
    setTimeout(() => { window.removeEventListener('message', handler); resolve(null); }, 3000);
  });
}

async function detectExtension() {
  if (_extConnected !== undefined) return _extConnected;
  try {
    const res = await sendExtensionMessage('ping');
    _extConnected = !!(res && res.connected);
  } catch {
    _extConnected = false;
  }
  return _extConnected;
}

// Web 模式下显示书签容器
function updateContainerHeight() {
  const container = document.querySelector('.bookmarks-container');
  if (!container) return;
  // 仅负责显示容器，高度由内容自适应
  container.classList.add('loaded');
}

// 从 FavsHubSettings 读取并在 DOM 中应用书签布局设置
function applyLayoutSettings() {
  // 书签卡片高度
  const savedCardHeight = FavsHubSettings.get('bookmarkCardHeight');
  if (savedCardHeight) {
    let styleElement = document.getElementById('custom-card-height');
    if (!styleElement) {
      styleElement = document.createElement('style');
      styleElement.id = 'custom-card-height';
      document.head.appendChild(styleElement);
    }
    styleElement.textContent = `.card { height: ${savedCardHeight}px !important; }`;
  }

  // 书签宽度（CSS 变量）
  const savedBookmarkWidth = FavsHubSettings.get('bookmarkWidth') || 200;
  document.documentElement.style.setProperty('--bookmark-width', `${savedBookmarkWidth}px`);

  // 书签容器宽度
  const savedContainerWidth = FavsHubSettings.get('bookmarkContainerWidth') || 85;
  const bookmarksContainer = document.querySelector('.bookmarks-container');
  if (bookmarksContainer) bookmarksContainer.style.width = `${savedContainerWidth}%`;
}

/**
 * 统一应用所有管理员设置到页面元素。
 * 替代原 settings.js 中 SettingsManager.applyAllSettings()，
 * 在 FavsHubSettings.load() 完成后调用一次即可。
 */
function applyAllSettings() {
  // --- 主题 ---
  const theme = FavsHubSettings.get('theme') || 'auto';
  let effectiveTheme = theme;
  if (theme === 'auto') {
    effectiveTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-theme', effectiveTheme);
  document.body.setAttribute('data-theme', effectiveTheme);
  const themeSelect = document.getElementById('theme-select');
  if (themeSelect) themeSelect.value = theme;
  if (typeof updateThemeIcon === 'function') updateThemeIcon(effectiveTheme === 'dark');

  // --- 书签布局（宽度、高度、容器宽度）---
  applyLayoutSettings();

  // --- 书签网格布局（CSS 变量 + grid）---
  const savedWidth = FavsHubSettings.get('bookmarkWidth') || 200;
  document.documentElement.style.setProperty('--bookmark-width', savedWidth + 'px');
  const bookmarksList = document.getElementById('bookmarks-list');
  if (bookmarksList) {
    bookmarksList.style.gridTemplateColumns = `repeat(auto-fit, minmax(${savedWidth}px, 1fr))`;
    bookmarksList.style.gap = '1rem';
  }

  // --- 容器宽度百分比 ---
  const savedContainerWidth = FavsHubSettings.get('bookmarkContainerWidth') || 85;
  const bContainer = document.querySelector('.bookmarks-container');
  if (bContainer) bContainer.style.width = `${savedContainerWidth}%`;

  // --- 背景（管理员设定）---
  const adminBg = FavsHubSettings.get('selectedBackground');
  const adminWallpaper = FavsHubSettings.get('wallpaperUrl');
  const hasUserWallpaper = localStorage.getItem('originalWallpaper');

  // 清除所有背景选项 active 状态
  document.querySelectorAll('.settings-bg-option').forEach(opt => opt.classList.remove('active'));

  if (hasUserWallpaper) {
    // 用户壁纸优先级最高（localStorage 残留，兼容旧数据）
    const wallpaperOption = document.querySelector(`.wallpaper-option[data-wallpaper-url="${hasUserWallpaper}"]`);
    if (wallpaperOption) wallpaperOption.classList.add('active');
  } else if (adminWallpaper) {
    // 管理员壁纸 URL 生效中（wallpaper.js 已应用壁纸）
    document.documentElement.className = '';
  } else if (adminBg) {
    // 管理员纯色背景
    document.documentElement.className = adminBg;
    const activeOption = document.querySelector(`[data-bg="${adminBg}"]`);
    if (activeOption) activeOption.classList.add('active');
  } else {
    // 兜底：默认梯度背景
    document.documentElement.className = 'gradient-background-7';
    const defaultOption = document.querySelector('[data-bg="gradient-background-7"]');
    if (defaultOption) defaultOption.classList.add('active');
  }

  // --- 布局可见性 ---
  const showSearchBox = FavsHubSettings.get('showSearchBox') !== false;
  const showWelcome = FavsHubSettings.get('showWelcomeMessage') !== false;
  const showFooterSetting = FavsHubSettings.get('showFooter') !== false;

  const searchContainer = document.querySelector('.search-container');
  if (searchContainer) searchContainer.style.display = showSearchBox ? '' : 'none';

  const welcomeEl = document.getElementById('welcome-message');
  if (welcomeEl) {
    welcomeEl.style.visibility = 'visible';
    welcomeEl.style.display = showWelcome ? '' : 'none';
  }

  const footerEl = document.querySelector('footer');
  if (footerEl) footerEl.style.display = showFooterSetting ? '' : 'none';

  // --- 快捷访问链接 ---
  const toggleVis = (sel, visible) => { const el = document.querySelector(sel); if (el) el.style.display = visible ? '' : 'none'; };
  toggleVis('#history-link', FavsHubSettings.get('showHistoryLink') !== false);
  toggleVis('#downloads-link', FavsHubSettings.get('showDownloadsLink') !== false);
  toggleVis('#passwords-link', FavsHubSettings.get('showPasswordsLink') !== false);
  toggleVis('#extensions-link', FavsHubSettings.get('showExtensionsLink') !== false);

  // --- 搜索引擎图标 ---
  const defaultEngine = FavsHubSettings.get('selectedSearchEngine') || 'google';
  updateSearchEngineIcon(defaultEngine);

  
}

/**
 * 初始化主题交互控件（系统主题变化监听、主题切换按钮）。
 * 只需调用一次。
 */
function initThemeControls() {
  // 监听系统主题变化
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (FavsHubSettings.get('theme') === 'auto') {
      const isDark = e.matches;
      document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
      document.body.setAttribute('data-theme', isDark ? 'dark' : 'light');
      if (typeof updateThemeIcon === 'function') updateThemeIcon(isDark);
    }
  });

  // 主题选择下拉框
  const themeSelect = document.getElementById('theme-select');
  if (themeSelect) {
    themeSelect.addEventListener('change', (e) => {
      const theme = e.target.value;
      FavsHubSettings.set('theme', theme);
      let effective = theme;
      if (theme === 'auto') {
        effective = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
      document.documentElement.setAttribute('data-theme', effective);
      document.body.setAttribute('data-theme', effective);
      if (typeof updateThemeIcon === 'function') updateThemeIcon(effective === 'dark');
    });
  }

  // 主题切换按钮
  const navThemeBtn = document.getElementById('navThemeBtn');
  const themeToggleBtn = document.getElementById('theme-toggle-btn');
  const toggleTheme = () => {
    const current = FavsHubSettings.get('theme') || 'light';
    const newTheme = current === 'dark' ? 'light' : 'dark';
    FavsHubSettings.set('theme', newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
    document.body.setAttribute('data-theme', newTheme);
    if (typeof updateThemeIcon === 'function') updateThemeIcon(newTheme === 'dark');
    const themeSelectEl = document.getElementById('theme-select');
    if (themeSelectEl) themeSelectEl.value = newTheme;
  };
  if (navThemeBtn) navThemeBtn.addEventListener('click', toggleTheme);
  if (themeToggleBtn) themeToggleBtn.addEventListener('click', toggleTheme);
}

// 解决函数未定义错误，将这些函数提升到全局范围
// 创建二维码函数
function createQRCode(url, bookmarkName) {
  // 创建一个模态来显示二维码
  const modal = document.createElement('div');
  modal.style.position = 'fixed';
  modal.style.left = '0';
  modal.style.top = '0';
  modal.style.width = '100%';
  modal.style.height = '100%';
  modal.style.backgroundColor = 'rgba(0,0,0,0.5)';
  modal.style.display = 'flex';
  modal.style.justifyContent = 'center';
  modal.style.alignItems = 'center';
  modal.style.zIndex = '1000';

  const qrContainer = document.createElement('div');
  qrContainer.style.backgroundColor = 'white';
  qrContainer.style.padding = '1.5rem 3rem';
  qrContainer.style.width = '320px';
  qrContainer.style.borderRadius = '10px';
  qrContainer.style.display = 'flex';
  qrContainer.style.flexDirection = 'column';
  qrContainer.style.alignItems = 'center';
  qrContainer.style.position = 'relative';

  // 添加关闭按钮
  const closeButton = document.createElement('span');
  closeButton.textContent = '×';
  closeButton.style.position = 'absolute';
  closeButton.style.right = '10px';
  closeButton.style.top = '10px';
  closeButton.style.fontSize = '20px';
  closeButton.style.cursor = 'pointer';
  closeButton.onclick = () => document.body.removeChild(modal);
  qrContainer.appendChild(closeButton);

  // 添加标题
  const title = document.createElement('h2');
  title.textContent = getLocalizedMessage('scanQRCode');
  title.style.marginBottom = '20px';
  title.style.fontWeight = '600';
  title.style.fontSize = '0.875rem';
  qrContainer.appendChild(title);

  // 创建 QR 码容器
  const qrCodeElement = document.createElement('div');
  qrContainer.appendChild(qrCodeElement);

  // 添加 URL 显示
  const urlDisplay = document.createElement('div');
  urlDisplay.textContent = url;
  urlDisplay.style.marginTop = '20px';
  urlDisplay.style.wordBreak = 'break-all';
  urlDisplay.style.maxWidth = '300px';
  urlDisplay.style.textAlign = 'center';
  qrContainer.appendChild(urlDisplay);

  // 添加按钮容器
  const buttonContainer = document.createElement('div');
  buttonContainer.style.display = 'flex';
  buttonContainer.style.justifyContent = 'space-between';
  buttonContainer.style.width = '100%';
  buttonContainer.style.marginTop = '20px';

  // 添加复制按钮
  const copyButton = document.createElement('button');
  copyButton.textContent = getLocalizedMessage('copyLink');
  copyButton.onclick = () => {
    navigator.clipboard.writeText(url).then(() => {
      copyButton.textContent = getLocalizedMessage('copied');
      setTimeout(() => copyButton.textContent = getLocalizedMessage('copyLink'), 2000);
    });
  };

  // 添加下载按钮
  const downloadButton = document.createElement('button');
  downloadButton.textContent = getLocalizedMessage('download');
  downloadButton.onclick = () => {
    // 给 QRCode 生成一些时间
    setTimeout(() => {
      const canvas = qrCodeElement.querySelector('canvas');
      if (canvas) {
        const link = document.createElement('a');
        // 使用书签名称作为文件名，并添加 .png 扩展名
        const fileName = `${bookmarkName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_qrcode.png`;
        link.download = fileName;
        link.href = canvas.toDataURL('image/png');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
    }, 100); // 给予 100ms 的延迟，确保 QR 码已经生成
  };

  // 设置按钮样式和hover效果
  [copyButton, downloadButton].forEach(button => {
    button.style.padding = '5px 10px';
    button.style.border = 'none';
    button.style.borderRadius = '5px';
    button.style.cursor = 'pointer';
    button.style.backgroundColor = '#f0f0f0';
    button.style.color = '#333';
    button.style.transition = 'all 0.3s ease';

    // 添加hover效果
    button.addEventListener('mouseenter', () => {
      button.style.backgroundColor = '#e0e0e0';
      button.style.color = '#111827';
    });
    button.addEventListener('mouseleave', () => {
      button.style.backgroundColor = '#f0f0f0';
      button.style.color = '#717882';
    });
  });

  buttonContainer.appendChild(copyButton);
  buttonContainer.appendChild(downloadButton);
  qrContainer.appendChild(buttonContainer);

  modal.appendChild(qrContainer);
  document.body.appendChild(modal);

  // 使用 qrcode.js 库生成二维码
  new QRCode(qrCodeElement, {
    text: url,
    width: 200,
  });

  // 点击模态框外部关闭
  modal.addEventListener('click', function (event) {
    if (event.target === modal) {
      document.body.removeChild(modal);
    }
  });
}

// 递归收集所有文件夹
function getAllFolders(nodes, level = 0) {
  let folders = [];
  nodes.forEach(function (node) {
    if (node.children && !node.url) {
      folders.push({ id: node.id, title: node.title, level: level });
      folders = folders.concat(getAllFolders(node.children, level + 1));
    }
  });
  return folders;
}

function closeEditCategoryDropdown() {
  const trigger = document.querySelector('#edit-dialog .edit-category-select-trigger');
  const dropdown = document.querySelector('#edit-dialog .edit-category-select-dropdown');
  if (!trigger || !dropdown) return;
  trigger.classList.remove('open');
  dropdown.classList.remove('open');
}

function syncEditCategoryCustomSelect() {
  const select = document.getElementById('edit-category');
  const wrapper = document.getElementById('edit-category-select-wrapper');
  if (!select || !wrapper) return;

  const triggerText = wrapper.querySelector('.edit-category-select-text');
  const dropdown = wrapper.querySelector('.edit-category-select-dropdown');
  if (!triggerText || !dropdown) return;

  dropdown.innerHTML = '';

  Array.from(select.options).forEach((option) => {
    const optionEl = document.createElement('button');
    optionEl.type = 'button';
    optionEl.className = 'edit-category-select-option';
    optionEl.dataset.value = option.value;

    const level = Number(option.dataset.level || 0);
    optionEl.style.paddingLeft = `${12 + (level * 18)}px`;

    if (option.selected) {
      optionEl.classList.add('selected');
      triggerText.textContent = option.textContent.trim();
      triggerText.classList.remove('placeholder');
    }

    const label = document.createElement('span');
    label.className = 'edit-category-select-option-label';
    label.textContent = option.textContent.trim();
    optionEl.appendChild(label);

    optionEl.addEventListener('click', () => {
      select.value = option.value;
      Array.from(select.options).forEach((selectOption) => {
        selectOption.selected = selectOption.value === option.value;
      });
      syncEditCategoryCustomSelect();
      closeEditCategoryDropdown();
    });

    dropdown.appendChild(optionEl);
  });

  if (!select.value && select.options.length > 0) {
    select.options[0].selected = true;
    triggerText.textContent = select.options[0].textContent.trim();
    triggerText.classList.remove('placeholder');
  }
}

function initEditCategoryCustomSelect() {
  const select = document.getElementById('edit-category');
  if (!select || document.getElementById('edit-category-select-wrapper')) return;

  const wrapper = document.createElement('div');
  wrapper.id = 'edit-category-select-wrapper';
  wrapper.className = 'edit-category-select';

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'edit-category-select-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');

  const triggerText = document.createElement('span');
  triggerText.className = 'edit-category-select-text placeholder';
  triggerText.textContent = '选择分类';

  const arrow = document.createElement('span');
  arrow.className = 'edit-category-select-arrow';
  arrow.innerHTML = ICONS.expand_less;

  const dropdown = document.createElement('div');
  dropdown.className = 'edit-category-select-dropdown';

  trigger.appendChild(triggerText);
  trigger.appendChild(arrow);
  wrapper.appendChild(trigger);
  wrapper.appendChild(dropdown);
  select.insertAdjacentElement('afterend', wrapper);

  trigger.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const isOpen = trigger.classList.contains('open');
    closeEditCategoryDropdown();
    if (!isOpen) {
      trigger.classList.add('open');
      dropdown.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');
    } else {
      trigger.setAttribute('aria-expanded', 'false');
    }
  });

  document.addEventListener('click', (event) => {
    if (!wrapper.contains(event.target)) {
      trigger.setAttribute('aria-expanded', 'false');
      closeEditCategoryDropdown();
    }
  });

  syncEditCategoryCustomSelect();
}

// 编辑书签对话框函数
function openEditDialog(bookmark) {
  const bookmarkId = bookmark.id;
  const bookmarkTitle = bookmark.title;
  const bookmarkUrl = bookmark.url;

  document.getElementById('edit-name').value = bookmarkTitle;
  document.getElementById('edit-url').value = bookmarkUrl;

  // 填充分类下拉
  const categorySelect = document.getElementById('edit-category');
  categorySelect.innerHTML = '';
  const allFolders = getAllFolders(bookmarkTreeNodes);
  allFolders.forEach(function (folder) {
    const option = document.createElement('option');
    option.value = folder.id;
    option.dataset.level = folder.level;
    const indent = '    '.repeat(folder.level);
    option.textContent = indent + folder.title;
    if (folder.id === bookmark.parentId) {
      option.selected = true;
    }
    categorySelect.appendChild(option);
  });

  initEditCategoryCustomSelect();
  syncEditCategoryCustomSelect();

  const editDialog = document.getElementById('edit-dialog');
  editDialog.style.display = 'block';

  // 设置提交事件
  document.getElementById('edit-form').onsubmit = function (event) {
    event.preventDefault();
    const newTitle = document.getElementById('edit-name').value;
    const newUrl = document.getElementById('edit-url').value;
    const newParentId = document.getElementById('edit-category').value;
    const oldParentId = bookmark.parentId;

    function doUpdate() {
      chrome.bookmarks.update(bookmarkId, { title: newTitle, url: newUrl }, function () {
        editDialog.style.display = 'none';
        updateSpecificBookmarkCard(bookmarkId, newTitle, newUrl);
      });
    }

    // 如果分类有变更，先将书签移动到新目录，再更新标题和URL
    if (newParentId !== oldParentId) {
      chrome.bookmarks.move(bookmarkId, { parentId: newParentId }, function () {
        updateBookmarksDisplay(oldParentId);
        doUpdate();
      });
    } else {
      doUpdate();
    }
  };

  // 添加取消按钮的事件监听
  document.querySelector('.cancel-button').addEventListener('click', function () {
    editDialog.style.display = 'none';
  });

  // 添加关闭按钮的事件监听
  document.querySelector('.close-button').addEventListener('click', function () {
    editDialog.style.display = 'none';
  });
}

function updateThemeIcon(isDark) {
  const themeToggleBtn = document.getElementById('theme-toggle-btn');
  if (!themeToggleBtn) return;

  themeToggleBtn.innerHTML = isDark ? ICONS.dark_mode : ICONS.light_mode;
}

// replaceIconsWithSvg and getIconHtml are now global from icons.js

// 初始化左侧导航栏 - 加载书签树
function initSidebarNavigation() {
  chrome.bookmarks.getTree(function (nodes) {
    bookmarkTreeNodes = nodes;
    displayBookmarkCategories(bookmarkTreeNodes[0].children, 0, null, '1');
  });
}

document.addEventListener('DOMContentLoaded', async function () {
  // 初始化左侧导航栏
  initSidebarNavigation();

  // 等待后端设置加载完成（获取管理员全局默认设置）
  await FavsHubSettings.load();

  // 统一应用所有管理员设置到页面
  applyAllSettings();

  // 初始化主题交互控件（系统主题监听、切换按钮）
  initThemeControls();

  // 初始化手势导航，传入 updateBookmarksDisplay 函数
  initGestureNavigation(updateBookmarksDisplay);
  
  // 替换所有图标
  replaceIconsWithSvg();

  // 或者在动态创建元素时使用
  const button = document.createElement('button');
  button.innerHTML = getIconHtml('settings') + ' Settings';

  // 更新这部分代码
  updateSearchEngineIcon(defaultSearchEngine);

  const searchEngineIcon = document.getElementById('search-engine-icon');
  if (searchEngineIcon && searchEngineIcon.src === '') {      
    searchEngineIcon.src = '/images/placeholder-icon.svg';
  }
});

function getLocalizedMessage(messageName) {
  const message = chrome.i18n.getMessage(messageName);
  return message || messageName;
}

// Define the context menu creation function
function createContextMenu() {
  
  // 移除任何已存在的上下文菜单
  const existingMenu = document.querySelector('.custom-context-menu');
  if (existingMenu) {
    existingMenu.remove();
  }

  const menu = document.createElement('div');
  menu.className = 'custom-context-menu';
  document.body.appendChild(menu);

  const menuItems = [
    { text: getLocalizedMessage('openInNewTab'), icon: 'open_in_new', action: () => currentBookmark && window.open(currentBookmark.url, '_blank') },
    { text: getLocalizedMessage('openInNewWindow'), icon: 'launch', action: () => currentBookmark && openInNewWindow(currentBookmark.url) },
    { text: getLocalizedMessage('openInIncognito'), icon: 'visibility_off', action: () => currentBookmark && openInIncognito(currentBookmark.url) },
    { text: getLocalizedMessage('editQuickLink'), icon: 'edit', action: () => currentBookmark && openEditDialog(currentBookmark) },
    { 
      text: getLocalizedMessage('deleteQuickLink'), 
      icon: 'delete', 
      action: () => {
        
        if (!currentBookmark) {
          
          return;
        }

        itemToDelete = {
          type: currentBookmark.type,
          data: {
            id: currentBookmark.id,
            title: currentBookmark.title,
            url: currentBookmark.url
          }
        };
        
        
        const message = itemToDelete.type === 'quickLink' 
          ? chrome.i18n.getMessage("confirmDeleteQuickLink", [`<strong>${itemToDelete.data.title}</strong>`])
          : chrome.i18n.getMessage("confirmDeleteBookmark", [`<strong>${itemToDelete.data.title}</strong>`]);
        
        showConfirmDialog(message, () => {
          if (itemToDelete && itemToDelete.data) {
            if (itemToDelete.type === 'quickLink') {
              deleteQuickLink(itemToDelete.data);
            } else {
              deleteBookmark(itemToDelete.data.id, itemToDelete.data.title);
            }
          }
        });
      }
    },
    { text: getLocalizedMessage('copyLink'), icon: 'content_copy', action: () => currentBookmark && Utilities.copyBookmarkLink(currentBookmark) },
    { text: getLocalizedMessage('createQRCode'), icon: 'qr_code', action: () => currentBookmark && createQRCode(currentBookmark.url, currentBookmark.title) }
  ];

  menuItems.forEach((item, index) => {
    // 在特定位置添加分隔线
    if (index === 3 || index === 5) {
      const divider = document.createElement('div');
      divider.className = 'custom-context-menu-divider';
      menu.appendChild(divider);
    }
    
    const menuItem = document.createElement('div');
    menuItem.className = 'custom-context-menu-item';
    
    const icon = document.createElement('span');
    icon.className = 'material-icons';
    icon.innerHTML = ICONS[item.icon];
    icon.style.marginRight = '8px';
    icon.style.fontSize = '18px';
    
    const text = document.createElement('span');
    text.textContent = item.text;

    menuItem.appendChild(icon);
    menuItem.appendChild(text);

    menuItem.addEventListener('click', () => {
      if (typeof item.action === 'function') {
        item.action();
      }
      menu.style.display = 'none';
    });

    menu.appendChild(menuItem);
  });

  return menu;
}

// 在文件顶部添加这个函数
function applyBackgroundColor() {
    const savedBg = FavsHubSettings.get('selectedBackground');
    if (savedBg) {
        const useDefaultBackground = FavsHubSettings.get('useDefaultBackground');
        
        if (String(useDefaultBackground) !== 'true') {
            document.querySelectorAll('.settings-bg-option').forEach(option => {
                option.classList.remove('active');
            });
            return;
        }
        
        document.documentElement.className = savedBg;
        
        // 使用 WelcomeManager 更新欢迎消息颜色
        const welcomeElement = document.getElementById('welcome-message');
        if (welcomeElement && window.WelcomeManager) {
            window.WelcomeManager.adjustTextColor(welcomeElement);
        }
    }
}

// 背景初始化由 wallpaper.js（initializeWallpaper）和 DOMContentLoaded 中
// 的背景处理逻辑按优先级统一管理，此函数保留供外部按需调用
// applyBackgroundColor(); // 已在 DOMContentLoaded 中按正确优先级处理

// 添加颜色缓存管理器
const ColorCache = {
  data: new Map(),
  maxSize: 2000, // 最多缓存500个书签的颜色
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7天过期
  storageKey: 'bookmark-colors-v2', // 新的存储键，避免与旧数据冲突

  // 初始化缓存
  init() {
    try {
      // 从 localStorage 加载缓存数据
      const cached = localStorage.getItem(this.storageKey);
      if (cached) {
        const parsedData = JSON.parse(cached);
        Object.entries(parsedData).forEach(([key, value]) => {
          if (Date.now() - value.timestamp < this.maxAge) {
            this.data.set(key, value);
          }
        });
      }
    } catch (error) {
      
      this.clear();
    }
  },

  // 获取颜色
  get(bookmarkId, url) {
    const cached = this.data.get(bookmarkId);
    if (!cached) return null;

    // 检查URL是否变化和过期时间
    if (cached.url !== url || Date.now() - cached.timestamp > this.maxAge) {
      this.data.delete(bookmarkId);
      return null;
    }

    return cached.colors;
  },

  // 设置颜色
  set(bookmarkId, url, colors) {
    // 如果缓存即将超出限制，清理旧数据
    if (this.data.size >= this.maxSize) {
      this.cleanup();
    }

    this.data.set(bookmarkId, {
      colors,
      url,
    });

    // 异步保存到 localStorage
    this.scheduleSave();
  },

  // 清理过期和多余的缓存
  cleanup() {
    const now = Date.now();
    const entries = Array.from(this.data.entries());

    // 删除过期项
    entries.forEach(([key, value]) => {
      if (now - value.timestamp > this.maxAge) {
        this.data.delete(key);
      }
    });

    // 如果仍然超出限制，删除最旧的项
    if (this.data.size >= this.maxSize) {
      const sortedEntries = Array.from(this.data.entries())
        .sort((a, b) => a[1].timestamp - b[1].timestamp);

      const deleteCount = Math.floor(this.data.size * 0.2);
      sortedEntries.slice(0, deleteCount).forEach(([key]) => {
        this.data.delete(key);
      });
    }
  },

  // 清除所有缓存
  clear() {
    this.data.clear();
    localStorage.removeItem(this.storageKey);
  },

  // 使用防抖保存到 localStorage
  scheduleSave: _.debounce(function () {
    try {
      const dataToSave = Object.fromEntries(this.data);
      localStorage.setItem(this.storageKey, JSON.stringify(dataToSave));
    } catch (error) {
      // 如果存储失败（比如超出配额），清理一半的缓存后重试
      const entries = Array.from(this.data.entries());
      entries.slice(0, Math.floor(entries.length / 2)).forEach(([key]) => {
        this.data.delete(key);
      });
      this.scheduleSave();
    }
  }, 1000)
};



// 页面加载时更新图标
document.addEventListener('DOMContentLoaded', async () => {
  await FavsHubSettings.load();
  const defaultEngine = SearchEngineManager.getDefaultEngine();
  if (defaultEngine) {
    updateSearchEngineIcon(defaultEngine);
  }
});

// 同样，将这个函数也移到全作用域
function setDefaultIcon(iconElement) {
  iconElement.src = '/images/default-search-icon.png';
  iconElement.alt = 'Default Search Engine';
}

// 1. 首先定义全局变量
let bookmarksList;
let itemHeight = 120;
let bufferSize = 5;
let visibleItems;
let allBookmarks = [];
let renderTimeout = null;
let scrollHandler = null;
let resizeObserver = null;

// 2. 定义主要的虚拟滚动函数
function initVirtualScroll() {
  bookmarksList = document.getElementById('bookmarks-list');
  if (!bookmarksList) return;
  
  visibleItems = Math.ceil(window.innerHeight / itemHeight) + 2 * bufferSize;

  // 渲染函数
  function renderVisibleBookmarks() {
    if (!bookmarksList) return;
    // ... 保持原有的 renderVisibleBookmarks 实现 ...
  }

  // 滚动处理函数
  const handleScroll = _.throttle(() => {
    if (renderTimeout) {
      cancelAnimationFrame(renderTimeout);
    }
    renderTimeout = requestAnimationFrame(renderVisibleBookmarks);
  }, 16);

  // 窗口大小变化处理函数
  function handleResize() {
    const newVisibleItems = Math.ceil(window.innerHeight / itemHeight) + 2 * bufferSize;
    if (newVisibleItems !== visibleItems) {
      visibleItems = newVisibleItems;
      renderVisibleBookmarks();
    }
  }

  // 清理函数
  function cleanup() {
    if (scrollHandler) {
      bookmarksList.removeEventListener('scroll', scrollHandler);
    }
    if (resizeObserver) {
      resizeObserver.disconnect();
    }
    if (renderTimeout) {
      cancelAnimationFrame(renderTimeout);
    }
    allBookmarks = [];
  }

  // 初始化事件监听
  function initializeListeners() {
    cleanup(); // 清理旧的监听器

    scrollHandler = handleScroll;
    bookmarksList.addEventListener('scroll', scrollHandler, { passive: true });

    // 确保 handleResize 在正确的作用域内
    const boundHandleResize = handleResize.bind(this);
    resizeObserver = new ResizeObserver(_.debounce(boundHandleResize, 100));
    resizeObserver.observe(bookmarksList);
  }

  // 更新书签显示
  window.updateBookmarksDisplay = function(parentId, movedItemId, newIndex) {
    return new Promise((resolve, reject) => {
      chrome.bookmarks.getChildren(parentId, (bookmarks) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }

        cleanup();
        allBookmarks = bookmarks;
        
        updateContainerHeight();
        updateFolderName(parentId);
        renderVisibleBookmarks();
        
        bookmarksList.dataset.parentId = parentId;
        initializeListeners();
        
        resolve();
      });
    });
  };

  // 初始化
  initializeListeners();
}

// 3. 合并 DOMContentLoaded 事件监听器
document.addEventListener('DOMContentLoaded', async function() {
  // 等待用户设置从后端加载完成（确保 search engine、openSearchInNewTab 等配置可用）
  await FavsHubSettings.load();

  // 初始化虚拟滚动
  initVirtualScroll();

  // 初始化滚动指示器（函数在后面处理器中定义，延迟调用）
  setTimeout(() => {
    if (typeof initScrollIndicator === 'function') initScrollIndicator();
  }, 100);

  // 其他初始化代码...
  startPeriodicSync();
  setupSpecialLinks();

  // 只调用一次搜索引擎初始化（先加载服务端引擎数据）
  if (typeof loadServerEngines === 'function') {
    loadServerEngines().then(() => {
      createSearchEngineDropdown();
      initializeSearchEngineDialog();
    });
  } else {
    createSearchEngineDropdown();
    initializeSearchEngineDialog();
  }

 

  // 背景应用已由第一个 DOMContentLoaded 中的 applyAllSettings() 统一处理

  // 监听主题变化
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.attributeName === 'class') {
        // 当背景类发生变化时，调整文字颜色
        requestAnimationFrame(() => {
          const welcomeElement = document.getElementById('welcome-message');
          if (welcomeElement && window.WelcomeManager) {
            window.WelcomeManager.adjustTextColor(welcomeElement);
          }
        });
      }
    });
  });

  // 开始观察 documentElement 的 class 变化
  observer.observe(document.documentElement, {
    attributes: true,
  });

  // 检测是否在 Side Panel 中运行
  const isSidePanel = window.location.search.includes('context=side_panel') || 
                     window.location.hash.includes('context=side_panel');
  
  if (isSidePanel) {
    document.body.classList.add('is-sidepanel');
    
    // 直接隐藏页脚 - 使用更直接的方法
    const footer = document.querySelector('footer');
    if (footer) {
      footer.style.display = 'none';
      footer.setAttribute('data-sidepanel-hidden', 'true'); // 添加标记以便于调试
    }
    
    // 隐藏一些在 Side Panel 中不需要的元素
    const elementsToHide = [
      '.theme-toggle',
      '.settings-icon'
    ];

    elementsToHide.forEach(selector => {
      const element = document.querySelector(selector);
      if (element) {
        element.style.display = 'none';
      }
    });

    // 调整布局和尺寸
    const sidebarContainer = document.getElementById('sidebar-container');
    if (sidebarContainer) {
      sidebarContainer.classList.add('is-sidepanel');
    }

    // 调整主容器样式
    const mainContainer = document.querySelector('main');
    if (mainContainer) {
      mainContainer.style.padding = '1rem';
    }

    // 确保搜索框的动态高度调整功能正常工作
    const searchInput = document.querySelector('.search-input');
    if (searchInput) {
      // 重新初始化搜索框高度
      adjustTextareaHeight();
      
      // 确保输入事件监听器正常工作
      searchInput.addEventListener('input', adjustTextareaHeight);
    }

    // 文件夹切换功能已删除
    // const defaultFoldersTabs = document.querySelector('.default-folders-tabs');
    // if (defaultFoldersTabs) {
    //   defaultFoldersTabs.style.bottom = '20px';
    // }

    // 添加一个延迟检查，确保页脚真的被隐藏了
    setTimeout(() => {
      const footerCheck = document.querySelector('footer');
      if (footerCheck && footerCheck.style.display !== 'none') {
        footerCheck.style.display = 'none !important';
        document.body.classList.add('force-hide-footer');
      }
    }, 500);
    
    // 隐藏欢迎语
    const welcomeMessage = document.getElementById('welcome-message');
    const welcomeContainer = document.querySelector('.welcome-search-container');
    
    if (welcomeMessage) {
      welcomeMessage.style.display = 'none';
    }
    
    if (welcomeContainer) {
      welcomeContainer.style.display = 'none';
    }
    
    // 调整搜索容器位置
    const searchContainer = document.querySelector('.search-container');
    if (searchContainer) {
      searchContainer.style.marginTop = '0.5rem';
      searchContainer.style.marginBottom = '1rem';
    }
  }

  // 布局和可见性设置已由第一个 DOMContentLoaded 中的 applyAllSettings() 统一处理

  // 快捷访问链接：检测扩展并绑定点击事件
  detectExtension().then(extConnected => {
    if (!extConnected) {
      // Web 模式：隐藏需要扩展的链接
      ['#history-link', '#downloads-link', '#passwords-link', '#extensions-link'].forEach(sel => {
        const el = document.querySelector(sel);
        if (el) el.style.display = 'none';
      });
      return;
    }
    // 扩展模式：绑定点击事件
    const linkActions = {
      '#history-link': 'openHistory',
      '#downloads-link': 'openDownloads',
      '#passwords-link': 'openPasswords',
      '#extensions-link': 'openExtensions',
    };
    Object.entries(linkActions).forEach(([sel, action]) => {
      const el = document.querySelector(sel);
      if (el) {
        el.addEventListener('click', (e) => {
          e.preventDefault();
          sendExtensionMessage(action);
        });
      }
    });
  });
});

// 修改书签缓存对象的定义
const bookmarksCache = {
  data: new Map(),
  maxSize: 100, // 最大缓存条目数
  maxAge: 5 * 60 * 1000, // 5分钟缓存

  set(parentId, bookmarks) {
    // 如果缓存即将超出限制，清理最旧的数据
    if (this.data.size >= this.maxSize) {
      this.cleanup();
    }

    this.data.set(parentId, {
      timestamp: Date.now(),
      data: bookmarks
    });
  },

  get(parentId) {
    const cached = this.data.get(parentId);
    if (!cached) return null;

    if (Date.now() - cached.timestamp > this.maxAge) {
      this.data.delete(parentId);
      return null;
    }

    return cached;
  },

  // 添加 delete 方法
  delete(parentId) {
    return this.data.delete(parentId);
  },

  // 添加清除方法
  clear() {
    this.data.clear();
  },

  // 清理过期和最少使用缓存
  cleanup() {
    const now = Date.now();
    const entries = Array.from(this.data.entries());

    // 按最后访问时间排序
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);

    // 删除最旧的 20% 缓存
    const deleteCount = Math.floor(entries.length * 0.2);
    entries.slice(0, deleteCount).forEach(([key]) => {
      this.data.delete(key);
    });
  }
};

function updateBookmarkCards() {
  const bookmarksList = document.getElementById('bookmarks-list');
  const defaultBookmarkId = localStorage.getItem('defaultBookmarkId');
  const parentId = defaultBookmarkId || bookmarksList.dataset.parentId || '1';

  // 获取完整的书签树，以便显示所有分组
  chrome.bookmarks.getTree(function (tree) {
    displayBookmarks(tree);

    // 在显示书签后更新默认书签指示器
    updateDefaultBookmarkIndicator();
    updateSidebarDefaultBookmarkIndicator();

    // 更新 bookmarks-list 的 data-parent-id
    bookmarksList.dataset.parentId = parentId;
  });
}

document.addEventListener('DOMContentLoaded', async function () {
  // 等待设置加载完成（search engine、openSearchInNewTab、建议开关等）
  await FavsHubSettings.load();

  // Create context menu immediately when the document loads
  contextMenu = createContextMenu();
  
  const searchEngineIcon = document.getElementById('search-engine-icon');
  const defaultSearchEngine = FavsHubSettings.get('selectedSearchEngine') || 'google';
  let deletedBookmark = null;
  let deletedCategory = null; // 添加这行
  let deleteTimeout = null;
  let bookmarkTreeNodes = []; // 定义全局变量
  // 调用 updateBookmarkCards
  updateBookmarkCards();
  
  updateSearchEngineIcon(defaultSearchEngine);

  if (searchEngineIcon.src === '') {      
    searchEngineIcon.src = '/images/placeholder-icon.svg';
  }
  setTimeout(() => {
    updateSearchEngineIcon(defaultSearchEngine);
  }, 0);

  // 修改 updateSearchEngineIcon 函数
  function updateSearchEngineIcon(engineName) {
    setSearchEngineIcon(engineName);
  }

  // 更新侧边栏默认书签指示器和选中状态
  updateSidebarDefaultBookmarkIndicator();

  // ... 其他代码 ...

  


  
  // 优化后的更新显示函数
  async function updateBookmarksDisplay(parentId) {
    const bookmarksContainer = document.querySelector('.bookmarks-container');
    
    // 添加加载状态
    bookmarksContainer.classList.add('loading');
    
    try {
      const cached = bookmarksCache.get(parentId);
      
      if (cached && !movedItemId) {
        // 使用缓存数据进行分页显示
        renderBookmarksPage(cached, 0);
        return;
      }

      chrome.bookmarks.getChildren(parentId, (bookmarks) => {
        if (chrome.runtime.lastError) {
          throw chrome.runtime.lastError;
        }
        
        // 缓存新数据
        bookmarksCache.set(parentId, bookmarks);
        
        // 初始渲染第一页
        renderBookmarksPage({ bookmarks, totalCount: bookmarks.length }, 0);
      });
    } finally {
      // 移除加载状态
      bookmarksContainer.classList.remove('loading');
    }
  }

  // 分页渲染函数
  function renderBookmarksPage(cachedData, pageIndex, pageSize = 100) {
    const startIndex = pageIndex * pageSize;
    const endIndex = Math.min(startIndex + pageSize, cachedData.totalCount);
    
    const bookmarksList = document.getElementById('bookmarks-list');
    const bookmarksContainer = document.querySelector('.bookmarks-container');
    
    // 使用 DocumentFragment 优化 DOM 操作
    const fragment = document.createDocumentFragment();
    
    // 获取当前页的书签
    const pageBookmarks = cachedData.bookmarks.slice(startIndex, endIndex);
    
    // 渲染书签
    pageBookmarks.forEach((bookmark, index) => {
      const bookmarkElement = bookmark.url ? 
        createBookmarkCard(bookmark, startIndex + index) : 
        createFolderCard(bookmark, startIndex + index);
      fragment.appendChild(bookmarkElement);
    });
    
    // 更新 DOM
    bookmarksList.innerHTML = '';
    bookmarksList.appendChild(fragment);

    // 重新初始化拖拽排序
    initBookmarkSortable();

    // 更新分页信息
    updatePagination(pageIndex, Math.ceil(cachedData.totalCount / pageSize));
  }

  // 添加分页控制
  function updatePagination(currentPage, totalPages) {
    // 实现分页控制UI
    // ...
  }

  // 化书顺序步
  function syncBookmarkOrder(parentId) {
    const cached = bookmarksCache.get(parentId);
    if (!cached) return;
    
    chrome.bookmarks.getChildren(parentId, (bookmarks) => {
      const chromeOrder = bookmarks.map(b => b.id);
      const cachedOrder = cached.bookmarks.map(b => b.id);
      
      if (JSON.stringify(chromeOrder) !== JSON.stringify(cachedOrder)) {
        // 更新缓存
        bookmarksCache.set(parentId, bookmarks);
        
        // 重新渲染当前页
        renderBookmarksPage({ bookmarks, totalCount: bookmarks.length }, 0);
      }
    });
  }

  // 修改右键菜单事件监听器
  document.addEventListener('contextmenu', async function (event) {
    const targetFolder = event.target.closest('.bookmark-folder');
    
    if (targetFolder) {
      event.preventDefault();
      event.stopPropagation(); // 阻止事件冒泡
      
      // 确保文件夹上下文菜单存在
      if (!bookmarkFolderContextMenu) {
        bookmarkFolderContextMenu = createBookmarkFolderContextMenu();
      }

      if (!bookmarkFolderContextMenu) {
        
        return;
      }

      // 更新当前文件夹
      const oldFolder = currentBookmarkFolder;
      currentBookmarkFolder = targetFolder;
      
      // 重新创建菜单项
      await createMenuItems(bookmarkFolderContextMenu);
      
      // 先显示菜单但设为不可见，以便获取其尺寸
      bookmarkFolderContextMenu.style.display = 'block';
      bookmarkFolderContextMenu.style.visibility = 'hidden';
      bookmarkFolderContextMenu.style.left = '0';
      bookmarkFolderContextMenu.style.top = '0';
      
      // 获取视窗尺寸
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      
      // 等待一下以确保菜单已渲染
      setTimeout(() => {
        const menuRect = bookmarkFolderContextMenu.getBoundingClientRect();
        
        // 计算最佳位置
        let left = event.clientX;
        let top = event.clientY;
        
        // 检查右侧空间
        if (left + menuRect.width > viewportWidth) {
          // 如果右侧空间不足，尝试将菜单放在点击位置的左侧
          left = Math.max(5, left - menuRect.width);
        }
        
        // 检查底部空间
        if (top + menuRect.height > viewportHeight) {
          // 如果底部空间不足，尝试将菜单放在点击位置的上方
          top = Math.max(5, viewportHeight - menuRect.height - 5);
        }
        
        // 应用计算后的位置
        bookmarkFolderContextMenu.style.left = `${left}px`;
        bookmarkFolderContextMenu.style.top = `${top}px`;
        
        // 使菜单可见
        bookmarkFolderContextMenu.style.visibility = 'visible';
      }, 0);

      // 隐藏其他上下文菜单
      if (contextMenu) {
        contextMenu.style.display = 'none';
      }
    }
  });

  // 修改文档点击事件，确保正确关闭菜单
  document.addEventListener('click', function(event) {
    // 如果点击的不是菜单本身，则关闭菜单
    if (bookmarkFolderContextMenu && 
        !bookmarkFolderContextMenu.contains(event.target) && 
        !event.target.closest('.bookmark-folder')) {
      bookmarkFolderContextMenu.style.display = 'none';
      currentBookmarkFolder = null; // 重置当前文件夹
    }
  });

  // 为菜单本身添加点击事件处理
  if (bookmarkFolderContextMenu) {
    bookmarkFolderContextMenu.addEventListener('click', function(event) {
      event.stopPropagation(); // 阻止事件冒泡到文档
    });
  }

  // 在点击其他地方时重置状态
  document.addEventListener('click', function () {
    // 延迟处理点击事件，让菜单项的点击事件先执行
    setTimeout(() => {
    if (contextMenu) {
      contextMenu.style.display = 'none';
        currentBookmark = null;
      }
      
      if (bookmarkFolderContextMenu) {
        bookmarkFolderContextMenu.style.display = 'none';
        currentBookmarkFolder = null;
      }
    }, 200);
  });
});

function showMovingFeedback(element) {
  element.style.opacity = '0.5';
}

function hideMovingFeedback(element) {
  element.style.opacity = '1';
}

function showSuccessFeedback(element) {
  element.style.backgroundColor = '#e6ffe6';
  setTimeout(() => {
    element.style.backgroundColor = '';
  }, 1000);
}

function showErrorFeedback(element) {
  element.style.backgroundColor = '#ffe6e6';
  setTimeout(() => {
    element.style.backgroundColor = '';
  }, 1000);
}

function getDraggedFolderSublist(folderElement) {
  if (!folderElement) return null;
  const sublist = folderElement.nextElementSibling;
  return sublist && sublist.tagName === 'UL' ? sublist : null;
}

function openCategory(category) {
  if (category && category.classList.contains('folder-item')) {
    document.querySelectorAll('#categories-list li').forEach(function (item) {
      item.classList.remove('bg-emerald-500');
    });
    category.classList.add('bg-emerald-500');

    if (category.dataset.id) {
      updateBookmarksDisplay(category.dataset.id);
    }
  }
}

// 移除所有 defaultBookmarkId 相关的代码
// 修改 waitForFirstCategory 函数
async function waitForFirstCategory(attemptsLeft = 5) {
  try {
    // 1. 先隐藏书签列表，避免闪烁
    const bookmarksList = document.getElementById('bookmarks-list');
    const bookmarksContainer = document.querySelector('.bookmarks-container');
    if (bookmarksList && bookmarksContainer) {
      bookmarksContainer.style.opacity = '0';
      bookmarksContainer.style.transition = 'opacity 0.3s ease';
    }

    // 2. 尝试获取上次访问的文件夹
    const { lastViewedFolder } = await chrome.storage.local.get('lastViewedFolder');
    
    if (lastViewedFolder) {
      try {
        const results = await chrome.bookmarks.get(lastViewedFolder);
        if (results && results.length > 0) {
          await updateBookmarksDisplay(lastViewedFolder);
          updateFolderName(lastViewedFolder);
          selectSidebarFolder(lastViewedFolder);
          // 显示内容
          bookmarksContainer.style.opacity = '1';
          return;
        }
      } catch (error) {
      }
    }

    // 3. 尝试使用用户设置的默认文件夹
    const defaultFoldersData = FavsHubSettings.get('defaultFolders') || [];
    const defaultFolders = Array.isArray(defaultFoldersData) ? defaultFoldersData : (defaultFoldersData.items || []);
    if (defaultFolders.length > 0) {
      const defaultFolderId = defaultFolders.items[0].id;
      try {
        const results = await chrome.bookmarks.get(defaultFolderId);
        if (results && results.length > 0) {
          await updateBookmarksDisplay(defaultFolderId);
          updateFolderName(defaultFolderId);
          selectSidebarFolder(defaultFolderId);
          // 显示内容
          bookmarksContainer.style.opacity = '1';
          return;
        }
      } catch (error) {
      }
    }

    // 4. 兜底方案：使用书签栏根目录
    await updateBookmarksDisplay('1');
    updateFolderName('1');
    selectSidebarFolder('1');
    // 显示内容
    bookmarksContainer.style.opacity = '1';

  } catch (error) {
    
    if (attemptsLeft > 0) {
      setTimeout(() => waitForFirstCategory(attemptsLeft - 1), 1000);
    } else {
      // 重试次数用完，使用根目录
      await updateBookmarksDisplay('1');
      updateFolderName('1');
      selectSidebarFolder('1');
      // 显示内容
      const bookmarksContainer = document.querySelector('.bookmarks-container');
      if (bookmarksContainer) {
        bookmarksContainer.style.opacity = '1';
      }
    }
  }
}


// 修改文件夹切换函数，确保同步更新所有状态
async function switchToFolder(folderId) {
  try {
    
    // 验证文件夹是否存在
    const results = await chrome.bookmarks.get(folderId);
    if (!results || results.length === 0) {
      throw new Error('Folder not found');
    }

    // 更新UI状态
    document.querySelectorAll('.folder-tab').forEach(tab => {
      const isActive = tab.dataset.folderId === folderId;
      tab.classList.toggle('active', isActive);
      tab.style.transform = isActive ? 'scale(1.2)' : 'scale(1)';
      tab.style.transition = 'transform 0.3s ease';
    });

    // 同步更新所有状态
    await Promise.all([
      updateBookmarksDisplay(folderId),
      updateFolderName(folderId),
      selectSidebarFolder(folderId)
    ]);

    // 保存最后访问的文件夹
    await chrome.storage.local.set({ 
      lastViewedFolder: folderId,
    });
    
  } catch (error) {
    
    // 错误时回退到根目录
    await updateBookmarksDisplay('1');
    updateFolderName('1');
    selectSidebarFolder('1');
  }
}

// 辅助函数：滚动到指定元素
function scrollToFolderGroup(element) {
  if (!element) return;
  element.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function updateBookmarksDisplay(parentId, movedItemId, newIndex) {
  return new Promise((resolve, reject) => {
    // 滚动到指定文件夹的锚点定位功能
    const folderGroup = document.getElementById(`folder-group-${parentId}`);
    if (folderGroup) {
      // 使用平滑滚动到指定的文件夹分组
      scrollToFolderGroup(folderGroup);

      // 添加视觉效果以突出显示目标分组
      folderGroup.style.transform = 'scale(1.02)';
      folderGroup.style.boxShadow = '0 10px 25px rgba(16, 185, 129, 0.3)';

      // 1秒后恢复原始样式
      setTimeout(() => {
        if (folderGroup) {
          folderGroup.style.transform = '';
          folderGroup.style.boxShadow = '';
        }
      }, 1000);

      resolve();
      return;
    }

    // 如果没有找到目标分组，仍然获取书签树并显示所有分组
    chrome.bookmarks.getTree(function (tree) {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }

      // 显示所有书签文件夹（更新 displayBookmarks 以接收整个树结构）
      displayBookmarks(tree);

      // 更新文件夹名称
      updateFolderName(parentId);

      // 滚动到指定的分组
      setTimeout(() => {
        const targetGroup = document.getElementById(`folder-group-${parentId}`);
        if (targetGroup) {
          scrollToFolderGroup(targetGroup);

          // 添加视觉效果以突出显示目标分组
          targetGroup.style.transform = 'scale(1.02)';
          targetGroup.style.boxShadow = '0 10px 25px rgba(16, 185, 129, 0.3)';

          // 1秒后恢复原始样式
          setTimeout(() => {
            if (targetGroup) {
              targetGroup.style.transform = '';
              targetGroup.style.boxShadow = '';
            }
          }, 1000);
        }
      }, 300); // 延迟以确保DOM已更新

      resolve();
    });
  });
}

// 获取书栏的本地化名称
function getBookmarksBarName() {
  return new Promise((resolve) => {
    chrome.bookmarks.getTree(function(tree) {
      if (tree && tree[0] && tree[0].children) {
        const bookmarksBar = tree[0].children.find(child => child.id === '1');
        if (bookmarksBar) {
          resolve(bookmarksBar.title);
        } else {
          resolve('Bookmarks Bar'); // 默认英文名称
        }
      } else {
        resolve('Bookmarks Bar'); // 默认英文名称
      }
    });
  });
}

function getBookmarkPath(bookmarkId) {
  return new Promise((resolve, reject) => {
    getBookmarksBarName().then(bookmarksBarName => {
      function getParentRecursive(id, path = []) {
        chrome.bookmarks.get(id, function(results) {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
            return;
          }
          if (results && results[0]) {
            path.unshift(results[0].title);
            if (results[0].parentId && results[0].parentId !== '0') {
              getParentRecursive(results[0].parentId, path);
            } else {
              // 确保书签栏名称总是作为第一个元素
              if (path[0] !== bookmarksBarName) {
                path.unshift(bookmarksBarName);
              }
              resolve(path);
            }
          } else {
            reject(new Error('Bookmark not found'));
          }
        });
      }
      getParentRecursive(bookmarkId);
    });
  });
}

function updateFolderName(bookmarkId) {
  const folderNameElement = document.getElementById('folder-name');
  if (!folderNameElement) return;

  // 清除所有内容
  folderNameElement.innerHTML = '';

  // 检查 bookmarkId 是否有效
  if (!bookmarkId || bookmarkId === 'undefined') {
    folderNameElement.textContent = getLocalizedMessage('bookmarks');
    return;
  }

  // 尝试获取书签路径
  getBookmarkPath(bookmarkId).then(pathArray => {
    let breadcrumbHtml = '';
    let currentPath = '';

    pathArray.forEach((part, index) => {
      currentPath += (index > 0 ? ' > ' : '') + part;
      breadcrumbHtml += `<span class="breadcrumb-item" data-path="${currentPath}">${getLocalizedMessage(part)}</span>`;
      if (index < pathArray.length - 1) {
        breadcrumbHtml += '<span class="breadcrumb-separator">&gt;</span>';
      }
    });

    folderNameElement.innerHTML = breadcrumbHtml;
    addBreadcrumbClickListeners();
  }).catch(error => {
    // 设置默认文本，并确保它被本地化
    folderNameElement.textContent = getLocalizedMessage('bookmarks');
  });
}

function addBreadcrumbClickListeners() {
  const breadcrumbItems = document.querySelectorAll('.breadcrumb-item');
  breadcrumbItems.forEach(item => {
    item.addEventListener('click', function () {
      const path = this.dataset.path;
      navigateToPath(path);
    });
  });
}

function navigateToPath(path) {
  const pathParts = path.split(' > ');
  
  // 获取书签栏的名称
  getBookmarksBarName().then(bookmarksBarName => {
    let currentId = '1'; // 默认从根目录开始
    let startIndex = 0;

    // 如果路径不是从书签栏开始，我们需要找到正确的起始点
    if (pathParts[0] !== bookmarksBarName) {
      chrome.bookmarks.search({title: pathParts[0]}, function(results) {
        if (results.length > 0) {
          currentId = results[0].id;
        }
        navigateRecursive(startIndex);
      });
    } else {
      startIndex = 1; // 如果从书签栏开始，跳过第一个元素
      navigateRecursive(startIndex);
    }

    function navigateRecursive(index) {
      if (index >= pathParts.length) {
        updateBookmarksDisplay(currentId);
        return;
      }

      chrome.bookmarks.getChildren(currentId, function(children) {
        const matchingChild = children.find(child => child.title === pathParts[index]);
        if (matchingChild) {
          currentId = matchingChild.id;
          navigateRecursive(index + 1);
        } else {
          updateBookmarksDisplay(currentId);
        }
      });
    }
  });
}

async function displayBookmarks(bookmarkTreeNodes) {
  const bookmarksList = document.getElementById('bookmarks-list');
  const bookmarksContainer = document.querySelector('.bookmarks-container');
  if (!bookmarksList) {
    return;
  }

  // 先移除 loaded 类
  bookmarksContainer.classList.remove('loaded');

  const fragment = document.createDocumentFragment();

  // 获取根级节点（书签栏、其他书签等）
  const rootNodes = bookmarkTreeNodes[0]?.children || [];

  // 这个函数将实现扁平化的垂直流式布局
  async function createFlatStructure() {
    // 遍历所有根节点
    for (const rootNode of rootNodes) {
      if (rootNode.url) continue;

      if (rootNode.id === 'recommended') {
        // "常用推荐"分组：未分类书签
        const directBookmarks = rootNode.children.filter(child => child.url && child.title);
        directBookmarks.sort((a, b) => a.index - b.index);

        if (directBookmarks.length > 0) {
          const recommendedGroup = document.createElement('div');
          recommendedGroup.className = 'folder-group flat-layout';
          recommendedGroup.id = 'folder-group-recommended';

          const recommendedTitle = document.createElement('h3');
          recommendedTitle.className = 'folder-group-title';
          recommendedTitle.textContent = '常用推荐';
          recommendedGroup.appendChild(recommendedTitle);

          const recommendedGrid = document.createElement('div');
          recommendedGrid.className = 'folder-bookmarks-grid';

          directBookmarks.forEach((bookmark) => {
            const card = createBookmarkCard(bookmark, bookmark.index || 0);
            recommendedGrid.appendChild(card);
          });

          recommendedGroup.appendChild(recommendedGrid);
          fragment.appendChild(recommendedGroup);
        }
      } else {
        // 文件夹 → 按文件夹名显示
        await processFolder(rootNode, fragment);
      }
    }
  }

  // 递归处理文件夹，但在主布局中是扁平化的
  async function processFolder(folder, parentElement) {
    if (folder.url) return; // 如果是书签，跳过

    // 创建文件夹分组
    const folderGroup = document.createElement('div');
    folderGroup.className = 'folder-group flat-layout';
    folderGroup.id = `folder-group-${folder.id}`;

    // 创建分组标题
    const groupTitle = document.createElement('h3');
    groupTitle.className = 'folder-group-title';
    groupTitle.textContent = folder.title;
    folderGroup.appendChild(groupTitle);

    // 获取此文件夹下的所有直接书签
    const folderBookmarks = folder.children.filter(child => child.url && child.title);
    folderBookmarks.sort((a, b) => a.index - b.index);

    const bookmarksGrid = document.createElement('div');
    bookmarksGrid.className = 'folder-bookmarks-grid';

    folderBookmarks.forEach((bookmark) => {
      const card = createBookmarkCard(bookmark, bookmark.index || 0);
      bookmarksGrid.appendChild(card);
    });

    folderGroup.appendChild(bookmarksGrid);
    parentElement.appendChild(folderGroup);

    // 递归处理子文件夹，使它们也扁平化显示
    const subFolders = folder.children.filter(child => !child.url);
    for (const subFolder of subFolders) {
      await processFolder(subFolder, parentElement);
    }
  }

  // 执行扁平化布局创建
  await createFlatStructure();

  bookmarksList.innerHTML = '';
  bookmarksList.appendChild(fragment);

  // 使用 requestAnimationFrame 确保在下一帧添加 loaded 类
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      bookmarksContainer.classList.add('loaded');
    });
  });

  setupSortable();
}

function getColors(img) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = img.width;
  canvas.height = img.height;
  ctx.drawImage(img, 0, 0, img.width, img.height);
  let data;
  try {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    data = imageData.data;
  } catch (e) {
    // 跨域图片无法读取像素数据，返回默认颜色
    return { primary: [200, 200, 200], secondary: [220, 220, 220] };
  }
  let colors = {};

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (a === 0) continue; // 跳过完全透明的像素
    const rgb = `${r},${g},${b}`;
    colors[rgb] = (colors[rgb] || 0) + 1;
  }

  const sortedColors = Object.entries(colors).sort((a, b) => b[1] - a[1]);
  
  if (sortedColors.length === 0) {
    // 如果图片完全透明，返回默认颜色
    return { primary: [200, 200, 200], secondary: [220, 220, 220] };
  }
  
  const primaryColor = sortedColors[0][0].split(',').map(Number);
  const secondaryColor = sortedColors.length > 1 
    ? sortedColors[1][0].split(',').map(Number)
    : primaryColor.map(c => Math.min(255, c + 20)); // 如果只有一种颜色，创建一个稍微亮的次要颜色

  return { primary: primaryColor, secondary: secondaryColor };
}



// 修改现有的颜色处理函数
function updateBookmarkColors(bookmark, img, card) {
  img.onload = function () {
    const colors = getColors(img);
    applyColors(card, colors);
    // 使用新的缓存系统
    ColorCache.set(bookmark.id, bookmark.url, colors);
  };

  img.onerror = function () {
    const defaultColors = {
      primary: [200, 200, 200],
      secondary: [220, 220, 220]
    };
    applyColors(card, defaultColors);
    ColorCache.set(bookmark.id, bookmark.url, defaultColors);
  };
}

// 修改创建书签卡片时的颜色处理
function createBookmarkCard(bookmark, index) {
  const card = document.createElement('a');
  card.href = bookmark.url;
  card.className = 'bookmark-card card';
  card.dataset.id = bookmark.id;
  card.dataset.parentId = bookmark.parentId;
  card.dataset.index = index.toString();

  const img = document.createElement('img');
  img.className = 'w-6 h-6 mr-2';
  // 使用统一的 favicon 获取函数
  img.src = window.normalizeFavicon ? window.normalizeFavicon(bookmark.icon, bookmark.url) : (window.getFaviconUrl ? window.getFaviconUrl(bookmark.url, 32) : '/images/placeholder-icon.svg');

  // 尝试从缓存获取颜色
  const cachedColors = localStorage.getItem(`bookmark-colors-${bookmark.id}`);
  
  if (cachedColors) {
    // 如果有缓存，直接应用缓存的颜色
    const colors = JSON.parse(cachedColors);
    applyColors(card, colors);
    
    // 只加载 favicon 图片，不重新计算颜色
    img.onload = null;
  } else {
    // 只在没有缓存时计算颜色
    img.onload = function() {
      const colors = getColors(img);
      applyColors(card, colors);
      localStorage.setItem(`bookmark-colors-${bookmark.id}`, JSON.stringify(colors));
    };
  }

  img.onerror = function() {
    // 处 favicon 加载失败的情况
    const defaultColors = { primary: [200, 200, 200], secondary: [220, 220, 220] };
    applyColors(card, defaultColors);
    localStorage.setItem(`bookmark-colors-${bookmark.id}`, JSON.stringify(defaultColors));
  };

  const favicon = document.createElement('div');
  favicon.className = 'favicon';
  favicon.appendChild(img);
  card.appendChild(favicon);

  const content = document.createElement('div');
  content.className = 'card-content';

  const title = document.createElement('div');
  title.className = 'card-title';
  title.textContent = bookmark.title;

  content.appendChild(title);
  card.appendChild(content);

  card.addEventListener('contextmenu', function(event) {
    event.preventDefault();
    event.stopPropagation(); // 阻止事件冒泡，防止触发文档级的contextmenu事件监听器
    showContextMenu(event, bookmark, 'bookmark'); // 明确指定类型为 'bookmark'
  });

  // 添加鼠标悬停效果
  card.addEventListener('mouseenter', function() {
    this.style.transform = 'scale(1.03)';
    this.style.boxShadow = '0 1px 1px rgba(0,0,0,0.01)';
    this.style.backgroundColor = 'rgba(255,255,255,1)';
  });

  card.addEventListener('mouseleave', function() {
    this.style.transform = 'scale(1)';
    this.style.boxShadow = '';
    this.style.backgroundColor = '';
  });

  // 在文件顶部添加防重复点击控制
  let isProcessingClick = false;
  const CLICK_COOLDOWN = 500; // 点击冷却时间

  // 只使用一个事件处理器
  card.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (window._dragJustEnded || window._isDragging) return;

    if (isProcessingClick) return;
    isProcessingClick = true;

    try {
      // 通过页面文件名判断环境
      const isSidePanel = window.location.pathname.endsWith('sidepanel.html');
      const isInternalUrl = bookmark.url.startsWith('chrome://') ||
                           bookmark.url.startsWith('chrome-extension://') ||
                           bookmark.url.startsWith('edge://') ||
                           bookmark.url.startsWith('about:');

      // 处理内部链接
      if (isInternalUrl) {
        chrome.tabs.create({
          url: bookmark.url,
          active: true
        }).then(tab => {
        }).catch(error => {
          
        });
        return;
      }

      // 处理普通链接
      if (isSidePanel) {
        // 获取侧边栏模式下的链接打开方式设置
        const openInNewTab = FavsHubSettings.get('sidepanelOpenInNewTab') !== false;
        const openInSidepanel = FavsHubSettings.get('sidepanelOpenInSidepanel') === true;

          if (openInSidepanel) {
            // 在侧边栏内打开链接
            // 使用 SidePanelManager 加载 URL
            try {
              // 检查 SidePanelManager 是否已定义
              if (typeof SidePanelManager === 'undefined') {
                // 如果未定义，则创建一个简单的加载函数
                const sidePanelContent = document.getElementById('side-panel-content');
                const sidePanelIframe = document.getElementById('side-panel-iframe');
                
                if (sidePanelContent && sidePanelIframe) {
                  sidePanelContent.style.display = 'block';
                  sidePanelIframe.src = bookmark.url;
                  
                  // 添加返回按钮
                  let backButton = document.querySelector('.back-to-links');
                  if (!backButton) {
                    backButton = document.createElement('div');
                    backButton.className = 'back-to-links';
                    backButton.innerHTML = '<span class="material-icons">arrow_back</span>';
                    document.body.appendChild(backButton);
                    
                    // 添加点击事件
                    backButton.addEventListener('click', () => {
                      sidePanelContent.style.display = 'none';
                      backButton.style.display = 'none';
                    });
                  }
                  
                  // 显示返回按钮
                  backButton.style.display = 'flex';
                } else {
                  
                  chrome.tabs.create({
                    url: bookmark.url,
                  });
                }
              } else if (window.sidePanelManager) {
                window.sidePanelManager.loadUrl(bookmark.url);
              } else {
                // 如果 SidePanelManager 已定义但实例不存在，创建一个新实例
                window.sidePanelManager = new SidePanelManager();
                window.sidePanelManager.loadUrl(bookmark.url);
              }
            } catch (error) {
              
              // 出错时回退到在新标签页中打开
              chrome.tabs.create({
                url: bookmark.url,
              });
            }
          } else if (openInNewTab) {
            chrome.tabs.create({ url: bookmark.url, active: true }).catch(() => {});
          }
      } else {
        if (FavsHubSettings.get('openInNewTab') !== false) {
          window.open(bookmark.url, '_blank');
        } else {
          window.location.href = bookmark.url;
        }
      }
    } catch (error) {
      
    } finally {
      setTimeout(() => {
        isProcessingClick = false;
      }, CLICK_COOLDOWN);
    }
  });

  return card;
}

function adjustColor(r, g, b) {
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  let factor = 1;

  if (brightness < 128) {
    // 如果颜色太暗，增加亮度
    factor = 1 + (128 - brightness) / 128;
  } else if (brightness > 200) {
    // 如果颜色太亮，减少亮度
    factor = 1 - (brightness - 200) / 55;
  }

  return {
    r: Math.min(255, Math.round(r * factor)),
    g: Math.min(255, Math.round(g * factor)),
    b: Math.min(255, Math.round(b * factor))
  };
}

function applyColors(card, colors) {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const adjustedPrimary = adjustColor(colors.primary[0], colors.primary[1], colors.primary[2]);
  const adjustedSecondary = adjustColor(colors.secondary[0], colors.secondary[1], colors.secondary[2]);
  
  const opacity = isDark ? '0.1' : '0.06';
  card.style.background = `linear-gradient(135deg, 
    rgba(${adjustedPrimary.r}, ${adjustedPrimary.g}, ${adjustedPrimary.b}, ${opacity}), 
    rgba(${adjustedSecondary.r}, ${adjustedSecondary.g}, ${adjustedSecondary.b}, ${opacity}))`;
  card.style.border = `1px solid rgba(${adjustedPrimary.r}, ${adjustedPrimary.g}, ${adjustedPrimary.b}, ${isDark ? '0.1' : '0.01'})`;
}

function openInNewWindow(url) {
  chrome.windows.create({ url: url }, function (window) {
  });
}

function openInIncognito(url) {
  chrome.windows.create({ url: url, incognito: true }, function (window) {
  });
}

// Encapsulate toast and bookmark link copier functionality in a closure
const Utilities = (function() {
  let toastTimeout;

  function showToast(message = getLocalizedMessage('moreSearchSupportToast'), duration = 1500) {
    const toast = document.getElementById('more-button-toast');
    if (!toast) {
      
      return;
    }

    // If toast is already showing, clear the previous timeout
    if (toast.classList.contains('show')) {
      clearTimeout(toastTimeout);
      toast.classList.remove('show');
      setTimeout(() => showToast(message, duration), 300); // Try showing again after a short delay
      return;
    }

    const toastMessage = toast.querySelector('p');
    if (toastMessage) {
      toastMessage.textContent = message;
    }

    toast.classList.add('show');

    toastTimeout = setTimeout(() => {
      toast.classList.remove('show');
    }, duration);
  }

  function copyBookmarkLink(bookmark) {
    try {
      if (!bookmark || !bookmark.url) {
        throw new Error('No valid bookmark link found');
      }
      navigator.clipboard.writeText(bookmark.url).then(() => {
        showToast(getLocalizedMessage('linkCopied'));
      }).catch(err => {
        
        showToast(getLocalizedMessage('copyLinkFailed'));
      });
    } catch (error) {
      
      if (error.message === 'Extension context invalidated.') {
        showToast(getLocalizedMessage('extensionReloaded'));
      } else {
        showToast(getLocalizedMessage('copyLinkFailed'));
      }
    }
  }

  return {
    showToast: showToast,
    copyBookmarkLink: copyBookmarkLink
  };
})();

// 修改 showContextMenu 函数
function showContextMenu(event, item, type = 'bookmark') {
  // 先关闭所有已存在的上下文菜单
  const existingMenus = document.querySelectorAll('.custom-context-menu');
  existingMenus.forEach(menu => {
    if (menu !== contextMenu && menu.style.display !== 'none') {
      menu.style.display = 'none';
    }
  });

  // 如果上下文菜单不存在，则创建一个新的
  if (!contextMenu) {
    contextMenu = createContextMenu();
  }

  if (!contextMenu) {
    
    return;
  }

  // 清除之前的状态
  itemToDelete = null;
  currentBookmark = null;
  
  // 设置当前项目，确保包含类型信息
  currentBookmark = {
    id: item.id || item.dataset?.id,
    title: item.title || item.querySelector?.('.card-title')?.textContent || item.querySelector?.('span')?.textContent,
    url: item.url || item.dataset?.url,
    parentId: item.parentId || item.dataset?.parentId,
    type: item.type || type  // 优先使用项目自带的类型，否则使用传入的类型
  };

  // 先显示菜单但设为不可见，以便获取其尺寸
  contextMenu.style.display = 'block';
  contextMenu.style.visibility = 'hidden';
  contextMenu.style.left = '0';
  contextMenu.style.top = '0';
  
  // 获取视窗尺寸
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  
  // 等待一下以确保菜单已渲染
  setTimeout(() => {
    const menuRect = contextMenu.getBoundingClientRect();
    
    // 计算最佳位置
    let left = event.clientX;
    let top = event.clientY;
    
    // 检查右侧空间
    if (left + menuRect.width > viewportWidth) {
      // 如果右侧空间不足，尝试将菜单放在点击位置的左侧
      left = Math.max(5, left - menuRect.width);
    }
    
    // 检查底部空间
    if (top + menuRect.height > viewportHeight) {
      // 如果底部空间不足，尝试将菜单放在点击位置的上方
      top = Math.max(5, viewportHeight - menuRect.height - 5);
    }
    
    // 应用计算后的位置
    contextMenu.style.left = `${left}px`;
    contextMenu.style.top = `${top}px`;
    
    // 使菜单可见
    contextMenu.style.visibility = 'visible';
  }, 0);
}



// 新增函数：根据类型创建菜单项
function createContextMenuItems(contextMenu, type) {
  const menuItems = [
    { text: getLocalizedMessage('openInNewTab'), icon: 'open_in_new', action: () => currentBookmark && window.open(currentBookmark.url, '_blank') },
    { text: getLocalizedMessage('openInNewWindow'), icon: 'launch', action: () => currentBookmark && openInNewWindow(currentBookmark.url) },
    { text: getLocalizedMessage('openInIncognito'), icon: 'visibility_off', action: () => currentBookmark && openInIncognito(currentBookmark.url) },
    { text: getLocalizedMessage('editQuickLink'), icon: 'edit', action: () => currentBookmark && openEditDialog(currentBookmark) },
    { 
      text: type === 'quickLink' ? getLocalizedMessage('deleteQuickLink') : getLocalizedMessage('deleteBookmark'), 
      icon: 'delete', 
      action: () => {
        
        if (!currentBookmark) {
          
          return;
        }

        // 使用全局的 itemToDelete 变量
        itemToDelete = {
          type: currentBookmark.type,  // 使用当前项目的类型
          data: {
            id: currentBookmark.id,
            title: currentBookmark.title,
            url: currentBookmark.url,
            type: currentBookmark.type  // 确保在 data 中也保存类型信息
          }
        };
        
        
        // 根据类型显示不同的确认消息
        const message = itemToDelete.type === 'quickLink' 
          ? chrome.i18n.getMessage("confirmDeleteQuickLink", [`<strong>${itemToDelete.data.title}</strong>`])
          : chrome.i18n.getMessage("confirmDeleteBookmark", [`<strong>${itemToDelete.data.title}</strong>`]);
        
        
        showConfirmDialog(message, () => {
          
          if (itemToDelete && itemToDelete.data) {
            if (itemToDelete.type === 'quickLink') {
              deleteQuickLink(itemToDelete.data);
            } else {
              deleteBookmark(itemToDelete.data.id, itemToDelete.data.title);
            }
          } else {
            
          }
        });
      }
    },
    { text: getLocalizedMessage('copyLink'), icon: 'content_copy', action: () => currentBookmark && Utilities.copyBookmarkLink(currentBookmark) },
    { text: getLocalizedMessage('createQRCode'), icon: 'qr_code', action: () => currentBookmark && createQRCode(currentBookmark.url, currentBookmark.title) }
  ];

  menuItems.forEach(item => {
    const menuItem = document.createElement('div');
    menuItem.className = 'custom-context-menu-item';
    
    const icon = document.createElement('span');
    icon.className = 'material-icons';
    icon.innerHTML = ICONS[item.icon];
    icon.style.marginRight = '8px';
    icon.style.fontSize = '18px';
    
    const text = document.createElement('span');
    text.textContent = item.text;

    menuItem.appendChild(icon);
    menuItem.appendChild(text);

    menuItem.addEventListener('click', () => {
      if (typeof item.action === 'function') {
        item.action();
      }
      contextMenu.style.display = 'none';
    });

    menu.appendChild(menuItem);
  });
}

function showDeleteConfirmDialog() {
  if (!itemToDelete || !itemToDelete.data) {
    
    return;
  }


  const confirmDialog = document.getElementById('confirm-dialog');
  const confirmMessage = document.getElementById('confirm-dialog-message');
  const confirmButton = document.getElementById('confirm-delete-button');
  const cancelButton = document.getElementById('cancel-delete-button');

  if (!confirmDialog || !confirmMessage || !confirmButton || !cancelButton) {
    
    return;
  }

  // 清空之前的消息
  confirmMessage.innerHTML = '';
  
  // 根据类型显示不同的确认消息
  const message = itemToDelete.type === 'quickLink'
    ? chrome.i18n.getMessage("confirmDeleteQuickLink", [`<strong>${itemToDelete.data.title}</strong>`])
    : chrome.i18n.getMessage("confirmDeleteBookmark", [`<strong>${itemToDelete.data.title}</strong>`]);
  confirmMessage.innerHTML = message;

  confirmDialog.style.display = 'block';

  const handleConfirm = () => {
    
    if (itemToDelete.type === 'quickLink') {
      deleteQuickLink(itemToDelete.data);
    } else {
      deleteBookmark(itemToDelete.data.id, itemToDelete.data.title);
    }
    
    confirmDialog.style.display = 'none';
    cleanup();
    itemToDelete = null;
  };

  const handleCancel = () => {
    confirmDialog.style.display = 'none';
    cleanup();
    itemToDelete = null;
  };

  const cleanup = () => {
    confirmButton.removeEventListener('click', handleConfirm);
    cancelButton.removeEventListener('click', handleCancel);
    itemToDelete = null;
  };

  // 设置事件监听器
  confirmButton.removeEventListener('click', handleConfirm);
  cancelButton.removeEventListener('click', handleCancel);
  confirmButton.addEventListener('click', handleConfirm);
  cancelButton.addEventListener('click', handleCancel);
}

// 在创建快捷链接卡片时
function createQuickLinkCard(quickLink) {
  const card = document.createElement('div');
  card.className = 'quick-link-item-container';
  card.dataset.url = quickLink.url;
  card.dataset.id = quickLink.id;
  card.dataset.type = 'quickLink';  // 明确设置类型

  // ... 其他代码保持不变 ...

  card.addEventListener('contextmenu', function(event) {
    event.preventDefault();
    
    // 构造完整的快捷链接对象
    const quickLinkData = {
      id: quickLink.id || this.dataset.id,
      title: quickLink.title || this.querySelector('span').textContent,
      url: quickLink.url || this.dataset.url,
      type: 'quickLink'  // 明确指定类型
    };
    
    showContextMenu(event, quickLinkData, 'quickLink');
  });

  // ... 其他代码保持不变 ...
}

// 在确认对话框关闭时清理数据
function closeConfirmDialog() {
  const confirmDialog = document.getElementById('confirm-dialog');
  if (confirmDialog) {
    confirmDialog.style.display = 'none';
    // 清理所有相关数据
    currentBookmark = null;
    itemToDelete = null;
  }
}

// 分别定义两个函数处理不同类型的删除
function confirmBookmarkDeletion(bookmark) {
  if (!bookmark || !bookmark.id) {
    
    return;
  }

  // 设置当前要删除的书签
  itemToDelete = { ...bookmark };

  const confirmDialog = document.getElementById('confirm-dialog');
  const confirmMessage = document.getElementById('confirm-dialog-message');
  const confirmButton = document.getElementById('confirm-delete-button');
  const cancelButton = document.getElementById('cancel-delete-button');

  if (!confirmDialog || !confirmMessage || !confirmButton || !cancelButton) {
    
    return;
  }

  // 清空之前的消息
  confirmMessage.innerHTML = '';
  
  // 只显示书签删除的确认消息
  confirmMessage.innerHTML = chrome.i18n.getMessage(
    "confirmDeleteBookmark", 
    [`<strong>${bookmark.title}</strong>`]
  );
  
  confirmDialog.style.display = 'block';

  const handleConfirm = () => {
    deleteBookmark(itemToDelete);
    confirmDialog.style.display = 'none';
    cleanup();
    clearDeleteStates();
  };

  const handleCancel = () => {
    confirmDialog.style.display = 'none';
    cleanup();
    clearDeleteStates();
  };

  const cleanup = () => {
    confirmButton.removeEventListener('click', handleConfirm);
    cancelButton.removeEventListener('click', handleCancel);
  };

  // 设置事件监听器
  confirmButton.removeEventListener('click', handleConfirm);
  cancelButton.removeEventListener('click', handleCancel);
  confirmButton.addEventListener('click', handleConfirm);
  cancelButton.addEventListener('click', handleCancel);
}

function confirmQuickLinkDeletion(quickLink) {
  if (!quickLink || !quickLink.id) {
    
    return;
  }

  // 设置当前要删除的快捷链接
  itemToDelete = { ...quickLink };

  const confirmDialog = document.getElementById('confirm-dialog');
  const confirmMessage = document.getElementById('confirm-dialog-message');
  const confirmButton = document.getElementById('confirm-delete-button');
  const cancelButton = document.getElementById('cancel-delete-button');

  if (!confirmDialog || !confirmMessage || !confirmButton || !cancelButton) {
    
    return;
  }

  // 清空之前的消息
  confirmMessage.innerHTML = '';
  
  // 只显示快捷链接删除的确认消息
  confirmMessage.innerHTML = chrome.i18n.getMessage(
    "confirmDeleteQuickLink", 
    [`<strong>${quickLink.title}</strong>`]
  );
  
  confirmDialog.style.display = 'block';

  const handleConfirm = () => {
    deleteQuickLink(itemToDelete);
    confirmDialog.style.display = 'none';
    cleanup();
    clearDeleteStates();
  };

  const handleCancel = () => {
    confirmDialog.style.display = 'none';
    cleanup();
    clearDeleteStates();
  };

  const cleanup = () => {
    confirmButton.removeEventListener('click', handleConfirm);
    cancelButton.removeEventListener('click', handleCancel);
  };

  // 设置事件监听器
  confirmButton.removeEventListener('click', handleConfirm);
  cancelButton.removeEventListener('click', handleCancel);
  confirmButton.addEventListener('click', handleConfirm);
  cancelButton.addEventListener('click', handleCancel);
}

// 新增：清理所有删除相关的状态
function clearDeleteStates() {
  itemToDelete = null;
  currentBookmark = null;
}

// 修改 showConfirmDialog 函数
function showConfirmDialog(message, callback) {
  // 先保存当前状态的副本
  const currentState = {
    itemToDelete: itemToDelete ? { ...itemToDelete } : null,
    currentBookmark: currentBookmark ? { ...currentBookmark } : null,
    type: itemToDelete ? itemToDelete.type : 'unknown'  // 从 itemToDelete 获取类型
  };
  
  
  const confirmDialog = document.getElementById('confirm-dialog');
  const confirmMessage = document.getElementById('confirm-dialog-message');
  const confirmQuickLinkMessage = document.getElementById('confirm-delete-quick-link-message');
  const confirmButton = document.getElementById('confirm-delete-button');
  const cancelButton = document.getElementById('cancel-delete-button');

  if (!confirmDialog || !confirmMessage || !confirmButton || !cancelButton) {
    
    return;
  }

  // 清空所有确认消息
  confirmMessage.innerHTML = '';
  if (confirmQuickLinkMessage) {
    confirmQuickLinkMessage.innerHTML = '';
    confirmQuickLinkMessage.style.display = 'none';
  }
  
  // 根据 itemToDelete 的类型显示相应的消息
  if (itemToDelete && itemToDelete.type === 'quickLink') {
    if (confirmQuickLinkMessage) {
      confirmQuickLinkMessage.innerHTML = message;
      confirmQuickLinkMessage.style.display = 'block';
      confirmMessage.style.display = 'none';
    }
  } else {
    confirmMessage.innerHTML = message;
    confirmMessage.style.display = 'block';
    if (confirmQuickLinkMessage) {
      confirmQuickLinkMessage.style.display = 'none';
    }
  }

  confirmDialog.style.display = 'block';

  const handleConfirm = () => {
    if (typeof callback === 'function') {
      callback();
    }
    confirmDialog.style.display = 'none';
    cleanup();
  };

  const handleCancel = () => {
    confirmDialog.style.display = 'none';
    
    // 清空所有确认消息
    confirmMessage.innerHTML = '';
    confirmMessage.style.display = 'block';
    if (confirmQuickLinkMessage) {
      confirmQuickLinkMessage.innerHTML = '';
      confirmQuickLinkMessage.style.display = 'none';
    }
    
    // 使用之前保存的状态副本记录日志
    
    clearAllStates();
    cleanup();
  };

  const cleanup = () => {
    confirmButton.removeEventListener('click', handleConfirm);
    cancelButton.removeEventListener('click', handleCancel);
  };

  // 移除旧的事件监听器并添加新的
  confirmButton.removeEventListener('click', handleConfirm);
  cancelButton.removeEventListener('click', handleCancel);
  confirmButton.addEventListener('click', handleConfirm);
  cancelButton.addEventListener('click', handleCancel);
}

// 新增一个函数来清理所有状态
function clearAllStates() {
  itemToDelete = null;
  currentBookmark = null;
  
  // 隐藏上下文菜单
  if (contextMenu) {
    contextMenu.style.display = 'none';
  }
}

function handleBookmarkDeletion() {
  
  if (!itemToDelete || !itemToDelete.data) {
    
    Utilities.showToast(getLocalizedMessage('deleteBookmarkError'));
    clearAllStates();
    return;
  }

  // 关闭确认对话框
  const confirmDialog = document.getElementById('confirm-dialog');
  if (confirmDialog) {
    confirmDialog.style.display = 'none';
  }

  // 执行删除操作
  deleteBookmark(itemToDelete.data.id, itemToDelete.data.title);

  // 清理状态
  clearAllStates();
}

function deleteBookmark(bookmarkId, bookmarkTitle) {
  if (!bookmarkId) {
    
    return;
  }

  // 先从界面上移除书签卡片
  const bookmarkCard = document.querySelector(`.bookmark-card[data-id="${bookmarkId}"]`);
  if (bookmarkCard) {
    // 添加淡出动画
    bookmarkCard.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    bookmarkCard.style.opacity = '0';
    bookmarkCard.style.transform = 'scale(0.95)';
    
    // 等待动画完成后移除元素
    setTimeout(() => {
      bookmarkCard.remove();
    }, 300);
  }

  // 然后调用 Chrome API 删除书签
  chrome.bookmarks.remove(bookmarkId, function() {
    if (chrome.runtime.lastError) {
      
      Utilities.showToast(getLocalizedMessage('deleteBookmarkError'));
      
      // 如果删除失败，恢复书签卡片
      if (bookmarkCard && bookmarkCard.parentNode) {
        bookmarkCard.style.opacity = '1';
        bookmarkCard.style.transform = 'scale(1)';
      }
    } else {
      // 保留成功删除的日志，但简化
      Utilities.showToast(getLocalizedMessage('deleteSuccess'));
      
      // 清除相关缓存
      bookmarksCache.clear();
      
      // 更新父文件夹的显示
      const parentId = document.getElementById('bookmarks-list').dataset.parentId;
      if (parentId) {
        // 不需要完全刷新，因为我们已经从界面上移除了书签卡片
        // 但我们需要更新缓存和排序
        chrome.bookmarks.getChildren(parentId, (bookmarks) => {
          if (!chrome.runtime.lastError) {
            bookmarkOrderCache[parentId] = bookmarks.map(b => b.id);
          }
        });
      }
    }
  });
}

function showToast(message, duration = 3000) {
  const toast = document.getElementById('toast');
  if (!toast) {
    
    return;
  }
  toast.textContent = message;
  toast.style.display = 'block';
  toast.classList.add('show');

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => {
      toast.style.display = 'none';
    }, 300);
  }, duration);
}



function createFolderCard(folder, index) {
  const card = document.createElement('div');
  card.className = 'bookmark-folder card';
  card.dataset.id = folder.id;
  card.dataset.parentId = folder.parentId;
  card.dataset.index = index.toString();

  const icon = document.createElement('span');
  icon.className = 'material-icons mr-2';
  icon.innerHTML = ICONS.folder;
  
  const content = document.createElement('div');
  content.className = 'card-content';
  
  const title = document.createElement('div');
  title.className = 'card-title';
  title.textContent = folder.title;
  
  content.appendChild(title);
  card.appendChild(icon);
  card.appendChild(content);

  // Add click event handler to display folder contents
  card.addEventListener('click', function() {
    if (window._dragJustEnded || window._isDragging) return;
    updateBookmarksDisplay(folder.id);
    updateFolderName(folder.id);
  });

  // 从缓存获取文件夹颜色
  const cachedColors = ColorCache.get(folder.id, 'folder');
  if (cachedColors) {
    applyColors(card, cachedColors);
  } else {
    // 为文件夹生成默认颜色
    const defaultColors = {
      primary: [230, 230, 230],    // 稍微浅一点的灰色
      secondary: [240, 240, 240]    // 更浅的灰色
    };
    applyColors(card, defaultColors);
    ColorCache.set(folder.id, 'folder', defaultColors);
  }

  // 修改右键点击事件，使用文件夹的上下文菜单
  card.addEventListener('contextmenu', async function (event) {
    event.preventDefault();
    event.stopPropagation();

    // 确保文件夹上下文菜单存在
    if (!bookmarkFolderContextMenu) {
      bookmarkFolderContextMenu = createBookmarkFolderContextMenu();
    }

    if (!bookmarkFolderContextMenu) {
      
      return;
    }

    // 更新当前文件夹
    currentBookmarkFolder = card;
    
    // 重新创建菜单项以反映当前文件夹的状态
    await createMenuItems(bookmarkFolderContextMenu);
    
    // 先显示菜单但设为不可见，以便获取其尺寸
    bookmarkFolderContextMenu.style.display = 'block';
    bookmarkFolderContextMenu.style.visibility = 'hidden';
    bookmarkFolderContextMenu.style.left = '0';
    bookmarkFolderContextMenu.style.top = '0';
    
    // 获取视窗尺寸
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    // 等待一下以确保菜单已渲染
    setTimeout(() => {
      const menuRect = bookmarkFolderContextMenu.getBoundingClientRect();
      
      // 计算最佳位置
      let left = event.clientX;
      let top = event.clientY;
      
      // 检查右侧空间
      if (left + menuRect.width > viewportWidth) {
        // 如果右侧空间不足，尝试将菜单放在点击位置的左侧
        left = Math.max(5, left - menuRect.width);
      }
      
      // 检查底部空间
      if (top + menuRect.height > viewportHeight) {
        // 如果底部空间不足，尝试将菜单放在点击位置的上方
        top = Math.max(5, viewportHeight - menuRect.height - 5);
      }
      
      // 应用计算后的位置
      bookmarkFolderContextMenu.style.left = `${left}px`;
      bookmarkFolderContextMenu.style.top = `${top}px`;
      
      // 使菜单可见
      bookmarkFolderContextMenu.style.visibility = 'visible';
    }, 0);

    // 隐藏其他上下文菜单
    if (contextMenu) {
      contextMenu.style.display = 'none';
    }
  });

  return card;
}

function initBookmarkSortable() {
  const bookmarksList = document.getElementById('bookmarks-list');
  if (!bookmarksList) return;

  // 扁平布局：卡片在 .folder-bookmarks-grid 里，需要在每个 grid 上挂 Sortable
  const grids = bookmarksList.querySelectorAll('.folder-bookmarks-grid');
  if (grids.length > 0) {
    grids.forEach(function (grid) {
      if (grid.sortable) {
        grid.sortable.destroy();
      }
      new Sortable(grid, {
        group: {
          name: 'flat-sort',
          pull: false,
          put: false
        },
        animation: 150,
        onStart: function () {
          window._isDragging = true;
          document.body.classList.add('is-sorting-bookmarks');
        },
        onEnd: function (evt) {
          window._isDragging = false;
          document.body.classList.remove('is-sorting-bookmarks');
          const itemId = evt.item.dataset.id;
          const newIndex = evt.newIndex;
          const oldIndex = evt.oldIndex;

          if (oldIndex === newIndex && evt.from === evt.to) return;
          window._dragJustEnded = true;
          setTimeout(function () { window._dragJustEnded = false; }, 200);

          showMovingFeedback(evt.item);

          var newParentId;
          if (evt.to === grid) {
            var groupEl = grid.closest('.folder-group');
            if (groupEl) {
              newParentId = groupEl.id.replace('folder-group-', '').replace('-recommended', '');
            }
          } else {
            var otherGroup = evt.to.closest('.folder-group');
            if (otherGroup) {
              newParentId = otherGroup.id.replace('folder-group-', '').replace('-recommended', '');
            }
          }
          if (!newParentId) {
            newParentId = evt.item.dataset.parentId;
          }

          moveBookmark(itemId, newParentId, newIndex, oldIndex, evt.item.dataset.parentId)
            .then(function () {
              hideMovingFeedback(evt.item);
              showSuccessFeedback(evt.item);
            })
            .catch(function () {
              hideMovingFeedback(evt.item);
              showErrorFeedback(evt.item);
            });
        }
      });
    });
    return;
  }

  // 直接模式：卡片直接是 #bookmarks-list 的子元素
  if (bookmarksList.sortable) {
    bookmarksList.sortable.destroy();
  }

  new Sortable(bookmarksList, {
    animation: 150,
    onStart: function () {
      window._isDragging = true;
      document.body.classList.add('is-sorting-bookmarks');
    },
    onEnd: function (evt) {
      window._isDragging = false;
      document.body.classList.remove('is-sorting-bookmarks');

      var itemId = evt.item.dataset.id;
      var newIndex = evt.newIndex;
      var oldIndex = evt.oldIndex;

      if (oldIndex === newIndex) return;
      window._dragJustEnded = true;
      setTimeout(function () { window._dragJustEnded = false; }, 200);

      showMovingFeedback(evt.item);

      var parentId = bookmarksList.dataset.parentId;
      moveBookmark(itemId, parentId, newIndex, oldIndex, parentId).then(function () {
        hideMovingFeedback(evt.item);
        showSuccessFeedback(evt.item);
      }).catch(function () {
        hideMovingFeedback(evt.item);
        showErrorFeedback(evt.item);
        if (parentId) syncBookmarkOrder(parentId);
      });
    }
  });
}

function setupSortable() {
  sidebarSortableInstances.forEach(instance => instance.destroy());
  sidebarSortableInstances = [];

  initBookmarkSortable();

  const categoriesList = document.getElementById('categories-list');
  if (categoriesList) {
    const rootSortable = new Sortable(categoriesList, {
      draggable: '.folder-item',
      animation: 150,
      group: 'nested',
      swapThreshold: 0.65,
      onStart: function () {
        window._isDragging = true;
      },
      onEnd: function (evt) {
        window._isDragging = false;

        const itemEl = evt.item;
        const newIndex = evt.newIndex;
        const bookmarkId = itemEl.dataset.id;
        const newParentId = evt.to.closest('li') ? evt.to.closest('li').dataset.id : '1';

        if (evt.oldIndex !== evt.newIndex || evt.from !== evt.to) {
          window._dragJustEnded = true;
          setTimeout(function () { window._dragJustEnded = false; }, 200);
          moveBookmark(bookmarkId, newParentId, newIndex)
            .then(() => {
              initSidebarNavigation();
            })
            .catch(() => {
              initSidebarNavigation();
            });
        }
      }
    });
    sidebarSortableInstances.push(rootSortable);

    const folders = categoriesList.querySelectorAll('li ul');
    folders.forEach((folder, index) => {
      const nestedSortable = new Sortable(folder, {
        draggable: '.folder-item',
        group: 'nested',
        animation: 150,
        swapThreshold: 0.65,
        onStart: function () {
          window._isDragging = true;
        },
        onEnd: function (evt) {
          window._isDragging = false;

          const itemEl = evt.item;
          const newIndex = evt.newIndex;
          const bookmarkId = itemEl.dataset.id;
          const newParentId = evt.to.closest('li') ? evt.to.closest('li').dataset.id : '1';

          if (evt.oldIndex !== evt.newIndex || evt.from !== evt.to) {
            window._dragJustEnded = true;
            setTimeout(function () { window._dragJustEnded = false; }, 200);
            moveBookmark(bookmarkId, newParentId, newIndex)
              .then(() => {
                initSidebarNavigation();
              })
              .catch(() => {
                initSidebarNavigation();
              });
          }
        }
      });
      sidebarSortableInstances.push(nestedSortable);
    });
  } else {
    
  }
}

function moveBookmark(itemId, newParentId, newIndex, oldIndex = null, oldParentId = null) {
  return new Promise((resolve, reject) => {
    const destination = { index: newIndex };
    if (newParentId) destination.parentId = newParentId;
    if (oldParentId && newParentId === oldParentId && oldIndex !== null && oldIndex < newIndex) {
      destination.index = newIndex + 1;
    }
    chrome.bookmarks.move(itemId, destination, (result) => {
      if (chrome.runtime.lastError) {
        
        reject(chrome.runtime.lastError);
      } else {
        updateAffectedBookmarks(newParentId, itemId, result.index)
          .then(() => {
            resolve(result);
          })
          .catch(reject);
      }
    });
  });
}

function updateAffectedBookmarks(parentId, movedItemId, newIndex) {
  return new Promise((resolve, reject) => {
    const movedElement = document.querySelector(`.bookmark-card[data-id="${movedItemId}"], .bookmark-folder[data-id="${movedItemId}"]`);
    
    if (!movedElement) {
      
      reject(new Error('Moved element not found'));
      return;
    }

    const container = movedElement.parentElement;
    if (!container) {
      reject(new Error('Moved element container not found'));
      return;
    }

    const bookmarkElements = Array.from(container.children).filter((element) => {
      return element.classList.contains('bookmark-card') || element.classList.contains('bookmark-folder');
    });
    const oldIndex = bookmarkElements.indexOf(movedElement);
    
    if (oldIndex === -1) {
      reject(new Error('Moved element index not found'));
      return;
    }

    movedElement.dataset.parentId = parentId;

    // 位置没有变化，不需要额外移动 DOM
    if (oldIndex === newIndex) {
      bookmarkElements.forEach((element, index) => {
        element.dataset.index = index.toString();
      });
      bookmarkOrderCache[parentId] = bookmarkElements.map(el => el.dataset.id);
      resolve();
      return;
    }

    // 移动元素到当前容器中的正确位置
    if (newIndex >= bookmarkElements.length) {
      container.appendChild(movedElement);
    } else {
      container.insertBefore(movedElement, bookmarkElements[newIndex]);
    }

    Array.from(container.children).forEach((element, index) => {
      if (element.classList.contains('bookmark-card') || element.classList.contains('bookmark-folder')) {
      element.dataset.index = index.toString();
      }
    });

    bookmarkOrderCache[parentId] = Array.from(container.children)
      .filter((element) => element.classList.contains('bookmark-card') || element.classList.contains('bookmark-folder'))
      .map(el => el.dataset.id);

    highlightBookmark(movedItemId);
    resolve();
  });
}

function highlightBookmark(itemId) {
  const bookmarkElement = document.querySelector(`[data-id="${itemId}"]`);
  if (bookmarkElement) {
    bookmarkElement.style.transition = 'background-color 0.5s ease';
    bookmarkElement.style.backgroundColor = '#ffff99';
    setTimeout(() => {
      bookmarkElement.style.backgroundColor = '';
    }, 1000);
  }
}

// 修改 displayBookmarkCategories 函数，添加清理逻辑
function displayBookmarkCategories(bookmarkNodes, level, parentUl, parentId) {
  const categoriesList = parentUl || document.getElementById('categories-list');

  // 如果是根级调用，先清空现有内容
  if (!parentUl) {
    categoriesList.innerHTML = '';
  }

  if (parentId === '1') {
    categoriesList.style.display = 'block';
  }

  // 需要默认展开的特定ID（1: 收藏夹栏, 2: 其他收藏夹）
  const defaultExpandedIds = ['1', '2'];
  
  bookmarkNodes.forEach(function (bookmark) {
    if (bookmark.children && bookmark.children.length > 0) {
      let li = document.createElement('li');
      li.className = 'cursor-pointer p-2 hover:bg-emerald-500 rounded-lg flex items-center folder-item';
      li.style.paddingLeft = `${(level * 20) + 8}px`;
      li.dataset.title = bookmark.title;
      li.dataset.id = bookmark.id;

      let span = document.createElement('span');
      span.textContent = bookmark.title;

      // remixicon 文件夹图标，基于名称哈希选图标
      const iconList = ['ri-folder-line','ri-folder-2-line','ri-folder-3-line','ri-folder-4-line','ri-bookmark-line','ri-star-line'];
      function hashStr(s) { let h=0; for(let i=0;i<s.length;i++) h=((h<<5)-h)+s.charCodeAt(i); return Math.abs(h); }
      const folderIcon = document.createElement('i');
      folderIcon.className = iconList[hashStr(bookmark.title) % iconList.length];
      folderIcon.style.cssText = 'font-size:16px;color:#667eea;margin-right:8px;flex-shrink:0;width:20px;text-align:center;';
      li.insertBefore(folderIcon, li.firstChild);

      // 检查是否有子文件夹（用于决定是否显示箭头图标）
      // 对于特定ID的文件夹，只要有一级子文件夹就应该显示箭头图标
      // 对于其他文件夹，只有当有孙子级文件夹时才显示箭头图标
      const hasSubfolders = defaultExpandedIds.includes(bookmark.id)
        ? bookmark.children.some(child => !child.url)  // 有一级子文件夹
        : bookmark.children.some(child => child.children);  // 有孙子级文件夹
      
      let arrowIcon;
      if (hasSubfolders) {
        arrowIcon = document.createElement('span');
        arrowIcon.className = 'material-icons ml-auto';
        // 只有特定ID的一级导航默认展开，显示向下箭头
        if (defaultExpandedIds.includes(bookmark.id)) {
          arrowIcon.innerHTML = ICONS.expand_less;
        } else {
          arrowIcon.innerHTML = ICONS.chevron_right;
        }
        li.appendChild(arrowIcon);
      }

      let sublist = document.createElement('ul');
      sublist.className = 'pl-4 space-y-2';
      // 只有特定ID的一级导航默认展开
      if (defaultExpandedIds.includes(bookmark.id)) {
        sublist.style.display = 'block';
      } else {
        sublist.style.display = 'none';
      }

      li.addEventListener('click', function (event) {
        event.stopPropagation();
        if (hasSubfolders) {
          let isExpanded = sublist.style.display === 'block';
          sublist.style.display = isExpanded ? 'none' : 'block';
          if (arrowIcon) {
            arrowIcon.innerHTML = isExpanded ? ICONS.chevron_right : ICONS.expand_less;
          }
        }

        document.querySelectorAll('#categories-list li').forEach(function (item) {
          item.classList.remove('bg-emerald-500');
        });
        li.classList.add('bg-emerald-500');

        const folderId = bookmark.id;
        // 先尝试直接滚动到目标元素
        let target = document.getElementById(`folder-group-${folderId}`);
        if (!target && (folderId === '1' || folderId === '2')) {
          target = document.getElementById(`folder-group-${folderId}-recommended`);
        }
        if (target) {
          scrollToFolderGroup(target);
        } else {
          // 元素不存在时触发渲染后再滚动
          updateBookmarksDisplay(folderId).then(() => {
            const el = document.getElementById(`folder-group-${folderId}`) || document.getElementById(`folder-group-${folderId}-recommended`);
            if (el) scrollToFolderGroup(el);
          });
        }
      });

      li.appendChild(span);
      categoriesList.appendChild(li);
      categoriesList.appendChild(sublist);

      displayBookmarkCategories(bookmark.children, level + 1, sublist, bookmark.id);
    }
  });

  if (!parentUl) {
    setupSortable();
  }
}

// 添加一个获取文件夹内书签数量的函数
function getFolderBookmarkCount(folderId) {
  return new Promise((resolve) => {
    let count = 0;

    function countBookmarks(bookmarkNodes) {
      bookmarkNodes.forEach(node => {
        if (node.url) {
          count++;
        }
        if (node.children) {
          countBookmarks(node.children);
        }
      });
    }

    chrome.bookmarks.getChildren(folderId, (children) => {
      if (chrome.runtime.lastError) {
        resolve(0);
        return;
      }
      countBookmarks(children);
      resolve(count);
    });
  });
}
// 新增辅助函数
async function isDefaultFolder(folderId) {
  if (!folderId) return false;

  const data = FavsHubSettings.get('defaultFolders') || [];
  const defaultFolders = Array.isArray(data.defaultFolders) ? data.defaultFolders : (data.defaultFolders?.items || []);
  return defaultFolders.some(folder => folder.id === folderId);
}
// 创建文件夹上下文菜单
function createBookmarkFolderContextMenu() {

  // 移除任何已存在的上下文菜单
  const existingMenu = document.querySelector('.bookmark-folder-context-menu');
  if (existingMenu) {
    existingMenu.remove();
  }

  const menu = document.createElement('div');
  menu.className = 'bookmark-folder-context-menu custom-context-menu';
  document.body.appendChild(menu);

  // 异步创建菜单项
  createMenuItems(menu).catch(error => {
    
  });

  return menu;
}

async function createMenuItems(menu) {  
  
  // 清空现有菜单项
  menu.innerHTML = '';

  // 每次创建菜单时重新检查当前文件夹的状态
  let isDefault = false;
  if (currentBookmarkFolder?.dataset?.id) {
    try {
      // 确保在获取状态前等待 chrome.storage.sync.get 完成
      const data = FavsHubSettings.get('defaultFolders') || [];
      const defaultFolders = Array.isArray(data.defaultFolders) ? data.defaultFolders : (data.defaultFolders?.items || []);
      isDefault = defaultFolders.some(folder => folder.id === currentBookmarkFolder.dataset.id);
    } catch (error) {
      
      isDefault = false;
    }
  }

  const menuItems = [
    { 
      text: getLocalizedMessage('openAllBookmarks'),
      icon: 'open_in_new',  
      action: () => {
        if (currentBookmarkFolder) {
          const folderId = currentBookmarkFolder.dataset.id;
          const folderTitle = currentBookmarkFolder.querySelector('.card-title').textContent;
          
          chrome.bookmarks.getChildren(folderId, (bookmarks) => {
            // 过滤出有效的书签URL
            const validUrls = bookmarks
              .filter(bookmark => bookmark.url)
              .map(bookmark => bookmark.url);

            if (validUrls.length > 0) {
              // 使用 chrome.runtime.sendMessage 发送消息给后台脚本
              chrome.runtime.sendMessage({
                action: 'openMultipleTabsAndGroup',
                urls: validUrls,
                groupName: folderTitle // 使用文件夹名称作为标签组名称
              }, (response) => {
                if (response.success) {
                } else {
                  
                }
              });
            }
          });
        }
      }
    },
    // 原有的菜单项
    { text: getLocalizedMessage('rename'), icon: 'edit', action: () => currentBookmarkFolder && openEditBookmarkFolderDialog(currentBookmarkFolder) },
    { text: getLocalizedMessage('delete'), icon: 'delete', action: () => {
      if (currentBookmarkFolder) {
        const folderId = currentBookmarkFolder.dataset.id;
        const folderTitle = currentBookmarkFolder.querySelector('.card-title').textContent;
        const parentId = currentBookmarkFolder.dataset.parentId || '1';
        
        showConfirmDialog(chrome.i18n.getMessage("confirmDeleteFolder", [`<strong>${folderTitle}</strong>`]), async () => {
          try {
            await chrome.bookmarks.removeTree(folderId);
            
            // 1. 立即从 UI 中移除文件夹卡片
            const folderCard = document.querySelector(`.bookmark-folder[data-id="${folderId}"]`);
            if (folderCard) {
              folderCard.remove();
            }
            
            // 2. 从侧边栏中移除对应的文件夹及其所有子文件夹
            const sidebarFolder = document.querySelector(`#categories-list li[data-id="${folderId}"]`);
            if (sidebarFolder) {
              // 获取并移除所有子文件夹
              const subFolders = sidebarFolder.querySelectorAll('ul');
              subFolders.forEach(ul => ul.remove());
              sidebarFolder.remove();
            }

            // 3. 清除相关缓存
            if (bookmarksCache.data.has(folderId)) {
              bookmarksCache.delete(folderId);
            }
            if (bookmarksCache.data.has(parentId)) {
              bookmarksCache.delete(parentId);
            }
            
            // 4. 显示删除成功的 toast 消息
            Utilities.showToast(getLocalizedMessage('deleteSuccess'));

            // 5. 如果删除的是当前显示的文件夹，则返回上一级并重新加载
            const bookmarksList = document.getElementById('bookmarks-list');
            if (bookmarksList.dataset.parentId === folderId) {
              await updateBookmarksDisplay(parentId);
              updateFolderName(parentId);
              selectSidebarFolder(parentId);
            }

            // 6. 重新加载父文件夹的内容
            const parentFolder = document.querySelector(`.bookmark-folder[data-id="${parentId}"]`);
            if (parentFolder) {
              await updateBookmarksDisplay(parentId);
            }

          } catch (error) {
            
            Utilities.showToast(getLocalizedMessage('deleteFolderError'));
          }
        });
      }
    }},
    {
      // 根据当前状态设置文本
      text: isDefault ? getLocalizedMessage('removeFromDefaultFolders') : getLocalizedMessage('addToDefaultFolders'),
      icon: isDefault ? 'keep_off' : 'keep',
      action: async () => {
        const folder = currentBookmarkFolder;

        if (!folder?.dataset?.id) {
          
          return;
        }

        await toggleDefaultFolder(folder);
        
        // 重新获取当前状态
        const data = FavsHubSettings.get('defaultFolders') || [];
        const defaultFolders = Array.isArray(data.defaultFolders) ? data.defaultFolders : (data.defaultFolders?.items || []);
        const newIsDefault = defaultFolders.some(f => f.id === folder.dataset.id);

        const menuItem = menu.querySelector(`[data-action="toggleDefault"]`);
        if (menuItem) {
          const newText = getLocalizedMessage(newIsDefault ? 'removeFromDefaultFolders' : 'addToDefaultFolders');
          
          menuItem.querySelector('.text').textContent = newText;
          const iconElement = menuItem.querySelector('.icon-svg');
          if (iconElement) {
            iconElement.innerHTML = ICONS[newIsDefault ? 'keep_off' : 'keep'];
          }
        }
      }
    }
  ];

  // 创建菜单项
  menuItems.forEach((item, index) => {
    const menuItem = document.createElement('div');
    menuItem.className = 'custom-context-menu-item';
    
    if (item.icon === 'keep' || item.icon === 'keep_off') {
      menuItem.dataset.action = 'toggleDefault';
    }
    
    const icon = document.createElement('span');
    icon.className = 'icon-svg';
    icon.innerHTML = ICONS[item.icon];
    if (item.icon === 'keep' || item.icon === 'keep_off') {
      icon.classList.toggle('selected', isDefault);
    }
    
    const text = document.createElement('span');
    text.className = 'text';
    text.textContent = item.text;

    menuItem.appendChild(icon);
    menuItem.appendChild(text);
    menuItem.addEventListener('click', async (e) => {
      e.stopPropagation();
      await item.action();
      setTimeout(() => {
      menu.style.display = 'none';
      }, 100);
    });

    menu.appendChild(menuItem);
  });
}


// 添加文件夹相关的全局变量
// Add event listeners or logic that uses these variables
document.addEventListener('DOMContentLoaded', () => {
  // Example initialization logic
  bookmarkFolderContextMenu = document.querySelector('#bookmark-folder-context-menu');
  currentBookmarkFolder = document.querySelector('.bookmark-folder.active');

  // Ensure these elements exist before using them
  if (bookmarkFolderContextMenu && currentBookmarkFolder) {
    // Add your event listeners or logic here
  }
});


function openEditBookmarkFolderDialog(folderElement) {
  const folderId = folderElement.dataset.id;
  const folderTitle = folderElement.querySelector('.card-title').textContent;

  const editCategoryNameInput = document.getElementById('edit-category-name');
  const editCategoryDialog = document.getElementById('edit-category-dialog');
  const editCategoryForm = document.getElementById('edit-category-form');

  editCategoryNameInput.value = folderTitle;
  editCategoryDialog.style.display = 'block';

  editCategoryForm.onsubmit = function (event) {
    event.preventDefault();
    const newTitle = editCategoryNameInput.value;
    chrome.bookmarks.update(folderId, { title: newTitle }, function () {
      updateCategoryUI(folderId, newTitle);
      updateFolderName(folderId);
      editCategoryDialog.style.display = 'none';
    });
  };
}

function updateCategoryUI(folderId, newTitle) {
  // 更新侧边栏中的文件夹名称
  const sidebarItem = document.querySelector(`#categories-list li[data-id="${folderId}"]`);
  if (sidebarItem) {
    // 更新文本内容
    const textSpan = sidebarItem.querySelector('span:not(.material-icons)');
    if (textSpan) {
      textSpan.textContent = newTitle;
    }

    // 更新 data-title 属性
    sidebarItem.setAttribute('data-title', newTitle);

    // 更新样式
    sidebarItem.classList.add('updated-folder');
    setTimeout(() => {
      sidebarItem.classList.remove('updated-folder');
    }, 2000); // 2秒后移除高亮效果
  }

  // 更新面包屑导航
  updateFolderName(folderId);

  // 更新文件夹卡片（如果在当前视图中）
  const folderCard = document.querySelector(`.bookmark-folder[data-id="${folderId}"]`);
  if (folderCard) {
    const titleElement = folderCard.querySelector('.card-title');
    if (titleElement) {
      titleElement.textContent = newTitle;
    }
  }
}


function showFolder(folderId) {
  // 显示侧边栏的文件夹
  const sidebarFolderElement = document.querySelector(`#categories-list li[data-id="${folderId}"]`);
  if (sidebarFolderElement) {
    sidebarFolderElement.style.display = '';
    // 如果文夹之前是展开的，显示其子列表
    const sublist = getDraggedFolderSublist(sidebarFolderElement);
    if (sublist) {
      sublist.style.display = '';

    }
  } else {
  }

  // 显示内容区域中的文件夹内容（如果当前显示的是该文夹的内容）
  const bookmarksList = document.getElementById('bookmarks-list');
  if (bookmarksList.dataset.parentId === folderId) {
    bookmarksList.style.display = '';

  }

  // 显示文件夹卡片
  const folderCard = document.querySelector(`.bookmark-folder[data-id="${folderId}"]`);
  if (folderCard) {
    folderCard.style.display = '';

  } else {
  }
}

function setDefaultBookmark(bookmarkId) {

  localStorage.setItem('defaultBookmarkId', bookmarkId);
  updateDefaultBookmarkIndicator();
  selectSidebarFolder(bookmarkId);


  // 刷新 bookmarks-container
  updateBookmarksDisplay(bookmarkId);

  // 更新侧边栏中的默认书签指示和选中状态
  updateSidebarDefaultBookmarkIndicator();

  // 通知背景脚本更新默认书签ID
  chrome.runtime.sendMessage({ action: 'setDefaultBookmarkId', defaultBookmarkId: bookmarkId }, function (response) {
    if (response && response.success) {
    }
  });
}

function updateSidebarDefaultBookmarkIndicator() {
  const defaultBookmarkId = localStorage.getItem('defaultBookmarkId');
  selectSidebarFolder(defaultBookmarkId);
  
  const allCategories = document.querySelectorAll('#categories-list li');
  allCategories.forEach(category => {
    const indicator = category.querySelector('.default-indicator');
    if (indicator) {
      indicator.remove();
    }
    if (category.dataset.id === defaultBookmarkId) {
      const defaultIndicator = document.createElement('span');
      defaultIndicator.className = 'default-indicator material-icons';
      defaultIndicator.textContent = 'star';
      defaultIndicator.title = getLocalizedMessage('homepage');
      category.appendChild(defaultIndicator);
    }
  });
}

// 添加局变量来存储本地缓存
let bookmarkOrderCache = {};

// 添加一函数来同步本地缓存和 Chrome 书签
function syncBookmarkOrder(parentId) {
  const cached = bookmarksCache.get(parentId);
  if (!cached) return;
  
  
  chrome.bookmarks.getChildren(parentId, (bookmarks) => {
    const chromeOrder = bookmarks.map(b => b.id);
    const cachedOrder = cached.bookmarks.map(b => b.id);
    
    if (JSON.stringify(chromeOrder) !== JSON.stringify(cachedOrder)) {
      // 更新缓存
      bookmarksCache.set(parentId, bookmarks);
      
      // 重新渲染当前页
      renderBookmarksPage({ bookmarks, totalCount: bookmarks.length }, 0);
    }
  });
}

// 添加一个定期同步函数
function startPeriodicSync() {
  setInterval(() => {
      const bookmarksList = document.getElementById('bookmarks-list');
      if (bookmarksList && bookmarksList.dataset.parentId) {
      const currentParentId = bookmarksList.dataset.parentId;
      try {
        syncBookmarkOrder(currentParentId);
      } catch (error) {
        
      }
    }
  }, 30000); // 每30秒同步一次
}

let isRequestPending = false;

function setupSpecialLinks() {
  const specialLinks = document.querySelectorAll('.settings-icon a, .sidebar-toolbar a');
  let isProcessingClick = false;

  specialLinks.forEach(link => {
    link.addEventListener('click', async function (e) {
      const href = this.getAttribute('href');
      // 只拦截 # 开头的特殊链接，其他链接正常跳转
      if (!href || !href.startsWith('#')) return;
      e.preventDefault();
      if (isProcessingClick) return;

      isProcessingClick = true;

      let chromeUrl;
      switch (href) {
        case '#history':
          chromeUrl = 'chrome://history';
          break;
        case '#downloads':
          chromeUrl = 'chrome://downloads';
          break;
        case '#passwords':
          chromeUrl = 'chrome://settings/passwords';
          break;
        case '#extensions':
          chromeUrl = 'chrome://extensions';
          break;
        case '#settings':
          openSettingsModal();
          isProcessingClick = false;
          return;
        default:
          
          isProcessingClick = false;
          return;
      }

      try {
        // 直接使用 chrome.tabs.create 打开新标签页
        chrome.tabs.create({ url: chromeUrl }, (tab) => {
          if (chrome.runtime.lastError) {
            
          }
        });
      } catch (error) {
        
      } finally {
        setTimeout(() => {
          isProcessingClick = false;
        }, 1000);
      }
    });
  });
}

function updateDefaultBookmarkIndicator() {
  const defaultBookmarkId = localStorage.getItem('defaultBookmarkId');
  const allBookmarks = document.querySelectorAll('.bookmark-card, .bookmark-folder');
  allBookmarks.forEach(bookmark => {
    const indicator = bookmark.querySelector('.default-indicator');
    if (indicator) {
      indicator.remove();
    }
    if (bookmark.dataset.id === defaultBookmarkId) {
      const defaultIndicator = document.createElement('span');
      defaultIndicator.className = 'default-indicator material-icons';
      defaultIndicator.textContent = 'star';
      defaultIndicator.title = getLocalizedMessage('homepage');
      bookmark.appendChild(defaultIndicator);
    }
  });
}

function selectSidebarFolder(folderId) {
  const allFolders = document.querySelectorAll('#categories-list li');
  allFolders.forEach(folder => {
    folder.classList.remove('bg-emerald-500');
    if (folder.dataset.id === folderId) {
      folder.classList.add('bg-emerald-500');
    }
  });
}

// 确在 DOMContentLoaded 事件初始化上文菜单
document.addEventListener('DOMContentLoaded', function () {
  // ... 其他初始化代码 ...
  createBookmarkFolderContextMenu();
});




// 保留原有的DOMContentLoaded事件监听器，但移除其中的背景应用逻辑
document.addEventListener('DOMContentLoaded', function () {

  // 在页面加载完成后立即检查 folder-name 元素
  const folderNameElement = document.getElementById('folder-name');

  // 设置一个 MutationObserver 来监视 folder-name 元素的变化
  if (folderNameElement) {
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
      });
    });
    observer.observe(folderNameElement, { childList: true, subtree: true });
  }

  function expandBookmarkTree(category) {
    let parent = category.parentElement;
    while (parent && parent.id !== 'categories-list') {
      if (parent.classList.contains('folder-item')) {
        const sublist = parent.nextElementSibling;
        if (sublist && sublist.tagName === 'UL') {
          sublist.style.display = 'block';
          const arrowIcon = parent.querySelector('.material-icons.ml-auto');
          if (arrowIcon) {
            arrowIcon.textContent = 'expand_less';
          }
        }
      }
      parent = parent.parentElement;
    }
  }

  function waitForFirstCategoryEdge(attemptsLeft) {
    waitForFirstCategory(attemptsLeft);
  }

  function findBookmarksByParentId(nodes, parentId) {
    if (!nodes) return [];
    let bookmarks = [];
    nodes.forEach(node => {
      if (node.parentId === parentId) {
        bookmarks.push(node);
      }
      if (node.children && node.children.length > 0) {
        bookmarks = bookmarks.concat(findBookmarksByParentId(node.children, parentId));
      }
    });
    return bookmarks;
  }


  function isEdgeBrowser() {
    return /Edg/.test(navigator.userAgent);
  }

  if (isEdgeBrowser()) {
    waitForFirstCategoryEdge(10);
  } else {
    waitForFirstCategory(10);
  }

  const toggleSidebarButton = document.getElementById('toggle-sidebar');
  const sidebarContainer = document.getElementById('sidebar-container');

  // 读取保存的侧边栏状态
  const isSidebarCollapsed = localStorage.getItem('sidebarCollapsed') === 'true';

  // 初始化状态
  function setSidebarState(isCollapsed) {
    if (isCollapsed) {
      sidebarContainer.classList.add('collapsed');
      toggleSidebarButton.textContent = '>';
      toggleSidebarButton.style.left = '2rem'; // 收起时的位置
    } else {
      sidebarContainer.classList.remove('collapsed');
      toggleSidebarButton.textContent = '<';
      toggleSidebarButton.style.left = '14.75rem'; // 展开时的位置
    }
  }

  // 应用初始状态
  setSidebarState(isSidebarCollapsed);

  // 切换侧边状态的函数
  function toggleSidebar() {
    const isCollapsed = sidebarContainer.classList.toggle('collapsed');
    setSidebarState(isCollapsed);
    localStorage.setItem('sidebarCollapsed', isCollapsed);
  }

  // 添加点击事件监听器
  if (toggleSidebarButton) {
    toggleSidebarButton.addEventListener('click', toggleSidebar);
  }

  document.addEventListener('click', function (event) {
    if (event.target.closest('#categories-list li')) {
      updateBookmarkCards();
    }
  });

  updateBookmarkCards();

  // 注释掉这个重复的createContextMenu函数定义，使用全局已经定义的函数
  /* function createContextMenu() {
    const menu = document.createElement('div');
    menu.className = 'custom-context-menu';
    document.body.appendChild(menu);
    // ... 其余函数内容 ...
  } */

  document.addEventListener('click', function () {
    // 延迟处理点击事件，让菜单项的点击事件先执行
    setTimeout(() => {
    if (contextMenu) {
      contextMenu.style.display = 'none';
        currentBookmark = null;
      }
      
      if (bookmarkFolderContextMenu) {
        bookmarkFolderContextMenu.style.display = 'none';
        currentBookmarkFolder = null;
      }
    }, 200);
  });

  const editDialog = document.getElementById('edit-dialog');
  const editForm = document.getElementById('edit-form');
  const editNameInput = document.getElementById('edit-name');
  const editUrlInput = document.getElementById('edit-url');
  const closeButton = document.querySelector('.close-button');
  const cancelButton = document.querySelector('.cancel-button');

  function openEditDialog(bookmark) {
    const bookmarkId = bookmark.id;
    const bookmarkTitle = bookmark.title;
    const bookmarkUrl = bookmark.url;

    document.getElementById('edit-name').value = bookmarkTitle;
    document.getElementById('edit-url').value = bookmarkUrl;

    const editDialog = document.getElementById('edit-dialog');
    editDialog.style.display = 'block';

    // 设置提交事件
    document.getElementById('edit-form').onsubmit = function (event) {
      event.preventDefault();
      const newTitle = document.getElementById('edit-name').value;
      const newUrl = document.getElementById('edit-url').value;
      chrome.bookmarks.update(bookmarkId, { title: newTitle, url: newUrl }, function () {
        editDialog.style.display = 'none';

        // 更新特定的书签卡片
        updateSpecificBookmarkCard(bookmarkId, newTitle, newUrl);
      });
    };

    // 添加取消按钮的事件监听
    document.querySelector('.cancel-button').addEventListener('click', function () {
      editDialog.style.display = 'none';
    });

    // 添加关闭按钮的事件监听
    document.querySelector('.close-button').addEventListener('click', function () {
      editDialog.style.display = 'none';
    });
  }

  function updateSpecificBookmarkCard(bookmarkId, newTitle, newUrl) {
    const bookmarkCard = document.querySelector(`.bookmark-card[data-id="${bookmarkId}"]`);
    if (bookmarkCard) {
      bookmarkCard.href = newUrl;
      bookmarkCard.querySelector('.card-title').textContent = newTitle;

      // 更新 favicon 和颜色
      const img = bookmarkCard.querySelector('img');
      updateBookmarkCardColors(bookmarkCard, newUrl, img);
    }
  }

  function updateBookmarkCardColors(bookmarkCard, newUrl, img) {
    // 清旧的缓存
    localStorage.removeItem(`bookmark-colors-${bookmarkCard.dataset.id}`);
    
    // 更新 favicon URL（使用统一方案）
    img.src = window.getFaviconUrl ? window.getFaviconUrl(newUrl, 32) : '/images/placeholder-icon.svg';
    
    img.onload = function () {
      const colors = getColors(img);
      applyColors(bookmarkCard, colors);
      localStorage.setItem(`bookmark-colors-${bookmarkCard.dataset.id}`, JSON.stringify(colors));
    };
    
    img.onerror = function () {
      const defaultColors = { primary: [200, 200, 200], secondary: [220, 220, 220] };
      applyColors(bookmarkCard, defaultColors);
      localStorage.setItem(`bookmark-colors-${bookmarkCard.dataset.id}`, JSON.stringify(defaultColors));
    };
  }

  closeButton.onclick = function () {
    editDialog.style.display = 'none';
  };

  cancelButton.onclick = function () {
    editDialog.style.display = 'none';
  };

  window.onclick = function (event) {
    if (event.target == editDialog) {
      editDialog.style.display = 'none';
    }
  };

  function findBookmarkNodeByTitle(nodes, title) {
    for (let node of nodes) {
      if (node.title === title) {
        return node;
      } else if (node.children) {
        const result = findBookmarkNodeByTitle(node.children, title);
        if (result) {
          return result;
        }
      }
    }
    return null;
  }



  // 调用 updateBookmarkCards
  updateBookmarkCards();

  function expandToBookmark(bookmarkId) {
    setTimeout(() => {
      const bookmarkElement = document.querySelector(`#categories-list li[data-id="${bookmarkId}"]`);
      if (bookmarkElement) {
        let parent = bookmarkElement.parentElement;
        while (parent && parent.id !== 'categories-list') {
          if (parent.classList.contains('folder-item')) {
            parent.classList.add('expanded');
            const sublist = parent.querySelector('ul');
            if (sublist) sublist.style.display = 'block';
          }
          parent = parent.parentElement;
        }
        bookmarkElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        bookmarkElement.style.animation = 'highlight 1s';
      }
    }, 100); // 给予一些 DOM 更新
  }

  function getFavicon(url, callback) {
    // 使用统一的 favicon 获取函数（自动适配扩展/Web 环境）
    const faviconUrl = window.getFaviconUrl ? window.getFaviconUrl(url, 32) : '';
    if (faviconUrl) {
      const img = new Image();
      img.onload = function () {
        callback(faviconUrl);
      };
      img.onerror = function () {
        callback('');
      };
      img.src = faviconUrl;
    } else {
      callback('');
    }
  }

  function fetchFaviconOnline(domain, callback) {
    const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
    const img = new Image();
    img.onload = function () {
      cacheFavicon(domain, faviconUrl);
      callback(faviconUrl);
    };
    img.onerror = function () {
      callback('');
    };
    img.src = faviconUrl;
  }

  function cacheFavicon(domain, faviconUrl) {
    const data = {};
    data[domain] = faviconUrl;
    chrome.storage.local.set(data);
  }

  let currentCategory = null;
  // 递归获取所有书签数量的函数
  const getAllBookmarksCount = async (folderId, maxDepth = 5) => {
    let count = 0;
    let depth = 0;

    async function countBookmarks(id, currentDepth) {
      if (currentDepth > maxDepth) return 0;

      return new Promise((resolve) => {
        chrome.bookmarks.getChildren(id, async (items) => {
          let localCount = 0;

          for (const item of items) {
            if (item.url && item.url.startsWith('http')) {
              localCount++;
            } else if (currentDepth < maxDepth) {
              localCount += await countBookmarks(item.id, currentDepth + 1);
            }
          }

          resolve(localCount);
        });
      });
    }

    count = await countBookmarks(folderId, depth);
    return count;
  };
  // 1. 批量创建标签页的函数
  function createTabsInBatches(urls, groupName, batchSize = 5, delay = 100) {
    return new Promise((resolve) => {
      const tabIds = [];
      let currentBatch = 0;

      function createBatch() {
        const batch = urls.slice(currentBatch, currentBatch + batchSize);
        if (batch.length === 0) {
          // 所有标签页创建完成后，创建标签组
          if (tabIds.length > 1) {
            chrome.tabs.group({ tabIds }, (groupId) => {
              chrome.tabGroups.update(groupId, {
                title: groupName,
              });
              resolve({ success: true });
            });
          } else {
            resolve({ success: true });
          }
          return;
        }

        // 创建这一批的标签页
        Promise.all(batch.map(url =>
          new Promise((resolve) => {
            chrome.tabs.create({ url, active: false }, (tab) => {
              if (tab) tabIds.push(tab.id);
              resolve();
            });
          })
        )).then(() => {
          currentBatch += batchSize;
          // 添加延迟以避免过快创建标签页
          setTimeout(createBatch, delay);
        });
      }

      createBatch();
    });
  }
  function createCategoryContextMenu() {
    const menu = document.createElement('div');
    menu.className = 'custom-context-menu';
    document.body.appendChild(menu);

    // 创建基本菜单项
    const createMenuItems = async (bookmarkCount) => {
      // 检查当前文件夹是否为默认文件夹
      let isDefault = false;
      if (currentCategory?.dataset?.id) {
        try {
          const data = FavsHubSettings.get('defaultFolders') || [];
          const defaultFolders = Array.isArray(data.defaultFolders) ? data.defaultFolders : (data.defaultFolders?.items || []);
          isDefault = defaultFolders.some(folder => folder.id === currentCategory.dataset.id);
        } catch (error) {
          
        }
      }

      const menuItems = [
        {
          text: `${getLocalizedMessage('openAllBookmarks')} (${bookmarkCount})`,
          icon: 'open_in_new',
          action: () => {
            if (currentCategory) {
              const folderId = currentCategory.dataset.id;
              const folderTitle = currentCategory.dataset.title;

              // 递归获取所有书签 URL 的函数
              const getAllBookmarkUrls = async (folderId) => {
                return new Promise((resolve) => {
                  chrome.bookmarks.getChildren(folderId, async (items) => {
                    let urls = [];
                    for (const item of items) {
                      if (item.url) {
                        urls.push(item.url);
                      } else {
                        // 递归获取子文件夹的 URLs
                        const subUrls = await getAllBookmarkUrls(item.id);
                        urls = urls.concat(subUrls);
                      }
                    }
                    resolve(urls);
                  });
                });
              };

              // 获取并打开所有书签
              getAllBookmarkUrls(folderId).then(validUrls => {
                if (validUrls.length > 0) {
                  // 使用 background.js 中的优化函数
                  chrome.runtime.sendMessage({
                    action: 'openMultipleTabsAndGroup',
                    urls: validUrls,
                    groupName: folderTitle
                  }, (response) => {
                    if (response.success) {
                    } else {
                      
                    }
                  });
                }
              });
            }
          }
        },
        // 原有的菜单项保持不变
        { text: getLocalizedMessage('rename'), icon: 'edit' },
        { text: getLocalizedMessage('delete'), icon: 'delete' },
        { 
          text: isDefault ? getLocalizedMessage('removeFromDefaultFolders') : getLocalizedMessage('addToDefaultFolders'),
          icon: isDefault ? 'keep_off' : 'keep',
          action: async () => {
            if (!currentCategory?.dataset?.id) {
              
              return;
            }
            await toggleDefaultFolder(currentCategory);
          }
        }
      ];

      // 清空现有菜单项
      menu.innerHTML = '';

      // 创建菜单项的其余代码保持不变...
      menuItems.forEach(item => {
        const menuItem = document.createElement('div');
        menuItem.className = 'custom-context-menu-item';

        const icon = document.createElement('span');
        icon.className = 'material-icons';
        icon.innerHTML = ICONS[item.icon];
        icon.style.marginRight = '8px';
        icon.style.fontSize = '18px';

        const text = document.createElement('span');
        text.textContent = item.text;

        menuItem.appendChild(icon);
        menuItem.appendChild(text);

        menuItem.addEventListener('click', function () {
          if (item.action) {
            item.action();
          } else {
            switch (item.text) {
              case getLocalizedMessage('rename'):
                openEditCategoryDialog(currentCategory);
                break;
              case getLocalizedMessage('delete'):
                const categoryId = currentCategory.dataset.id;
                const categoryTitle = currentCategory.dataset.title;
                showConfirmDialog(chrome.i18n.getMessage("confirmDeleteFolder", [`<strong>${categoryTitle}</strong>`]), () => {
                  chrome.bookmarks.removeTree(categoryId, function () {
                    currentCategory.remove();
                    Utilities.showToast(getLocalizedMessage('categoryDeleted'));
                  });
                });
                break;
            }
          }
          menu.style.display = 'none';
        });

        menu.appendChild(menuItem);
      });
    };

    return {
      menu: menu,
      updateMenuItems: createMenuItems
    };
  }

  const categoryContextMenu = createCategoryContextMenu();

  document.addEventListener('contextmenu', function (event) {
    const targetCategory = event.target.closest('#categories-list li');
    if (targetCategory) {
      event.preventDefault();
      currentCategory = targetCategory;

      if (currentCategory) {
        const folderId = currentCategory.dataset.id;
        // 使用新的递归函数获取总书签数量
        getAllBookmarksCount(folderId).then(totalCount => {
          categoryContextMenu.updateMenuItems(totalCount);

          categoryContextMenu.menu.style.top = `${event.clientY}px`;
          categoryContextMenu.menu.style.left = `${event.clientX}px`;
          categoryContextMenu.menu.style.display = 'block';
        });
      }
    } else {
      categoryContextMenu.menu.style.display = 'none';
    }
  });

  document.addEventListener('click', function () {
    categoryContextMenu.menu.style.display = 'none';
  });

  const editCategoryDialog = document.getElementById('edit-category-dialog');
  const editCategoryForm = document.getElementById('edit-category-form');
  const editCategoryNameInput = document.getElementById('edit-category-name');
  const closeCategoryButton = document.querySelector('.close-category-button');
  const cancelCategoryButton = document.querySelector('.cancel-category-button');

  function openEditCategoryDialog(categoryElement) {
    const categoryId = categoryElement.dataset.id;
    const categoryTitle = categoryElement.dataset.title;

    editCategoryNameInput.value = categoryTitle;

    editCategoryDialog.style.display = 'block';

    editCategoryForm.onsubmit = function (event) {
      event.preventDefault();
      const updatedTitle = editCategoryNameInput.value;

      chrome.bookmarks.update(categoryId, {
        title: updatedTitle
      }, function (result) {
        updateCategoryUI(categoryElement, updatedTitle);
        editCategoryDialog.style.display = 'none';
      });
    };
  }

  function updateCategoryUI(categoryElement, newTitle) {
    // 更新侧边栏中的文件夹名称
    const sidebarItem = document.querySelector(`#categories-list li[data-id="${categoryElement.dataset.id}"]`);
    if (sidebarItem) {
      // 更新文本内容
      const textSpan = sidebarItem.querySelector('span:not(.material-icons)');
      if (textSpan) {
        textSpan.textContent = newTitle;
      }

      // 更新 data-title 属性
      sidebarItem.setAttribute('data-title', newTitle);

      // 更新样式
      sidebarItem.classList.add('updated-folder');
      setTimeout(() => {
        sidebarItem.classList.remove('updated-folder');
      }, 2000); // 2秒后移除高亮效果
    }

    // 更新面包屑导航
    updateFolderName(categoryElement.dataset.id);

    // 更新文件夹卡片（如果在当前视图中）
    const folderCard = document.querySelector(`.bookmark-folder[data-id="${categoryElement.dataset.id}"]`);
    if (folderCard) {
      const titleElement = folderCard.querySelector('.card-title');
      if (titleElement) {
        titleElement.textContent = newTitle;
      }
    }
  }

  closeCategoryButton.onclick = function () {
    editCategoryDialog.style.display = 'none';
  };

  cancelCategoryButton.onclick = function () {
    editCategoryDialog.style.display = 'none';
  };

  window.onclick = function (event) {
    if (event.target == editCategoryDialog) {
      editCategoryDialog.style.display = 'none';
    }
  };

  function updateBookmarksDisplay(parentId, movedItemId, newIndex) {
    return new Promise((resolve, reject) => {
      // 首先检查缓存
      const cached = bookmarksCache.get(parentId);
      if (cached && !movedItemId) {
        // 如果有缓存且不是移动操作，获取完整的书签树
        chrome.bookmarks.getTree(function (tree) {
          displayBookmarks(tree);

          // 滚动到指定的文件夹
          setTimeout(() => {
            const folderGroup = document.getElementById(`folder-group-${parentId}`);
            if (folderGroup) {
              scrollToFolderGroup(folderGroup);
            }
          }, 300);

          resolve();
        });
        return;
      }

      // 如果没有缓存或是移动操作，获取完整的书签树
      chrome.bookmarks.getTree((tree) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }

        // 显示所有书签
        displayBookmarks(tree);

        // 滚动到指定的文件夹
        setTimeout(() => {
          const folderGroup = document.getElementById(`folder-group-${parentId}`);
          if (folderGroup) {
            scrollToFolderGroup(folderGroup);
          }
        }, 300);

        // 如果是移动操作，突出显示移动的书签
        if (movedItemId) {
          highlightBookmark(movedItemId);
        }

        const bookmarksContainer = document.querySelector('.bookmarks-container');

        // 先隐藏容器
        bookmarksContainer.style.opacity = '0';
        bookmarksContainer.style.transform = 'translateY(20px)';

        // 使用 requestAnimationFrame 来确保 DOM 更新后再显示容器
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            bookmarksContainer.style.opacity = '1';
            bookmarksContainer.style.transform = 'translateY(0)';
          });
        });

        resolve();
      });
    });
  }

  const tabsContainer = document.getElementById('tabs-container');
  const tabs = document.querySelectorAll('.tab');
  const defaultSearchEngine = FavsHubSettings.get('selectedSearchEngine') || 'Google';

  // 在文件的适当位置（可能在 DOMContentLoaded 事件监听器内）添加这个标志
  let isChangingSearchEngine = false;

  // 将 getSearchUrl 函数移到文件前面，在事件监听器之前定义
  function getSearchUrl(engine, query) {
    const allEngines = SearchEngineManager.getAllEngines();
    const engineConfig = allEngines.find(e => {
      // 匹配引擎名称或别名
      return e.name.toLowerCase() === engine.toLowerCase() || 
             (e.aliases && e.aliases.some(alias => alias.toLowerCase() === engine.toLowerCase()));
    });

    if (!engineConfig) {
      // 如果找不到对应的引擎配置,使用默认引擎
      const defaultEngine = SearchEngineManager.getDefaultEngine();
      return defaultEngine.url + encodeURIComponent(query);
    }

    // 确保 URL 中包含查询参数占位符
    const url = engineConfig.url.includes('%s') ? 
      engineConfig.url.replace('%s', encodeURIComponent(query)) :
      engineConfig.url + encodeURIComponent(query);

    return url;
  }



  // 自定义拖拽排序，彻底解决点击与拖拽冲突
  (function setupTabsDragAndClick() {
    const DRAG_THRESHOLD = 5; // 移动超过 5px 才算拖拽

    tabsContainer.addEventListener('mousedown', function (e) {
      const tab = e.target.closest('.tab');
      if (!tab) return;

      e.preventDefault(); // 阻止浏览器默认的 HTML5 拖拽
      const startX = e.clientX;
      const startY = e.clientY;
      let isDragging = false;
      let placeholder = null;

      function onMouseMove(e) {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        if (!isDragging && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
          // 超过阈值，进入拖拽模式
          isDragging = true;
          window._isDragging = true;

          // 创建占位符
          placeholder = document.createElement('div');
          placeholder.className = 'tab drag-placeholder';
          placeholder.style.visibility = 'hidden';
          tab.parentNode.insertBefore(placeholder, tab);

          // 被拖拽元素样式
          tab.style.position = 'relative';
          tab.style.zIndex = '1000';
          tab.style.opacity = '0.7';
          tab.style.pointerEvents = 'none';
          tab.style.transform = `translateX(${dx}px)`;
        }

        if (isDragging) {
          tab.style.transform = `translateX(${dx}px)`;

          // 检测鼠标下方应该插入位置
          const children = Array.from(tabsContainer.children);
          const currentIndex = children.indexOf(placeholder);
          const tabCenter = tab.getBoundingClientRect().left + tab.getBoundingClientRect().width / 2;

          let newIndex = currentIndex;
          for (let i = 0; i < children.length; i++) {
            const child = children[i];
            if (child === tab || child === placeholder) continue;
            const childCenter = child.getBoundingClientRect().left + child.getBoundingClientRect().width / 2;
            if (tabCenter > childCenter && i > currentIndex) {
              newIndex = i;
            } else if (tabCenter < childCenter && i < currentIndex) {
              newIndex = i;
              break;
            }
          }

          if (newIndex !== currentIndex) {
            tabsContainer.insertBefore(placeholder, children[newIndex]);
          }
        }
      }

      function onMouseUp(e) {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);

        // 恢复样式
        tab.style.position = '';
        tab.style.zIndex = '';
        tab.style.opacity = '';
        tab.style.pointerEvents = '';
        tab.style.transform = '';

        if (isDragging) {
          // 拖拽结束：将 tab 插入到占位符位置
          if (placeholder && placeholder.parentNode) {
            placeholder.parentNode.insertBefore(tab, placeholder);
            placeholder.parentNode.removeChild(placeholder);
          }

          window._isDragging = false;
          window._dragJustEnded = true;
          setTimeout(function () { window._dragJustEnded = false; }, 200);

          // 保存排序
          const orderedEngines = Array.from(tabsContainer.children).map(t => t.getAttribute('data-engine'));
          localStorage.setItem('orderedSearchEngines', JSON.stringify(orderedEngines));
        } else {
          // 是点击行为：手动触发引擎切换
          const selectedEngine = tab.getAttribute('data-engine');
          const searchInput = document.querySelector('.search-input');
          const searchQuery = searchInput.value.trim();

          tabs.forEach(t => t.classList.remove('active'));
          tab.classList.add('active');

          if (searchQuery) {
            const searchUrl = getSearchUrl(selectedEngine, searchQuery);
            window.open(searchUrl, '_blank');
            hideSuggestions();
            setTimeout(restoreDefaultSearchEngine, 300);
          }
        }
      }

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  })();

  const savedOrder = JSON.parse(localStorage.getItem('orderedSearchEngines'));
  if (savedOrder) {
    savedOrder.forEach(engineName => {
      const tab = Array.from(tabs).find(tab => tab.getAttribute('data-engine') === engineName);
      if (tab) {
        tabsContainer.appendChild(tab);
      }
    });
  }

  const searchForm = document.getElementById('search-form');
  const searchInput = document.querySelector('.search-input');
  const searchEngineIcon = document.getElementById('search-engine-icon');

  searchInput.addEventListener('focus', async function () {
    searchForm.classList.add('focused');
    if (searchInput.value.trim() === '') {
      await showDefaultSuggestions();
    } else {
      const suggestions = await getSuggestions(searchInput.value.trim());
      showSuggestions(suggestions);
    }
  });

  searchInput.addEventListener('blur', () => {
    const searchForm = document.querySelector('.search-form');
    searchForm.classList.remove('focused');
    // 使用 setTimeout 来延迟隐藏建议列表，允许点击建议
    setTimeout(() => {
      if (!searchForm.contains(document.activeElement)) {
        hideSuggestions();
      }
    }, 200);
  });

  if (!searchForm || !searchInput || !tabsContainer || !searchEngineIcon) {
    return;
  }

  updateSubmitButtonState();



  function updateSubmitButtonState() {
    if (searchInput.value.trim() === '') {
      tabsContainer.style.display = 'none';
    } else {
      // 只有当搜索建议列表不为空时才显示 tabs-container
      if (searchSuggestions.children.length > 0) {
        tabsContainer.style.display = 'flex';
      } else {
        tabsContainer.style.display = 'none';
      }
    }
  }

  let isSearching = false;
  let searchQueue = [];

  function debounce(func, wait) {
    let timeout;
    return function(...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }

  const debouncedPerformSearch = debounce(performSearch, 300);

  // Modify the search form submit event listener
  searchForm.addEventListener('submit', (e) => {
    e.preventDefault(); // Prevent default form submission
    performSearch(searchInput.value.trim());
  });

  function queueSearch() {
    const query = searchInput.value.trim();
    if (query === '') {
      return;
    }
    searchQueue.push(query);
    processSearchQueue();
  }

  function processSearchQueue() {
    if (isSearching || searchQueue.length === 0) {
      return;
    }
    
    const query = searchQueue.shift();
    debouncedPerformSearch(query);
  }
  // 修改 performSearch 函数
  function performSearch(query) {
    if (!query || typeof query !== 'string' || query.trim() === '') {
      return;
    }

    isSearching = true;

    // 同步获取所需数据（轻量操作）
    const activeTab = document.querySelector('.tab.active');
    const currentEngine = activeTab ? activeTab.getAttribute('data-engine') : defaultSearchEngine;
    const defaultEngine = FavsHubSettings.get('selectedSearchEngine') || 'google';
    const openInNewTab = FavsHubSettings.get('openSearchInNewTab') !== false;
    const url = getSearchUrl(currentEngine, query);

    // rAF 仅处理 DOM 视觉更新
    requestAnimationFrame(() => {
      const tabs = document.querySelectorAll('.tab');
      tabs.forEach(tab => {
        delete tab.dataset.temporary;
        if (tab.getAttribute('data-engine').toLowerCase() === defaultEngine.toLowerCase()) {
          tab.classList.add('active');
        } else {
          tab.classList.remove('active');
        }
      });
      hideSuggestions();
    });

    // 导航操作在 rAF 外通过 setTimeout 执行，避免阻塞渲染帧
    setTimeout(() => {
      if (openInNewTab) {
        window.open(url, '_blank');
      } else {
        window.location.href = url;
      }

      setTimeout(() => {
        isSearching = false;
        processSearchQueue();
      }, 1000);
    }, 50);
  }

  // 新增恢复默认搜索引擎的函数
  function restoreDefaultSearchEngine() {
    const defaultEngine = FavsHubSettings.get('selectedSearchEngine') || 'google';

    // 更新标签状态
    const tabs = document.querySelectorAll('.tab');
    tabs.forEach(tab => {
      if (tab.getAttribute('data-engine') === defaultEngine) {
        tab.classList.add('active');
      } else {
        tab.classList.remove('active');
      }
    });

    // 更新搜索引擎图标
    updateSearchEngineIcon(defaultEngine);
  }


  // 修改 getSearchUrl 函数,使用 SearchEngineManager 中的配置
  function getSearchUrl(engine, query) {
    const allEngines = SearchEngineManager.getAllEngines();
    const engineConfig = allEngines.find(e => {
      // 匹配引擎名称或别名
      return e.name.toLowerCase() === engine.toLowerCase() ||
        (e.aliases && e.aliases.some(alias => alias.toLowerCase() === engine.toLowerCase()));
    });

    if (!engineConfig) {
      // 如果找不到对应的引擎配置,使用默认引擎
      const defaultEngine = SearchEngineManager.getDefaultEngine();
      return defaultEngine.url + encodeURIComponent(query);
    }

    // 确保 URL 中包含查询参数占位符
    const url = engineConfig.url.includes('%s') ? 
      engineConfig.url.replace('%s', encodeURIComponent(query)) :
      engineConfig.url + encodeURIComponent(query);

    return url;
  }

  // 动态调整 textarea 度的函数
  function adjustTextareaHeight() {
    const searchInput = document.querySelector('.search-input');
    if (!searchInput) return;

    searchInput.style.height = 'auto'; // 重置高度
    const lineHeight = parseInt(getComputedStyle(searchInput).lineHeight) || 21;
    const maxHeight = 3 * lineHeight; // 最多显示 3 行
    const newHeight = Math.min(searchInput.scrollHeight, maxHeight);
    searchInput.style.height = `${newHeight}px`;
  }

  // 在输入事件中调用调整高度的函数
  searchInput.addEventListener('input', adjustTextareaHeight);

  // 初始化时调整高度
  adjustTextareaHeight();
  

  const searchSuggestions = document.getElementById('search-suggestions');

  // 防抖函
  function debounce(func, wait) {
    let timeout;
    return function (...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }
  async function getRecentHistory(limit = 100, maxPerDomain = 5) {
    let historyItems = [];

    // 扩展模式：通过 content script 中继调用真实的 chrome.history.search
    if (document.documentElement.getAttribute('data-favshub-ext') === 'active') {
      const res = await sendExtensionMessage('searchHistory', { text: '', maxResults: limit * 20 });
      if (res && res.success && res.items) {
        historyItems = res.items;
      }
    }

    const now = Date.now();
    const domainCounts = {};
    const uniqueItems = new Map();

    const recentHistory = historyItems
      .map(item => {
        let domain;
        try { domain = new URL(item.url).hostname; } catch { domain = ''; }
        return {
          text: item.title,
          url: item.url,
          domain: domain,
          type: 'history',
          relevance: 1,
          timestamp: item.lastVisitTime
        };
      })
      .sort((a, b) => b.timestamp - a.timestamp)
      .filter(item => {
        const key = `${item.url}|${item.text}`;
        if (uniqueItems.has(key)) return false;
        domainCounts[item.domain] = (domainCounts[item.domain] || 0) + 1;
        if (domainCounts[item.domain] > maxPerDomain) return false;
        uniqueItems.set(key, item);
        return true;
      })
      .map(item => {
        const daysSinceLastVisit = (now - item.timestamp) / (1000 * 60 * 60 * 24);
        item.relevance *= Math.exp(-daysSinceLastVisit / RELEVANCE_CONFIG.timeDecayHalfLife);
        return item;
      })
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, limit);

    return recentHistory;
  }
  // 在文件顶部定义 RELEVANCE_CONFIG
  const RELEVANCE_CONFIG = {
    titleExactMatchWeight: 6,
    urlExactMatchWeight: 1.5,
    titlePartialMatchWeight: 1.2,
    urlPartialMatchWeight: 0.3,
    timeDecayHalfLife: 60,
    fuzzyMatchThreshold: 0.6,
    fuzzyMatchWeight: 1.5,
    bookmarkRelevanceBoost: 1.2
  };

  // 计算模糊匹配分数
  function calculateFuzzyMatch(query, text) {
    if (query.length === 0 || text.length === 0) return 0;
    if (query === text) return 1;

    const maxLength = Math.max(query.length, text.length);
    const distance = levenshteinDistance(query, text);
    return (maxLength - distance) / maxLength;
  }

  // Levenshtein 距离计算
  function levenshteinDistance(a, b) {
    const matrix = Array(b.length + 1).fill().map(() => Array(a.length + 1).fill(0));

    for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= b.length; j++) matrix[j][0] = j;

    for (let j = 1; j <= b.length; j++) {
      for (let i = 1; i <= a.length; i++) {
        const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1,                   // 删除
          matrix[j - 1][i] + 1,                   // 插入
          matrix[j - 1][i - 1] + substitutionCost // 替换
        );
      }
    }
    return matrix[b.length][a.length];
  }

  function updateSidebarDefaultBookmarkIndicator() {
    const defaultBookmarkId = localStorage.getItem('defaultBookmarkId');
    selectSidebarFolder(defaultBookmarkId);
    
    const allCategories = document.querySelectorAll('#categories-list li');
    allCategories.forEach(category => {
      const indicator = category.querySelector('.default-indicator');
      if (indicator) {
        indicator.remove();
      }
      if (category.dataset.id === defaultBookmarkId) {
        const defaultIndicator = document.createElement('span');
        defaultIndicator.className = 'default-indicator material-icons';
        defaultIndicator.textContent = 'star';
        defaultIndicator.title = getLocalizedMessage('homepage');
        category.appendChild(defaultIndicator);
      }
    });
  }

  function updateBookmarksDisplay(parentId, movedItemId, newIndex) {
    return new Promise((resolve, reject) => {
      // 首先检查缓存
      const cached = bookmarksCache.get(parentId);
      if (cached && !movedItemId) {
        // 如果有缓存且不是移动操作，获取完整的书签树
        chrome.bookmarks.getTree(function (tree) {
          displayBookmarks(tree);

          // 滚动到指定的文件夹
          setTimeout(() => {
            const folderGroup = document.getElementById(`folder-group-${parentId}`);
            if (folderGroup) {
              scrollToFolderGroup(folderGroup);
            }
          }, 300);

          resolve();
        });
        return;
      }

      // 如果没有缓存或是移动操作，获取完整的书签树
      chrome.bookmarks.getTree((tree) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }

        // 显示所有书签
        displayBookmarks(tree);

        // 滚动到指定的文件夹
        setTimeout(() => {
          const folderGroup = document.getElementById(`folder-group-${parentId}`);
          if (folderGroup) {
            scrollToFolderGroup(folderGroup);
          }
        }, 300);

        // 如果是移动操作，突出显示移动的书签
        if (movedItemId) {
          highlightBookmark(movedItemId);
        }

        const bookmarksContainer = document.querySelector('.bookmarks-container');

        // 先隐藏容器
        bookmarksContainer.style.opacity = '0';
        bookmarksContainer.style.transform = 'translateY(20px)';

        // 使用 requestAnimationFrame 来确保 DOM 更新后再显示容器
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            bookmarksContainer.style.opacity = '1';
            bookmarksContainer.style.transform = 'translateY(0)';
          });
        });

        resolve();
      });
    });
  }



  if (!searchForm || !searchInput || !tabsContainer || !searchEngineIcon) {
    return;
  }



  function updateSubmitButtonState() {
    if (searchInput.value.trim() === '') {
      tabsContainer.style.display = 'none';
    } else {
      // 只有当搜索建议列表不为空时才显示 tabs-container
      if (searchSuggestions.children.length > 0) {
        tabsContainer.style.display = 'flex';
      } else {
        tabsContainer.style.display = 'none';
      }
    }
  }



  function debounce(func, wait) {
    let timeout;
    return function(...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }


  function queueSearch() {
    const query = searchInput.value.trim();
    if (query === '') {
      return;
    }
    searchQueue.push(query);
    processSearchQueue();
  }

  function processSearchQueue() {
    if (isSearching || searchQueue.length === 0) {
      return;
    }
    
    const query = searchQueue.shift();
    debouncedPerformSearch(query);
  }

  function setDefaultSearchEngine(engine) {
    defaultSearchEngine = engine;
    FavsHubSettings.set('selectedSearchEngine', engine);
  }

  // 修改 getSearchUrl 函数,使用 SearchEngineManager 中的配置
  function getSearchUrl(engine, query) {
    const allEngines = SearchEngineManager.getAllEngines();
    const engineConfig = allEngines.find(e => {
      // 匹配引擎名称或别名
      return e.name.toLowerCase() === engine.toLowerCase() ||
        (e.aliases && e.aliases.some(alias => alias.toLowerCase() === engine.toLowerCase()));
    });

    if (!engineConfig) {
      // 如果找不到对应的引擎配置,使用默认引擎
      const defaultEngine = SearchEngineManager.getDefaultEngine();
      return defaultEngine.url + encodeURIComponent(query);
    }

    // 确保 URL 中包含查询参数占位符
    const url = engineConfig.url.includes('%s') ? 
      engineConfig.url.replace('%s', encodeURIComponent(query)) :
      engineConfig.url + encodeURIComponent(query);

    return url;
  }



  // 防抖函
  function debounce(func, wait) {
    let timeout;
    return function (...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }
  // 添加这个函数定义
  async function getBingSuggestions(query) {
    try {
      const response = await fetch(`https://api.bing.com/osjson.aspx?query=${encodeURIComponent(query)}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      return data[1].map(suggestion => ({
        text: suggestion,
        type: 'bing_suggestion',
        relevance: 1
      }));
    } catch (error) {
      return []; // 返回空数组，以便在出错时程序可以继续运行
    }
  }

  function searchHistory(query, maxResults = 200) {
    return new Promise(async (resolve) => {
      // 扩展模式：通过 content script 中继调用真实 chrome.history.search
      if (document.documentElement.getAttribute('data-favshub-ext') === 'active') {
        const startTime = new Date().getTime() - (30 * 24 * 60 * 60 * 1000);
        const res = await sendExtensionMessage('searchHistory', {
          text: query,
          maxResults: maxResults,
          startTime: startTime
        });
        if (res && res.success && res.items) {
          const uniqueResults = Array.from(new Set(res.items.map(r => r.url)))
            .map(url => res.items.find(r => r.url === url));
          resolve(uniqueResults);
          return;
        }
      }
      resolve([]);
    });
  }
  // 获取搜索建议
  async function getSuggestions(query) {
    // 如果管理员关闭了搜索建议总开关，只返回搜索词本身
    if (FavsHubSettings.get('showSearchSuggestions') === false) {
      return [{ text: query, type: 'search', relevance: Infinity }];
    }

    const maxTotalSuggestions = 50;

    let suggestions = [{ text: query, type: 'search', relevance: Infinity }];

    // 获取设置
    const settings = {
      showHistorySuggestions: FavsHubSettings.get('showHistorySuggestions') !== false,
      showBookmarkSuggestions: FavsHubSettings.get('showBookmarkSuggestions') !== false,
      showPromptSuggestions: FavsHubSettings.get('showPromptSuggestions') !== false,
    };

    // === 历史记录建议（仅扩展模式，需要 chrome.history API）===
    let historySuggestions = [];
    if (settings.showHistorySuggestions && document.documentElement.getAttribute('data-favshub-ext') === 'active') {
      const historyItems = await searchHistory(query, 200);
      historySuggestions = historyItems.map(item => ({
        text: item.title,
        url: item.url,
        type: 'history',
        relevance: calculateRelevance(query, item.title, item.url),
        timestamp: item.lastVisitTime
      }));
    }

    // === 书签建议（通过后端 API 多字段搜索）===
    let bookmarkSuggestions = [];
    if (settings.showBookmarkSuggestions) {
      try {
        const result = await api.searchBookmarks(query, 50);
        if (result && result.bookmarks) {
          bookmarkSuggestions = result.bookmarks.map(item => ({
            text: item.title,
            url: item.url,
            type: 'bookmark',
            icon: item.icon || '',
            // 不在这里乘 bookmarkRelevanceBoost，由 balanceResults 统一处理（避免双重 boost）
            relevance: calculateRelevance(query, item.title, item.url)
          }));
        }
      } catch (e) {
        
      }
    }

    // === 提示词建议（通过后端 API 搜索 + calculatePromptScore 评分）===
    let promptSuggestions = [];
    if (settings.showPromptSuggestions) {
      try {
        const result = await api.getPrompts({ search: query });
        if (result && result.prompts) {
          // 使用与 promptpro-search.js 一致的 calculatePromptScore 算法
          const keywords = query.trim()
            .split(/[\s\u3000\u2000-\u206f\u3000-\u303f\uff00-\uffef,.!?;:，。！？；：、]+/)
            .filter(k => k.length > 0);
          promptSuggestions = result.prompts
            .map(prompt => ({
              text: prompt.title,
              url: `promptpro://detail/${prompt.prompt_id || prompt.id}`,
              type: 'prompt',
              relevance: calculatePromptScore(prompt, keywords),
              promptData: prompt
            }))
            .filter(p => p.relevance > 0)
            .sort((a, b) => b.relevance - a.relevance);
        }
      } catch (e) {
        
      }
    }

    // 合并所有建议
    suggestions.push(
      ...historySuggestions,
      ...bookmarkSuggestions,
      ...promptSuggestions
    );

    // 对结果去重（保留同一 URL 中 relevance 最高的条目）并排序
    const urlBestMap = new Map();
    for (const s of suggestions) {
      if (!s.url) continue;
      const existing = urlBestMap.get(s.url);
      if (!existing || s.relevance > existing.relevance) {
        urlBestMap.set(s.url, s);
      }
    }
    // 搜索词本身（relevance: Infinity）也需要保留
    const uniqueSuggestions = Array.from(urlBestMap.values())
      .sort((a, b) => b.relevance - a.relevance);

    // 平衡和交替显示结果
    const balancedResults = await balanceResults(uniqueSuggestions, maxTotalSuggestions);

    return balancedResults;
  }

  /**
   * 提示词搜索评分算法（与 promptpro-search.js 的 calculateScore 保持一致）
   * 支持 title/tags/description/folder_name/content 多字段加权匹配
   */
  function calculatePromptScore(prompt, keywords) {
    if (!keywords || keywords.length === 0) return 0;

    const title = (prompt.title || '').toLowerCase();
    const desc = (prompt.description || '').toLowerCase();
    const content = (prompt.content || '').toLowerCase();
    const folder = (prompt.folder_name || '').toLowerCase();
    const tagNames = (prompt.tags || []).map(t => (t.tag_name || t.name || '').toLowerCase());

    let totalScore = 0;
    let titleMatchedCount = 0;
    let tagMatchedCount = 0;
    let descMatchedCount = 0;
    let folderMatchedCount = 0;
    let contentMatchedCount = 0;

    for (const keyword of keywords) {
      // 标题匹配（权重最高）
      if (title.includes(keyword)) {
        if (title === keyword) totalScore += 10000;
        else if (title.startsWith(keyword)) totalScore += 8000;
        else totalScore += 5000;
        titleMatchedCount++;
      }

      // 标签匹配
      if (tagNames.some(tag => tag.includes(keyword))) {
        totalScore += 2000;
        tagMatchedCount++;
      }

      // 描述匹配
      if (desc.includes(keyword)) {
        if (desc.startsWith(keyword)) totalScore += 1500;
        else totalScore += 1000;
        descMatchedCount++;
      }

      // 文件夹匹配
      if (folder.includes(keyword)) {
        totalScore += 800;
        folderMatchedCount++;
      }

      // 内容匹配（权重最低）
      if (content.includes(keyword)) {
        totalScore += 300;
        contentMatchedCount++;
      }
    }

    // 标题中包含所有关键词时，给予极高奖励
    if (titleMatchedCount === keywords.length && keywords.length > 0) {
      totalScore += keywords.length * 5000;
    }

    // 标签中包含所有关键词时，给予高奖励
    if (tagMatchedCount === keywords.length && keywords.length > 0) {
      totalScore += keywords.length * 3000;
    }

    // 描述中包含所有关键词时，给予中等奖励
    if (descMatchedCount === keywords.length && keywords.length > 0) {
      totalScore += keywords.length * 1500;
    }

    // 跨字段匹配奖励（标题+标签、标题+描述等）
    const fieldsMatched = [
      titleMatchedCount > 0,
      tagMatchedCount > 0,
      descMatchedCount > 0,
      folderMatchedCount > 0
    ].filter(Boolean).length;

    if (fieldsMatched >= 2 && keywords.length > 1) {
      totalScore += fieldsMatched * 1000;
    }

    return totalScore;
  }

  function calculateRelevance(query, title, url) {
    // 基础设置
    const weights = {
      exactTitleMatch: 100,    // 标题完全匹配权重
      exactUrlMatch: 80,       // URL完全匹配权重
      titleStartsWith: 70,     // 标题开头匹配权重
      urlStartsWith: 60,       // URL开头匹配权重
      titleIncludes: 50,       // 标题包含匹配权重
      urlIncludes: 40,         // URL包含匹配权重
      wordMatch: 30,           // 分词匹配权重
      fuzzyMatch: 20           // 模糊匹配权重
    };

    // 数据预处理
    const lowerQuery = query.toLowerCase().trim();
    const lowerTitle = (title || '').toLowerCase().trim();
    const lowerUrl = (url || '').toLowerCase().trim();
    const queryWords = lowerQuery.split(/\s+/);  // 将查询分词

    let score = 0;

    // 1. 完全匹配检查
    if (lowerTitle === lowerQuery) {
      score += weights.exactTitleMatch;
    }
    if (lowerUrl === lowerQuery) {
      score += weights.exactUrlMatch;
    }

    // 2. 开头匹配检查
    if (lowerTitle.startsWith(lowerQuery)) {
      score += weights.titleStartsWith;
    }
    if (lowerUrl.startsWith(lowerQuery)) {
      score += weights.urlStartsWith;
    }

    // 3. 包含匹配检查
    if (lowerTitle.includes(lowerQuery)) {
      score += weights.titleIncludes;
    }
    if (lowerUrl.includes(lowerQuery)) {
      score += weights.urlIncludes;
    }

    // 4. 分词匹配
    queryWords.forEach(word => {
      if (word.length > 1) {  // 忽略单字符词
        if (lowerTitle.includes(word)) {
          score += weights.wordMatch;
        }
        if (lowerUrl.includes(word)) {
          score += weights.wordMatch / 2;  // URL分词匹配权重较低
        }
      }
    });

    // 5. 模糊匹配（编辑距离）
    if (title) {
      const fuzzyScore = calculateFuzzyMatch(lowerQuery, lowerTitle);
      if (fuzzyScore > 0.8) {  // 相似度阈值
        score += weights.fuzzyMatch * fuzzyScore;
      }
    }

    // 6. 长度惩罚因子（避免过长的结果）
    const lengthPenalty = Math.max(1, Math.log(lowerTitle.length / lowerQuery.length));
    score = score / lengthPenalty;

    // 7. 添加时间衰减因子（如果有时间戳）
    if (title && title.timestamp) {
      const daysOld = (Date.now() - title.timestamp) / (1000 * 60 * 60 * 24);
      const timeDecay = Math.exp(-daysOld / 30);  // 30天的半衰期
      score *= timeDecay;
    }

    return Math.round(score * 100) / 100;  // 保留两位小数
  }

  // 计算模糊匹配分数
  function calculateFuzzyMatch(query, text) {
    if (query.length === 0 || text.length === 0) return 0;
    if (query === text) return 1;

    const maxLength = Math.max(query.length, text.length);
    const distance = levenshteinDistance(query, text);
    return (maxLength - distance) / maxLength;
  }

  // Levenshtein 距离计算
  function levenshteinDistance(a, b) {
    const matrix = Array(b.length + 1).fill().map(() => Array(a.length + 1).fill(0));

    for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= b.length; j++) matrix[j][0] = j;

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1,                   // 删除
          matrix[j - 1][i] + 1,                   // 插入
          matrix[j - 1][i - 1] + substitutionCost // 替换
        );
      }
    }
    return matrix[b.length][a.length];
  }

  // Levenshtein 距离函数（如果之前没有定义的话）
  function levenshteinDistance(a, b) {
    const matrix = [];

    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[b.length][a.length];
  }

  async function balanceResults(suggestions, maxResults) {
    const currentSuggestion = suggestions.filter(s => s.type === 'search');
    let bookmarks = suggestions.filter(s => s.type === 'bookmark');
    let histories = suggestions.filter(s => s.type === 'history');
    let bingSuggestions = suggestions.filter(s => s.type === 'bing_suggestion');
    let prompts = suggestions.filter(s => s.type === 'prompt');

    // 应用时间衰减因子到历史记录
    const now = Date.now();
    histories = histories.map(h => {
      const daysSinceLastVisit = (now - h.timestamp) / (1000 * 60 * 60 * 24);
      if (daysSinceLastVisit < 7) { // 如果是最近7天内的记录
        h.relevance *= 1.5; // 为最近的记录提供额外的提升
      }
      h.relevance *= Math.exp(-daysSinceLastVisit / RELEVANCE_CONFIG.timeDecayHalfLife);
      return h;
    });

    // 为书签提供轻微的相关性提升
    bookmarks = bookmarks.map(b => {
      b.relevance *= RELEVANCE_CONFIG.bookmarkRelevanceBoost;
      return b;
    });

    // 各组内部按相关性降序排序
    bookmarks.sort((a, b) => b.relevance - a.relevance);
    prompts.sort((a, b) => b.relevance - a.relevance);
    histories.sort((a, b) => b.relevance - a.relevance);

    // 合并顺序：书签 → 提示词 → 历史记录
    const allItems = [...bookmarks, ...prompts, ...histories, ...bingSuggestions];
    
    // 取前 maxResults - 1 个项目（减去搜索项）
    const results = [...currentSuggestion, ...allItems.slice(0, maxResults - 1)];

    // 计算用户相关性（但不重新排序，保持相关性顺序）
    const suggestionsWithUserRelevance = await calculateUserRelevance(results);

    return suggestionsWithUserRelevance;
  }

  const USER_BEHAVIOR_KEY = 'userSearchBehavior';

  // 在文件顶部定义 MAX_BEHAVIOR_ENTRIES
  const MAX_BEHAVIOR_ENTRIES = 1000; // 你可以根据需要调整这个值

  // 获取用户行为数据
  async function getUserBehavior() {
    return new Promise((resolve) => {
      chrome.storage.local.get(USER_BEHAVIOR_KEY, (result) => {
        const behavior = result[USER_BEHAVIOR_KEY] || {};
        resolve(behavior); // 直接返回行为数据，不进行清理
      });
    });
  }

  // 保存用户行为数据
  async function saveUserBehavior(key, increment = 1) {
    const behavior = await getUserBehavior();
    const now = Date.now();

    if (!behavior[key]) {
      behavior[key] = { count: 0, lastUsed: now };
    }

    behavior[key].count += increment; // 增加计数
    behavior[key].lastUsed = now; // 更新最后用时间

    // 检查条目数并清理
    if (Object.keys(behavior).length > MAX_BEHAVIOR_ENTRIES) {
      const sortedEntries = Object.entries(behavior)
        .sort(([, a], [, b]) => a.lastUsed - b.lastUsed); // 按最后使用时间排序
      sortedEntries.slice(0, sortedEntries.length - MAX_BEHAVIOR_ENTRIES).forEach(([key]) => {
        delete behavior[key]; // 删除最旧的条目
      });
    }

    return new Promise((resolve) => {
      chrome.storage.local.set({ [USER_BEHAVIOR_KEY]: behavior }, resolve); // 直接保存行为数据
    });
  }

  // 计算用户相关性
  async function calculateUserRelevance(suggestions) {
    const behavior = await getUserBehavior();
    const now = Date.now();

    return suggestions.map(suggestion => {
      const key = suggestion.url || suggestion.text;
      const behaviorData = behavior[key];

      if (!behaviorData) return { ...suggestion, userRelevance: suggestion.relevance };

      const daysSinceLastUse = (now - behaviorData.lastUsed) / (1000 * 60 * 60 * 24);
      const recencyFactor = Math.exp(-daysSinceLastUse / 30); // 30天的半衰期
      const behaviorScore = behaviorData.count * recencyFactor;

      return {
        ...suggestion,
        userRelevance: suggestion.relevance * (1 + behaviorScore * 0.1) // 增加最多10%的权重
      };
    });
  }

  let allSuggestions = [];
  let displayedSuggestions = 0;
  const suggestionsPerLoad = 10; // 每次加载10个建议

  let isScrollListenerAttached = false;

  // 分组搜索建议数据（用于 Tab 切换）
  let groupedSuggestions = { bookmarks: [], prompts: [], histories: [] };
  let currentCategoryTab = 'default';
  const categoryTabsEl = document.getElementById('category-tabs');

  function showSuggestions(suggestions) {
    if (!Array.isArray(suggestions) || suggestions.length === 0) {
      hideSuggestions();
      return;
    }

    // 分离搜索项本身和分类数据
    const searchItems = suggestions.filter(s => s.type === 'search');
    groupedSuggestions = {
      searchItems,
      bookmarks: suggestions.filter(s => s.type === 'bookmark'),
      prompts: suggestions.filter(s => s.type === 'prompt'),
      histories: suggestions.filter(s => s.type === 'history')
    };

    // 如果有多种类型的数据，显示 Tab 栏
    const typeCount = [groupedSuggestions.bookmarks.length > 0, groupedSuggestions.prompts.length > 0, groupedSuggestions.histories.length > 0].filter(Boolean).length;
    if (typeCount > 1) {
      renderCategoryTabs();
      categoryTabsEl.classList.add('visible');
    } else {
      categoryTabsEl.classList.remove('visible');
      categoryTabsEl.innerHTML = '';
    }

    // 默认 Tab：每类最多显示 5 条
    currentCategoryTab = 'default';
    allSuggestions = suggestions;
    displayedSuggestions = 0;
    searchSuggestions.innerHTML = '';
  
    const searchForm = document.querySelector('.search-form');
    searchForm.classList.add('focused-with-suggestions');

    const suggestionsWrapper = document.querySelector('.search-suggestions-wrapper');
    if (suggestionsWrapper) {
      suggestionsWrapper.style.display = 'block';
    }
    searchSuggestions.style.display = 'block';

    // 显示 line-container
    const lineContainer = document.getElementById('line-container');
    lineContainer.style.display = 'block';

    searchSuggestions.style.maxHeight = '390px';
    searchSuggestions.style.overflowY = 'auto';

    renderCurrentTab();

    if (!isScrollListenerAttached) {
      searchSuggestions.addEventListener('scroll', throttledHandleScroll);
      isScrollListenerAttached = true;
    }
  }

  /**
   * 渲染分类 Tab 栏
   */
  function renderCategoryTabs() {
    const bmCount = groupedSuggestions.bookmarks.length;
    const prCount = groupedSuggestions.prompts.length;
    const hiCount = groupedSuggestions.histories.length;
    // 默认 Tab：每类取前 5 条
    const defaultCount = Math.min(bmCount, 5) + Math.min(prCount, 5) + Math.min(hiCount, 5);
    // 子 Tab：前 5 条已在默认 Tab，只显示剩余数量
    const bmRest = Math.max(bmCount - 5, 0);
    const prRest = Math.max(prCount - 5, 0);
    const hiRest = Math.max(hiCount - 5, 0);

    categoryTabsEl.innerHTML = `
      <button type="button" class="category-tab ${currentCategoryTab === 'default' ? 'active' : ''}" data-tab="default">默认<span class="tab-count">${defaultCount}</span></button>
      ${bmRest > 0 ? `<button type="button" class="category-tab ${currentCategoryTab === 'bookmark' ? 'active' : ''}" data-tab="bookmark">书签<span class="tab-count">${bmRest}</span></button>` : ''}
      ${prRest > 0 ? `<button type="button" class="category-tab ${currentCategoryTab === 'prompt' ? 'active' : ''}" data-tab="prompt">提示词<span class="tab-count">${prRest}</span></button>` : ''}
      ${hiRest > 0 ? `<button type="button" class="category-tab ${currentCategoryTab === 'history' ? 'active' : ''}" data-tab="history">历史<span class="tab-count">${hiRest}</span></button>` : ''}
    `;

    // 绑定点击事件
    categoryTabsEl.querySelectorAll('.category-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab');
        if (tab === currentCategoryTab) return;
        currentCategoryTab = tab;
        // 更新 active 状态
        categoryTabsEl.querySelectorAll('.category-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderCurrentTab();
      });
    });
  }

  /**
   * 根据当前 Tab 渲染对应的建议列表
   */
  function renderCurrentTab() {
    displayedSuggestions = 0;
    searchSuggestions.innerHTML = '';

    if (currentCategoryTab === 'default') {
      // 默认 Tab：搜索项 + 每类最多 5 条
      const items = [
        ...(groupedSuggestions.searchItems || []),
        ...groupedSuggestions.bookmarks.slice(0, 5),
        ...groupedSuggestions.prompts.slice(0, 5),
        ...groupedSuggestions.histories.slice(0, 5)
      ];
      allSuggestions = items;
    } else {
      // 子 Tab：前 5 条已在默认 Tab，只显示第 6 条起的剩余项
      const typeMap = { bookmark: 'bookmarks', prompt: 'prompts', history: 'histories' };
      const key = typeMap[currentCategoryTab];
      allSuggestions = [
        ...(groupedSuggestions.searchItems || []),
        ...(groupedSuggestions[key] || []).slice(5)
      ];
    }

    loadMoreSuggestions();
    searchSuggestions.scrollTop = 0;
  }

  function loadMoreSuggestions() {
    if (!Array.isArray(allSuggestions) || allSuggestions.length === 0) {
      return;
    }

    const remainingSuggestions = allSuggestions.length - displayedSuggestions;
    const suggestionsToAdd = Math.min(remainingSuggestions, 10);

    if (suggestionsToAdd <= 0) {
      return;
    }

    const fragment = document.createDocumentFragment();
    for (let i = displayedSuggestions; i < displayedSuggestions + suggestionsToAdd; i++) {
      const li = createSuggestionElement(allSuggestions[i]);
      fragment.appendChild(li);
    }

    searchSuggestions.appendChild(fragment);
    displayedSuggestions += suggestionsToAdd;
  }

  function throttle(func, limit) {
    let inThrottle;
    return function() {
      const args = arguments;
      const context = this;
      if (!inThrottle) {
        func.apply(context, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    }
  }

  const throttledHandleScroll = throttle(function() {
    const scrollPosition = searchSuggestions.scrollTop + searchSuggestions.clientHeight;
    const scrollHeight = searchSuggestions.scrollHeight;
    if (scrollPosition >= scrollHeight - 20 && displayedSuggestions < allSuggestions.length) {
      loadMoreSuggestions();
    }
  }, 200);  // 限制为每200毫秒最多执行一次

  function showNoMoreSuggestions() {
    const existingNoMore = searchSuggestions.querySelector('.no-more-suggestions');
    if (!existingNoMore) {
      const noMoreElement = document.createElement('li');
      noMoreElement.className = 'no-more-suggestions';
      noMoreElement.style.height = '38px'; // 设置一个固定高度，与他建议项保持一致
      noMoreElement.style.visibility = 'hidden'; // 使元素不可见，但保留空间
      searchSuggestions.appendChild(noMoreElement);
    }
  }

  // 修改创建建议元素的函数
  function createSuggestionElement(suggestion) {
    const li = document.createElement('li');
    const displayUrl = suggestion.url ? formatUrl(suggestion.url) : '';
    li.setAttribute('data-type', suggestion.type);
    if (suggestion.url) {
      li.setAttribute('data-url', suggestion.url);
    }
    const searchSvgIcon = `<svg class="suggestion-icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" width="20" height="20">
  <path d="M466.624 890.432a423.296 423.296 0 0 1-423.936-423.04C42.688 233.728 231.936 42.624 466.56 42.624a423.68 423.68 0 0 1 423.936 424.64 437.952 437.952 0 0 1-56.32 213.12 47.872 47.872 0 0 1-64.128 17.28 48 48 0 0 1-17.216-64.256c29.76-50.176 43.84-106.56 43.84-166.144-1.6-183.36-148.608-330.624-330.112-330.624a330.432 330.432 0 0 0-330.112 330.624 329.408 329.408 0 0 0 330.112 330.688c57.92 0 115.776-15.68 165.824-43.904a47.872 47.872 0 0 1 64.128 17.28 48 48 0 0 1-17.152 64.192 443.584 443.584 0 0 1-212.8 54.848z" fill="#334155"></path>
  <path d="M466.624 890.432a423.296 423.296 0 0 1-423.936-423.04c0-75.264 20.288-148.928 56.32-213.12a47.872 47.872 0 0 1 64.128-17.28 48 48 0 0 1 17.216 64.256 342.08 342.08 0 0 0-43.84 166.08c0 181.76 147.072 330.688 330.112 330.688a329.408 329.408 0 0 0 330.112-330.688A330.432 330.432 0 0 0 466.56 136.704c-57.856 0-115.776 15.68-165.824 43.84a47.872 47.872 0 0 1-64.128-17.216 48 48 0 0 1 17.216-64.256A436.032 436.032 0 0 1 466.56 42.688c233.088 0 422.4 189.568 422.4 424.64a422.016 422.016 0 0 1-422.4 423.104z" fill="#334155"></path>
  <path d="M934.4 981.312a44.992 44.992 0 0 1-32.832-14.08l-198.72-199.04c-18.752-18.816-18.752-48.576 0-65.792 18.752-18.816 48.512-18.816 65.728 0l198.656 199.04c18.816 18.752 18.816 48.576 0 65.792a47.68 47.68 0 0 1-32.832 14.08z" fill="#334155"></path>
</svg>`;
    // 限制建议文本的长度
    const maxTextLength = 20; // 你可以根据需要调整这个值
    const truncatedText = suggestion.text.length > maxTextLength
      ? suggestion.text.substring(0, maxTextLength) + '...'
      : suggestion.text;

    // 根据类型选择图标
    let iconHtml = searchSvgIcon;
    if (suggestion.type === 'prompt') {
      iconHtml = `<svg class="suggestion-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="#F59E0B" stroke="#F59E0B"/>
      </svg>`;
    } else if (suggestion.type !== 'search') {
      iconHtml = '<span class="material-icons suggestion-icon"></span>';
    }

    li.innerHTML = `
    ${iconHtml}
    <div class="suggestion-content">
      <span class="suggestion-text" title="${suggestion.text}">${truncatedText}</span>
      ${displayUrl ? `<span class="suggestion-dash">-</span><span class="suggestion-url">${displayUrl}</span>` : ''}
    </div>
    <span class="suggestion-type">${suggestion.type === 'prompt' ? '提示词' : suggestion.type}</span>
  `;

    if (suggestion.url && suggestion.type !== 'search') {
      if (suggestion.icon) {
        // 书签：直接使用 API 返回的 icon 字段（已下载的 favicon）
        const iconSpan = li.querySelector('.suggestion-icon');
        iconSpan.innerHTML = `<img src="${suggestion.icon}" alt="" class="favicon-from-api" onerror="this.parentElement.innerHTML=''">`;
      } else {
        // 历史记录等：异步获取 favicon
        getFavicon(suggestion.url, (faviconUrl) => {
          const iconSpan = li.querySelector('.suggestion-icon');
          if (faviconUrl) {
            iconSpan.innerHTML = `<img src="${faviconUrl}" alt="" class="favicon">`;
          }
        });
      }
    }

    li.addEventListener('click', async () => {
      // 如果是提示词类型，打开 PromptPro 详情页面
      if (suggestion.type === 'prompt' && suggestion.promptData) {
        openPromptProDetail(suggestion.promptData);
        hideSuggestions();
        return;
      }

      if (suggestion.url) {
        if (FavsHubSettings.get('openSearchInNewTab') !== false) {
          window.open(suggestion.url, '_blank');
        } else {
          window.location.href = suggestion.url;
        }
        await saveUserBehavior(suggestion.url);
      } else {
        searchInput.value = suggestion.text;
        searchInput.focus();
        queueSearch();
        await saveUserBehavior(suggestion.text);
      }
      hideSuggestions();
    });

    return li;
  }

  // 打开 PromptPro 详情页面
  function openPromptProDetail(promptData) {
    // 使用 Chrome Extension API 打开新标签页
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      const url = chrome.runtime.getURL(`src/promptpro.html?detail=${promptData.prompt_id}`);
      chrome.tabs.create({ url });
    } else {
      window.open(`promptpro.html?detail=${promptData.prompt_id}`, '_blank');
    }
  }

  function formatUrl(url) {
    try {
      const urlObj = new URL(url);
      let domain = urlObj.hostname;

      // 移除 'www.' 前缀（如果存在）
      domain = domain.replace(/^www\./, '');

      // 如果路径不只是 '/'
      let path = urlObj.pathname;
      if (path && path !== '/') {
        // 截断长路径
        path = path.length > 10 ? path.substring(0, 10) + '...' : path;
        domain += path;
      }

      return domain;
    } catch (e) {
      // 如果 URL 解析失败，返回空字符串
      return '';
    }
  }


  // 获取 favicon（统一使用环境自适应方案）
  function getFavicon(url, callback) {
    const faviconUrl = window.getFaviconUrl ? window.getFaviconUrl(url, 32) : '';
    if (faviconUrl) {
      const img = new Image();
      img.onload = function () { callback(faviconUrl); };
      img.onerror = function () { callback(''); };
      img.src = faviconUrl;
    } else {
      callback('');
    }
  }

  // 在线获取 favicon 作为备用
  function fetchFaviconOnline(url, callback) {
    const domain = new URL(url).hostname;
    const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
    const img = new Image();
    img.onload = function () {
      cacheFavicon(domain, faviconUrl);
      callback(faviconUrl);
    };
    img.onerror = function () {
      callback('');
    };
    img.src = faviconUrl;
  }

  // Add this function to cache favicons
  function cacheFavicon(domain, faviconUrl) {
    const data = {};
    data[domain] = faviconUrl;
    chrome.storage.local.set(data);
  }

  async function showDefaultSuggestions() {
    // 如果管理员关闭了搜索建议总开关，不显示任何建议
    if (FavsHubSettings.get('showSearchSuggestions') === false) {
      hideSuggestions();
      return;
    }

    // 首先检查设置
    const settings = {
      showHistorySuggestions: FavsHubSettings.get('showHistorySuggestions') !== false,
      showBookmarkSuggestions: FavsHubSettings.get('showBookmarkSuggestions') !== false,
      showPromptSuggestions: FavsHubSettings.get('showPromptSuggestions') !== false,
    };

    let suggestions = [];

    // === 历史记录建议（仅扩展模式，需要 chrome.history API）===
    if (settings.showHistorySuggestions && document.documentElement.getAttribute('data-favshub-ext') === 'active') {
      const recentHistory = await getRecentHistory(20);
      suggestions = suggestions.concat(recentHistory.map(item => ({
        text: item.text,
        url: item.url,
        type: 'history',
        relevance: item.relevance
      })));
    }

    // === 书签建议（通过后端 API 获取最近的书签）===
    if (settings.showBookmarkSuggestions) {
      try {
        const result = await api.getBookmarks();
        if (result && result.bookmarks) {
          // URL 去重：保留 sort_order 更小的（更靠前的）
          const seenUrls = new Set();
          const recentBookmarks = result.bookmarks
            .filter(item => item.title && item.url)
            .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
            .filter(item => {
              if (seenUrls.has(item.url)) return false;
              seenUrls.add(item.url);
              return true;
            })
            .slice(0, 10);
          suggestions = suggestions.concat(recentBookmarks.map(item => ({
            text: item.title,
            url: item.url,
            type: 'bookmark',
            icon: item.icon || '',
            relevance: 1
          })));
        }
      } catch (e) {
        
      }
    }

    // === 提示词建议（通过后端 API 获取最近的提示词）===
    if (settings.showPromptSuggestions) {
      try {
        const result = await api.getPrompts({ limit: 10 });
        if (result && result.prompts) {
          suggestions = suggestions.concat(result.prompts.slice(0, 5).map(prompt => ({
            text: prompt.title,
            url: `promptpro://detail/${prompt.prompt_id || prompt.id}`,
            type: 'prompt',
            relevance: 0.5,
            promptData: prompt
          })));
        }
      } catch (e) {
        
      }
    }

    // 如果没有任何建议，则不显示建议列表
    if (suggestions.length === 0) {
      hideSuggestions();
      return;
    }

    // 按 relevance 降序排序
    suggestions.sort((a, b) => b.relevance - a.relevance);

    showSuggestions(suggestions);
  }

  // 修改 handleInput 函数
  const handleInput = debounce(async () => {
    const query = searchInput.value.trim();
    showLoadingIndicator();
    
    if (query) {
      const suggestions = await getSuggestions(query);
      hideLoadingIndicator();
      // 移除 length > 1 的判断，因为我们总是想显示搜索建议
      showSuggestions(suggestions);
    } else {
      hideLoadingIndicator();
      showDefaultSuggestions();
    }
    updateSubmitButtonState();
  }, 300);

  // 处理输入事件
  searchInput.addEventListener('input', () => {
    handleInput();
    updateSubmitButtonState();
    if (searchInput.value.trim() === '') {
      showDefaultSuggestions();
    }
  });

  // 处理键盘导航
  searchInput.addEventListener('keydown', (e) => {
    const items = searchSuggestions.querySelectorAll('li');
    let index = Array.from(items).findIndex(item => item.classList.contains('keyboard-selected'));

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (index < items.length - 1) index++;
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (index > 0) index--;
        break;
      case 'Enter':
        e.preventDefault();
        // 缓存所需数据
        const _cachedMetaKey = e.metaKey || e.ctrlKey;
        const _cachedQuery = searchInput.value.trim();
        const _cachedIndex = index;
        const _cachedItems = items;

        if (_cachedMetaKey) {
          // Ctrl/Cmd+Enter：异步打开多标签
          setTimeout(() => {
            if (_cachedQuery) openAllSearchEngines(_cachedQuery);
          }, 0);
        } else if (_cachedIndex !== -1) {
          const selectedItem = _cachedItems[_cachedIndex];
          const suggestionType = selectedItem.getAttribute('data-type');
          if (suggestionType === 'history' || suggestionType === 'bookmark') {
            const url = selectedItem.getAttribute('data-url');
            if (url) {
              // 导航操作通过 setTimeout 异步执行
              setTimeout(() => {
                if (FavsHubSettings.get('openSearchInNewTab') !== false) {
                  window.open(url, '_blank');
                } else {
                  window.location.href = url;
                }
                hideSuggestions();
              }, 0);
              return;
            }
          }
          // DOM 点击操作通过 rAF 调度
          requestAnimationFrame(() => { selectedItem.click(); });
        } else {
          performSearch(_cachedQuery);
        }
        return;
      default:
        return;
    }

    items.forEach(item => item.classList.remove('keyboard-selected'));
    if (index !== -1) {
      items[index].classList.add('keyboard-selected');
      // 只在选择搜索建议时更新输入框的值
      const selectedItem = items[index];
      const suggestionType = selectedItem.getAttribute('data-type');
      if (suggestionType === 'search') {
        searchInput.value = selectedItem.querySelector('.suggestion-text').textContent;
      }
    }
  })

  // 添加防抖函数
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }



  function hideSuggestions() {
    if (isChangingSearchEngine) {
      return; // 如果正在切换搜索引擎，不隐藏建议列表
    }
    const searchForm = document.querySelector('.search-form');
    searchForm.classList.remove('focused-with-suggestions');

    const suggestionsWrapper = document.querySelector('.search-suggestions-wrapper');
    if (suggestionsWrapper) {
      suggestionsWrapper.style.display = 'none';
    }
    if (searchSuggestions) {
      searchSuggestions.style.display = 'none';
      searchSuggestions.innerHTML = ''; // Clear the suggestions
    }

    // 隐藏 line-container
    const lineContainer = document.getElementById('line-container');
    lineContainer.style.display = 'none'; // 隐藏线条

    if (isScrollListenerAttached) {
      searchSuggestions.removeEventListener('scroll', throttledHandleScroll);
      isScrollListenerAttached = false;
    }

    // Reset suggestions-related variables
    allSuggestions = [];
    displayedSuggestions = 0;

    // 清理分类 Tab 状态
    currentCategoryTab = 'default';
    groupedSuggestions = { bookmarks: [], prompts: [], histories: [] };
    if (categoryTabsEl) {
      categoryTabsEl.classList.remove('visible');
      categoryTabsEl.innerHTML = '';
    }
  }

  function showLoadingIndicator() {
    const loadingIndicator = document.createElement('div');
    loadingIndicator.className = 'loading-indicator';
    loadingIndicator.innerHTML = `
    <svg class="loading-spinner" viewBox="0 0 50 50">
      <circle class="spinner-path" cx="25" cy="25" r="20" fill="none" stroke-width="4"></circle>
    </svg>
  `;
    searchSuggestions.appendChild(loadingIndicator);
  }

  function hideLoadingIndicator() {
    const loadingIndicator = searchSuggestions.querySelector('.loading-indicator');
    if (loadingIndicator) {
      loadingIndicator.remove();
    }
  }


  // 修改这个函数
  function openAllSearchEngines(query) {
    const enabledEngines = SearchEngineManager.getEnabledEngines();

    const urls = enabledEngines
      .map(engine => getSearchUrl(engine.name, query));

    if (urls.length > 0) {
      window.lastSearchTrigger = 'cmdCtrlEnter';

      chrome.runtime.sendMessage({
        action: 'openMultipleTabsAndGroup',
        urls: urls,
        groupName: query
      }, function (response) {
        if (!response || !response.success) {
          
        }
      });
    } else {
    }
  }

// 确保在 DOMContentLoaded 时调用创建函数
document.addEventListener('DOMContentLoaded', async function() {
  await FavsHubSettings.load();
  createSearchEngineDropdown();
  // ... 其他初始化代码 ...







  // 在适当时机调用此函数
  document.addEventListener('DOMContentLoaded', setVersionNumber);

  // 修改文档点击事件监听器，同时处理书签和文件夹的上下文菜单
  document.addEventListener('click', function (event) {
    // 关闭书签上下文菜单
    if (contextMenu) {
      contextMenu.style.display = 'none';
      currentBookmark = null;
    }
    
    // 关闭文件夹上下文菜单
    if (bookmarkFolderContextMenu) {
      bookmarkFolderContextMenu.style.display = 'none';
      currentBookmarkFolder = null;
    }
  });

  // 为上下文菜单添加阻止冒泡，防止点击菜单本身时关闭
  if (contextMenu) {
    contextMenu.addEventListener('click', function(event) {
      event.stopPropagation();
    });
  }

  if (bookmarkFolderContextMenu) {
    bookmarkFolderContextMenu.addEventListener('click', function(event) {
      event.stopPropagation();
    });
  }

  // 添加搜索引擎变更事件监听
  document.addEventListener('defaultSearchEngineChanged', (event) => {
    // 可以在这里添加其他需要响应搜索引擎变更的逻辑
    createTemporarySearchTabs(); // 添加这行以更新临时搜索标签
  });


  // 新增辅助函数


  async function toggleDefaultFolder(folder) {
    if (!folder?.dataset?.id) {
      
      return;
    }

    const folderId = folder.dataset.id;
    // 根据不同的文件夹元素结构获取文件夹名称
    let folderName;
    if (folder.classList.contains('bookmark-folder')) {
        // 主内容区的文件夹卡片
        folderName = folder.querySelector('.card-title')?.textContent;
    } else {
        // 侧边栏的文件夹
        folderName = folder.dataset.title || folder.textContent.trim();
    }
    
    if (!folderName) {
        
        return;
    }

    try {
        const data = FavsHubSettings.get('defaultFolders') || [];
        let defaultFolders = Array.isArray(data.defaultFolders) ? data.defaultFolders : (data.defaultFolders?.items || []);
        const isDefault = defaultFolders.some(f => f.id === folderId);

        if (isDefault) {
            defaultFolders = defaultFolders.filter(f => f.id !== folderId);
            defaultFolders = defaultFolders.map((f, index) => ({
                ...f,
                order: index
            }));
            showToast(chrome.i18n.getMessage("removedFromDefaultFolders", [folderName]));
        } else {
            if (defaultFolders.length >= 8) {
                showToast(chrome.i18n.getMessage("maxDefaultFoldersReached"));
                return;
            }
            defaultFolders.push({
                id: folderId,
                name: folderName,
            });
            showToast(chrome.i18n.getMessage("addedToDefaultFolders", [folderName]));
        }

        FavsHubSettings.setMany({
            defaultFolders: defaultFolders,
        });
        FavsHubSettings.set('lastViewedFolder', null);

        // 文件夹切换功能已删除
        // await initDefaultFoldersTabs();

        // 立即更新UI

        // 如果是新添加的默认文件夹，自动切换到该文件夹
        if (!isDefault) {
            await switchToFolder(folderId);
        }

        // 触发更新事件
        document.dispatchEvent(new CustomEvent('defaultFoldersChanged', {
            detail: { folders: defaultFolders }
        }));

    } catch (error) {
        
        showToast('操作失败，请重试');
    }
  }





  // 文件夹切换功能已删除
  // 监听默认文件夹变化
  // document.addEventListener('defaultFoldersChanged', async (event) => {
  //   await initDefaultFoldersTabs();
  // });

  // 在文档加载完成后初始化 - 文件夹切换功能已删除
  // document.addEventListener('DOMContentLoaded', async () => {
  //   await initDefaultFoldersTabs();
  // });




// 获取版本号并设置
function setVersionNumber() {
  const manifest = chrome.runtime.getManifest();
  const versionElement = document.querySelector('.about-version');
  
  if (versionElement && manifest) {
    // 移除 data-i18n 属性，因为我们要直接设置完整的本地化文本
    versionElement.removeAttribute('data-i18n');
    
    // 获取本地化的版本号文本并设置
    const versionText = chrome.i18n.getMessage('version', [manifest.version]);
    versionElement.textContent = versionText;
  }
}

// 确保在 DOM 加载完成后调用
document.addEventListener('DOMContentLoaded', () => {
  // 延迟一小段时间执行，确保其他初始化完成
  setTimeout(setVersionNumber, 100);
});

// 文件夹切换功能已删除
// function updateDefaultFoldersTabsVisibility() { ... }

// 监听侧边栏状态变化 - 文件夹切换功能已删除
// document.addEventListener('DOMContentLoaded', () => {
//   const sidebarContainer = document.getElementById('sidebar-container');
//   if (sidebarContainer) {
//     const observer = new MutationObserver(updateDefaultFoldersTabsVisibility);
//     observer.observe(sidebarContainer, { attributes: true, attributeFilter: ['class'] });
//   }
//   updateDefaultFoldersTabsVisibility();
// });

// 在标签更新时调用 - 文件夹切换功能已删除
// document.addEventListener('defaultFoldersChanged', updateDefaultFoldersTabsVisibility);

// 在适当位置添加或修改
function openSettingsModal() {
  // 修改为打开侧边栏
  const settingsSidebar = document.getElementById('settings-sidebar');
  const settingsOverlay = document.getElementById('settings-overlay');

  if (settingsSidebar && settingsOverlay) {
    settingsSidebar.classList.add('open');
    settingsOverlay.classList.add('active');
    document.body.style.overflow = 'hidden'; // 防止背景滚动
  } else {
    
  }
}

// 确保在 DOMContentLoaded 事件中初始化设置图标点击事件
document.addEventListener('DOMContentLoaded', function() {
  // ... 其他初始化代码 ...
  
  // 设置图标点击事件
  const settingsIcon = document.querySelector('.settings-icon a');
  if (settingsIcon) {
    settingsIcon.addEventListener('click', function(e) {
      e.preventDefault();
      openSettingsModal();
    });
  }
  
  // 关闭按钮点击事件
  const closeButton = document.querySelector('.settings-sidebar-close');
  if (closeButton) {
    closeButton.addEventListener('click', function() {
      const settingsSidebar = document.getElementById('settings-sidebar');
      const settingsOverlay = document.getElementById('settings-overlay');

      if (settingsSidebar) {
        settingsSidebar.classList.remove('open');
      }
      if (settingsOverlay) {
        settingsOverlay.classList.remove('active');
        settingsOverlay.style.display = 'none';
        setTimeout(() => {
          settingsOverlay.style.display = '';
        }, 300);
      }
      document.body.style.overflow = ''; // 恢复背景滚动
    });
  }
  
  // 遮罩层点击事件
  const settingsOverlay = document.getElementById('settings-overlay');
  if (settingsOverlay) {
    settingsOverlay.addEventListener('click', function() {
      const settingsSidebar = document.getElementById('settings-sidebar');

      if (settingsSidebar) {
        settingsSidebar.classList.remove('open');
      }
      settingsOverlay.classList.remove('active');
      settingsOverlay.style.display = 'none';
      setTimeout(() => {
        settingsOverlay.style.display = '';
      }, 300);
      document.body.style.overflow = ''; // 恢复背景滚动
    });
  }
});

});

// 添加滚动指示器功能
function initScrollIndicator() {
  const bookmarksContainer = document.querySelector('.bookmarks-container');
  const bookmarksList = document.getElementById('bookmarks-list');
  
  if (!bookmarksContainer || !bookmarksList) return;
  
  // 创建滚动指示器
  const scrollIndicator = document.createElement('div');
  scrollIndicator.className = 'scroll-indicator';
  scrollIndicator.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="7 13 12 18 17 13"></polyline>
      <polyline points="7 6 12 11 17 6"></polyline>
    </svg>
  `;
  bookmarksContainer.appendChild(scrollIndicator);
  
  // 滚动状态变量
  let scrollTimeout;
  let isScrolling = false;
  
  // 检查是否需要滚动
  function checkScrollable() {
    const isScrollable = bookmarksList.scrollHeight > bookmarksList.clientHeight;
    
    if (isScrollable) {
      scrollIndicator.style.display = 'flex';
      // 添加动画类
      if (!scrollIndicator.classList.contains('animate')) {
        scrollIndicator.classList.add('animate');
        // 5秒后移除动画
        setTimeout(() => {
          scrollIndicator.classList.remove('animate');
        }, 5000);
      }
    } else {
      scrollIndicator.style.display = 'none';
    }
  }
  
  // 监听滚动事件
  bookmarksList.addEventListener('scroll', () => {
    // 如果已经滚动到底部，隐藏指示器
    const isAtBottom = bookmarksList.scrollHeight - bookmarksList.scrollTop <= bookmarksList.clientHeight + 10;
    if (isAtBottom) {
      scrollIndicator.style.opacity = '0';
    } else {
      scrollIndicator.style.opacity = '';
    }
    
    // 添加滚动中的类
    if (!isScrolling) {
      isScrolling = true;
      bookmarksList.classList.add('scrolling');
    }
    
    // 清除之前的定时器
    clearTimeout(scrollTimeout);
    
    // 设置新的定时器，滚动停止1.5秒后移除滚动中的类
    scrollTimeout = setTimeout(() => {
      isScrolling = false;
      bookmarksList.classList.remove('scrolling');
    }, 1500);
  });
  
  // 鼠标进入书签列表时，如果可滚动，添加滚动中的类
  bookmarksList.addEventListener('mouseenter', () => {
    if (bookmarksList.scrollHeight > bookmarksList.clientHeight) {
      bookmarksList.classList.add('scrolling');
      
      // 鼠标离开时，如果不在滚动，移除滚动中的类
      const handleMouseLeave = () => {
        if (!isScrolling) {
          bookmarksList.classList.remove('scrolling');
        }
        bookmarksList.removeEventListener('mouseleave', handleMouseLeave);
      };
      
      bookmarksList.addEventListener('mouseleave', handleMouseLeave);
    }
  });
  
  // 初始检查和窗口大小变化时重新检查
  checkScrollable();
  window.addEventListener('resize', _.debounce(checkScrollable, 200));
  
  // 当书签列表内容变化时重新检查
  const observer = new MutationObserver(_.debounce(checkScrollable, 200));
  observer.observe(bookmarksList, { childList: true, subtree: true });
  
  // 点击指示器滚动到下一屏
  scrollIndicator.addEventListener('click', () => {
    const currentScroll = bookmarksList.scrollTop;
    const nextScroll = currentScroll + bookmarksList.clientHeight * 0.8;
    bookmarksList.scrollTo({
      top: nextScroll,
    });
    
    // 点击时添加滚动中的类
    bookmarksList.classList.add('scrolling');
    isScrolling = true;
    
    // 清除之前的定时器
    clearTimeout(scrollTimeout);
    
    // 设置新的定时器
    scrollTimeout = setTimeout(() => {
      isScrolling = false;
      bookmarksList.classList.remove('scrolling');
    }, 1500);
  });

  // 监听触摸事件，支持触摸设备
  bookmarksList.addEventListener('touchstart', () => {
    bookmarksList.classList.add('scrolling');
    isScrolling = true;

    // 清除之前的定时器
    clearTimeout(scrollTimeout);
  }, { passive: true });

  bookmarksList.addEventListener('touchend', () => {
    // 设置新的定时器，触摸结束后1.5秒移除滚动中的类
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      isScrolling = false;
      bookmarksList.classList.remove('scrolling');
    }, 1500);
  });
  
  // 初始检查和窗口大小变化时重新检查
}

// 在DOMContentLoaded事件中调用
document.addEventListener('DOMContentLoaded', function() {
  // 初始化虚拟滚动
  initVirtualScroll();
  
  // 初始化滚动指示器
  initScrollIndicator();
  
  // 其他初始化代码...
  startPeriodicSync();
});

// 回到顶部按钮功能
function initBackToTop() {
  const backToTopBtn = document.getElementById('back-to-top');
  const scrollPercentElement = document.getElementById('scroll-percent');

  if (!backToTopBtn) {
    // 如果按钮不存在，稍后重试
    setTimeout(initBackToTop, 100);
    return;
  }

  const svgElement = backToTopBtn.querySelector('svg');
  
  let scrollTimeout;
  
  // 简化滚动事件监听器，不使用节流以确保响应性
  function handleScroll() {
    // 找到实际发生滚动的容器
    const candidates = [
      document.querySelector('main'),
      document.querySelector('.bookmarks-container'),
      document.getElementById('bookmarks-list'),
      document.querySelector('.overflow-auto, .overflow-y-auto')
    ].filter(Boolean);

    let scrollPosition = 0;
    let maxScroll = 0;

    for (const el of candidates) {
      const pos = el.scrollTop;
      const max = el.scrollHeight - el.clientHeight;
      if (pos > 0 || max > 0) {
        scrollPosition = pos;
        maxScroll = max;
        break;
      }
    }

    if (scrollPosition === 0) {
      scrollPosition = window.pageYOffset || document.documentElement.scrollTop || 0;
      maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    }

    let scrollPercentage = maxScroll > 0
      ? Math.min(Math.round((scrollPosition / maxScroll) * 100), 100)
      : 0;
    
    
    // 显示百分比文本，隐藏SVG图标（在滚动过程中）
    if (scrollPercentElement) {
      scrollPercentElement.textContent = scrollPercentage + '%';
      // 使用CSS类控制显示状态
      backToTopBtn.classList.remove('show-icon');
      backToTopBtn.classList.add('show-percent');
    }
    
    if (svgElement) {
      // 使用CSS类控制显示状态
      backToTopBtn.classList.remove('show-icon'); // 移除图标显示类
      backToTopBtn.classList.add('show-percent'); // 添加百分比显示类
    }
    
    // 在滚动时立即更新环形进度条
    if (scrollPercentage !== 0) {
      // 移除之前的进度类
      const progressClasses = Array.from(backToTopBtn.classList).filter(cls => cls.startsWith('progress-'));
      progressClasses.forEach(cls => backToTopBtn.classList.remove(cls));
      // 添加新的进度类
      backToTopBtn.classList.add(`progress-${scrollPercentage}`);
    }
    
    
    // 使用较小的阈值
    const threshold = 50; // 使用50px作为阈值
    
    if (scrollPosition > threshold) {  
      backToTopBtn.classList.add('show');
    } else {
      backToTopBtn.classList.remove('show');
    }
    
    // 清除之前的定时器
    clearTimeout(scrollTimeout);
    
    // 设置定时器，在滚动停止3秒后显示回到顶部图标，隐藏百分比
    scrollTimeout = setTimeout(() => {
      if (scrollPercentElement) {
        // 使用CSS类控制显示状态
        backToTopBtn.classList.remove('show-percent');
        backToTopBtn.classList.add('show-icon');
      }
      if (svgElement) {
        // 使用CSS类控制显示状态
        backToTopBtn.classList.remove('show-percent');
        backToTopBtn.classList.add('show-icon');
      }
      // 移除之前的进度类
      const progressClasses = Array.from(backToTopBtn.classList).filter(cls => cls.startsWith('progress-'));
      progressClasses.forEach(cls => backToTopBtn.classList.remove(cls));
      
      // 确保此时显示的是SVG图标而不是百分比
      backToTopBtn.classList.remove('show-percent');
      backToTopBtn.classList.add('show-icon');
    }, 3000); // 3秒后切换回回到顶部图标
  }

  // 添加一个函数来尝试添加滚动监听器
  function setupScrollListener() {
    // 监听多个可能的滚动容器 + window
    const targets = [
      document.querySelector('main'),
      document.querySelector('.bookmarks-container'),
      document.getElementById('bookmarks-list'),
      document.querySelector('.overflow-auto, .overflow-y-auto')
    ].filter(Boolean);

    targets.forEach(el => {
      el.removeEventListener('scroll', handleScroll);
      el.addEventListener('scroll', handleScroll);
    });
    window.addEventListener('scroll', handleScroll);

    handleScroll();
    return true;
  }
  
  // 尝试立即设置监听器
  if (!setupScrollListener()) {
    // 如果立即设置失败，定期尝试直到成功
    const intervalId = setInterval(() => {
      if (setupScrollListener()) {
        clearInterval(intervalId);
      }
    }, 500);
    
    // 设置一个最大等待时间（10秒）
    setTimeout(() => {
      clearInterval(intervalId);
    }, 10000);
  }
  
  // 也监听resize事件，以防页面内容动态变化
  window.addEventListener('resize', handleScroll);

  // 点击按钮时滚动到顶部
  backToTopBtn.addEventListener('click', function() {
    let scrollContainer = document.querySelector('main') || document.querySelector('.bookmarks-container') || document.querySelector('.overflow-auto, .overflow-y-auto');
    if (scrollContainer) {
      scrollContainer.scrollTo({ top: 0 });
    } else {
      window.scrollTo({ top: 0 });
    }
  });
  
  // 页面加载时确保显示SVG图标（非滚动状态）
  if (svgElement) {
    // 使用CSS类控制显示状态
    backToTopBtn.classList.remove('show-percent');
    backToTopBtn.classList.add('show-icon');
    backToTopBtn.classList.add('show'); // 确保按钮可见
  }
  if (scrollPercentElement) {
    // 使用CSS类控制显示状态
    backToTopBtn.classList.remove('show-percent');
    backToTopBtn.classList.add('show-icon');
  }
  
  // 确保在任何情况下都有正确的默认显示状态
  setTimeout(() => {
    if (svgElement) {
      backToTopBtn.classList.remove('show-percent');
      backToTopBtn.classList.add('show-icon');
      backToTopBtn.classList.add('show');
    }
  }, 500); // 在初始化后稍作延迟再次确认状态
}

// 初始化回到顶部按钮（直接调用，不依赖 DOMContentLoaded 避免死锁）
setTimeout(() => {
  if (typeof initBackToTop === 'function') initBackToTop();
}, 300);

window.addEventListener('load', () => {
  setTimeout(() => {
    if (typeof initBackToTop === 'function') initBackToTop();
  }, 200);
});

// 点击logo标题回到页面顶端的功能
function initLogoTitleScrollToTop() {
  const logoTitle = document.getElementById('logo-title');
  
  if (!logoTitle) {
    setTimeout(initLogoTitleScrollToTop, 100);
    return;
  }

  logoTitle.addEventListener('click', function() {
    
    // 尝试找到当前实际的滚动容器
    let scrollContainer = document.getElementById('bookmarks-list');
    
    if (!scrollContainer || (scrollContainer.scrollHeight <= scrollContainer.clientHeight)) {
      scrollContainer = document.querySelector('main');
    }
    
    if (!scrollContainer || (scrollContainer.scrollHeight <= scrollContainer.clientHeight)) {
      scrollContainer = document.querySelector('.bookmarks-container');
    }
    
    if (!scrollContainer || (scrollContainer.scrollHeight <= scrollContainer.clientHeight)) {
      scrollContainer = document.querySelector('.overflow-auto, .overflow-y-auto');
    }
    
    if (scrollContainer) {
      // 使用平滑滚动效果
      scrollContainer.scrollTo({
        top: 0,
      });
    } else {
      // 备用：滚动整个页面
      window.scrollTo({
        top: 0,
      });
    }
  });
  
  // 添加鼠标悬停效果提示
  logoTitle.style.cursor = 'pointer';
  logoTitle.title = '点击回到页面顶端';
}

// 在DOM加载完成后初始化logo标题点击功能
document.addEventListener('DOMContentLoaded', function() {
  setTimeout(initLogoTitleScrollToTop, 100);
});

// 作为备用方案，在页面完全加载后再次尝试
window.addEventListener('load', function() {
  setTimeout(() => {
    const logoTitle = document.getElementById('logo-title');
    if (logoTitle && !logoTitle.hasAttribute('data-scroll-initialized')) {
      logoTitle.setAttribute('data-scroll-initialized', 'true');
      initLogoTitleScrollToTop();
    }
  }, 100);
});
});

