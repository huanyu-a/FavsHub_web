# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

FavsHub 是一个**网站 + 浏览器扩展**项目，用于智能书签管理和 AI 提示词管理。

- **网站 + 后端 API** (`favshub-nuxt/`) — Nuxt 3 全栈应用（SSR + Nitro 服务端），Vue 3 + Naive UI + better-sqlite3 + Drizzle ORM
- **浏览器扩展** (`favshub-ext/`) — Vue 3 + WXT + Naive UI + TypeScript + pnpm，书签同步到网站
- **静态资源** (`favshub-nuxt/public/images/`) — 搜索引擎 logo、favicon 缓存、壁纸、图标

## 常用命令

### 网站服务（Nuxt 3 全栈）
```bash
cd favshub-nuxt
pnpm install
pnpm dev                         # 开发模式（默认端口 3000）
pnpm build                       # 生产构建
pnpm preview                     # 预览生产构建
```

### 浏览器扩展
```bash
cd favshub-ext
pnpm install                     # 首次运行自动执行 wxt prepare
pnpm dev                         # Chrome 开发模式
pnpm build                       # Chrome 生产构建（MV3）
pnpm build:firefox               # Firefox 生产构建
```

### Docker 部署
```bash
cd favshub-nuxt
docker compose up -d             # 一键启动，访问 http://localhost:3090
```

## 架构要点

### 数据流
1. 扩展同步书签 → `PUT /api/sync/bookmarks`（增量合并，URL 去重）→ SQLite
2. 网站前端浏览/管理书签和提示词
3. 所有已登录用户可访问 `/admin` 页面管理自己的数据；管理员可管理全站数据
4. 扩展通过 `utils/request.ts` 封装请求，自动携带 JWT token

### 目录结构

**Nuxt 全栈应用 (`favshub-nuxt/`)：**

- `pages/` — Vue 页面（首页、登录、提示词管理、admin/ 后台 SPA）
- `components/` — Vue 组件（auth、bookmark、search、sidebar、prompts、mobile）
- `composables/` — 组合式函数（useAuth、useMobile、useTheme）
- `layouts/` — 布局（default.vue、admin.vue）
- `middleware/admin.ts` — 客户端路由守卫（登录权限保护）
- `stores/` — Pinia 状态管理（auth、bookmarks、searchEngines、settings、ui）
- `plugins/` — Nuxt 插件（主题初始化、认证初始化）
- `public/css/` — 样式（tokens.css、themes.css、main-bundle.css、admin.css、mobile-responsive.css、promptpro-bundle.css、error.css）
- `public/images/` — 搜索引擎 logo、favicon 缓存
- `public/vendor/` — 第三方库（remixicon 图标库）

**后端 (`favshub-nuxt/server/`)：**
- `api/` — Nitro 文件式路由（auth/、bookmarks/、folders/、prompts/、tags/、sync/、admin/、settings/、search-engines）
- `middleware/` — admin-guard.ts（管理员 JWT 验证）、cors.ts
- `plugins/` — db-init.ts（数据库初始化）、theme-init.ts、error-handler.ts、backup-scheduler.ts
- `database/` — index.ts（连接）、schema.ts（Drizzle ORM Schema）、migrate.ts（增量迁移）
- `utils/` — auth.ts、jwt.ts、config.ts、constants.ts、rate-limit.ts

### 数据库

- SQLite WAL 模式 + 外键约束（better-sqlite3 驱动 + Drizzle ORM）
- 书签去重：`UNIQUE(user_id, url)` — 以 URL 为基准
- 表：users, folders, bookmarks, prompt_folders, prompts, tags, prompt_tags, prompt_versions, settings, search_engines, system_config, prompt_review_requests（后者通过 migrate.ts 原始 SQL 创建，不在 Drizzle schema 中）
- 首个注册用户自动成为管理员
- 多步写操作必须用 `db.transaction(() => { ... })()` 包裹确保原子性
- 迁移：`database/migrate.ts` 采用增量 ALTER TABLE 方式，启动时自动执行

### 认证（双渠道）

- **httpOnly Cookie** — SSR 页面访问时自动携带，服务端中间件验证
- **Bearer Token** — 客户端 API 调用时通过 `Authorization` 头传递
- 登录后同时写入 `localStorage.favshub_token` 和 `Set-Cookie: favshub_token=xxx`
- `authStore.token === 'cookie_auth'` 是 cookie 认证哨兵值，此时 `getAuthHeaders()` 返回 `{}`，靠 `credentials: 'include'` 带 cookie
- 下载文件不能用 token 拼 URL，需用 `$fetch` + `responseType: 'blob'` + `credentials: 'include'`
- JWT 过期默认 7 天（可通过 `system_config.jwt_token_expiry` 调整）；secure 标志自适应（HTTP/HTTPS）
- JWT 密钥优先级：环境变量 `NUXT_JWT_SECRET` → 持久化文件 `data/.jwt-secret` → 自动生成（48 字节随机）
- 管理员检查：数据库 `is_admin` 字段 + 环境变量 `NUXT_ADMIN_USERS`

### API 结构

所有路由挂载在 `/api` 前缀下（Nitro 文件式路由）：

| 路由 | 说明 | 认证 |
|------|------|------|
| `/api/auth/*` | 注册/登录/登出/个人信息 | 部分公开 |
| `/api/bookmarks/*` | 书签 CRUD + 排序 + 导出 | 需要 |
| `/api/folders/*` | 书签文件夹管理 | 需要 |
| `/api/prompts/*` | 提示词 CRUD + 版本 + 文件夹 + 审核 | 需要 |
| `/api/prompts/:id/review-request` | 提交提示词修改审核请求 | 需要 |
| `/api/prompts/:id/my-review-request` | 查询当前用户的审核状态 | 需要 |
| `/api/tags/*` | 标签 CRUD | 需要 |
| `/api/settings/*` | 用户设置 + 默认设置 | 需要 |
| `/api/sync/*` | 书签同步（增量合并）+ favicon 同步 | 需要 |
| `/api/admin/*` | 管理员后台（用户/书签/提示词/备份/搜索引擎/配置） | 管理员 |
| `/api/admin/prompts/review-requests/*` | 提示词审核请求管理（批准/拒绝） | 管理员 |
| `/api/admin/search-engines/*` | 搜索引擎 CRUD | 管理员 |
| `/api/search-engines` | 搜索引擎列表 | 无 |
| `/api/health` | 健康检查 | 无 |
| `/api/config/registration` | 注册开关状态 | 无 |
| `/api/tdk` | TDK 配置 | 无 |
| `/api/user/stats` | 用户统计 | 需要 |

### 提示词审核系统

- 非管理员可对管理员创建的公开提示词（`login_required = false`）提交修改请求
- 请求存储在 `prompt_review_requests` 表，状态：pending / approved / rejected
- 管理员通过 `/api/admin/prompts/review-requests/:id/approve` 或 `/reject` 处理
- 审核通过时，6 步写操作（更新提示词、创建版本、更新版本号、清除旧标签、写入新标签、更新请求状态）全部包裹在 `db.transaction()` 中
- 同一用户对同一提示词只能有一个 pending 请求

### 搜索引擎

- 排序：SEARCH → AI → SOCIAL
- `is_default` 唯一标记默认引擎，创建/更新时自动清除其他
- 非管理员可提交搜索引擎供管理员审核（POST 使用 `requireAuth()`，非管理员提交 status='pending'）
- 前端 search-engines.vue 中非管理员编辑路径过滤 `sort_order` 和 `is_default` 字段

### 书签同步

- `folder_path` 格式：`文件夹/子文件夹`（去掉容器名前缀）
- 去重以 URL 为基准，已存在 URL 只变更标题和分类，不变更 icon
- icon 下载按 hostname 分组，每域名只下载一次

### 安全措施

- **服务端**：CORS 限制、JWT 密钥封装、错误脱敏、参数校验、rate-limit 速率限制
- **前端**：Vue 模板自动转义，避免 v-html 直接渲染用户内容
- **扩展**：postMessage 使用 `window.origin`、URL 协议验证、最小权限原则

## 开发注意事项

- Nuxt 文件式路由：`server/api/` 下的文件自动映射为 API 端点
- 修改 `server/` 下代码后，`pnpm dev` 会自动热重载（HMR）
- CSS 修改后需在 `useHead` 中 bump 版本号（格式 `?v=YYYYMMDD`，如 `?v=20260707`）清除缓存
- Vue `<Teleport to="body">` 的内容脱离父组件 DOM 树，父级 scoped CSS 选择器（如 `.admin-layout .xxx`）不匹配，Teleport 内容需用全局选择器
- 所有 async 函数必须有 try/catch/finally，API 失败时不能让 loading 卡死无反馈
- catch 块的变量不能与外层参数同名（变量遮蔽），建议用 `err` 而非 `e`
- `favshub-ext/.wxt/` 和 `favshub-ext/.output/` 自动生成，不要手动编辑
- `.gitignore` 排除了 `favshub-nuxt/data/`，首次启动自动创建数据库
- 提示词文件夹 ID 是字符串（时间戳+随机后缀），不是整数，路由中不要用 parseInt
- VERSION 文件变更触发 GitHub Actions CI/CD，自动构建 Docker 镜像并推送至 GHCR
