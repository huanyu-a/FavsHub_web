# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**读者：** AI 与开发者。用户安装 / 部署 / 功能说明见 [README.md](README.md)，勿在本文件写产品教程。  
**范围：** 仅 `favshub-nuxt/`（Nuxt 3 全栈网站）。仓库总览见 [../CLAUDE.md](../CLAUDE.md)；扩展开发见 [../favshub-ext/CLAUDE.md](../favshub-ext/CLAUDE.md)。

## 技术栈

Nuxt 3（SSR + Nitro）· Vue 3 · Pinia · Naive UI · better-sqlite3 · Drizzle ORM · pnpm  
版本号：`VERSION`（变更会触发 GHCR 镜像 CI）。

## 常用命令

```bash
pnpm install
pnpm dev              # http://localhost:3000
pnpm build            # → .output/
pnpm preview
pnpm generate         # 静态生成；主路径是 SSR，一般不用
docker compose up -d  # http://localhost:3090
```

- **无**独立 lint / unit test 脚本；验证以 `pnpm build` + 手动联调为主。
- `postinstall` → `nuxt prepare`。
- 改 `server/` 后 dev HMR；改 `public/css/` 须在布局 `useHead` 中 bump `?v=YYYYMMDD`。

## 环境变量

通过 `nuxt.config.ts` 的 `runtimeConfig` 映射为 `NUXT_*` 环境变量；`.env.example` 含参考模板。

| 变量 | 说明 | 默认 |
|------|------|------|
| `NUXT_JWT_SECRET` | JWT 签名 | 空 → `data/.jwt-secret` 或自动 48 字节 |
| `NUXT_DB_PATH` | SQLite 路径 | `./data/favshub.db` |
| `NUXT_CORS_ORIGIN` | CORS | `http://localhost:3000` |
| `NUXT_ADMIN_USERS` | 额外管理员用户名（逗号分隔） | 空（首注册用户为管理员） |
| `NUXT_TRUST_PROXY` | 信任 X-Forwarded-For | `false` |

另有 `runtimeConfig.public.baseUrl`（默认 `https://favshub.com`）供 sitemap / TDK 用，当前非环境变量，改需直接改 `nuxt.config.ts`。
`.env.example` 中的 `PORT=3001` 无效（Nuxt dev 端口由 `devServer.port` 固定为 `3000`）。

`data/` 已 gitignore，首次启动自动建库。本地部署密文：`DEPLOY.md`（gitignore，**勿提交**）。

## 目录结构

```
pages/                 # 文件路由
  index.vue            # 首页：书签网格、搜索、侧边栏、精选集 tab、壁纸
  login.vue
  prompts/             # 提示词浏览（公开）
  collections/         # 精选集市场 + [id] 详情
  tokens/              # Token 白嫖通告列表（公开；详情为同页弹层，无独立路由）
  admin/               # 管理后台 SPA
    index / users / bookmarks / collections / prompts
    search-engines / backup / settings / config / token-deals
components/            # auth, bookmark, search, sidebar, prompts, collections, tokens, mobile, common
composables/           # useAuth, useMobile, useTheme（11 套主题：7 浅 + 4 深）
stores/                # auth, bookmarks（含 viewMode）, searchEngines, settings, ui
layouts/               # default.vue（前台+移动端壳）, admin.vue
middleware/admin.ts    # 客户端：需登录进 /admin
error.vue              # 根级错误页（404/500 统一渲染）
public/css/            # tokens, themes, main-bundle, admin, mobile-responsive, promptpro, error
public/images/         # 引擎 logo、favicon 缓存、systermicon
public/robots.txt      # SEO 爬虫规则 + sitemap 链接
server/api/            # Nitro 文件式路由 → /api/*
server/routes/         # 非 API 路由（sitemap.xml.ts — 动态站点地图）
server/database/       # schema.ts, migrate.ts, index.ts
server/middleware/     # admin-guard, cors, cache-control（公开页 CDN 缓存头升级）
server/plugins/        # db-init, theme-init, error-handler, backup-scheduler, rate-limit-cleanup
server/utils/          # auth, jwt, config, constants, rate-limit, settings-cache, favicon-download, favicon-dir, delete-user, token-deals, seed-token-deals
utils/                 # 前端工具：pinyin.ts（拼音搜索）、template-variables.ts（{{变量}}）、themeCookie.ts（SSR 防闪）、bookmark-colors.ts（配色合并缓存）
docs/screenshots/      # 文档截图（非 public）
```

### 组件与状态（改 UI 时）

- 书签：`components/bookmark/`（Card、Grid、EditDialog、ContextMenu）
- 搜索：`components/search/`
- 侧栏：`components/sidebar/`
- Token 通告：`components/tokens/`（Card、Detail、Editor、FilterBar）
- 其它：`BackToTop`、`FloatingNav`、`WelcomeMessage`、`YearProgress`、`common/IconPicker`
- **BackToTop 为逐页引用组件**（不在任何 layout）：新增长页须手动加 `<BackToTop />`。滚动监听捕获 window / body / 最后滚动容器 / `main`；admin 布局真实滚动容器是 `main.admin-main`（`overflow-y:auto; height:100vh`）。登录页（`layout:false` 单屏居中）无需添加
- Pinia `bookmarks`：个人书签 vs 精选集 `viewMode` / `fetchCollectionData`

### 管理后台能力

- 已登录用户自管数据（按 `user_id`）；管理员管全站用户、官方精选集、系统配置、备份等
- 书签：列表 + 文件夹，两级筛选、树形、图标
- 提示词：列表 + 文件夹 + 标签 + 历史 + 审核
- 搜索引擎：CRUD + 用户提交审核
- Token 通告：待审核队列 + 通过 / 驳回（含驳回原因）+ 置顶（`admin/token-deals`）
- 备份：手动 + 每日定时 + 百度网盘（见 `admin/backup`）

## 数据模型

- 驱动：better-sqlite3，WAL + 外键
- 多步写：**必须** `db.transaction(() => { ... })()`
- 原始连接：`getRawDb()`（事务/特殊 SQL）
- 迁移：`server/database/migrate.ts` 启动时增量执行（不要假设只用 drizzle-kit push）
- 书签去重：`UNIQUE(user_id, url)`
- 首个注册用户 = 管理员；启动种子约 29 个搜索引擎（SEARCH / AI / SOCIAL）
- `login_required`：提示词 / 书签 / 文件夹可见性

### 书签与精选集（核心）

```
bookmarks                          # 唯一实体 title/url/icon…
├── user_id + label
└── 首页「全部书签」= 当前用户个人书签

collection_bookmarks               # 薄引用，不存 title/url
├── collection_id → collections
├── bookmark_id   → bookmarks.id
├── category_id   → collection_categories
└── UNIQUE(collection_id, bookmark_id)

collections / collection_categories
collection_subscriptions           # 订阅
collection_imports                 # 导入到用户空间
```

- 精选集加书签：从 `bookmarks` 池搜索，写 `bookmark_id`，**禁止**再建独立 title/url 存储层
- 导入：复制到用户 `bookmarks` + 记 `collection_imports`

### 其它表

`users` · `folders` · `prompt_folders` / `prompts` / `tags` / `prompt_tags` / `prompt_versions`  
`prompt_review_requests`（migrate 原始 SQL，可能不在 Drizzle schema）  
`settings`（`user_id` PK，`id=0` 系统默认）· `search_engines` · `system_config`  
`token_deals` / `token_deal_votes` / `token_deal_reviews`（Token 白嫖通告，见「产品域行为」）

提示词与提示词文件夹 **ID 是字符串**（时间戳+随机后缀）→ 路由**不要** `parseInt`。

JSON 数组：`JSON.parse` 后 `Array.isArray()`；**空数组也要执行清除**（如标签），勿当无变更跳过。

**迁移三坑**（2026-09 实测，改 `migrate.ts` 前必读）：

- **多语句 `db.exec()` 是原子性陷阱**：块内任一语句报错即中断整块，其后语句**全部静默不执行**，且只留一行 warning。兜底 / 高风险语句（如 `CREATE INDEX`）**必须独立 `try/catch`**，勿塞进大 exec 块 —— 曾因一条索引失败连带其后 31 条 `CREATE INDEX` 全部未执行。
- **生成列检测必须用 `PRAGMA table_xinfo`**：`table_info` **不返回生成列**，用它判断列是否存在会恒为 false → 每次启动重复 `ALTER` 并被静默吞掉。另：`ALTER TABLE ADD COLUMN` **只支持 `VIRTUAL` 生成列**，写 `STORED` 会报 `cannot add a STORED column`。
- **重建表会丢列**：`CREATE TABLE x_new` + `INSERT` + `RENAME` 的写法只保留显式列出的字段。`bookmarks` 重建分支（原 `entry_id` 存在时触发）即会丢弃生成列 `has_sync` —— 新增生成列时须同步补进重建定义，或把 `ALTER` 排到重建之后。

## 认证（双渠道）

- **httpOnly Cookie** `favshub_token`：SSR 自动带；`sameSite: lax`
- **Bearer**：客户端 `Authorization`
- 登录同时写 `localStorage.favshub_token` + Cookie
- `authStore.token === 'cookie_auth'` → `getAuthHeaders()` 返回 `{}`，靠 `credentials: 'include'`
- 下载：`$fetch` + `responseType: 'blob'` + `credentials: 'include'`，**勿** token 拼 URL
- JWT 默认 7 天（`system_config.jwt_token_expiry`）；secure 随 HTTPS  
  密钥：`NUXT_JWT_SECRET` → `data/.jwt-secret` → 自动生成
- 管理员：`users.is_admin` 或 `NUXT_ADMIN_USERS`；中间件 `admin-guard.ts`

## API 地图（`/api` 前缀，Nitro 文件路由）

| 前缀 | 职责 | 认证 |
|------|------|------|
| `/api/auth/*` | 注册/登录/登出/profile | 部分公开 |
| `/api/bookmarks/*`、`/api/folders/*` | 个人书签与文件夹 | 登录 |
| `/api/collections/*` | 精选集 CRUD、订阅、导入、书签引用 | 混合 |
| `/api/prompts/*`、`/api/tags/*` | 提示词、版本、审核申请 | 登录 |
| `/api/token-deals/*` | Token 通告：列表 / 详情 / 发布 / 改删 / 投票 / 评测 / 导入 / 置顶 | 混合 |
| `/api/sync/*` | 扩展书签 / favicon 同步 | 登录 |
| `/api/favicon?domain=` | favicon 服务端代理 + 本地缓存（SSRF 防护） | 无 |
| `/api/settings/*` | 用户设置 | 登录 |
| `/api/search-engines` | 公开引擎列表 | 无 |
| `/api/admin/*` | 用户/书签/提示词/精选集/引擎/备份/配置/Token 审核 | 管理员（部分自管） |
| `/api/health`、`/api/config/registration`、`/api/tdk*` | 健康检查、注册开关、SEO | 无 |
| `/api/user/stats` | 用户统计 | 登录 |

精选集管理端：`/api/admin/collections/*`（official、batch-import、bookmarks 等）。

文件路由示例：`server/api/foo/bar.get.ts` → `GET /api/foo/bar`。

## 产品域行为

### 精选集

- 前台：`pages/collections/`、`[id].vue`；后台：`pages/admin/collections.vue`
- 首页 tabs：个人 vs 已订阅（`stores/bookmarks.ts`）
- `is_public` / `is_official`；订阅与导入分离

### 提示词审核

- 非管理员可对管理员公开提示词（`login_required = false`）提交修改
- 状态：pending / approved / rejected；同一用户对同一提示词仅一个 pending
- 批准时多步写必须同一 `db.transaction`

### 搜索引擎

- 排序：SEARCH → AI → SOCIAL；约 29 个内置
- `is_default` 唯一：创建/更新时清其它默认
- 非管理员可提交 `status=pending`；前端编辑过滤 `sort_order` / `is_default`

### Token 白嫖通告

- 前台 `/tokens`（公开列表 + 筛选 + 详情弹层）；后台 `/admin/token-deals`（审核队列）
- 发布：登录用户可发，落库 `status='pending'`；仅作者（`mine=1`）与管理员可见待审核项
- 审核：管理员通过 / 驳回；驳回写 `reject_reason`，**匿名读驳回详情返回 403**，作者可读并可编辑重提
- 投票：一人一票（`UNIQUE(deal_id, user_id)`）——重复投同向 = **取消**，投反向 = 改票
- 评测：一人一评（`UNIQUE(deal_id, user_id)`）——重复提交为**更新**（不新增计数）；`rating` 限 1-5，越界 400
- 置顶：**仅管理员**（普通用户 403）；删除：作者或管理员
- 计数：`vote_up` / `vote_down` / `rating_sum` / `rating_count` 为缓存列，统一由 `syncDealCounters(db, id)` 在 `db.transaction` 内重算，勿在各接口里手工 ±1
- 排序：`hot`（净票数）/ `rating`（平均分）/ `expiring`（临期）；筛选 `region` / `quality` / `source_tag` / 关键词
- 种子：`token_deals` 为空时插入 10 条默认通告（`seed-token-deals.ts`）

### 扩展同步（服务端语义）

- 入参扁平：`{ title, url, folder_path, icon }`
- `ensureFolderPath()` 递归建夹
- 已存在 URL：更新标题/分类，**不覆盖**已有 icon；icon 按 hostname 去重下载
- 增量：`PUT /api/sync/bookmarks`（全量 upsert）；图标走 `POST /api/sync/favicons`（base64）
- 服务端行为（去重、不覆盖 icon、`ensureFolderPath`）见服务端代码，改协议时两边一起改

## 安全（改代码时保持）

- CORS、JWT 封装、错误脱敏、参数校验、rate-limit、favicon SSRF 限制
- 前端：避免对用户内容 `v-html`；Teleport 到 body 勿依赖父级 scoped 选择器

## 部署

CI：仅 `VERSION` 推送 `main`（或 `workflow_dispatch`）→ `ghcr.io/<owner>/favshub:<ver|latest|sha>`。

快速参考（细节与密码见本地 `DEPLOY.md`）：

```bash
git push origin main
# 发镜像时：
echo "1.0.X" > VERSION && git add VERSION && git commit -m "chore: bump VERSION to 1.0.X" && git push
gh run list --limit 1
# 可选本地：pnpm build && bash build.sh；docker tag/save | gzip；服务器 load + compose up
curl -s http://<SERVER>:3090/api/health
```

注意：Windows 部署优先原生 SSH（`C:\Windows\System32\OpenSSH\ssh.exe`）；`docker load` 后直接 `compose up`，避免无谓 `rmi` 重拉大层。

## 开发注意事项

- **async**：try/catch/finally；catch 用 `err`，勿遮蔽外层参数
- **Teleport**：弹层用全局选择器或无父链依赖的 scoped
- **SSR / hydration**：`useMobile` 等 SSR 与客户端宽度可能不一致；`isMobile` 默认须与 CSS 断点（约 `1024px`，`mobile-responsive.css`）一致，避免 mismatch / `insertBefore`
- **watch**：下一 tick 异步；同一操作勿「手动调 API + 依赖 watcher 再调」
- **CSS 缓存**：`layouts/default.vue` / `admin.vue` 的 `useHead` 上 `?v=`
- **CI**：功能提交不必 bump `VERSION`
- **密钥**：勿提交 `DEPLOY.md`、密码、JWT secret
