# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

FavsHub 是一个**网站 + 浏览器扩展**项目，用于智能书签管理和 AI 提示词管理。

- **网站前端** (`wwwroot/web/`) — 主前端，原生 JS，由后端静态托管
- **后端 API 服务** (`wwwroot/server/`) — Express.js + SQLite (better-sqlite3)
- **浏览器扩展** (`zmark-ext/`) — Vue 3 + WXT + Naive UI + TypeScript + pnpm
- **静态资源** (`wwwroot/images/`) — 搜索引擎 logo、favicon 缓存、壁纸、图标
- `bak/` — 旧版项目存档，不再维护

## 常用命令

### 后端服务
```bash
cd wwwroot/server
npm install
node index.js                    # 启动（默认端口 3000，PORT 环境变量可覆盖）
node --watch index.js            # 开发模式（Node 18+）
```

### 浏览器扩展
```bash
cd zmark-ext
pnpm install                     # 首次运行自动执行 wxt prepare
pnpm dev                         # Chrome 开发模式
pnpm build                       # Chrome 生产构建
pnpm build:firefox               # Firefox 生产构建
```

## 架构要点

### 数据流
1. 扩展同步书签 → `PUT /api/sync/bookmarks`（增量合并，URL 去重）→ SQLite
2. 网站前端浏览/管理书签和提示词
3. 管理员通过 `/admin/index.html` 管理所有数据
4. 扩展通过 `utils/request.ts` 封装请求，自动携带 JWT token

### 目录结构

**前端 (`wwwroot/web/`)：**
- `js/` — JavaScript（api.js, script.js, promptpro-bundle.js 等）
- `css/` — 样式（main-bundle.css, promptpro-bundle.css 等）
- `admin/` — 管理后台 SPA（通过 data-page 切换子页面）
- `promptpro/` — 提示词管理页面
- `vendor/` — 第三方库（Sortable, lodash, qrcode, remixicon）

**后端 (`wwwroot/server/`)：**
- `routes/` — API 路由（auth, bookmarks, folders, prompts, tags, settings, sync, admin）
- `middleware/` — auth.js（JWT 认证 + signToken）、admin.js（管理员检查）
- `db.js` — SQLite 初始化 + 迁移 + 默认数据

### 数据库

- SQLite WAL 模式 + 外键约束
- 书签去重：`UNIQUE(user_id, url)` — 以 URL 为基准
- 表：users, folders, bookmarks, prompt_folders, prompts, tags, prompt_tags, prompt_versions, settings, search_engines
- 首个注册用户自动成为管理员
- 迁移：try/catch ALTER TABLE 增量迁移

### 认证

- JWT Bearer Token，存储在 localStorage (`favshub_token`)
- `middleware/auth.js` 导出 `authMiddleware` 和 `signToken()`（不直接导出 JWT_SECRET）
- 管理员检查：数据库 `is_admin` 字段 + 环境变量 `ADMIN_USERS`

### API 结构

| 路由 | 说明 | 认证 |
|------|------|------|
| `/api/auth` | 注册/登录 | 部分公开 |
| `/api/bookmarks` | 书签 CRUD | 需要 |
| `/api/folders` | 书签文件夹 | 需要 |
| `/api/prompts` | 提示词 CRUD + 版本 | 需要 |
| `/api/tags` | 标签 CRUD | 需要 |
| `/api/settings` | 用户设置 | 需要 |
| `/api/sync` | 书签同步（增量合并） | 需要 |
| `/api/admin` | 管理员后台 | 管理员 |
| `/api/search-engines` | 搜索引擎列表 | 无 |
| `/api/config/baidu-app-key` | 百度网盘 AppKey | GET 无 / PUT 管理员 |

### 搜索引擎

- 排序：SEARCH → AI → SOCIAL
- `is_default` 唯一标记默认引擎，创建/更新时自动清除其他
- 前端 `SearchEngineManager` 优先使用 `is_default` 引擎

### 书签同步

- `folder_path` 格式：`文件夹/子文件夹`（去掉容器名前缀）
- 去重以 URL 为基准，已存在 URL 只变更标题和分类，不变更 icon
- icon 下载按 hostname 分组，每域名只下载一次

### 安全措施

- **服务端**：helmet 安全头（含 scriptSrcAttr: unsafe-inline）、CORS 限制、JWT secret 封装、错误脱敏、NaN 参数校验
- **前端**：innerHTML 渲染使用 `escapeHtml()`/`escapeAttr()`/`sanitizeUrl()`（`js/utils.js`）
- **扩展**：postMessage 使用 `window.origin`、URL 协议验证、最小权限原则

### 百度网盘备份

- 仅支持 Chrome 扩展环境（Web 管理后台域名未授权无法 OAuth）
- AppKey 由管理员在后台手动填写，存储在数据库 settings 表
- OAuth 流程：popup → 百度授权 → 回调到 `/admin/#access_token=...` → 提取 token

## 开发注意事项

- 修改服务端路由后需重启 Node.js 进程
- 扩展修改后需 `cd zmark-ext && pnpm build`，然后在 Chrome 重新加载
- JS/CSS 修改后需更新 HTML 中的版本号参数（如 `?v=22`）清除缓存
- `zmark-ext/.wxt/` 和 `zmark-ext/.output/` 自动生成，不要手动编辑
- `.gitignore` 排除了 `wwwroot/server/data/`，首次启动自动创建数据库
- CSP 配置了 `scriptSrcAttr: 'unsafe-inline'` 以支持 onclick 内联事件
- admin 页面按钮使用 data-* 属性 + dispatcher 函数模式（避免 JSON.stringify 在 onclick 中的问题）
- 提示词文件夹 ID 是字符串（时间戳+随机后缀），不是整数，路由中不要用 parseInt
