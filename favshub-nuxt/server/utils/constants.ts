/**
 * 系统级配置字段名列表（仅管理员可写入 system_config 表）
 * 普通用户通过 /api/settings 写入时会被过滤掉这些字段
 */
export const SYSTEM_ONLY_KEYS = [
  // TDK
  'siteTitle', 'siteDescription', 'siteKeywords',
  'promptproTitle', 'promptproDescription', 'promptproKeywords',
  'collectionsTitle', 'collectionsDescription', 'collectionsKeywords',
  'title', 'description', 'keywords',
  // System
  'allow_registration',
  // Backup
  'backup_enabled', 'backup_hour', 'backup_minute', 'backup_keep_copies',
  // Favicon
  'favicon_source_url', 'favicon_size', 'favicon_download_timeout', 'favicon_max_redirects',
  // Auth / Security
  'jwt_token_expiry', 'cookie_max_age',
  'rate_limit_login_max', 'rate_limit_login_window',
  'rate_limit_register_max', 'rate_limit_register_window',
  'min_password_length', 'trust_proxy',
  // Data limits
  'max_bookmarks_per_sync', 'bookmarks_query_limit',
  // Analytics
  'baidu_tongji_id', 'baidu_tongji_domains',
]

/**
 * 所有系统配置的默认值（key → 字符串值，存入 system_config 表）
 */
export const SYSTEM_CONFIG_DEFAULTS: Record<string, string> = {
  // TDK
  siteTitle: 'FavsHub-网址导航与智能书签管理工作台',
  siteDescription: 'FavsHub 智能网址导航工作台，一站式管理浏览器书签、工具导航与AI提示词。精选集市场涵盖各行各业常用网址导航合集，支持浏览器扩展多端同步、聚合搜索与自定义导航页。',
  siteKeywords: '网址导航,导航网站,工具导航,书签管理,浏览器书签同步,智能导航页,AI提示词,网站导航,FavsHub',
  promptproTitle: 'PromptPro-AI提示词管理与分享平台',
  promptproDescription: 'PromptPro 提示词管理系统，集中管理、分类整理、版本控制与分享AI提示词。支持ChatGPT、Claude、DeepSeek等主流模型，标签化管理让提示词随取随用。',
  promptproKeywords: 'PromptPro,提示词管理,AI提示词,ChatGPT提示词,Claude提示词,提示词模板,提示词分类,提示词分享',
  collectionsTitle: '网址导航精选集',
  collectionsDescription: 'FavsHub 网址导航精选集 — 从 AI 工具到设计资源、从开发框架到效率神器，按行业与场景分类整理，一键导入你的专属导航页。',
  collectionsKeywords: '网址导航,导航网站,工具导航,精选集,书签合集,网址合集,行业导航,网站导航合集,FavsHub',
  // System
  allow_registration: 'true',
  // Backup
  backup_enabled: 'false',
  backup_hour: '3',
  backup_minute: '0',
  backup_keep_copies: '7',
  // Favicon
  favicon_source_url: 'https://www.google.com/s2/favicons?domain={domain}&sz={size}',
  favicon_size: '32',
  favicon_download_timeout: '10000',
  favicon_max_redirects: '3',
  // Auth / Security
  jwt_token_expiry: '7d',
  cookie_max_age: '604800',
  rate_limit_login_max: '20',
  rate_limit_login_window: '60000',
  rate_limit_register_max: '10',
  rate_limit_register_window: '60000',
  min_password_length: '8',
  trust_proxy: 'false',
  // Data limits
  max_bookmarks_per_sync: '20000',
  bookmarks_query_limit: '500',
}
