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

> **注意**：README.md 需要反映网站项目的定位，而非纯扩展。旧的 README-BOOKMARKS.md 和 README-PROMPTS.md 在 bak/ 中。

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
1. 用户通过浏览器扩展同步书签 → 扩展调用 `POST /api/sync/bookmarks` → 服务端存储到 SQLite
2. 用户通过网站前端浏览/管理书签和提示词
3. 管理员通过 `/admin.html` 管理所有数据（书签、提示词、用户、搜索引擎、备份）
4. 扩展端通过 `zmark-ext/utils/request.ts` 封装的请求方法与后端通信，自动携带 JWT token

### 网站前端 (`wwwroot/web/`)

**核心页面：**
- `index.html` — 主页面（书签网格 + 搜索 + 侧边栏导航 + 快捷链接 + 壁纸）
- `admin.html` — 管理员后台（SPA，通过 `data-page` 切换子页面）
- `promptpro.html` — 提示词管理页面（独立的完整应用）
- `login.html` — 登录/注册页面
- `sidepanel.html` — 侧边栏模式页面（紧凑布局）
- `migrate.html` — 数据迁移工具（将浏览器 IndexedDB 数据迁移到服务端）

**核心 JS 文件：**
- `js/api.js` — API 客户端封装（FavsHubAPI 类），所有后端请求的统一入口
- `script.js` — 书签展示和交互逻辑（主页面核心）
- `promptpro-bundle.js` — 提示词管理核心逻辑（打包文件，约 200KB+），调用服务端 API
- `promptpro.js` — 提示词入口导航脚本（从 index.html 侧边栏跳转到 promptpro.html）
- `promptpro-export.js` — 提示词数据导出功能
- `promptpro-search.js` — 提示词智能搜索（权重评分算法）
- `promptpro-backup-setup.js` — 提示词备份配置
- `chrome-shim.js` — 在 Web 模式下模拟 `chrome.*` API 部分功能
- `backup-manager.js` — 本地文件夹自动备份管理
- `baidu-pan-backup-manager.js` — 百度网盘云端备份管理
- `baidu-pan-settings.js` — 百度网盘授权与设置
- `search-engine-dropdown.js` — 搜索引擎下拉选择器
- `gesture-navigation.js` — 手势导航支持
- `sidepanel-manager.js` — 侧边栏管理
- `sidepanel-navigation.js` — 侧边栏导航逻辑
- `quick-links.js` — 快捷链接推荐（基于浏览器历史）
- `wallpaper.js` — 壁纸系统（必应壁纸 + 预设 + 用户上传）
- `settings.js` — 用户设置管理（主题、布局、语言等）
- `welcome.js` — 新用户欢迎引导
- `progress.js` — 通用进度条工具
- `localization.js` — 国际化支持
- `icons.js` — 图标管理

**CSS 文件：**
- `main-bundle.css` — 主样式打包
- `promptpro-bundle.css` — 提示词页面样式
- `promptpro-card-styles.css` — 提示词卡片样式
- `promptpro-dark-theme.css` / `promptpro-light-theme.css` — 暗色/亮色主题
- `index-sidebar-fix.css` — 侧边栏修复样式

**第三方库（直接引用）：**
- `Sortable.min.js` — 拖拽排序
- `lodash.min.js` — 工具函数
- `qrcode.min.js` — 二维码生成

**国际化：**
- `_locales/zh_CN/` — 中文本地化资源

### 数据库 (`wwwroot/server/db.js`)

- SQLite 文件：`wwwroot/server/data/favshub.db`
- 启用 WAL 模式和外键约束
- 表结构：
  - `users` — 用户（username, email, password_hash, is_admin）
  - `folders` — 书签文件夹（支持 parent_id 层级，支持 icon）
  - `bookmarks` — 书签（title, url, folder_id, icon, sort_order）
  - `prompt_folders` — 提示词文件夹（支持 parent_id 层级）
  - `prompts` — 提示词（title, description, content, folder_id, is_favorite, avatar, 版本信息）
  - `tags` — 标签（name, color, updated_at）
  - `prompt_tags` — 提示词-标签关联（含 created_at）
  - `prompt_versions` — 提示词版本历史（content, version_number, variables）
  - `settings` — 用户设置（JSON data 字段）
  - `search_engines` — 搜索引擎（name, label, url, icon, category, sort_order, is_default）
- 首个注册用户自动成为管理员
- 首次启动自动创建 28 个默认搜索引擎（AI / SEARCH / SOCIAL 三类）
- **数据库迁移模式：** 采用 try/catch ALTER TABLE 方式增量迁移，每个迁移检查目标列是否存在，不存在则添加。当前已迁移的列：tags.color, tags.updated_at, prompt_tags.created_at, prompts.avatar, prompt_folders.parent_id, folders.icon, prompt_versions.variables

### 认证

- JWT Bearer Token，存储在 localStorage (`favshub_token`)，同时同步到 chrome.storage.local
- 默认 JWT_SECRET：`favshub-secret-change-in-production`（可通过环境变量 `JWT_SECRET` 覆盖）
- 中间件：`middleware/auth.js`（通用认证，从 Bearer token 提取用户信息）
- 管理员中间件：`middleware/admin.js`（先认证，再检查 is_admin 字段或 ADMIN_USERS 环境变量）
- 管理员可通过两种方式设置：数据库 is_admin 字段 + 环境变量 `ADMIN_USERS`（逗号分隔的用户名列表）

### API 结构 (`wwwroot/server/routes/`)

所有路由挂载在 `/api` 前缀下（`index.js` 中配置）：

| 路由文件 | 挂载路径 | 说明 | 认证 |
|---------|---------|------|------|
| `auth.js` | `/api/auth` | 注册/登录/获取当前用户 | 部分公开 |
| `bookmarks.js` | `/api/bookmarks` | 书签 CRUD + 排序 | 需要 |
| `folders.js` | `/api/folders` | 书签文件夹管理 | 需要 |
| `prompts.js` | `/api/prompts` | 提示词 CRUD + 版本管理 + 文件夹管理 | 需要 |
| `tags.js` | `/api/tags` | 标签 CRUD | 需要 |
| `settings.js` | `/api/settings` | 用户设置读写 | 需要 |
| `sync.js` | `/api/sync` | 数据同步（扩展→服务端，含 favicon 本地化） | 需要 |
| `admin.js` | `/api/admin` | 管理员后台（用户/书签/提示词/备份/搜索引擎/文件夹管理） | 管理员 |
| *(内联)* | `/api/search-engines` | 公开搜索引擎列表 | 无 |

### 管理后台 (`wwwroot/web/admin.html`)

- 一个 SPA 页面，通过 `data-page` 属性切换不同管理子页面
- 书签管理：子标签页（书签列表 + 文件夹管理），支持两级下拉筛选、树形层级折叠、图标选择
- 提示词管理：子标签页（提示词列表 + 文件夹管理 + 标签管理 + 历史记录）
- 搜索引擎管理：CRUD + 分类展示
- 数据备份：手动下载 + 每日定时备份 + 百度网盘云端备份
- 使用 remixicon 图标库（通过 CDN 加载）

### 浏览器扩展同步机制 (`zmark-ext/`)

- 技术栈：WXT + Vue 3 + Naive UI + TailwindCSS + TypeScript + pnpm
- `entrypoints/background.ts` — Service Worker
- `entrypoints/content.ts` — Content Script
- `entrypoints/popup/` — 弹窗页面
- `components/Sync.vue` — 读取浏览器书签树，扁平化为 `{ title, url, folder_path, icon }`
- `folder_path` 格式为 `收藏夹栏/子文件夹/...`，顶级文件夹（收藏夹栏/其他收藏夹）的子文件夹提升为顶级
- 服务端 `sync.js` 的 `ensureFolderPath()` 递归创建层级文件夹
- 同步时通过 `chrome.runtime.getURL('/_favicon/')` 获取浏览器缓存的 favicon 并上传到服务端
- 请求封装在 `utils/request.ts`，自动拼接 BASE_URL 和携带 JWT token，超时 90s
- 图标统一使用 `@vicons/ionicons5`

### 静态资源 (`wwwroot/images/`)

- 搜索引擎 logo（google, bing, baidu, chatgpt, claude, deepseek 等 28+ 个）
- `favicon.ico` / `favicon.png` / `icon-*.png` — 网站图标
- `favicons/` — 书签网站 favicon 本地缓存
- `wallpapers/` — 壁纸存储（必应 + 预设 + 用户上传）
- `static/` — README 文档截图
- `sider-icon/` — Sider 插件图标
- `systermicon/` — 系统图标
- `logo.svg` / `view-icon.svg` / `placeholder-icon.svg` — UI 图标

### 工具脚本

- `wwwroot/server/import-prompts.js` — 从备份 JSON 文件批量导入提示词到数据库（指定 userId=1，先清空再导入）

## 开发注意事项

- 修改服务端路由后需重启 Node.js 进程
- 浏览器扩展修改后需 `cd zmark-ext && pnpm build`，然后在 Chrome 扩展管理页重新加载
- `zmark-ext/.wxt/` 和 `zmark-ext/.output/` 是自动生成的，不要手动编辑
- `api.js` 修改后需要在 HTML 中更新版本号参数（如 `?v=4`）以清除浏览器缓存
- 首次克隆 zmark-ext 后需运行 `pnpm install`（会自动执行 `wxt prepare` 生成 tsconfig.json）
- zmark-ext 中 Vite 插件必须嵌套在 `vite: () => ({ plugins: [...] })` 中
- 扩展的 API 路径前缀是 `/api/`（不是 `/api/v1/`）
- 服务端默认 JWT_SECRET 仅用于开发，生产环境务必通过环境变量覆盖
- 管理员后台使用 remixicon 图标库（已通过 CDN 加载）
- `--watch` 参数需要 Node.js 18+
- `.gitignore` 排除了 `wwwroot/server/data/`，首次启动会自动创建数据库
