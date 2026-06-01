// 设置管理器类（依赖 icons.js 和 backup-manager.js 已通过全局脚本加载）
class SettingsManager {
  constructor() {
    this.settingsModal = document.getElementById('settings-modal');
    this.settingsSidebar = document.getElementById('settings-sidebar');
    this.settingsOverlay = document.getElementById('settings-overlay');
    this.settingsIcon = document.querySelector('.settings-icon a');
    this.closeButton = document.querySelector('.settings-sidebar-close');
    this.tabButtons = document.querySelectorAll('.settings-tab-button');
    this.tabContents = document.querySelectorAll('.settings-tab-content');
    this.bgOptions = document.querySelectorAll('.settings-bg-option');
    this.enableFloatingBallCheckbox = document.getElementById('enable-floating-ball');
    // 快捷链接功能已删除
    // this.enableQuickLinksCheckbox = document.getElementById('enable-quick-links');
    this.openInNewTabCheckbox = document.getElementById('open-in-new-tab');
    
    // 侧边栏模式下的链接打开方式设置元素可能不存在于所有页面
    // 添加安全检查，避免在元素不存在时出错
    const sidepanelOpenInNewTab = document.getElementById('sidepanel-open-in-new-tab');
    const sidepanelOpenInSidepanel = document.getElementById('sidepanel-open-in-sidepanel');
    
    this.sidepanelOpenInNewTabCheckbox = sidepanelOpenInNewTab;
    this.sidepanelOpenInSidepanelCheckbox = sidepanelOpenInSidepanel;
    
    this.widthSettings = document.getElementById('floating-width-settings');
    this.widthSlider = document.getElementById('width-slider');
    this.widthValue = document.getElementById('width-value');
    this.widthPreviewCount = document.getElementById('width-preview-count');
    this.settingsModalContent = document.querySelector('.settings-modal-content');
    this.showHistorySuggestionsCheckbox = document.getElementById('show-history-suggestions');
    this.showBookmarkSuggestionsCheckbox = document.getElementById('show-bookmark-suggestions');
    this.enableWheelSwitchingCheckbox = null; // 文件夹切换功能已删除
    // this.enableWheelSwitchingCheckbox = document.getElementById('enable-wheel-switching');
    this.openSearchInNewTabCheckbox = document.getElementById('open-search-in-new-tab');
    this.init();
  }

  init() {
    this.loadSavedSettings();
    this.initEventListeners();
    this.initTheme();
    
    // 只在相关元素存在时才调用各个初始化方法
    // 快捷链接功能已删除
    // if (this.enableQuickLinksCheckbox) {
    //   this.initQuickLinksSettings();
    // }

    if (this.enableFloatingBallCheckbox) {
      this.initFloatingBallSettings();
    }
    
    if (this.openInNewTabCheckbox || this.sidepanelOpenInNewTabCheckbox || this.sidepanelOpenInSidepanelCheckbox) {
      this.initLinkOpeningSettings();
    }
    
    // 书签管理相关已删除

    // 检查宽度设置相关元素
    if (this.widthSlider && this.widthValue) {
      this.initBookmarkWidthSettings();
    }
    
    // 检查高度设置相关元素
    const heightSlider = document.getElementById('height-slider');
    const heightValue = document.getElementById('height-value');
    if (heightSlider && heightValue) {
      this.initCardHeightSettings();
    }
    
    // 检查容器宽度设置相关元素
    const containerWidthSlider = document.getElementById('container-width-slider');
    if (containerWidthSlider) {
      this.initContainerWidthSettings();
    }
    
    // 检查布局设置相关元素
    const showSearchBoxCheckbox = document.getElementById('show-search-box');
    const showWelcomeMessageCheckbox = document.getElementById('show-welcome-message');
    const showFooterCheckbox = document.getElementById('show-footer');
    if (showSearchBoxCheckbox || showWelcomeMessageCheckbox || showFooterCheckbox) {
      this.initLayoutSettings();
    }
    
    // 检查搜索建议设置相关元素
    if (this.showHistorySuggestionsCheckbox || this.showBookmarkSuggestionsCheckbox) {
      this.initSearchSuggestionsSettings();
    }
    
    // 检查滚轮切换设置相关元素
    // 文件夹切换功能已删除
    // if (this.enableWheelSwitchingCheckbox) {
    //   this.initWheelSwitchingTab();
    // }
    
    // 检查快捷键设置相关元素
    const configureShortcuts = document.getElementById('configure-shortcuts');
    if (configureShortcuts) {
      this.initShortcutsSettings();
    }

    // 初始化备份设置
    this.initBackupSettings();
  }

  initEventListeners() {
    // 打开设置侧边栏 - 同时支持旧版 .settings-icon a 和新版侧边栏 #settings-link
    const settingsTriggers = document.querySelectorAll('.settings-icon a, #settings-link');
    settingsTriggers.forEach(trigger => {
      trigger.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.openSettingsSidebar();
      });
    });

    // 关闭设置侧边栏
    if (this.closeButton) {
      this.closeButton.addEventListener('click', () => {
        this.closeSettingsSidebar();

        // 关闭侧边栏时更新欢迎消息
        if (window.WelcomeManager) {
          window.WelcomeManager.updateWelcomeMessage();
        }
      });
    }

    // 标签切换
    this.tabButtons.forEach(button => {
      button.addEventListener('click', () => {
        const tabName = button.getAttribute('data-tab');
        this.switchTab(tabName);
      });
    });

    // 背景颜色选择
    this.bgOptions.forEach(option => {
      option.addEventListener('click', () => this.handleBackgroundChange(option));
    });

    // 悬浮球设置
    if (this.enableFloatingBallCheckbox) {
      this.enableFloatingBallCheckbox.addEventListener('change', () => {
        FavsHubSettings.set('enableFloatingBall', this.enableFloatingBallCheckbox.checked);
      });
    }

    // 添加键盘事件监听，按ESC关闭侧边栏
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.settingsSidebar && this.settingsSidebar.classList.contains('open')) {
        this.closeSettingsSidebar();
      }
    });

    // 添加点击侧边栏外部关闭功能
    document.addEventListener('click', (e) => {
      // 如果侧边栏已打开，且点击的不是侧边栏内部元素，也不是设置触发器
      const clickedTrigger = e.target.closest('.settings-icon a, #settings-link');
      if (this.settingsSidebar &&
          this.settingsSidebar.classList.contains('open') &&
          !this.settingsSidebar.contains(e.target) &&
          !clickedTrigger) {
        this.closeSettingsSidebar();

        // 关闭侧边栏时更新欢迎消息
        if (window.WelcomeManager) {
          window.WelcomeManager.updateWelcomeMessage();
        }
      }
    });

    // 阻止侧边栏内部点击事件冒泡到文档
    if (this.settingsSidebar) {
      this.settingsSidebar.addEventListener('click', (e) => {
        // 如果点击的是链接，不阻止事件冒泡
        if (e.target.tagName === 'A' || e.target.closest('a')) {
          return; // 允许链接点击事件正常传播
        }
        e.stopPropagation();
      });
    }

    // 阻止设置触发器点击事件冒泡到文档
    settingsTriggers.forEach(trigger => {
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
      });
    });
  }

  // 打开设置侧边栏
  openSettingsSidebar() {
    if (this.settingsSidebar) {
      this.settingsSidebar.classList.add('open');
    }
    if (this.settingsOverlay) {
      this.settingsOverlay.classList.add('active');
    }
    document.body.style.overflow = 'hidden';
  }

  // 关闭设置侧边栏
  closeSettingsSidebar() {
    if (this.settingsSidebar) {
      this.settingsSidebar.classList.remove('open');
    }
    if (this.settingsOverlay) {
      this.settingsOverlay.classList.remove('active');
      // 强制隐藏遮罩层，确保遮罩层不会残留在页面上
      this.settingsOverlay.style.display = 'none';
      setTimeout(() => {
        this.settingsOverlay.style.display = '';
      }, 300);
    }
    // 恢复背景滚动
    document.body.style.overflow = '';
  }

  switchTab(tabName) {
    // 移除所有标签的 active 类
    this.tabButtons.forEach(button => {
      button.classList.remove('active');
    });
    
    // 移除所有内容的 active 类
    this.tabContents.forEach(content => {
      content.classList.remove('active');
    });
    
    // 添加当前标签的 active 类
    const selectedButton = document.querySelector(`[data-tab="${tabName}"]`);
    const selectedContent = document.getElementById(`${tabName}-settings`);
    
    if (selectedButton && selectedContent) {
      selectedButton.classList.add('active');
      selectedContent.classList.add('active');
      // 更新 UI 语言
      window.updateUILanguage();
      
      // 确保欢迎消息也被更新
      if (window.WelcomeManager) {
        window.WelcomeManager.updateWelcomeMessage();
      }
    }
  }

  handleBackgroundChange(option) {
    const bgClass = option.getAttribute('data-bg');
    
    // 更新欢迎消息
    if (window.WelcomeManager) {
      window.WelcomeManager.updateWelcomeMessage();
    }
  }

  clearWallpaper() {
    document.querySelectorAll('.wallpaper-option').forEach(opt => {
      opt.classList.remove('active');
    });

    const mainElement = document.querySelector('main');
    if (mainElement) {
      mainElement.style.backgroundImage = 'none';
      document.body.style.backgroundImage = 'none';
    }
    localStorage.removeItem('originalWallpaper');

    // 更新欢迎消息颜色
    const welcomeElement = document.getElementById('welcome-message');
    if (welcomeElement && window.WelcomeManager) {
      window.WelcomeManager.adjustTextColor(welcomeElement);
    }
  }

  loadSavedSettings() {
    if (this.enableFloatingBallCheckbox) {
      this.enableFloatingBallCheckbox.checked = FavsHubSettings.get('enableFloatingBall') !== false;
    }
    const savedBg = FavsHubSettings.get('selectedBackground');
    if (savedBg) {
      document.documentElement.className = savedBg;
      this.bgOptions.forEach(option => {
        if (option.getAttribute('data-bg') === savedBg) option.classList.add('active');
      });
    }
  }

  initTheme() {
    const themeSelect = document.getElementById('theme-select');
    const savedTheme = FavsHubSettings.get('theme') || 'auto';
    let effectiveTheme = savedTheme;
    if (savedTheme === 'auto') {
      effectiveTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', effectiveTheme);
    document.body.setAttribute('data-theme', effectiveTheme);
    if (themeSelect) themeSelect.value = savedTheme;
    this.updateThemeIcon(effectiveTheme === 'dark');

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      if (FavsHubSettings.get('theme') === 'auto') {
        const isDark = e.matches;
        document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
        document.body.setAttribute('data-theme', isDark ? 'dark' : 'light');
        this.updateThemeIcon(isDark);
      }
    });

    if (themeSelect) {
      themeSelect.addEventListener('change', (e) => this.saveTheme(e.target.value));
    }
    const navThemeBtn = document.getElementById('navThemeBtn');
    if (navThemeBtn) navThemeBtn.addEventListener('click', () => this.toggleTheme());
    const themeToggleBtn = document.getElementById('theme-toggle-btn');
    if (themeToggleBtn) themeToggleBtn.addEventListener('click', () => this.toggleTheme());
  }

  saveTheme(theme) {
    FavsHubSettings.set('theme', theme);
    const themeSelect = document.getElementById('theme-select');
    if (themeSelect) themeSelect.value = theme;
    let effectiveTheme = theme;
    if (theme === 'auto') {
      effectiveTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', effectiveTheme);
    document.body.setAttribute('data-theme', effectiveTheme);
    this.updateThemeIcon(effectiveTheme === 'dark');
  }

  toggleTheme() {
    const currentTheme = FavsHubSettings.get('theme') || 'light';
    this.saveTheme(currentTheme === 'dark' ? 'light' : 'dark');
  }

  setThemeBasedOnSystem() {
    const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = isDarkMode ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    document.body.setAttribute('data-theme', theme);
    this.updateThemeIcon(isDarkMode);
  }

  updateThemeIcon(isDark) {
    // 更新旧版主题按钮（如果存在）
    const themeToggleBtn = document.getElementById('theme-toggle-btn');
    if (themeToggleBtn) {
      themeToggleBtn.innerHTML = isDark ? ICONS.dark_mode : ICONS.light_mode;
    }

    // 更新侧边栏主题按钮图标（使用 SVG 模式）
    const navThemeBtn = document.getElementById('navThemeBtn');
    if (navThemeBtn) {
      navThemeBtn.innerHTML = isDark ? ICONS.dark_mode : ICONS.light_mode;
      navThemeBtn.title = isDark ? '切换到浅色模式' : '切换到深色模式';
    }
  }

  // 快捷链接功能已删除
  // initQuickLinksSettings() { ... }
  // toggleQuickLinksVisibility(show) { ... }

  initFloatingBallSettings() {
    if (this.enableFloatingBallCheckbox) {
      this.enableFloatingBallCheckbox.checked = FavsHubSettings.get('enableFloatingBall') !== false;
      this.enableFloatingBallCheckbox.addEventListener('change', () => {
        const isEnabled = this.enableFloatingBallCheckbox.checked;
        FavsHubSettings.set('enableFloatingBall', isEnabled);
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
          chrome.runtime.sendMessage({ action: 'updateFloatingBallSetting', enabled: isEnabled });
        }
      });
    }
  }

  initLinkOpeningSettings() {
    if (!this.openInNewTabCheckbox) return;
    const hasSidepanelSettings = this.sidepanelOpenInNewTabCheckbox && this.sidepanelOpenInSidepanelCheckbox;

    this.openInNewTabCheckbox.checked = FavsHubSettings.get('openInNewTab') !== false;
    this.openInNewTabCheckbox.addEventListener('change', () => {
      FavsHubSettings.set('openInNewTab', this.openInNewTabCheckbox.checked);
    });

    if (!hasSidepanelSettings) return;

    this.sidepanelOpenInNewTabCheckbox.checked = FavsHubSettings.get('sidepanelOpenInNewTab') !== false;
    this.sidepanelOpenInSidepanelCheckbox.checked = FavsHubSettings.get('sidepanelOpenInSidepanel') === true;
    if (this.sidepanelOpenInNewTabCheckbox.checked && this.sidepanelOpenInSidepanelCheckbox.checked) {
      this.sidepanelOpenInSidepanelCheckbox.checked = false;
      FavsHubSettings.set('sidepanelOpenInSidepanel', false);
    }

    this.sidepanelOpenInNewTabCheckbox.addEventListener('change', () => {
      FavsHubSettings.set('sidepanelOpenInNewTab', this.sidepanelOpenInNewTabCheckbox.checked);
      if (this.sidepanelOpenInNewTabCheckbox.checked && this.sidepanelOpenInSidepanelCheckbox.checked) {
        this.sidepanelOpenInSidepanelCheckbox.checked = false;
        FavsHubSettings.set('sidepanelOpenInSidepanel', false);
      }
    });
    this.sidepanelOpenInSidepanelCheckbox.addEventListener('change', () => {
      FavsHubSettings.set('sidepanelOpenInSidepanel', this.sidepanelOpenInSidepanelCheckbox.checked);
      if (this.sidepanelOpenInSidepanelCheckbox.checked && this.sidepanelOpenInNewTabCheckbox.checked) {
        this.sidepanelOpenInNewTabCheckbox.checked = false;
        FavsHubSettings.set('sidepanelOpenInNewTab', false);
      }
    });
  }

  initBookmarkManagementTab() {
    const tabButton = document.querySelector('[data-tab="bookmark-management"]');
    if (tabButton) {
      tabButton.addEventListener('click', () => {
        this.switchTab('bookmark-management');
      });
    }
  }

  // 文件夹切换功能已删除
  // initWheelSwitchingTab() { ... }
  // 添加 debounce 方法来优化性能
  debounce(func, wait) {
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

  initBookmarkWidthSettings() {
    // 获取元素引用
    this.widthSlider = document.getElementById('width-slider');
    this.widthValue = document.getElementById('width-value');
    this.widthPreviewCount = document.getElementById('width-preview-count');
    
    if (!this.widthSlider || !this.widthValue) return;
    const savedWidth = FavsHubSettings.get('bookmarkWidth') || 190;
    this.widthSlider.value = savedWidth;
    this.widthValue.textContent = savedWidth;
    this.updatePreviewCount(savedWidth);
    this.updateBookmarkWidth(savedWidth);
    this.widthSlider.addEventListener('input', (e) => {
      const width = e.target.value;
      this.widthValue.textContent = width;
      this.updatePreviewCount(width);
      this.updateBookmarkWidth(width);
    });
    this.widthSlider.addEventListener('mouseup', () => {
      FavsHubSettings.set('bookmarkWidth', this.widthSlider.value);
    });
        
    // 添加窗口大小改变的监听
    const debouncedUpdate = this.debounce(() => {
      this.updatePreviewCount(this.widthSlider.value);
    }, 250);
    window.addEventListener('resize', debouncedUpdate);
  }
  
  // 新增书签卡片高度设置函数
  initCardHeightSettings() {
    // 获取滑块和显示元素
    this.heightSlider = document.getElementById('height-slider');
    this.heightValue = document.getElementById('height-value');
    
    if (!this.heightSlider || !this.heightValue) return;
    const savedHeight = FavsHubSettings.get('bookmarkCardHeight') || 50;
    this.heightSlider.value = savedHeight;
    this.heightValue.textContent = savedHeight;
    this.updateCardHeight(savedHeight);
    this.heightSlider.addEventListener('input', (e) => {
      const height = e.target.value;
      this.heightValue.textContent = height;
      this.updateCardHeight(height);
    });
    this.heightSlider.addEventListener('mouseup', () => {
      FavsHubSettings.set('bookmarkCardHeight', this.heightSlider.value);
    });
  }
  
  // 更新书签卡片高度
  updateCardHeight(height) {
    // 创建或更新自定义样式
    let styleElement = document.getElementById('custom-card-height');
    if (!styleElement) {
      styleElement = document.createElement('style');
      styleElement.id = 'custom-card-height';
      document.head.appendChild(styleElement);
    }
    
    // 设置卡片高度
    styleElement.textContent = `
      .card {
        height: ${height}px !important;
      }
    `;
  }

  updatePreviewCount(width) {
    // 获取书签列表容器
    const bookmarksList = document.getElementById('bookmarks-list');
    if (!bookmarksList) return;

    // 确保容器可见
    const originalDisplay = bookmarksList.style.display;
    if (getComputedStyle(bookmarksList).display === 'none') {
      bookmarksList.style.display = 'grid';
    }

    // 获取容器的实际可用宽度
    const containerStyle = getComputedStyle(bookmarksList);
    const containerWidth = bookmarksList.offsetWidth 
      - parseFloat(containerStyle.paddingLeft) 
      - parseFloat(containerStyle.paddingRight);

    // 还原容器显示状态
    bookmarksList.style.display = originalDisplay;

    // 使用与 CSS Grid 相同的计算逻辑
    const gap = 16; // gap: 1rem
    const minWidth = parseInt(width);
    
    // 计算一行能容纳的最大数量
    // 使用 Math.floor 确保不会超出容器宽度
    const count = Math.floor((containerWidth + gap) / (minWidth + gap));
    
    // 更新显示 - 使用本地化文本
    const previewText = chrome.i18n.getMessage("bookmarksPerRow", [count]) || `${count} 个/行`;
    this.widthPreviewCount.textContent = previewText;
  }

  updateBookmarkWidth(width) {
    // 更新CSS变量
    document.documentElement.style.setProperty('--bookmark-width', width + 'px');
    
    // 更新Grid布局
    const bookmarksList = document.getElementById('bookmarks-list');
    if (bookmarksList) {
      // 使用 minmax 确保最小宽度，但允许在空间足够时扩展
      bookmarksList.style.gridTemplateColumns = `repeat(auto-fit, minmax(${width}px, 1fr))`;
      // 设置 gap
      bookmarksList.style.gap = '1rem';
    }
  }

  initContainerWidthSettings() {
    // 获取元素引用
    this.containerWidthSlider = document.getElementById('container-width-slider');
    this.containerWidthValue = document.getElementById('container-width-value');
    
    if (!this.containerWidthSlider || !this.containerWidthValue) return;
    const savedWidth = FavsHubSettings.get('bookmarkContainerWidth') || 85;
    this.containerWidthSlider.value = savedWidth;
    this.containerWidthValue.textContent = savedWidth;
    this.updateContainerWidth(savedWidth);
    this.containerWidthSlider.addEventListener('input', (e) => {
      const width = e.target.value;
      this.containerWidthValue.textContent = width;
      this.updateContainerWidth(width);
    });
    this.containerWidthSlider.addEventListener('mouseup', () => {
      FavsHubSettings.set('bookmarkContainerWidth', this.containerWidthSlider.value);
    });
  }

  // 更新书签容器宽度的方法
  updateContainerWidth(widthPercent) {
    const bookmarksContainer = document.querySelector('.bookmarks-container');
    if (bookmarksContainer) {
      bookmarksContainer.style.width = `${widthPercent}%`;
    }
  }

  initLayoutSettings() {
    this.showSearchBoxCheckbox = document.getElementById('show-search-box');
    this.showWelcomeMessageCheckbox = document.getElementById('show-welcome-message');
    this.showFooterCheckbox = document.getElementById('show-footer');

    this.showSearchBoxCheckbox.checked = FavsHubSettings.get('showSearchBox') !== false;
    this.showWelcomeMessageCheckbox.checked = FavsHubSettings.get('showWelcomeMessage') !== false;
    this.showFooterCheckbox.checked = FavsHubSettings.get('showFooter') !== false;
    const searchContainer = document.querySelector('.search-container');
    if (searchContainer) searchContainer.style.display = this.showSearchBoxCheckbox.checked ? '' : 'none';

    this.showSearchBoxCheckbox.addEventListener('change', () => {
      const isVisible = this.showSearchBoxCheckbox.checked;
      FavsHubSettings.set('showSearchBox', isVisible);
      const searchContainer = document.querySelector('.search-container');
      if (searchContainer) searchContainer.style.display = isVisible ? '' : 'none';
      if (window.WelcomeManager) window.WelcomeManager.updateWelcomeMessage();
    });
    this.showWelcomeMessageCheckbox.addEventListener('change', () => {
      const isVisible = this.showWelcomeMessageCheckbox.checked;
      FavsHubSettings.set('showWelcomeMessage', isVisible);
      const welcomeMessage = document.getElementById('welcome-message');
      if (welcomeMessage) welcomeMessage.style.display = isVisible ? '' : 'none';
    });
    this.showFooterCheckbox.addEventListener('change', () => {
      const isVisible = this.showFooterCheckbox.checked;
      FavsHubSettings.set('showFooter', isVisible);
      const footer = document.querySelector('footer');
      if (footer) footer.style.display = isVisible ? '' : 'none';
    });
  }

  // 辅助方法：切换元素可见性
  toggleElementVisibility(selector, isVisible) {
    const element = document.querySelector(selector);
    if (element) {
      element.style.display = isVisible ? '' : 'none';
      
      // 特殊处理 links-icons 容器
      if (selector.includes('link')) {
        const linksContainer = document.querySelector('.links-icons');
        if (linksContainer) {
          // 检查是否所有链接都被隐藏
          const visibleLinks = Array.from(linksContainer.querySelectorAll('a')).filter(
            link => link.style.display !== 'none'
          ).length;
          
          linksContainer.style.display = visibleLinks === 0 ? 'none' : '';
        }
      }
    }
  }

  initSearchSuggestionsSettings() {
    this.showHistorySuggestionsCheckbox = document.getElementById('show-history-suggestions');
    this.showBookmarkSuggestionsCheckbox = document.getElementById('show-bookmark-suggestions');
    this.showPromptSuggestionsCheckbox = document.getElementById('show-prompt-suggestions');
    this.openSearchInNewTabCheckbox = document.getElementById('open-search-in-new-tab');

    this.showHistorySuggestionsCheckbox.checked = FavsHubSettings.get('showHistorySuggestions') !== false;
    this.showBookmarkSuggestionsCheckbox.checked = FavsHubSettings.get('showBookmarkSuggestions') !== false;
    this.showPromptSuggestionsCheckbox.checked = FavsHubSettings.get('showPromptSuggestions') !== false;
    this.openSearchInNewTabCheckbox.checked = FavsHubSettings.get('openSearchInNewTab') !== false;

    this.showHistorySuggestionsCheckbox.addEventListener('change', () => FavsHubSettings.set('showHistorySuggestions', this.showHistorySuggestionsCheckbox.checked));
    this.showBookmarkSuggestionsCheckbox.addEventListener('change', () => FavsHubSettings.set('showBookmarkSuggestions', this.showBookmarkSuggestionsCheckbox.checked));
    this.showPromptSuggestionsCheckbox.addEventListener('change', () => FavsHubSettings.set('showPromptSuggestions', this.showPromptSuggestionsCheckbox.checked));
    this.openSearchInNewTabCheckbox.addEventListener('change', () => FavsHubSettings.set('openSearchInNewTab', this.openSearchInNewTabCheckbox.checked));
  }

  async initBackupSettings() {
    const selectFolderBtn = document.getElementById('select-backup-folder');
    const folderNameEl = document.getElementById('backup-folder-name');
    const autoBackupCheckbox = document.getElementById('enable-auto-backup');
    const manualBackupBtn = document.getElementById('manual-backup-btn');
    const lastBackupTimeEl = document.getElementById('last-backup-time');

    if (!selectFolderBtn) return;

    try {
      // 加载已保存的文件夹名称
      const savedName = await backupManager.getFolderName();
      console.log('[Settings] 加载备份文件夹名称:', savedName);
      if (savedName && folderNameEl) {
        folderNameEl.textContent = savedName;
      }

      // 加载自动备份开关状态
      const autoEnabled = await backupManager.getAutoBackupEnabled();
      if (autoBackupCheckbox) {
        autoBackupCheckbox.checked = autoEnabled;
        autoBackupCheckbox.addEventListener('change', async () => {
          await backupManager.setAutoBackupEnabled(autoBackupCheckbox.checked);
        });
      }

      // 加载上次备份时间
      const lastTime = await backupManager.getLastBackupTimeFormatted();
      console.log('[Settings] 加载上次备份时间:', lastTime);
      if (lastTime && lastBackupTimeEl) {
        lastBackupTimeEl.textContent = `上次备份：${lastTime}`;
      }
    } catch (err) {
      console.error('[Settings] 加载备份配置失败:', err);
    }

    // 选择文件夹按钮
    selectFolderBtn.addEventListener('click', async () => {
      try {
        const name = await backupManager.selectFolder();
        if (name && folderNameEl) {
          folderNameEl.textContent = name;
          this._showToast(`已选择：${name}`);
        }
      } catch (err) {
        console.error('[Settings] 选择文件夹失败:', err);
        this._showToast('选择文件夹失败');
      }
    });

    // 手动备份按钮
    if (manualBackupBtn) {
      manualBackupBtn.addEventListener('click', async () => {
        try {
          manualBackupBtn.disabled = true;
          manualBackupBtn.textContent = '备份中...';
          const filename = await backupManager.performBackup();
          const newTime = await backupManager.getLastBackupTimeFormatted();
          console.log('[Settings] 备份完成，更新时间显示:', newTime);
          if (lastBackupTimeEl && newTime) {
            lastBackupTimeEl.textContent = `上次备份：${newTime}`;
          }
          this._showToast(`备份成功：${filename}`);
          await this.renderBackupHistory();
        } catch (err) {
          if (err.message === 'NO_CHANGE') {
            this._showToast('数据无变化，不需新增记录文件');
          } else if (err.message === 'NO_FOLDER') {
            this._showToast('请先选择备份文件夹');
          } else if (err.message === 'NO_PERMISSION') {
            this._showToast('没有文件夹写入权限，请重新选择');
          } else {
            console.error('[Settings] 备份失败:', err);
            this._showToast(`备份失败：${err.message || '请重试'}`);
          }
        } finally {
          manualBackupBtn.disabled = false;
          manualBackupBtn.textContent = '立即备份';
        }
      });
    }

    // 加载备份记录
    await this.renderBackupHistory();

    // 页面加载时检查自动备份
    try {
      const filename = await backupManager.checkAndAutoBackup();
      if (filename) {
        this._showToast(`自动备份完成：${filename}`);
        const time = await backupManager.getLastBackupTimeFormatted();
        if (time && lastBackupTimeEl) {
          lastBackupTimeEl.textContent = `上次备份：${time}`;
        }
        await this.renderBackupHistory();
      }
    } catch (err) {
      console.warn('[Settings] 自动备份检查失败:', err);
    }

    // 百度网盘云端备份（通过全局 window.baiduPanSettingsManager 访问）
    try {
      if (window.baiduPanSettingsManager && window.baiduPanSettingsManager.init) {
        await window.baiduPanSettingsManager.init();
      }
    } catch (err) {
      console.warn('[Settings] 百度网盘备份模块加载失败:', err);
    }
  }

  async renderBackupHistory() {
    const container = document.getElementById('backup-history-list');
    if (!container) return;

    const records = await backupManager.getBackupHistory();

    if (records.length === 0) {
      container.innerHTML = '<p style="color: var(--text-secondary, #888); font-size: 13px;">暂无备份记录</p>';
      return;
    }

    container.innerHTML = records.map((record, index) => `
      <div class="backup-record-item" style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--border-color, #eee); font-size: 13px;">
        <div style="flex: 1; min-width: 0;">
          <div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text-primary, #333);" title="${record.filename}">${record.filename}</div>
          <div style="color: var(--text-secondary, #888); font-size: 12px; margin-top: 2px;">${record.timeFormatted}</div>
        </div>
        <button class="backup-delete-btn" data-index="${index}" title="删除记录" style="background: none; border: none; cursor: pointer; color: var(--text-secondary, #999); padding: 4px 8px; font-size: 16px; flex-shrink: 0;">&#x2716;</button>
      </div>
    `).join('');

    // 绑定删除事件
    container.querySelectorAll('.backup-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const index = parseInt(btn.getAttribute('data-index'), 10);
        await backupManager.deleteBackupRecord(index);
        await this.renderBackupHistory();
        this._showToast('已删除备份记录');
      });
    });
  }

  _showToast(message) {
    const toast = document.getElementById('toast');
    if (toast) {
      toast.textContent = message;
      toast.style.display = 'block';
      setTimeout(() => { toast.style.display = 'none'; }, 3000);
    }
  }

  initShortcutsSettings() {
    const shortcutItem = document.getElementById('configure-shortcuts');
    if (shortcutItem) {
      shortcutItem.addEventListener('click', () => {
        chrome.tabs.create({
          url: 'chrome://extensions/shortcuts'
        });
      });
    }
  }
}

// 导出设置管理器实例
window.settingsManager = new SettingsManager();