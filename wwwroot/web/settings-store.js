/**
 * FavsHub 全局设置存储（只读模式）
 *
 * 所有设置由管理员后台统一管理，前端仅读取系统默认设置。
 * set/setMany 仅更新内存缓存（运行时临时覆盖），不写入后端。
 *
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
    wallpaperUrl: '',
    useDefaultBackground: '',
  };

  // 内存缓存，页面生命周期内有效
  let _cache = { ...DEFAULTS };
  let _loaded = false;
  let _loadFailed = false;
  let _loadPromise = null;

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
          console.log('[Settings] 设置加载成功:', Object.keys(data.data).length, '项');
          _loadFailed = false;
        } else {
          console.warn('[Settings] API 返回格式异常:', data);
          _loadFailed = true;
        }
      } catch (e) {
        console.warn('[Settings] 加载设置失败，使用默认值:', e.message || e);
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
   * 写入单个设置项（仅更新内存缓存，不写入后端）
   */
  function set(key, value) {
    _cache[key] = value;
  }

  /**
   * 批量写入多个设置项（仅更新内存缓存，不写入后端）
   */
  function setMany(obj) {
    Object.assign(_cache, obj);
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
