/**
 * FavsHub 全局设置存储
 *
 * 所有用户设置统一通过 /api/settings 后端 API 读写，
 * 不再使用 chrome.storage.sync 或 localStorage 存储设置。
 *
 * 搜索引擎用户偏好（启用列表、默认引擎、自定义引擎）也存储在这里。
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
    bookmarkContainerWidth: 100,
    // 布局开关
    showSearchBox: true,
    showWelcomeMessage: true,
    showFooter: true,
    // 搜索建议开关
    showHistorySuggestions: true,
    showBookmarkSuggestions: true,
    showPromptSuggestions: true,
    openSearchInNewTab: true,
    // 搜索引擎偏好
    enabledSearchEngines: [],
    selectedSearchEngine: '',
    customSearchEngines: [],
    // 背景
    selectedBackground: '',
    useDefaultBackground: 'true',
  };

  // 内存缓存，页面生命周期内有效
  let _cache = { ...DEFAULTS };
  let _loaded = false;
  let _loadPromise = null;

  /**
   * 从后端加载设置到缓存。页面启动时自动调用一次。
   */
  async function load() {
    if (_loaded) return _cache;
    if (_loadPromise) return _loadPromise;

    _loadPromise = (async () => {
      try {
        const data = await window.api.getSettings();
        if (data && data.data) {
          _cache = { ...DEFAULTS, ...data.data };
        }
      } catch (e) {
        console.warn('[Settings] 加载设置失败，使用默认值:', e);
      }
      _loaded = true;
      return _cache;
    })();
    return _loadPromise;
  }

  /**
   * 读取单个设置项
   */
  function get(key) {
    return _cache[key] !== undefined ? _cache[key] : DEFAULTS[key];
  }

  /**
   * 写入单个设置项，立即更新缓存并异步保存到后端
   */
  async function set(key, value) {
    _cache[key] = value;
    try {
      await window.api.updateSettings({ [key]: value });
    } catch (e) {
      console.warn('[Settings] 保存设置失败:', key, e);
    }
  }

  /**
   * 批量写入多个设置项
   */
  async function setMany(obj) {
    Object.assign(_cache, obj);
    try {
      await window.api.updateSettings(obj);
    } catch (e) {
      console.warn('[Settings] 批量保存失败:', e);
    }
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

  return { load, get, set, setMany, getAll, isLoaded, DEFAULTS };
})();

// 挂载到 window，供全局使用
window.FavsHubSettings = FavsHubSettings;
