/**
 * 系统级配置字段名列表（仅管理员可写入 system_config 表）
 * 普通用户通过 /api/settings 写入时会被过滤掉这些字段
 */
export const SYSTEM_ONLY_KEYS = [
  // TDK
  'siteTitle', 'siteDescription', 'siteKeywords',
  'promptproTitle', 'promptproDescription', 'promptproKeywords',
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
  siteTitle: 'FavsHub - 智能书签工作台',
  siteDescription: 'FavsHub 智能书签工作台 - 高效管理浏览器书签、AI提示词，支持多端同步、智能搜索、自定义导航页',
  siteKeywords: '书签管理,智能导航,AI提示词,工作台,FavsHub,浏览器书签同步,提示词管理',
  promptproTitle: 'PromptPro - AI提示词管理系统',
  promptproDescription: 'PromptPro 提示词管理系统 - 集中管理、分类整理、快速检索AI提示词，提升工作效率',
  promptproKeywords: 'PromptPro,提示词管理,AI提示词,提示词分类,提示词模板,ChatGPT提示词',
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
