# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

FavsHub 是一个**网站 + 浏览器扩展**项目，用于智能书签管理和 AI 提示词管理。

- **网站前端** (`wwwroot/web/`) — 主前端，原生 JS + TailwindCSS，由后端静态托管
- **后端 API 服务** (`wwwroot/server/`) — Express.js + SQLite (better-sqlite3)，提供 RESTful API
- **浏览器扩展** (`zmark-ext/`) — 配套工具，将浏览器书签同步至网站（Vue 3 + WXT + Naive UI）
- **静态资源** (`wwwroot/images/`) — 搜索引擎 logo、favicon 缓存、壁纸、图标等
- **数据库文件** (`wwwroot/server/data/`) — SQLite 数据库 + 备份文件（已 gitignore）
- `bak/` — 旧版项目存档，不再维护

## 常用命令

### 后端服务 (`wwwroot/server/`)
```bash
cd wwwroot/server
npm install                      # 安装依赖
node index.js                    # 启动服务（默认端口 3000，可用 PORT 环境变量覆盖）
node --watch index.js            # 开发模式（自动重启，需要 Node 18+）
node import-prompts.js           # 从备份 JSON 文件批量导入提示词
```

### 浏览器扩展 (`zmark-ext/`)
```bash
cd zmark-ext
pnpm install                     # 安装依赖（首次运行会自动执行 wxt prepare）
pnpm dev                         # 开发模式 (Chrome)
pnpm dev:firefox                 # 开发模式 (Firefox)
pnpm build                       # 生产构建 (Chrome MV3)
pnpm build:firefox               # 生产构建 (Firefox)
pnpm compile                     # 类型检查（不产生输出）
```

## 架构要点

### 数据流
1. 用户通过浏览器扩展同步书签 → 扩展调用 `PUT /api/sync/bookmarks`（增量合并）→ 服务端存储到 SQLite
2. 用户通过网站前端浏览/管理书签和提示词
3. 管理员通过 `/admin/index.html` 管理所有数据（书签、提示词、用户、搜索引擎、备份）
4. 扩展端通过 `zmark-ext/utils/request.ts` 封装的请求方法与后端通信，自动携带 JWT token

### 网站前端 (`wwwroot/web/`)

**目录结构（已重组）：**
- `js/` — 所有 JavaScript 文件（api.js, script.js, promptpro-bundle.js 等）
- `css/` — 所有样式文件（main-bundle.css, promptpro-bundle.css 等）
- `admin/` — 管理后台（admin/index.html）
- `promptpro/` — 提示词管理页面
- `tools/` — 工具页面（migrate.html）
- `vendor/` — 第三方库（Sortable.min.js, lodash.min.js, qrcode.min.js, remixicon.css）
- `_locales/zh_CN/` — 中文本地化资源

**核心 JS 文件：**
- `js/api.js` — API 客户端封装（FavsHubAPI 类），所有后端请求的统一入口
- `js/utils.js` — 安全工具函数（escapeHtml, escapeAttr, sanitizeUrl），所有 innerHTML 渲染必须使用
- `js/script.js` — 书签展示和交互逻辑（主页面核心，约 6400+ 行）
- `js/search-engine-dropdown.js` — 搜索引擎下拉选择器 + SearchEngineManager 单例
- `js/settings-store.js` — 用户设置管理（FavsHubSettings，内存缓存 + 后端持久化）
- `js/chrome-shim.js` — 在 Web 模式下模拟 `chrome.*` API 部分功能（含 escapeHtml）
- `js/wallpaper.js` — 壁纸系统（必应壁纸 + 预设 + 用户上传）
- `js/quick-links.js` — 快捷链接推荐（基于浏览器历史）
- `js/promptpro-bundle.js` — 提示词管理核心逻辑（打包文件）
- `js/backup-manager.js` — 本地文件夹自动备份管理
- `js/baidu-pan.js` — 百度网盘云端备份 + 设置
- `js/icons.js` — 图标管理（全局 ICONS 对象 + getIconHtml）
- `js/welcome.js` — 新用户欢迎引导
- `js/gesture-navigation.js` — 手势导航支持

### 数据库 (`wwwroot/server/db.js`)

- SQLite 文件：`wwwroot/server/data/favshub.db`
- 启用 WAL 模式和外键约束
- 书签去重：`UNIQUE(user_id, url)` — 以 URL 为基准去重，同一 URL 在不同文件夹中合并为一条
- 表结构：users, folders, bookmarks, prompt_folders, prompts, tags, prompt_tags, prompt_versions, settings, search_engines
- 首个注册用户自动成为管理员
- 首次启动自动创建默认搜索引擎（AI / SEARCH / SOCIAL 三类）
- 数据库迁移：try/catch ALTER TABLE 增量迁移 + 自动清理重复 URL 数据

### 认证

- JWT Bearer Token，存储在 localStorage (`favshub_token`)，同时同步到 chrome.storage.local
- `middleware/auth.js` 导出 `authMiddleware` 和 `signToken(payload, expiresIn)` 函数（不直接导出 JWT_SECRET）
- 管理员中间件：`middleware/admin.js`（先认证，再检查 is_admin 字段或 ADMIN_USERS 环境变量）

### API 结构 (`wwwroot/server/routes/`)

所有路由挂载在 `/api` 前缀下：

| 路由文件 | 挂载路径 | 说明 | 认证 |
|---------|---------|------|------|
| `auth.js` | `/api/auth` | 注册/登录/获取当前用户 | 部分公开 |
| `bookmarks.js` | `/api/bookmarks` | 书签 CRUD + 排序 | 需要 |
| `folders.js` | `/api/folders` | 书签文件夹管理 | 需要 |
| `prompts.js` | `/api/prompts` | 提示词 CRUD + 版本管理 + 文件夹管理 | 需要 |
| `tags.js` | `/api/tags` | 标签 CRUD | 需要 |
| `settings.js` | `/api/settings` | 用户设置读写 | 需要 |
| `sync.js` | `/api/sync` | 数据同步（扩展→服务端，增量合并） | 需要 |
| `admin.js` | `/api/admin` | 管理员后台（用户/书签/提示词/备份/搜索引擎/文件夹管理） | 管理员 |
| *(内联)* | `/api/search-engines` | 公开搜索引擎列表（按 SEARCH→AI→SOCIAL 排序） | 无 |

### 浏览器扩展同步机制 (`zmark-ext/`)

- 技术栈：WXT + Vue 3 + Naive UI + TailwindCSS + TypeScript + pnpm
- `entrypoints/background.ts` — Service Worker（URL 协议验证、context menu 管理）
- `entrypoints/content.ts` — Content Script（消息中继，origin 限制为 window.origin）
- `entrypoints/floating-ball.content.ts` — 悬浮球（XSS 防护、content script 重复注入防护）
- `utils/flatten-bookmarks.ts` — 将浏览器书签树扁平化
  - `folder_path` 格式为 `文件夹/子文件夹`（已去掉容器名前缀，顶级容器的子文件夹提升为顶级）
  - 容器内直接的书签 `folder_path` 为 null
- `utils/container-sync.ts` — 容器名映射（收藏夹栏→bar, 其他收藏夹→other）
- `components/Sync.vue` — 同步 UI（先 PUT 增量合并，再上传 favicon）
- 书签去重以 URL 为基准（`ON CONFLICT(user_id, url) DO UPDATE`）
- favicon 通过 `chrome.runtime.getURL('/_favicon/')` 获取并上传到 `POST /api/sync/favicons`

### 安全措施

- **服务端**：helmet 安全头、CORS 来源限制（CORS_ORIGIN 环境变量）、JWT secret 封装为 signToken 函数、错误信息脱敏、NaN 路由参数校验
- **前端**：所有 innerHTML 渲染使用 `escapeHtml()`/`escapeAttr()`/`sanitizeUrl()`（定义在 `js/utils.js`）、URL 协议仅允许 http/https
- **扩展**：postMessage 使用 `window.origin`、openTab/openUrlInSidePanel 验证 URL 协议、移除多余权限

### 静态资源 (`wwwroot/images/`)

- 搜索引擎 logo（google, bing, baidu, chatgpt, claude, deepseek 等 28+ 个）
- `favicons/` — 书签网站 favicon 本地缓存（由 sync 接口自动下载）
- `wallpapers/` — 壁纸存储（必应 + 预设 + 用户上传）

## 开发注意事项

- 修改服务端路由后需重启 Node.js 进程
- 浏览器扩展修改后需 `cd zmark-ext && pnpm build`，然后在 Chrome 扩展管理页重新加载
- `zmark-ext/.wxt/` 和 `zmark-ext/.output/` 是自动生成的，不要手动编辑
- JS/CSS 文件修改后需在 HTML 中更新版本号参数（如 `?v=21`）以清除浏览器缓存
- 首次克隆 zmark-ext 后需运行 `pnpm install`（会自动执行 `wxt prepare` 生成 tsconfig.json）
- zmark-ext 中 Vite 插件必须嵌套在 `vite: () => ({ plugins: [...] })` 中
- 扩展的 API 路径前缀是 `/api/`（不是 `/api/v1/`）
- 服务端默认 JWT_SECRET 仅用于开发，生产环境务必通过环境变量覆盖
- `.gitignore` 排除了 `wwwroot/server/data/`，首次启动会自动创建数据库
- 新增的 admin.html 中间层路由：访问 `/admin.html` 会自动重定向到 `/admin/index.html`
- 搜索引擎排序：API 返回顺序为 SEARCH→AI→SOCIAL，前端标签页和对话框均按此顺序显示
- 后台设置 `is_default` 为唯一的默认引擎，创建/更新时自动清除其他引擎的默认标记
