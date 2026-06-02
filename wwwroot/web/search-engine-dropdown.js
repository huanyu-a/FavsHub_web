// 导入所需的依赖
// ICONS 和 getIconHtml 已通过 icons.js 全局加载

// 预定义的所有可用搜索引擎列表
const ALL_ENGINES = [
  { name: 'google', icon: '/images/google-logo.svg', label: 'googleLabel', url: 'https://www.google.com/search?q=', aliases: ['谷歌'] },
  { name: 'bing', icon: '/images/bing-logo.png', label: 'bingLabel', url: 'https://www.bing.com/search?q=' },
  { name: 'baidu', icon: '/images/baidu-logo.svg', label: 'baiduLabel', url: 'https://www.baidu.com/s?wd=', aliases: ['百度'] },
  { name: 'baidu_m', icon: '/images/baidu-logo.svg', label: 'baidumLabel', url: 'https://m.baidu.com/s?wd=', aliases: ['百度移动'] },
  { name: 'toutiao', icon: '/images/toutiao-logo.png', label: 'toutiaoLabel', url: 'https://so.toutiao.com/search?dvpf=pc&keyword=', aliases: ['头条'] },
  { name: 'sougou', icon: '/images/sougou-logo.png', label: 'sougouLabel', url: 'https://www.sogou.com/web?query=', aliases: ['搜狗'] },
  { name: '360', icon: '/images/360-logo.png', label: '360Label', url: 'https://www.so.com/s?q=', aliases: ['360'] },
  { name: 'shenma', icon: '/images/shenma-logo.png', label: 'shenmaLabel', url: 'https://yz.m.sm.cn/s?q=', aliases: ['神马'] },
//  { name: 'kimi', icon: '/images/kimi-logo.svg', label: 'kimiLabel', url: 'https://kimi.moonshot.cn/?q=', aliases: ['Kimi'] },
//  { name: 'doubao', icon: '/images/doubao-logo.png', label: 'doubaoLabel', url: 'https://www.doubao.com/?q=', aliases: ['豆包'] },
  { name: 'zhida', icon: '/images/zhida-logo.png', label: 'zhidaLabel', url: 'https://zhida.zhihu.com/search?q=', aliases: ['知乎直答'] },
  { name: 'qwen', icon: '/images/qwen-logo.png', label: 'qwenLabel', url: 'https://www.qianwen.com/chat/?q=', aliases: ['千问'] },
  { name: 'iflow', icon: '/images/iflow-logo.png', label: 'iflowLabel', url: 'https://iflow.cn/answers/', aliases: ['心流'] },
  { name: 'chatgpt', icon: '/images/chatgpt-logo.svg', label: 'chatgptLabel', url: 'https://chat.openai.com/?q=', aliases: ['ChatGPT'] },
  { name: 'felo', icon: '/images/felo-logo.svg', label: 'feloLabel', url: 'https://felo.ai/search?q=', aliases: ['Felo'] },
  { name: 'metaso', icon: '/images/metaso-logo.png', label: 'metasoLabel', url: 'https://metaso.cn/?q=', aliases: ['Metaso'] },
  { name: 'perplexity', icon: '/images/perplexity-logo.svg', label: 'perplexityLabel', url: 'https://www.perplexity.ai/?q=', aliases: ['Perplexity'] },
  { name: 'semanticscholar', icon: '/images/semanticscholar-logo.png', label: 'semanticscholarLabel', url: 'https://www.semanticscholar.org/search?q=', aliases: ['Semantic Scholar'] },
//  { name: 'deepseek', icon: '/images/deepseek-logo.svg', label: 'deepseekLabel', url: 'https://chat.deepseek.com/?q=', aliases: ['DeepSeek'] },
  { name: 'grok', icon: '/images/grok-logo.svg', label: 'grokLabel', url: 'https://grok.com/?q=', aliases: ['Grok'] },
  { name: 'yahoo', icon: '/images/yahoo-logo.svg', label: 'yahooLabel', url: 'https://search.yahoo.com/search?p=', aliases: ['雅虎'] },
  { name: 'duckduckgo', icon: '/images/duckduckgo-logo.svg', label: 'duckduckgoLabel', url: 'https://duckduckgo.com/?q=', aliases: ['DuckDuckGo'] },
  { name: 'yandex', icon: '/images/yandex-logo.svg', label: 'yandexLabel', url: 'https://yandex.com/search/?text=', aliases: ['Yandex'] },
  { name: 'xiaohongshu', icon: '/images/xiaohongshu-logo.svg', label: 'xiaohongshuLabel', url: 'https://www.xiaohongshu.com/search_result?keyword=', aliases: ['小红书'] },
  { name: 'jike', icon: '/images/jike-logo.svg', label: 'jikeLabel', url: 'https://web.okjike.com/search?keyword=', aliases: ['即刻'] },
  { name: 'zhihu', icon: '/images/zhihu-logo.svg', label: 'zhihuLabel', url: 'https://www.zhihu.com/search?q=', aliases: ['知乎'] },
  { name: 'douban', icon: '/images/douban-logo.svg', label: 'doubanLabel', url: 'https://www.douban.com/search?q=', aliases: ['豆瓣'] },
  { name: 'bilibili', icon: '/images/bilibili-logo.svg', label: 'bilibiliLabel', url: 'https://search.bilibili.com/all?keyword=', aliases: ['Bilibili'] },
  { name: 'github', icon: '/images/github-logo.svg', label: 'githubLabel', url: 'https://github.com/search?q=', aliases: ['GitHub'] }
];

// 定义搜索引擎分类
const ENGINE_CATEGORIES = {
  AI: ['kimi', 'doubao', 'zhida', 'qwen', 'iflow', 'chatgpt', 'perplexity', 'claude', 'felo', 'metaso', 'semanticscholar', 'deepseek', 'grok'],
  SEARCH: ['baidu', 'google', 'bing', 'baidu_m', 'toutiao', 'sougou', '360', 'shenma', 'duckduckgo', 'yahoo', 'yandex'],
  SOCIAL: ['xiaohongshu', 'jike', 'zhihu', 'douban', 'bilibili', 'github']
};

// 服务端搜索引擎缓存
let _serverEngines = null;
let _serverEnginesPromise = null;

async function loadServerEngines() {
  if (_serverEngines) return _serverEngines;
  if (_serverEnginesPromise) return _serverEnginesPromise;
  _serverEnginesPromise = (async () => {
    try {
      const res = await fetch('/api/search-engines');
      if (res.ok) {
        const data = await res.json();
        _serverEngines = (data.engines || []).map(e => ({
          name: e.name,
          icon: e.icon || '/images/default-engine-logo.svg',
          label: e.label || e.name,
          url: e.url,
          category: e.category,
          is_default: !!e.is_default
        }));
      }
    } catch (e) {
      console.warn('[SearchEngine] 加载服务端引擎失败:', e);
      _serverEngines = [];
    }
    return _serverEngines || [];
  })();
  return _serverEnginesPromise;
}

// 存储管理相关函数
const SearchEngineManager = {
  getEnabledEngines() {
    const stored = FavsHubSettings.get('enabledSearchEngines');
    if (stored && stored.length) return stored;
    const defaultEngines = ALL_ENGINES.slice(0, 8);
    this.saveEnabledEngines(defaultEngines);
    return defaultEngines;
  },

  saveEnabledEngines(engines) {
    FavsHubSettings.set('enabledSearchEngines', engines);
  },

  // 获取所有可用的搜索引擎列表
  getAllEngines() {
    // 合并服务端和预定义搜索引擎
    const server = _serverEngines || [];
    // 服务端引擎优先，本地引擎作为补充
    const serverNames = new Set(server.map(e => e.name));
    const localOnly = ALL_ENGINES.filter(e => !serverNames.has(e.name));
    return [...server, ...localOnly];
  },

  // 添加搜索引擎到启用列表
  addEngine(engineName) {
    const enabled = this.getEnabledEngines();
    const engine = this.getAllEngines().find(e => e.name === engineName);
    if (engine && !enabled.find(e => e.name === engineName)) {
      enabled.push(engine);
      this.saveEnabledEngines(enabled);
      return true;
    }
    return false;
  },

  // 从启用列表中移除搜索引擎
  removeEngine(engineName) {
    const enabled = this.getEnabledEngines();
    const filtered = enabled.filter(e => e.name !== engineName);
    if (filtered.length < enabled.length) {
      this.saveEnabledEngines(filtered);
      return true;
    }
    return false;
  },

  // 获取默认搜索引擎
  getDefaultEngine() {
    const defaultEngineName = FavsHubSettings.get('selectedSearchEngine');
    if (defaultEngineName) {
      const engine = this.getAllEngines().find(e => e.name === defaultEngineName);
      if (engine) return engine;
    }
    return ALL_ENGINES[0];
  },

  setDefaultEngine(engineName) {
    FavsHubSettings.set('selectedSearchEngine', engineName);
    const engine = ALL_ENGINES.find(e => e.name === engineName);

    if (engine) {
      FavsHubSettings.set('selectedSearchEngine', engineName);
      return true;
    }
    console.error('[Search] Engine not found:', engineName);
    return false;
  }
};

// 创建搜索引擎选项
function createSearchEngineOption(engine, isAddButton = false) {
  const option = document.createElement('div');
  option.className = 'search-engine-option';

  if (isAddButton) {
    option.innerHTML = `
      <div class="search-engine-option-content add-engine">
        ${getIconHtml('add_circle')}
        <span class="search-engine-option-label">${getLocalizedMessage('addSearchEngine')}</span>
      </div>
    `;
    option.addEventListener('click', () => {
      showSearchEnginesDialog();
    });
  } else {
    option.innerHTML = `
      <div class="search-engine-option-content">
        <img src="${engine.icon}" alt="${getLocalizedMessage(engine.label)}" class="search-engine-option-icon">
        <span class="search-engine-option-label">${getLocalizedMessage(engine.label)}</span>
      </div>
    `;
    option.onclick = () => handleSearchEngineSelection(engine);
  }

  return option;
}

// 处理搜索引擎选择
function handleSearchEngineSelection(engine) {
  // 关闭下拉菜单
  const dropdownContainer = document.querySelector('.search-engine-dropdown');
  if (dropdownContainer) {
    dropdownContainer.style.display = 'none';
  }

  // 使用 SearchEngineManager 设置默认搜索引擎
  if (SearchEngineManager.setDefaultEngine(engine.name)) {
    // 更新搜索引擎图标
    updateSearchEngineIcon(engine);

    // 更新标签栏状态
    updateTabsState(engine.name);

    // 立即更新搜索表单中的默认搜索引擎
    const searchForm = document.querySelector('.search-form');
    if (searchForm) {
      searchForm.setAttribute('data-current-engine', engine.name);
    }

    // 触发自定义事件
    const event = new CustomEvent('defaultSearchEngineChanged', {
      detail: { engine: engine }
    });
    document.dispatchEvent(event);
  } else {
    console.error('[Search] Failed to set default engine:', engine);
  }
}

// 更新标签栏状态
function updateTabsState(engineName) {
  const defaultEngine = engineName.toLowerCase();
  const tabs = document.querySelectorAll('.tab');

  // 先移除所有 active 类
  tabs.forEach(tab => tab.classList.remove('active'));

  // 尝试找到对应的标签并添加 active 类
  const matchingTab = Array.from(tabs).find(tab => {
    const tabEngine = tab.getAttribute('data-engine').toLowerCase();
    return tabEngine === defaultEngine;
  });

  if (matchingTab) {
    matchingTab.classList.add('active');
  }
  // 如果是自定义引擎，可能没有对应的标签，这是正常的
}

// 修改初始化函数
function initializeSearchEngine() {
  // 确保 DOM 已经加载完成
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initializeSearchEngineUI();
    });
  } else {
    initializeSearchEngineUI();
  }
}

// 新增 UI 初始化函数
function initializeSearchEngineUI() {
  const defaultEngine = SearchEngineManager.getDefaultEngine();

  if (defaultEngine) {
    // 确保搜索表单和图标元素存在
    const searchForm = document.querySelector('.search-form');
    const searchEngineIcon = document.getElementById('search-engine-icon');

    if (searchForm && searchEngineIcon) {
      // 更新搜索引擎图标
      updateSearchEngineIcon(defaultEngine);

      // 更新标签栏状态
      updateTabsState(defaultEngine.name);

      // 更新搜索表单中的默认搜索引擎
      searchForm.setAttribute('data-current-engine', defaultEngine.name);

      // 确保图标正确加载
      if (searchEngineIcon.src !== defaultEngine.icon) {
        searchEngineIcon.src = defaultEngine.icon;
        searchEngineIcon.alt = `${getLocalizedMessage(defaultEngine.label)} Search`;
      }
    } else {
      console.error('[Search] Required DOM elements not found');
    }
  }
}

// 添加 getSearchUrl 函数
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

// 修改 createTemporarySearchTabs 函数中的点击事件处理
function createTemporarySearchTabs() {
  const tabsContainer = document.getElementById('tabs-container');
  if (!tabsContainer) return;

  // 保留搜索提示文本
  const searchTips = tabsContainer.querySelector('.search-tips');
  tabsContainer.innerHTML = '';
  if (searchTips) {
    tabsContainer.appendChild(searchTips);
  }

  // 获取启用的搜索引擎
  const enabledEngines = SearchEngineManager.getEnabledEngines();
  const defaultEngine = SearchEngineManager.getDefaultEngine();

  // 为每个启用的搜索引擎创建标签
  enabledEngines.forEach(engine => {
    const tab = document.createElement('div');
    tab.className = 'tab';
    tab.setAttribute('data-engine', engine.name);

    if (engine.name === defaultEngine.name) {
      tab.classList.add('active');
    }

    if (engine.label) {
      const label = getLocalizedMessage(engine.label) || engine.name;
      tab.textContent = label;
    } else {
      tab.textContent = engine.name;
    }

    tab.addEventListener('click', function() {
      const searchInput = document.querySelector('.search-input');
      const searchQuery = searchInput.value.trim();

      if (searchQuery) {
        // 移除所有标签的激活状态
        tabsContainer.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        // 为当前点击的标签添加激活状态
        this.classList.add('active');

        // 执行搜索
        const searchUrl = getSearchUrl(engine.name, searchQuery);
        if (FavsHubSettings.get('openSearchInNewTab') !== false) {
          window.open(searchUrl, '_blank');
        } else {
          window.location.href = searchUrl;
        }

        // 隐藏搜索建议
        const searchSuggestions = document.querySelector('.search-suggestions-wrapper');
        if (searchSuggestions) {
          searchSuggestions.style.display = 'none';
        }

        // 延迟恢复默认搜索引擎状态
        setTimeout(() => {
          const defaultEngine = SearchEngineManager.getDefaultEngine();
          tabsContainer.querySelectorAll('.tab').forEach(t => {
            if (t.getAttribute('data-engine') === defaultEngine.name) {
              t.classList.add('active');
            } else {
              t.classList.remove('active');
            }
          });
        }, 300);
      }
    });

    tabsContainer.appendChild(tab);
  });
}

// 修改 createSearchEngineDropdown 函数，添加对临时搜索标签的更新
function createSearchEngineDropdown() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initializeSearchEngine();
      createDropdownUI();
      createTemporarySearchTabs();
    });
  } else {
    initializeSearchEngine();
    createDropdownUI();
    createTemporarySearchTabs();
  }
}

// 新增下拉菜单 UI 创建函数
function createDropdownUI() {
  // 将原来 createSearchEngineDropdown 中的 UI 创建代码移到这里
  const existingDropdown = document.querySelector('.search-engine-dropdown');
  if (existingDropdown) {
    existingDropdown.remove();
  }

  const searchForm = document.querySelector('.search-form');
  const iconContainer = document.querySelector('.search-icon-container');
  const dropdownContainer = document.createElement('div');
  dropdownContainer.className = 'search-engine-dropdown';
  dropdownContainer.style.display = 'none';

  // 创建选项容器
  const optionsContainer = document.createElement('div');
  optionsContainer.className = 'search-engine-options-container';

  // 获取启用的搜索引擎列表
  const enabledEngines = SearchEngineManager.getEnabledEngines();

  // 添加启用的搜索引擎选项
  enabledEngines.forEach(engine => {
    const option = createSearchEngineOption(engine);
    optionsContainer.appendChild(option);
  });

  // 添加管理引擎按钮
  const addButton = createSearchEngineOption(null, true);
  optionsContainer.appendChild(addButton);

  // 添加事件监听器
  iconContainer.addEventListener('click', (e) => {
    e.stopPropagation();
    const isVisible = dropdownContainer.style.display === 'block';
    dropdownContainer.style.display = isVisible ? 'none' : 'block';
  });

  // 点击其他区域时关闭下拉菜单
  document.addEventListener('click', () => {
    dropdownContainer.style.display = 'none';
  });

  dropdownContainer.appendChild(optionsContainer);
  searchForm.appendChild(dropdownContainer);
}

// 添加显示搜索引擎对话框的函数
async function showSearchEnginesDialog() {
  const dialog = document.getElementById('search-engines-dialog');
  if (!dialog) return;

  // 显示对话框框架（内容异步加载）
  dialog.style.display = 'block';

  // 从服务端加载搜索引擎列表
  await createSearchEnginesList();

  // 添加关闭按钮事件
  const closeButton = dialog.querySelector('.close-button');
  if (closeButton) {
    closeButton.onclick = () => {
      dialog.style.display = 'none';
      // 关闭对话框时也更新下拉菜单
      createSearchEngineDropdown();
    };
  }

  // 点击对话框外部关闭
  dialog.onclick = (e) => {
    if (e.target === dialog) {
      dialog.style.display = 'none';
      // 关闭对话框时也更新下拉菜单
      createSearchEngineDropdown();
    }
  };

  // 阻止对话框内容区域的点击事件冒泡
  const modalContent = dialog.querySelector('.modal-content');
  if (modalContent) {
    modalContent.addEventListener('click', (e) => {
      e.stopPropagation();
    });
  }
}

// 修改创建搜索引擎列表函数
async function createSearchEnginesList() {
  const aiContainer = document.getElementById('ai-search-engines');
  const searchContainer = document.getElementById('search-engines');
  const socialContainer = document.getElementById('social-media-engines');

  if (!aiContainer || !searchContainer || !socialContainer) return;

  // 清空所有容器的现有内容
  aiContainer.innerHTML = '';
  searchContainer.innerHTML = '';
  socialContainer.innerHTML = '';

  // 获取已启用的搜索引擎
  const enabledEngines = SearchEngineManager.getEnabledEngines();
  const enabledEngineNames = enabledEngines.map(e => e.name);

  // 从服务端加载引擎列表（loadServerEngines 已内置缓存）
  const serverEngines = await loadServerEngines();

  // 确定数据源：服务端优先，本地 ALL_ENGINES 作为后备
  let engineDataSource;
  if (serverEngines.length > 0) {
    engineDataSource = serverEngines;
  } else {
    engineDataSource = ALL_ENGINES.map(e => {
      let category = 'SEARCH';
      for (const [cat, names] of Object.entries(ENGINE_CATEGORIES)) {
        if (names.includes(e.name)) { category = cat; break; }
      }
      return { ...e, category };
    });
  }

  // 修改创建搜索引擎项目的函数
  const createEngineItem = (engine) => {
    const engineItem = document.createElement('div');
    engineItem.className = 'search-engine-item';

    const checkboxContainer = document.createElement('label');
    checkboxContainer.className = 'custom-checkbox';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = enabledEngineNames.includes(engine.name);

    const checkmark = document.createElement('span');
    checkmark.className = 'checkmark';

    checkboxContainer.appendChild(checkbox);
    checkboxContainer.appendChild(checkmark);

    const engineInfo = document.createElement('div');
    engineInfo.className = 'search-engine-info';

    const engineIcon = document.createElement('img');
    engineIcon.src = engine.icon;
    engineIcon.alt = getLocalizedMessage(engine.label);
    engineIcon.className = 'search-engine-icon';

    const engineName = document.createElement('span');
    engineName.className = 'search-engine-name';
    engineName.textContent = getLocalizedMessage(engine.label);

    engineInfo.appendChild(engineIcon);
    engineInfo.appendChild(engineName);

    engineItem.appendChild(checkboxContainer);
    engineItem.appendChild(engineInfo);

    // 简化事件处理逻辑
    const toggleEngine = (e) => {
      // 获取实际的复选框元素
      const checkbox = e.currentTarget.querySelector('input[type="checkbox"]');

      // 排除复选框本身的点击
      if (e.target === checkbox) {
        return;
      }

      // 切换复选框状态
      checkbox.checked = !checkbox.checked;

      // 触发change事件以同步状态
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));

      // 更新样式和状态
      e.currentTarget.classList.toggle('selected', checkbox.checked);
      handleEngineToggle(engine, checkbox.checked);
    };

    // 为整个项目添加点击事件
    engineItem.addEventListener('click', toggleEngine);

    // 移除复选框的点击事件阻止
    checkbox.addEventListener('change', (e) => {
      // 直接更新状态
      engineItem.classList.toggle('selected', e.target.checked);
      handleEngineToggle(engine, e.target.checked);
    });

    return engineItem;
  };

  // 按 category 分组填充到对应容器
  const categoryContainers = { AI: aiContainer, SEARCH: searchContainer, SOCIAL: socialContainer };
  engineDataSource.forEach(engine => {
    const container = categoryContainers[engine.category];
    if (container) {
      container.appendChild(createEngineItem(engine));
    }
  });
}

// 处理搜索引擎启用/禁用
function handleEngineToggle(engine, enabled) {
  if (enabled) {
    SearchEngineManager.addEngine(engine.name);
  } else {
    SearchEngineManager.removeEngine(engine.name);
  }
  // 更新下拉菜单和临时搜索标签
  createSearchEngineDropdown();
  createTemporarySearchTabs();
}







// 创建新的初始化函数
function initializeSearchEngineDialog() {
  const dialog = document.getElementById('search-engines-dialog');
  if (dialog) {
    const closeButton = dialog.querySelector('.close-button');
    if (closeButton) {
      closeButton.addEventListener('click', () => {
        dialog.style.display = 'none';
      });
    }

    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) {
        dialog.style.display = 'none';
      }
    });

    const modalContent = dialog.querySelector('.modal-content');
    if (modalContent) {
      modalContent.addEventListener('click', (e) => {
        e.stopPropagation();
      });
    }
  }
}

// 修改 updateSearchEngineIcon 函数
function updateSearchEngineIcon(engine) {
  if (typeof engine === 'string') {
    setSearchEngineIcon(engine);
  } else if (engine && engine.name) {
    setSearchEngineIcon(engine.name);
  }
}

// 添加 setSearchEngineIcon 函数
function setSearchEngineIcon(engineName) {
  const searchEngineIcon = document.getElementById('search-engine-icon');
  if (!searchEngineIcon) return;

  const allEngines = SearchEngineManager.getAllEngines();
  const engine = allEngines.find(e => e.name === engineName);

  if (engine) {
    searchEngineIcon.src = engine.icon;
    searchEngineIcon.alt = `${getLocalizedMessage(engine.label)} Search`;
  } else {
    // 使用默认图标
    searchEngineIcon.src = '/images/placeholder-icon.svg';
    searchEngineIcon.alt = 'Search';
  }
}

// Add this function if it doesn't exist
function getSearchEngineIconPath(engineName) {
  const allEngines = SearchEngineManager.getAllEngines();
  const engine = allEngines.find(e => e.name === engineName);
  return engine ? engine.icon : '/images/placeholder-icon.svg';
}

// 暴露到全局
window.SearchEngineManager = SearchEngineManager;
window.updateSearchEngineIcon = updateSearchEngineIcon;
window.setSearchEngineIcon = setSearchEngineIcon;
window.createSearchEngineDropdown = createSearchEngineDropdown;
window.initializeSearchEngineDialog = initializeSearchEngineDialog;
window.getSearchUrl = getSearchUrl;
window.createTemporarySearchTabs = createTemporarySearchTabs;
window.getSearchEngineIconPath = getSearchEngineIconPath;
window.loadServerEngines = loadServerEngines;

// 自动初始化：等待设置加载完成后再创建 UI
(async function autoInit() {
  await FavsHubSettings.load();
  createSearchEngineDropdown();
  initializeSearchEngineDialog();
})();
