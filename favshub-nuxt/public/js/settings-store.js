/**
 * FavsHub 全局设置存储
 *
 * set/setMany 更新内存缓存并通过 debounced fetch 同步到后端持久化。
 * 搜索引擎用户偏好（启用列表、默认引擎、自定义引擎）仍通过缓存管理。
 */
const FavsHubSettings = (() => {
  const DEFAULTS = {
    // 主题
    theme: 'auto',
    // 悬浮球
    enableFloatingBall: false,
    // 链接打开方式
    openInNewTab: true,
    // 侧边栏链接打开方式
    sidepanelOpenInNewTab: false,
    sidepanelOpenInSidepanel: true,
    // 书签卡片尺寸
    bookmarkWidth: 200,
    bookmarkCardHeight: 50,
    bookmarkContainerWidth: 85,
    // 布局开关
    showSearchBox: true,
    showWelcomeMessage: true,
    showFooter: true,
    // 搜索建议开关
    showSearchSuggestions: true,
    showHistorySuggestions: true,
    showBookmarkSuggestions: true,
    showPromptSuggestions: true,
    openSearchInNewTab: true,
    // 快捷访问链接
    showHistoryLink: true,
    showDownloadsLink: true,
    showPasswordsLink: true,
    showExtensionsLink: true,
    // 搜索引擎偏好
    enabledSearchEngines: [],
    selectedSearchEngine: '',
    customSearchEngines: [],
    // 背景
    selectedBackground: '',
    solidBackground: '',
    useDefaultBackground: '',
  };

  // 内存缓存，页面生命周期内有效
  let _cache = { ...DEFAULTS };
  let _loaded = false;
  let _loadFailed = false;
  let _loadPromise = null;

  // Debounced 后端持久化
  let _persistTimer = null;
  const DEBOUNCE_MS = 300;

  function _schedulePersist() {
    if (_persistTimer) clearTimeout(_persistTimer);
    _persistTimer = setTimeout(() => {
      _persistTimer = null;
      _persistToBackend();
    }, DEBOUNCE_MS);
  }

  async function _persistToBackend() {
    try {
      // 游客不持久化设置
      if (!window.api || !window.api.isLoggedIn()) return;
      if (typeof window.api.updateSettings === 'function') {
        await window.api.updateSettings(_cache);
      }
    } catch (e) {
    }
  }

  /**
   * 从后端加载设置到缓存。页面启动时自动调用一次。
   * 如果上次加载失败，允许重试。
   */
  async function load() {
    if (_loaded && !_loadFailed) return _cache;
    if (_loadPromise) return _loadPromise;

    _loadPromise = (async () => {
      try {
        const data = await window.api.getSettings();
        if (data && data.data && typeof data.data === 'object') {
          _cache = { ...DEFAULTS, ...data.data };
          // 管理员后台用 solidBackground 作为系统默认背景，前端统一使用 selectedBackground
          if (!_cache.selectedBackground && _cache.solidBackground) {
            _cache.selectedBackground = _cache.solidBackground;
          }
          
          _loadFailed = false;
        } else {
          
          _loadFailed = true;
        }
      } catch (e) {
        
        _loadFailed = true;
      }
      _loaded = true;
      return _cache;
    })();
    return _loadPromise;
  }

  /**
   * 强制重新从后端加载设置（清除缓存）
   */
  async function reload() {
    _loaded = false;
    _loadFailed = false;
    _loadPromise = null;
    return load();
  }

  /**
   * 读取单个设置项
   */
  function get(key) {
    return _cache[key] !== undefined ? _cache[key] : DEFAULTS[key];
  }

  /**
   * 写入单个设置项（更新内存缓存，debounced 写入后端）
   */
  function set(key, value) {
    _cache[key] = value;
    _schedulePersist();
  }

  /**
   * 批量写入多个设置项（更新内存缓存，debounced 写入后端）
   */
  function setMany(obj) {
    Object.assign(_cache, obj);
    _schedulePersist();
  }

  /**
   * 获取所有设置（只读副本）
   */
  function getAll() {
    return { ..._cache };
  }

  /**
   * 检查设置是否已从后端加载
   */
  function isLoaded() {
    return _loaded;
  }

  return { load, reload, get, set, setMany, getAll, isLoaded, DEFAULTS };
})();

// 挂载到 window，供全局使用
window.FavsHubSettings = FavsHubSettings;

// 立即启动异步加载（静默，不阻塞页面渲染）
// 其他模块可 await FavsHubSettings.load() 等待加载完成
FavsHubSettings.load();
