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
- **样式分两层**：手写全局样式在 `public/css/*.css`（由布局 `useHead` 引入）；组件 `<style scoped>` 由 Vite 打包成 `/_nuxt/*.css`。`nuxt.config.ts` 中 `features.inlineStyles: false` 是刻意设置——不把 scoped 样式内联进 SSR HTML 的 `<style>`（每页省约 8KB，且 CSS 带 hash 可复用 `/_nuxt/**` 的 immutable 缓存）。因此 render 出的 head 里**不应再出现明文 `<style>` 块**；若回归，先查该开关是否被改回 `true`。检查方法：`curl -s https://hao.bx9y.com.cn/ | grep -c "<style"`。

## 环境变量

通过 `nuxt.config.ts` 的 `runtimeConfig` 映射为 `NUXT_*` 环境变量；`.env.example` 含参考模板。

| 变量 | 说明 | 默认 |
|------|------|------|
| `NUXT_JWT_SECRET` | JWT 签名 | 空 → `data/.jwt-secret` 或自动 48 字节 |

> ⚠️ **`NUXT_JWT_SECRET` 绝不能留公开的占位值**（2026-10-30 生产实测）。
> 该密钥同时用于两处，猜中即等同站点接管：
> 1. 签发/校验登录令牌 —— 可为任意用户（含 `is_admin=1`）伪造令牌；
> 2. `utils/avatar.ts` 的 `deriveKey()` 基座 —— QQ 密文与去重指纹都由它派生。
>
> 事故样本：部署副本 `compose.yaml` 写 `NUXT_JWT_SECRET=${NUXT_JWT_SECRET:-please-change-this-to-a-random-string}`
> 而 `.env` 未定义该变量 → 容器实际用的是那个公开常量 → 用它可以签出访问 `/api/admin/*` 返回 200 的令牌。
> 仓库版本写的是 `:-}`（空值会走「自动生成并持久化」的安全分支），是**部署副本**把默认值换坏了。
> 现在 `utils/jwt.ts` 会在启动时对该占位值大声告警（只告警不阻断，避免站点因配置项起不来）。
>
> 轮换密钥的代价：所有会话失效（需重新登录）；`token_deal_guest_reviews.qq_cipher`
> 会解不开 → 相关游客头像退化为字母头像（正文不受影响）；`digest()` 指纹整体轮换 →
> 「同一访客同一通告只能评一次/投一票」对**历史行**短暂失效。**不需要数据迁移**。
| `NUXT_DB_PATH` | SQLite 路径 | `./data/favshub.db` |
| `NUXT_CORS_ORIGIN` | CORS | `http://localhost:3000` |
| `NUXT_ADMIN_USERS` | 额外管理员用户名（逗号分隔）；**AI 通道的管理员判定同样读取它** | 空 |
| `NUXT_TRUST_PROXY` | 信任 `X-Real-IP` / `X-Forwarded-For`（见「限流与并发 → 取真实 IP」；本站双层反代下**不需要**开） | `false` |

> ⚠️ **容器/本机的 DNS 不可使用 fake-ip 模式**（Clash、mihomo TUN 等，2026-10-30 实测）。
> fake-ip 会把**所有域名**解析到 `198.18.0.0/15`，而该段被 `server/utils/favicon-download.ts`
> 的 SSRF 护栏按「基准保留段」拦截 → 「拉取模型列表」与 favicon 下载**全部失效**，
> 表现为 `不允许访问内网地址`。生产用的是普通 DNS，不受影响；
> 但**本地开发若开着这类代理，模型拉取的出站成功路径无法在本机验证**（只能验证拒绝分支）。
> 护栏本身假定是正常解析器，这是刻意的取舍：宁可自建 DNS 时不可用，也不放行可被
> 攻击者用自控权威 DNS 指到内网的解析结果。

| `NUXT_PUBLIC_BASE_URL` | 站点对外地址（canonical / og:url / og:image / sitemap.xml 用） | `https://hao.bx9y.com.cn` |

限流阈值用 `FAVSHUB_RL_*`（**不走 runtimeConfig**，`server/utils/rate-limit.ts` 直接读 `process.env`，
进程启动时读一次并缓存；非法值告警后回退默认）。完整清单与默认值见「限流与并发」一节的阈值表。

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
    search-engines / backup / settings / config / token-deals / api-tokens
components/            # auth, bookmark, search, sidebar, prompts, collections, tokens, mobile, common
composables/           # useAuth, useMobile, useTheme（11 套主题：7 浅 + 4 深）
stores/                # auth, bookmarks（含 viewMode）, searchEngines, settings, ui
layouts/               # default.vue（前台+移动端壳）, admin.vue
middleware/admin.ts    # 客户端：需登录进 /admin
error.vue              # 根级错误页（404/500 统一渲染）
public/css/            # tokens, themes, main-bundle, admin, mobile-responsive, promptpro, error
public/images/         # 引擎 logo、systermicon（favicons/ 为运行时数据，不入库，见 .gitignore）
public/robots.txt      # SEO 爬虫规则 + sitemap 链接
server/api/            # Nitro 文件式路由 → /api/*
  ai/                  # AI 数据操作 REST（**PAT 通道**，见「AI 数据操作通道」）
  user/api-tokens/     # 令牌自管（**JWT 通道**）
  mcp.post.ts          # MCP（JSON-RPC 2.0）端点，**PAT 通道**
server/routes/         # 非 API 路由（sitemap.xml.ts — 动态站点地图）
server/database/       # schema.ts, migrate.ts, index.ts
server/middleware/     # admin-guard, cors, cache-control（公开页 CDN 缓存头升级）
server/plugins/        # db-init, theme-init, error-handler, backup-scheduler, rate-limit-cleanup
server/utils/          # auth, jwt, config, constants, rate-limit, settings-cache, favicon-download, favicon-dir, delete-user, token-deals, seed-token-deals, ai-auth, ai-service
scripts/               # 运维 / 冒烟脚本（ai-api-smoke-{read,write}.mjs、token-deals-smoke-*）
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
- **右下角悬浮件会互相打架（2026-10-30 实测）**：`#back-to-top-container` 在 ≤1024px 为
  `position:fixed; bottom:calc(80px + safe-area); right:0; z-index:10004`，
  其 50×50 按钮带 `margin:32px`，实际占据 **右侧 32–82px / 底部 112–162px**；
  公告挂件 FAB 原为 `right:24px; bottom:120px; z-index:990` → 两者重叠，且 FAB 的
  z-index 远低于回到顶部容器（10004），**点击直接落到回到顶部按钮上、FAB 完全点不到**。
  修法是把 FAB 抬到回到顶部之上（`bottom: calc(176px + safe-area)`）并居中（≤1024 用 `right:33px`，
  ≤768 用 `right:35px` 配 44×44）。**以后往右下角加悬浮件，必须先量这两个数**。
- Pinia `bookmarks`：个人书签 vs 精选集 `viewMode` / `fetchCollectionData`

### 管理后台能力

- 已登录用户自管数据（按 `user_id`）；管理员管全站用户、官方精选集、系统配置、备份等
- 书签：列表 + 文件夹，两级筛选、树形、图标
- 提示词：列表 + 文件夹 + 标签 + 历史 + 审核
- 搜索引擎：CRUD + 用户提交审核
- Token 通告：待审核队列 + 通过 / 驳回（含驳回原因）+ 置顶 + **已失效面板**（`admin/token-deals`，
  「已失效」Tab 汇总已过期 / 判定失效 / 已删除三类，可恢复、续期、改永久、彻底删除）
- 备份：手动 + 每日定时 + 百度网盘（见 `admin/backup`）

## 数据模型

- 驱动：better-sqlite3，WAL + 外键
- 多步写：**必须** `db.transaction(() => { ... })()`
- 原始连接：`getRawDb()`（事务/特殊 SQL）
- 迁移：`server/database/migrate.ts` 启动时增量执行（不要假设只用 drizzle-kit push）
- 书签去重：`UNIQUE(user_id, url)`
- 管理员：预置 `admin_favs`(id=1, `is_admin=1`)；仅当库中**无任何管理员**（`is_admin=1 AND id>0`）时，首个注册用户兜底提权（防站点锁死）。启动种子约 29 个搜索引擎（SEARCH / AI / SOCIAL）
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
`token_deals` / `token_deal_votes` / `token_deal_reviews` / `guest_submit_quota`
（Token 白嫖通告与游客提交配额，见「产品域行为」）  
`token_deal_invite_codes`（通告邀请码池：比例 / 复制阈值 / 计数，见「邀请码」；**公开侧绝不下发**）  
`announcements`（站点公告；`status` 仅 `published`/`pending`，删除走正交的 `deleted_at`/`deleted_by` 软删除，
见「站点公告与友情链接」）  
`token_deal_events`（对外订阅的事件流，**append-only，`seq` 即游标**）/ `deal_subscriptions`
（游客机器人订阅账本，见「通告事件流与订阅」）  
`token_keys` / `token_key_votes`（福利 Key 快照与可用性投票，见「产品域行为」；**时间戳为秒**，其余表为毫秒）  
`api_tokens` / `ai_audit_logs`（AI 数据操作 PAT 与审计，见「AI 数据操作通道」）

提示词与提示词文件夹 **ID 是字符串**（时间戳+随机后缀）→ 路由**不要** `parseInt`。

JSON 数组：`JSON.parse` 后 `Array.isArray()`；**空数组也要执行清除**（如标签），勿当无变更跳过。

**迁移三坑**（2026-09 实测，改 `migrate.ts` 前必读）：

- **多语句 `db.exec()` 是原子性陷阱**：块内任一语句报错即中断整块，其后语句**全部静默不执行**，且只留一行 warning。兜底 / 高风险语句（如 `CREATE INDEX`）**必须独立 `try/catch`**，勿塞进大 exec 块 —— 曾因一条索引失败连带其后 31 条 `CREATE INDEX` 全部未执行。
- **生成列检测必须用 `PRAGMA table_xinfo`**：`table_info` **不返回生成列**，用它判断列是否存在会恒为 false → 每次启动重复 `ALTER` 并被静默吞掉。另：`ALTER TABLE ADD COLUMN` **只支持 `VIRTUAL` 生成列**，写 `STORED` 会报 `cannot add a STORED column`。
- **重建表会丢列**：`CREATE TABLE x_new` + `INSERT` + `RENAME` 的写法只保留显式列出的字段。`bookmarks` 重建分支（原 `entry_id` 存在时触发）即会丢弃生成列 `has_sync` —— 新增生成列时须同步补进重建定义，或把 `ALTER` 排到重建之后。
- **新增表/索引一律拆成独立 `try/catch`**：AI 通道的 `createAiSchema(db)`（2 表 + 4 索引）即按此写法，且**不得**并入 `createTables()` 的大 `exec` 块，否则一条失败会静默带走其后全部语句。

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
| `/api/token-deals/*` | Token 通告：列表 / 详情 / 发布 / 改删（软删除）/ 投票 / 评测 / 导入 / 置顶 | 混合 |
| `/api/token-deals/:id/invite-code` | 公开抽**一个**邀请码（服务端加权随机，`canReadDeal` 同口径） | 混合 |
| `/api/token-deals/:id/invite-code/:codeId/copy` | 邀请码复制计数（IP+通告 限频 20/h；写闸门 `findWritableDeal`） | 混合 |
| `/api/token-deals/:id/invite-codes` | 完整码池读写（全量替换；仅作者 / 管理员） | 登录（作者/管理员） |
| `/api/token-deals/fetch-models` | 从 `call_url` 拉取模型清单（服务端出站，SSRF 三重防护；登录 30/h、游客 6/h） | 混合 |
| `/api/announcements[/:id]` | 站点公告公开读取（仅 `published` 且未软删除） | 无 |
| `/api/admin/announcements[/:id]` | 公告管理：三态（`published`/`pending`）+ 软删除 + `{restore:true}` 恢复 | 管理员 |
| `/api/admin/token-deals/:id/restore` | 恢复删除 / 撤销失效 / 标记失效 / 续期 / 改永久（管理员，支持 `dry_run`） | 管理员 |
| `/api/admin/token-deals/:id/purge` | 彻底删除通告及其明细（物理删除，须 `{confirm:true}`） | 管理员 |
| `/api/token-deals/changes` | 通告事件增量流（`?tail=1` 基线 / `?since=` 增量 / `?token=` 过滤；无变化 304） | 无 |
| `/api/token-deals/feed.atom`、`feed.json` | Atom / JSON Feed 1.1（仅上新/变更/续期） | 无 |
| `/api/deal-subscriptions[/:token]` | 游客建 / 查 / 改 / 退订机器人订阅（`sub_token` 即凭证） | 无 |
| `/api/admin/token-deals/subscriptions`、`/events` | 后台订阅账本与最近事件（排查「为什么没推」） | 管理员 |
| `/api/token-keys/*` | 福利 Key：公开脱敏列表 / 复制明文 / 可用性投票 / 我的投票 | 无（投票按指纹身份） |
| `/api/sync/*` | 扩展书签 / favicon 同步 | 登录 |
| `/api/favicon?domain=` | favicon 服务端代理 + 本地缓存（SSRF 防护） | 无 |
| `/api/settings/*` | 用户设置 | 登录 |
| `/api/search-engines` | 公开引擎列表 | 无 |
| `/api/admin/*` | 用户/书签/提示词/精选集/引擎/备份/配置/Token 审核 | 管理员（部分自管） |
| `/api/health`、`/api/config/registration`、`/api/tdk*` | 健康检查、注册开关、SEO | 无 |
| `/api/user/stats` | 用户统计 | 登录 |
| `/api/user/api-tokens/*` | API 令牌自管：列出 / 创建 / 吊销 | 登录（**JWT 通道**） |
| `/api/ai/*` | AI 数据操作：describe / stats / 书签 / 文件夹 / 提示词 / 标签 / 通告 | **PAT**（`favs_ai_`，scope 分级） |
| `/api/mcp` | MCP（JSON-RPC 2.0）：initialize / ping / tools/list / tools/call | **PAT**（与 `/api/ai/*` 同一套） |

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
- 游客发布（未登录）：昵称 + 人机校验（见下）+ 内容过滤，落库 `user_id=0`（种子系统用户 `_system`）
  + `guest_name` / `guest_fingerprint`；**同一 IP 每天限 1 条**（`guest_submit_quota` 表，
  滚动 24h 窗口；配额行与通告行**同事务**写入，校验失败不占配额），另有每指纹在审上限 3 条、
  同领取地址去重。管理员/登录用户不受此限
- 审核：管理员通过 / 驳回；驳回写 `reject_reason`，**匿名读驳回详情返回 403**，作者可读并可编辑重提
- 投票：一人一票（`UNIQUE(deal_id, user_id)`）——重复投同向 = **取消**，投反向 = 改票
- 评测：一人一评（`UNIQUE(deal_id, user_id)`）——重复提交为**更新**（不新增计数）；`rating` 限 1-5，越界 400。
  登录用户评测（即时公开、无审核）自 2026-10-12 起同样有限频（每用户 20/h、每 IP 40/h）与广告黑名单过滤
- 置顶：**仅管理员**（普通用户 403）；删除：作者或管理员 —— **软删除**（见下「生命周期」）
- 计数：`vote_up` / `vote_down` / `rating_sum` / `rating_count` 为缓存列，统一由 `syncDealCounters(db, id)` 在 `db.transaction` 内重算，勿在各接口里手工 ±1
- 排序：`hot`（净票数）/ `rating`（平均分）/ `expiring`（临期）；筛选 `region` / `quality` / `source_tag` / 关键词
- 种子：`token_deals` 为空时插入 10 条默认通告（`seed-token-deals.ts`）

#### 生命周期：已过期 / 判定失效 / 已删除（2026-10-20）

> 判定分两类入口：**读**用 `canReadDeal(deal, {id, isAdmin})`，**写**用 `findWritableDeal()`；
> 列表类 SQL 用 `publicVisibleClause(alias, params)` 拼条件。三者口径必须一致。

状态机与 `status`（审核态）**正交**，四列全部是毫秒时间戳或空：

| 列 | 含义 |
|----|------|
| `deleted_at` / `deleted_by` | 软删除：谁在何时删的。恢复后按原审核态重新上架 |
| `invalid_at` / `invalid_reason` | 失效：`expired`（到期）/ `votes`（社区投票判定）/ `manual`（管理员判定） |

三类互斥，优先级 **已删除 > 判定失效 > 已过期**；「已过期」既指归档后
`invalid_reason='expired'`，也指到期未归档（`invalid_at IS NULL AND expires_at <= now`）——
判定逻辑的单一真源在 `admin/token-deals/index.get.ts` 的 `P_DELETED / P_INVALID / P_EXPIRED / P_LIVE`
与 `classify()`，改口径只改这里。

- **对外不可见**：公开列表、详情直达、评测列表 / 游客评测、投票、提交评测、建议、打标、置顶、
  导入、分享卡片（PNG）、AI 通道，对不可见条目**统一 404**（不是 403 —— 403 会泄露「这条存在」）。
  规则集中在 `publicVisibleClause()` / `isPubliclyVisible()`（列表与写入口）与
  `canReadDeal()`（读入口，含作者/管理员例外）/ `findWritableDeal()`（`utils/token-deals.ts`）。
  **新增任何按 id 读通告内容的端点，都要先过 `canReadDeal()`** —— 否则会出现
  「详情 404，但换个端点还能把失效内容读出来」。
- **例外（作者视角）**：自己的**过期 / 失效**通告仍可打开详情（据此续期），列表走 `mine=1`；
  但**已删除**的除管理员外一律 404 —— 恢复是管理员动作，防止被下架内容被作者自行「复活」。
- **自动失效**：`archiveExpiredDeals()`（`db-init` 启动时 + 打开后台失效面板时各跑一次，幂等）
  把到期行写成 `invalid_at = COALESCE(expires_at, now)`、`invalid_reason='expired'`，
  使后台「失效时间」是真实到期时刻而非打开页面的时刻；投票阈值
  `INVALID_VOTE_RULE = {minDownVotes:3, minDownRatio:0.6}` 由 `evaluateDealVoteInvalidation()`
  在**真实投票后**判定（**不要放进 `syncDealCounters`** —— 种子数据带演示负票会被误判）。
- **可逆性**：投票类失效在负票回落到阈值以下时自动撤销，且这类条目仍允许继续投票
  （`findWritableDeal(..., {allowVotesInvalid:true})`，否则阈值一触发就自我锁死、负票再也撤不掉）；
  `manual` / `expired` 不被投票推翻。续期或改永久只清除 `expired` 类。
- **后台端点**：`GET /api/admin/token-deals?view=invalid[&lifecycle=expired|invalid|deleted]`、
  `POST /api/admin/token-deals/:id/restore`（`{action: restore_delete|restore_invalid|mark_invalid|extend|set_permanent}`，
  支持 `dry_run`）、`DELETE /api/admin/token-deals/:id/purge`（**物理删除**，必须 `{confirm:true}`，
  显式清理 6 张明细表，不依赖 FK 级联）。审核队列（`view=queue`）只含在架条目，与失效面板互不重叠。
- **AI / MCP / QQ**：`/api/ai/token-deals` 列表同样按上面口径过滤，删除即软删除；
  QQ 机器人待审汇总额外报「已失效 N 条」。

#### 人工核验时间轴（2026-10-20）

> 白嫖资源最大的坑是「早失效了还挂在列表里」。社区投票是**用户**反馈，
> 人工核验是**站点确认「此时此刻仍然可用」**，两者互补、互不替代。

| 列 / 表 | 含义 |
|----|------|
| `token_deals.verified_at` | 最近一次确认可用的时刻；`0` / `NULL` = 从未核验 |
| `token_deals.verified_by` | 核验人（管理员用户名）——**任何身份都不下发**（含管理员浏览公开前台），后台走 `/api/admin/token-deals` |
| `token_deals.verify_note` | 最近一次核验备注（如「注册实测通过，额度到账」） |
| `token_deal_verifications` | 核验流水（`action` / `note` / `actor` / `created_at`），append-only |

- **写入口唯一**：`verifyDeal()`（`utils/token-deals.ts`）+ `POST /api/admin/token-deals/:id/verify`
  （`{action: alive|dead|note, note?}`，仅管理员）。`action='dead'` 走 `markDealInvalid(..., 'manual')`，
  幂等，且**只有真正从可见变失效那一次**会产出 `offline` 事件。
- **核验不产生事件**：确认「没有变化」不该推给订阅者 —— `alive` / `note` 只写时间轴与流水，
  绝不 `appendDealEvent`。想让订阅者知道下架，只有 `dead`。
- **`alive` 不隐式恢复**：通告当前已失效 / 已过期时，`alive` 依旧记录核验事实，但**不改可见性**，
  返回 `visible:false` 与提示文案；恢复要显式走 `restore` 端点（管理员看得见自己点了什么）。
- **「待复核」只是提示**：`isVerifyStale()` / `verifyAgeDays()` + 配置 `deal_verify_stale_days`
  （默认 30，范围 7–365，`SYSTEM_ONLY_KEYS`）。超阈值只影响前台/后台的**标记与筛选**
  （`?stale=1`、后台 `?verify=stale`），**不影响可见性** —— 可见性仍由
  `status` / `deleted_at` / `invalid_at` / `expires_at` 决定，别把两件事混在一起。
- **派生字段**：列表/详情返回 `verified_at`、`verify_age_days`（-1 = 从未核验）、`verify_stale`、
  `verify_note`；详情另带 `verifications`。
- **核验人永不出现在前端（2026-10-30）**：`verified_by` 恒下发空串、`verifications[].actor` 恒置空，
  **不再按 `isAdmin` 放行**。原因：原实现写成 `isAdmin ? row.verified_by : ''`，管理员浏览公开前台时
  仍会看到账号名，与「前端不出现敏感信息」直接冲突。前端组件也不再渲染该字段。
- **AI 侧**：`/api/ai/describe` 把 `verified_at` / `verify_stale` 标为**只读**字段（AI 不能自封核验），
  并提示「优先推最近核验 + 社区投票健康」的条目。

#### 通告事件流与订阅（2026-10-20）

游客装技能后想让自己的 Hermes 机器人**在通告变化时收到消息**。架构选择是 **pull-first**：

```
站内写路径 → appendDealEvent() → token_deal_events（append-only，seq 即游标）
                                        ↓ 游客机器 cron 拉增量
                            GET /api/token-deals/changes?since=<seq>
                                        ↓ 本地渲染
                            hermes send -t qqbot:<群号> --json "<text>"
```

- **站点零出站**：不做任何主动 HTTP，因此没有 SSRF 面、不会被当成刷屏放大器、也不需要地址验证；
  群号 / 频率 / 文案全在游客自己手里，符合「游客只有接收能力」。
- **公开边界**（`server/utils/deal-events.ts` 的 `appendDealEvent`，**fail-closed**）：
  `offline` 要求 `wasPublished(before)`（审核通过 + 未软删 + 未失效，**故意不看 `expires_at`**，
  否则到期归档这一事件永远发不出去）；其余类型要求 `nowPublic && status==='approved'`。
  `updated` 无实质差异则不写。
- **两套渲染并存**：`text`（单行 ≤200 字，给 OneBot 这类没有富文本的通道兜底）+ `markdown`
  （多行富文本：`### ` 标题 / 加粗标题 / 字段列表 / 领取与官网地址 / 可点详情链接）。
  **钉钉群机器人和 QQ 官方机器人私聊都吃 markdown**（QQ 走 `msg_type=2`，实测返回 200；
  QQ 群主动消息需**群主开通【机器人主动在群聊内发言】权限**，未开通会报 `40034105`，开通后每日 1000 条）。脱敏事件（`deal_redacted`）
  的 `markdown` 不推可点链接，只留一句「已下架」说明。
- **推送只放读者关心的字段**：额度 / 模型 / 到期 / 领取 / 官网 / 评分。**品级（`quality`）、
  地区（`region`）属于站内运营信息，不进推送**——`snapshot` 里仍有，渲染时故意不用。
- **分类（`category`）**：`token`（默认，API 额度）/ `cloud`（免费云服务器）。云服务器与 API 额度
  共用一块通告板，但领取方式与核验口径完全不同，所以前端筛选、卡片徽标、推送文案都按分类分流；
  新分类要同时改 `server/utils/token-deals.ts` 的 `DEAL_CATEGORIES`、迁移里的默认值，以及
  `TokenFilterBar` / `TokenDealEditor` / `TokenDealCard` / `TokenDealDetail` 四处的常量副本。
- **不在推送与公开页暴露身份**：`users.username` 一律不出现在 `/api/token-deals*`、
  `/api/collections*` 的响应里（管理员接口除外）；详情页「发布者」只显示用户自填昵称，
  没有昵称就显示「社区用户」；待审通知里提交人只写「游客 / 注册用户」。
- **2026-10-30 二次收紧（前端脱敏）**：光靠「管理员除外」不够 —— 管理员也会用公开前台，
  而前台一旦渲染就是泄露。因此：
  - 用户名类字段（`verified_by`、`verifications[].actor`）**任何身份都不下发**，只看后台；
  - 内部标识（`user_id`）、下架操作人（`deleted_by`）不进公开列表/详情 —— 归属判断一律用服务端算好的
    `is_owner` / `can_edit` / `can_moderate`，前端不需要也不该拿到 ID；
  - `server/utils/deal-edits.ts` 的 `displayName()` / `reviewer` **不再回退到 `username`**
    （原为 `nickname || username || '匿名'`，没设昵称的用户会在公开前台的「修改建议」里
    直接暴露登录账号名），改为 `nickname || '社区用户'`；
  - **游客指纹也不下发**（`guest_fingerprint`）：`...row` 展开全列会让它混进公开列表/详情
    （2026-10-30 审查实测确认）。它是 `sha256(ip|ua)`，与 `utils/guest-reviews.ts` 的身份识别
    是**同一算法**，一旦泄露就能把「同一个匿名访客发过的所有通告」串起来，游客通道的匿名性即失效。
    现在列表与详情都显式置 `undefined`。**`guest_name` 要保留** —— 那是游客自填的展示名，与昵称同级。
  - 公开侧仍用 `...row` 展开全列，所以**每次往 `token_deals` 加内部字段都要回来看一眼**
    这两个端点要不要显式剔除。
- **`text` / `markdown` 都不落库**：只存 `snapshot`（公开字段）+ `meta.changes`（差异结构），文案在读取时渲染
  —— 站点换域名时链接跟着变。`offline` 的 `snapshot` 走 `offlineSnapshot()` 只留
  `id/provider/title/expires_at/share_path`：下架后额度 / 模型 / 领取链接不该再从公开流里读到。
- **事件写入永不回滚业务事务**：整体包在 try/catch 里，失败只 warn。
- **埋点位**：`softDeleteDeal` / `restoreDeletedDeal` / `markDealInvalid` / `clearDealInvalid` /
  `archiveExpiredDeals` / `reviewDealById`（audit=approve）/ `purgeDealPermanently`（连带删事件）/
  `token-deals/index.post.ts`（管理员直发）/ `[id].put.ts` / `[id]/pin.post.ts` /
  `admin/.../restore.post.ts`（extend、set_permanent）/ `ai-service.ts`（创建、更新）/
  `deal-edits.ts`（提案通过）。
- **游标语义**：`next_since` 推进到**取到的**最大 seq（不是命中的），否则带过滤的订阅会在同一段反复重扫。
  首次接入必须 `?tail=1` 取基线，**永不回灌历史**。
- **游标超前不报错**：`since > maxSeq`（多为事件被保留期清理后 `seq` 回落）时**归位到 maxSeq**
  并回 `notice` + `cursor_reset: true`。不要改回 400 —— 无人值守的 cron 遇到 400 就是永久静默失败，
  而归位不会跳过客户端还没见过的序号。
- **总开关** `deal_events_enabled=false` 会在 `appendDealEvent()` 入口直接返回（业务写入照常）。
  写侧开关 + 读侧 `deal_changes_public` 是两层独立的闸门。
- **订阅凭证**：`sub_token` = 32 字节随机 hex，只在 `POST /api/deal-subscriptions` 返回一次；
  之后一律脱敏（`maskSubToken`）。站点不采集游客身份，只有 `created_ip_hash`（sha256 前 16 位）。
- **读侧可见性收敛（必须）**：事件 snapshot 是**写入当时**的快照，通告之后可能被软删 / 失效 /
  到期归档 —— 而它更早的 `online|updated|renewed` 事件还在表里。所有公开出口都要过
  `publicEventViews()`（`server/utils/deal-events.ts`）：当前不可见就降级成最小快照 + 清空差异，
  并打 `deal_redacted`（feed 据此整条剔除）。**不要**直接 `toEventView()` 对外吐。
- **`deal_sub_enabled=false` 是整条链路的闸门**：`resolveSubscription()` 直接返回 null，
  于是查 / 改 / 退订 / 带 token 拉取一律 404，不必逐个端点加判断。
- **限频键收敛**：订阅创建用 `rateKeyForIp()`（IPv6 → /64），否则换地址即重置配额；
  `changes` 与两个 feed 各自 60 次/小时/IP。
- **暂停订阅的判断必须早于 304**：否则带 `If-None-Match` 的轮询永远拿不到 `paused` 提示，
  后台「最近来拉」也不更新。ETag 里带订阅 id，不同过滤条件不能共用同一个 304。
- **死订阅淘汰**：`pruneDeadSubscriptions()` 在 db-init 启动时 + 每 24h 跑一次
  （`revoked` 超 90 天删除；`active/paused` 超 180 天没拉取则自动置 revoked）。
- **配置项**：`deal_events_enabled` / `deal_changes_public` / `deal_feed_enabled` / `deal_sub_enabled` /
  `deal_sub_per_ip_per_day`(3) / `deal_events_retention_days`(90) / `deal_changes_max_limit`(100)。
  保留期清理在 `server/plugins/db-init.ts` 启动时跑（`pruneDealEvents`）。
- **不要**给这条链路加「站点主动推送到游客地址」的能力：那会让站点变成开放出站代理。

#### 邀请码（2026-10-30）

> 需求：一个通告可配**多个**邀请码，每个码可设「展现比例」与「被复制次数」；
> 用户访问详情页时邀请码按比例出现，前端**只显示一个**，被复制次数达到阈值后不再出现。

| 表 / 列 | 含义 |
|----|------|
| `token_deal_invite_codes.deal_id` | 所属通告（带 `ON DELETE CASCADE`，但**不要依赖级联**，见 `purgeDealPermanently`） |
| `.code` / `.label` | 邀请码内容 / 展示备注 |
| `.weight` | 展现比例（相对权重，`<=0` 兜底为 1） |
| `.copy_limit` | 被复制次数上限，`0` = 不限 |
| `.copy_count` | 已复制次数（由 copy 端点自增） |
| `.enabled` / `.sort_order` | 是否参与抽取 / 展示顺序 |

- **码池绝不随详情下发（核心设计）**：若把 `invite_codes` 数组放进 `GET /api/token-deals/:id`，
  前端「按比例只显示一个」就纯属摆设（F12 一开全看得见），比例与阈值同时失效。
  因此公开侧只有两个端点，且都**不暴露码池**：
  - `GET /api/token-deals/:id/invite-code` → 服务端按权重**加权随机抽一个**，只返回这一个，
    并附一个 32 位 HMAC 抽中凭证 `t`；无可用码返回 `{ id:null, code:null, t:'' }`。
    **按 IP + 通告限频 60 次/小时** —— 原先完全无限频，脚本循环请求即可把整池码收割走。
  - `POST /api/token-deals/:id/invite-code/:codeId/copy` → 计数，body 必须带 `{ t }`。
    没有凭证的话，枚举 `codeId` 就能把每个码的配额逐个烧满、把码从池里挤出去
    （实测把 `copy_limit=2` 的码两次烧满）。凭证校验见 `verifyDrawToken`，管理员豁免。
- **可见性口径必须走 `canReadDeal` / `findWritableDeal`**：2026-10-30 审查发现这两个函数
  **原先都不判 `status`**（注释写「与 `status='approved'` 配合」，等于把责任推给每个调用方）——
  详情端点自己补了，新加的邀请码端点没补，于是**未过审 / 已驳回通告的邀请码可被匿名读到**
  （实测 200 + 明文码，而同一 deal 的详情是 403）。现在 `status` 判定收在函数内部，
  新增任何按 id 读写通告的端点直接调它们即可，不必也不该再自己补一次。
- **`copy_limit` 是「防君子不防小人」**：用户完全可以把码手动抄给别人而不点复制按钮，
  凭证与限频只是让「通过本站接口刷」变得有成本。前端文案按这个口径写，
  不要宣称「散播次数严格等于计数值」。
- **完整码池只在作者/管理员侧**：`GET|PUT /api/token-deals/:id/invite-codes`
  （`findManageableDeal` 闸门：已删除 → 404，非作者非管理员 → 403）。
- **全量替换语义**：`PUT` 的 `codes` 就是最终码池，缺失的码被删除；缺 `codes` 字段 → 400
  （避免调用方漏传被静默当成「清空码池」）。
  **前端配套**：编辑器读码池失败时锁住编辑并跳过这笔 PUT（`inviteCodesLoaded`），
  否则「读失败 = 空池」会把整池连同 `copy_count` 删掉。
- **`copy_count` 在替换时按码内容沿用**（`replaceInviteCodes`）：否则每次编辑通告
  （哪怕只改标题）都会把计数清零，已经用满的码会重新开始出现。
  匹配是**大小写敏感的精确匹配** —— 改码内容（含只改大小写）即视为新码、计数从 0 起，
  这是刻意的（运营可借改码重置额度）。
- **`enabled` 只认显式停用**：`false` / `0` / `'false'` / `'0'` 才算停用，其余一律启用。
- **计数是原子的条件自增**：`UPDATE ... SET copy_count = copy_count + 1 WHERE ... AND (copy_limit = 0 OR copy_count < copy_limit)`，
  把「检查」和「自增」压进同一条语句，避免并发超发（实测 4 进程 × 60 次 / limit 25 → 恰好 25，零超发）。
- **加权随机的退化保护**：`weight <= 0` 兜底为 1；权重之和算出 `Infinity` 时改用等概率
  （否则永远返回池中最后一个码、其余码被饿死）。
- **AI 通道不开放码池读写**：邀请码属分发控制信息，走人工界面更可控，故不入 `DEAL_PATCHABLE`。
- **前端**：详情页 `TokenDealDetail.vue` 的邀请码区块（只读、带复制按钮，复制时带凭证上报一次计数）；
  编辑器 `TokenDealEditor.vue` 的码池表格仅在 `isEdit && !isGuest && !isProposal` 时出现
  —— 码池挂在通告 ID 上，新建时还没有 ID。

#### 富文本备注与 HTML 消毒（2026-10-30）

- 备注上限 **500 → 2000**（`LIMITS.note`，前后端同步），支持 Markdown + HTML + 图片。
- **渲染放在服务端**：详情接口新增 `note_html`，由 `server/utils/rich-text.ts` 的
  `renderRichText()` 用 `marked` 解析后经 `sanitize-html` 白名单消毒，**前端只 `v-html` 成品**。
  选这条路的理由：备注是**普通用户可写**字段，消毒点必须在唯一入口；
  若交给前端渲染，每个消费方（页面/分享卡片/快照）都得记得消毒一次，漏一处就是漏洞。
- 白名单只放行常见排版标签与 `img` / `a` / `table` / `code` / `pre`；
  `a` 强制 `rel="noopener noreferrer"`；协议只允许 `http` / `https` / `mailto`
  （**不放行 `data:`** —— 2000 字上限下 base64 图片根本塞不下，放行只有风险没有收益）。
- 降级路径保守：`marked` 或 `sanitize-html` 抛异常时，只输出**转义后的纯文本**，
  绝不把原文当 HTML 吐出去。
- 原始 `note` 仍照常下发（供编辑器回填），前端渲染一律用 `note_html`。
- 公告正文沿用「前端 `marked` + `v-html`」的既有实现（公告正文是**管理员**独有权限的字段），
  本次未改动；新增的富文本场景请一律走 `renderRichText()`。

#### 模型清单拉取（2026-10-30）

- 需求：「内置 `/v1/models` 接口直接获取模型，然后手动点击选择；部分平台需要 key 才出现 key 字段，
  填了 key 再获取模型」。端点：`POST /api/token-deals/fetch-models`（`{ call_url, api_key? }`）。
- **URL 规整**（`normalizeModelsEndpoint`）：去尾斜杠 → 已以 `/models` 结尾则原样 →
  以 `/v\d+` 结尾则补 `/models` → 否则补 `/v1/models`。
- **这是本站极少数的服务端主动出站接口，SSRF 是首要风险**，三重防护缺一不可：
  1. 协议与主机名：仅 http/https；复用 `isPrivateHostname` 挡 `localhost` / `*.internal` / 内网 IP 字面量；
     拒绝 URL 内嵌凭据；
  2. **DNS 二次解析**后校验 IP（挡 `evil.com` 解析到 `127.0.0.1` 这类 rebinding）；
  3. **`redirect:'manual'` 手动跟一跳并重新做完整校验** —— 交给 fetch 自动跟随等于绕过前两步
     （首跳合法、次跳指向内网）。
- 其它边界：响应体上限 2 MB、超时 12 秒、返回模型数上限 500；`api_key` **只用于本次出站**，
  不落库、不回显、不写日志（并拒绝含 `\r\n` 的 key 以防 header 注入）。
- 限频：登录用户 30 次/小时（按 用户+IP），游客 6 次/小时（按 IP）。
  放行游客是为了不砍掉「游客投稿」通道，但额度压得很低。
- 上游错误一律**不回显原始信息**（可能含内网细节），只转成可操作的中文提示。

#### QQ 机器人出站配额（2026-10-20）

- **唯一能被做成放大器的是 QQ 通知**：`PUT /api/token-deals/:id`（作者修正被驳回的通告）、
  `POST /api/prompts/:id/review-request` 等**用户可反复触发**的写路径会驱动服务端出站 HTTP。
  新增 `allowNotify()`（`server/utils/qq-notify.ts`）两层保护：
  1. 同 kind + 同标题 **10 分钟内只发一次**（循环提交不再刷屏）；
  2. 全站通知 `qq_notify_max_per_hour`（默认 40）条/小时，超出丢弃并 warn。
- **机器人指令回复不走配额**（`queueBotReply`）：正常聊天被限会显得机器人坏了。
- 机器人总开关关着时不消耗配额（`allowNotify` 先判 `botEnabled()`）。

#### 人机校验（2026-10-12 升级为 Cloudflare Turnstile）

游客发布通告（`POST /api/token-deals`）、游客评测（`POST /api/token-deals/[id]/guest-reviews`）与
**注册**（`POST /api/auth/register`）**共用同一套人机校验**，入口只有两个函数
（`server/utils/human-check.ts`）：

| 函数 | 作用 |
|------|------|
| `issueHumanChallenge(opts?)` | 挑战端点下发校验方式：`{provider:'turnstile',site_key}` 或 `{provider:'disabled',message}`（`opts.disabledMessage` 可换措辞） |
| `assertHumanCheck(event, body, opts?)` | 提交时校验：只认 `body.turnstile_token` 过 siteverify，其余一律拒绝 |

- **注册通道**（2026-10-12 安全审查 M1）：挑战端点 `GET /api/auth/register-challenge`，
  开关 `register_turnstile_enabled`（默认 `true`）。**开放注册曾让「登录用户评测即时公开、无审核」
  成为绕过游客人机校验的后门**（脚本按 10 账号/分钟注册再灌评分）；登录评测现已补限频
  （`LIMITS.reviewPerUserPerHour` / `reviewPerIpPerHour`）+ 与游客同一份广告黑名单
  （`server/utils/spam.ts`）。关掉该开关只建议在「访客加载不出挂件」时临时用，且应配合
  `allow_registration=false` 或调低注册限频 —— 否则等于把注册通道敞开

**策略：失败即拒绝（fail-closed），没有任何降级通道**（2026-10-12 二次调整，原算术题降级已整体移除）。
挂件脚本加载失败、令牌缺失/过期/复用、siteverify 网络异常或超时、校验不通过 —— 全部返回可读错误并拒绝提交。
代价：境内无代理访客（加载不出 `challenges.cloudflare.com`）**无法**提交游客通告/评测，这是刻意取舍；
`turnstile_enabled=false` 或密钥留空时游客通道整体关闭，同样不放行。前端 `TurnstileBox` 暴露
`retry()`，失败后给访客一个「重新加载验证」入口（`loadTurnstileScript` 失败时会摘掉坏掉的 script 标签，重试才有效）。

- **Turnstile 侧**（`server/utils/turnstile.ts`）：前端渲染挂件拿一次性令牌（`body.turnstile_token`），
  服务端带 `remoteip` 调 `challenges.cloudflare.com/turnstile/v0/siteverify`（8s 超时），只认 `success`；
  **网络失败一律不放行**（放行等于关掉校验）。令牌**一次性且 300s 过期**，前端每次提交后必须
  `reset()` 换新，否则重试必然报 `timeout-or-duplicate`
- **配置**（`system_config`，后台「人机校验」卡片）：`turnstile_enabled` / `turnstile_site_key` /
  `turnstile_secret_key` / `register_turnstile_enabled`。**site key 或 secret 任一为空时强制视为未启用**
  （防止配错就卡死整条游客通道）；**Cloudflare 官方测试密钥（`1x`/`2x`/`3x` 开头的 site key 或
  secret）同样强制视为未启用** —— 测试密钥在任意域名恒返回 `success:true`，误配即静默放行、
  等于没有校验（2026-10-12 安全审查 M2），`getTurnstileConfig()` 里用 `TEST_KEY_RE` 拦截。`GET /api/admin/config` 把私钥回显为 `已设置` 占位符，
  PUT 收到空值或该占位符时**跳过写入**，不会用占位符覆盖真密钥
- **CSP 必须放行**（`nuxt.config.ts` 的 `/**` 头）：`script-src` 与 `frame-src` 都要有
  `https://challenges.cloudflare.com`（`connect-src` 已有 `https:`）。**漏了 CSP 时挂件脚本被浏览器
  拒绝、`window.turnstile` 始终 undefined，游客会被直接挡住提交（fail-closed）** —— 改完 CSP 务必在真浏览器里
  确认挂件真的渲染出来了，只看接口返回 `provider: turnstile` 不算验证通过。另外 Cloudflare 挂件要求
  **当前域名在该挂件的 Hostnames 白名单里**，否则挂件报 `110200` 且拿不到令牌（挂件在 Cloudflare 后台加域名即可）

### 福利 Key（`/tokens/keys`）

- 前台 `/tokens/keys`（公开脱敏列表 + 状态/服务商筛选 + 卡片复制）；数据由采集端经 `POST /api/ai/token-keys` 按 `key_hash + base_url` 幂等 upsert，`POST /api/ai/token-keys/prune` 对账清理
- 列表白名单 = `server/api/token-keys/index.get.ts` 的 `KEY_FIELDS`；`key_plain` / `key_hash` / `key_encrypted` / `error_message_raw` **绝不进入**任何 SELECT、响应或日志（明文只在 `GET /api/token-keys/:id/copy` 按需下发）
- **时间戳为秒**（采集端语义），页面渲染时 ×1000；`copy_count` 为复制热度（copy 端点 +1）
- 可用性投票（2026-10-10，`server/utils/key-votes.ts`）：👍 可用 / 👎 不可用，**无需登录**，身份走指纹（登录 `fp:u<id>` / 游客 cookie+UA）
  - 一人一票（`UNIQUE(key_id, fingerprint)`）：同向再点 = **取消**，反向 = **改票**
  - 游客额外限「同一 IP 对同一 key 最多 3 票」，超出**静默无效**（不报错）；身份级限频 120 次/小时
  - 计数 `vote_up` / `vote_down` 为缓存列，统一由 `syncKeyVoteCounters(db, keyId)` 在事务内重算，勿手工 ±1
  - 投票端点复用列表可见口径（`published` + 非 `dead` + 回帖指引 24h 内），不可见行一律 **404**（不区分「不存在」与「已下架」）
  - `my_vote` **不**进列表响应（列表按「公开资源共享缓存」语义设计：`routeRules` 声明 `public, max-age=300`，但容器 nginx 的 API 段另加 `private, no-cache`，实际不落共享缓存），由 `GET /api/token-keys/my-votes` 客户端挂载后批量补拉（`no-store` + `Vary: Cookie`）
  - 爬虫 `upsertTokenKey` 的 UPDATE / INSERT **不含**投票列 → 每轮上报不会清零投票；`pruneTokenKeys` 删行时级联清理 `token_key_votes`

### 站点公告与友情链接（2026-10-30 三态 + 软删除）

前台悬浮公告挂件（`components/common/SiteAnnouncement.vue`）读取 `GET /api/announcements`；
公告正文与「通告备注」不同，是**管理员独有**字段，沿用前端 `marked` + `v-html` 渲染（未改）。

- **状态模型**：`status` 只有两个值 —— `published`（发布）/ `pending`（待发布）；
  「删除」**不是**第三个状态，而是正交的软删除列 `deleted_at` / `deleted_by`。
  有效公开可见 = `status = 'published' AND deleted_at IS NULL`。
  新建公告时 status **缺省取 `pending`**（fail-closed）：与 PUT 端点、以及迁移里
  「`draft`/`offline` → `pending`」的收敛方向一致，不给「参数写错就直接对外发布」留口子。
- **为什么删除不做成 status**：做成状态就会和「待发布」抢同一个字段
  （「待发布且已删除」无法表达），且恢复时无法知道该退回哪个状态。两列分开后，
  删除只记「谁在什么时候删的」，恢复即把两列清空、状态原样保留。
- **历史值收敛**：老库里的 `draft` / `offline` 在启动迁移里统一改为 `pending`
  （二者语义都是「未发布」，没有信息损失），迁移日志会打印收敛条数。
- **后台筛选**：`GET /api/admin/announcements?status=published|pending|deleted`
  （省略 = 全部）；已删除行排序垫底，前台用 `row-deleted` 样式区分并只给「恢复」按钮。
- **恢复**：`PUT /api/admin/announcements/:id` 带 `{ restore: true }`，
  在**同一事务**里先更新字段再清空删除标记，避免出现「字段已改但没恢复」的中间态。
- **公开端点不区分「不存在」与「未发布/已删除」**（一律 404），避免靠状态码探测草稿。

### AI 数据操作通道（PAT）

让外部 AI 助手（Claude Code / Cherry Studio / MCP 客户端等）安全地读写站点数据。

- **通道隔离（铁律）**：`/api/ai/*` 与 `/api/mcp` 只认 `Authorization: Bearer favs_ai_...` 形式的 PAT，
  **绝不回退 JWT**（`authenticateAi` 只做前缀识别 + 哈希比对）；反之 PAT 也不是合法 JWT，
  在 `/api/*` 通道必然 401。令牌自管端点（`/api/user/api-tokens/*`）刻意放在 **JWT 通道**，
  避免 PAT 触及用户凭证流程。
- **令牌模型**：明文 `favs_ai_` + 32 字节 CSPRNG base64url（共 51 字符），库中仅存 SHA-256 hex；
  明文只在创建响应中出现一次。每人最多 20 个未吊销令牌。
- **scope 分级**：`read(1) < write(2) < delete(3)`，高等级自动包含低等级。
  `delete` **必须显式授予**，且**仅管理员**可创建含 delete 的令牌（普通用户请求创建 → 403）。
- **越权硬隔离**：所有 SQL 强制 `user_id = token.user_id`；操作他人资源统一返回 **404**（不区分
  「不存在」与「无权限」，避免存在性泄露）。**管理员在 AI 通道同样不能跨用户改删**（例外：标签与
  Token 通告的删除沿用 Web 语义，管理员可删他人）。
- **写保护**：单请求批量上限 50（超出 400）；所有写操作支持 `dry_run: true` 只返回 `changes` 不落库；
  删除必须携带 `confirm: true`（否则 400），且不支持批量删除。
- **可见性**：非管理员经 AI 写入的数据强制 `login_required = 1`（仅自己可见），与 Web 端点一致。
- **限频**（2026-10-30 全面收紧，详见「限流与并发」）：同 IP 兜底 60 次/分钟 + 200 次/30 分钟
  → 令牌 25 次/分钟 **且** 250 次/30 分钟（两个窗口都要过）→ 并发上限（令牌 4 / IP 8）。
  超限 429 + `Retry-After`。
- **审计**：`ai_audit_logs` 记录 `token_id / user_id / method / path / scope / status_code / ip`，
  在 `finally` 中 best-effort 落库，**绝不记录请求体内容**；限频在鉴权阶段拦截，故 429 不入审计。
- **管理员判定**：`ai-service.isUserAdmin` 与 Web 端 `requireAdmin` 同序 —— `NUXT_ADMIN_USERS` → DB `is_admin`。
  改一处必须改另一处（Service 层无 H3Event，直接读 `process.env.NUXT_ADMIN_USERS`）。
- **代码分工**：`server/utils/ai-auth.ts`（PAT 生成/校验/scope/限频/审计 + `defineAiHandler` 统一包装）、
  `server/utils/ai-service.ts`（**唯一**数据操作来源，不接收 H3Event，REST 与 MCP 共用）、
  `server/api/ai/*`（薄端点）、`server/api/mcp.post.ts`（27 个 MCP 工具）、
  `pages/admin/api-tokens.vue`（令牌管理 UI）、仓库根 `favshub-data-ops/`（对外分发的 AI 技能包）。
- **首次接入建议**：先 `GET /api/ai/describe` 拿能力清单与字段字典，再按
  `dry_run 预演 → 用户确认 → 正式执行` 的流程操作。
- **冒烟**：`scripts/ai-api-smoke-{read,write}.mjs`（共约 130 项断言，含 12 类安全用例）。
  须对**临时库副本**运行，且服务端以 `NUXT_ADMIN_USERS=smokeadmin NUXT_TRUST_PROXY=true` 启动
  （迁移预置了 `admin_favs`，注册已不会自动提权；限频压测需靠 XFF 隔离到专用 IP）。

### 扩展同步（服务端语义）

- 入参扁平：`{ title, url, folder_path, icon }`
- `ensureFolderPath()` 递归建夹
- 已存在 URL：更新标题/分类，**不覆盖**已有 icon；icon 按 hostname 去重下载
- 增量：`PUT /api/sync/bookmarks`（全量 upsert）；图标走 `POST /api/sync/favicons`（base64）
- 服务端行为（去重、不覆盖 icon、`ensureFolderPath`）见服务端代码，改协议时两边一起改

## 安全（改代码时保持）

- CORS、JWT 封装、错误脱敏、参数校验、rate-limit、favicon SSRF 限制
- 前端：避免对用户内容 `v-html`；Teleport 到 body 勿依赖父级 scoped 选择器
- **PAT 通道**：`/api/ai/*`、`/api/mcp` 禁止回退 JWT 校验；PAT 比对用 `timingSafeEqual`（先判长度，
  否则长度不等会抛 `RangeError`）；明文令牌**只回一次**、不入库、不入审计、不打日志；
  `delete` scope 仅管理员可签发；越权一律 404

## 限流与并发（rate-limit）

三层防护，全部**进程内存**实现（`server/utils/rate-limit.ts`，T5 于 2026-10-30 重写）：

| 层 | 位置 | 作用域 | 键 |
|---|---|---|---|
| L1 全站 IP 分层 | `server/middleware/rate-limit.ts` | `**只**拦 `/api/**`；页面 SSR / 静态资源根本不进函数 | 来源 IP |
| L2 AI 通道 | `server/utils/ai-auth.ts` | `/api/ai/**` 与 `/api/mcp`（同一 `authenticateAi`） | 令牌 + 来源 IP |
| L3 端点自带 | 各端点 `checkRateLimit(...)` 调用点（30+ 处，固定窗口） | 单端点业务语义 | 用户 / IP / 指纹 |

L1 是**最外层兜底**，阈值刻意高于所有 L3 业务限频 —— 正常用户应当先撞到语义更准确的业务 429。

### 阈值表（默认值，全部可用 `FAVSHUB_RL_*` 覆盖）

| 层 | 限值 | 环境变量 |
|---|---|---|
| 令牌 · 短窗口 | 25 次/分钟 | `FAVSHUB_RL_AI_PER_MIN` / `FAVSHUB_RL_AI_WINDOW_MS` |
| 令牌 · 长窗口 | 250 次/30 分钟 | `FAVSHUB_RL_AI_BURST` / `FAVSHUB_RL_AI_BURST_WINDOW_MS` |
| 令牌 · 并发 | 4 在途 | `FAVSHUB_RL_AI_CONCURRENCY` |
| IP 兜底 | 60 次/分钟、200 次/30 分钟 | `FAVSHUB_RL_AI_IP_PER_MIN` / `FAVSHUB_RL_AI_IP_BURST` |
| IP · 并发 | 8 在途 | `FAVSHUB_RL_AI_IP_CONCURRENCY` |
| 全站读（GET/HEAD） | 600 次/分钟 | `FAVSHUB_RL_SITE_READ_PER_MIN` |
| 全站写（POST/PUT/PATCH/DELETE） | 120 次/分钟 | `FAVSHUB_RL_SITE_WRITE_PER_MIN` |
| 全站资源类读（`/api/favicon`） | 1200 次/分钟 | `FAVSHUB_RL_SITE_ASSET_PER_MIN` |
| 全站窗口长度 | 60 秒 | `FAVSHUB_RL_SITE_WINDOW_MS` |
| 全站同 IP 并发 | 24 在途 | `FAVSHUB_RL_SITE_CONCURRENCY` |
| 总开关 | 开 | `FAVSHUB_RL_SITE_ENABLED`（`0` 关掉 L1） |
| 探活豁免（精确路径，逗号分隔） | `/api/health` | `FAVSHUB_RL_SITE_EXEMPT` |
| 资源档路径（精确路径，逗号分隔） | `/api/favicon` | `FAVSHUB_RL_SITE_ASSET_PATHS` |
| 限流键总数上限 | 20000 | `FAVSHUB_RL_MAX_KEYS` |

**AI 通道两个窗口是「且」不是「或」**：先过短窗口再过长窗口，任一不过即 429。

### 窗口算法：滑动窗口（逐请求时间戳）

`consumeWindow(key, limit, windowMs)` 保存窗口内每次请求的时间戳，精度到单请求，**没有固定窗口的
边界双倍突发问题**（固定窗口在最坏情况下能放过 2×limit，对「25 次/分钟」是不可接受的 2 倍误差）。
L3 的既有 `checkRateLimit` 仍是固定窗口（30+ 调用点、阈值小，行为稳定，未动）。

内存边界（三条硬约束，改这里必须同时保住）：

1. **被拒的请求不落桶** → 挨打时数组不再增长，单键上限 = limit 个时间戳；
2. 数组用 head 游标 + 超过 64 条时 slice 压缩，长度压在 `limit + 64` 内；
3. 键数超过 `FAVSHUB_RL_MAX_KEYS` 时按「最久未使用」淘汰（Map 删后重插维持顺序），
   清理在 `sweepRateLimitState()` 里做（每 5 分钟一次 + 超限时每秒最多一次的兜底）。

### 并发计数器：释放纪律（最容易写错的地方）

`acquireRequestSlot()` 把槽位挂在 **`event.node.res.once('close')`** 上，并返回**幂等**的 release：

- 正常返回 → 响应结束触发 `close` → 释放；
- 处理器抛错 → `defineAiHandler` 的 `finally` 释放（`close` 随后也会触发，幂等不重复扣）；
- **客户端中途断开 / 超时** → 连接关闭触发 `close` → 释放。

L1 中间件无法用 `try/finally` 包住下游，**只靠 `close`**，因此「close 一定触发」是这个设计的前提
（Node 的 `ServerResponse` 在响应完成与连接提前终止两种情况下都会 emit `close`）。
`scripts/third-batch-ratelimit.mjs` 用「打满 → 中止连接 → 再打满」多轮断言了计数不泄漏。

### 取真实 IP：只许复用 `getClientIP()`

`server/utils/rate-limit.ts` 的 `getClientIP(event)` 是**唯一**取 IP 入口，优先级：

1. `NUXT_TRUST_PROXY=true` → 先 `X-Real-IP`，再 `X-Forwarded-For` 首段；
2. 直连对端是**内网地址** → 采信 `X-Real-IP`（本站「宝塔 nginx → docker nginx → 应用」走这条：
   `nginx.conf` 用 `realip` + `real_ip_recursive on` 还原真实客户端 IP，再 `proxy_set_header X-Real-IP $remote_addr`）；
3. 否则回退 H3 的对端地址。

⚠️ **不要在任何新代码里自己读 `x-forwarded-for` / `x-real-ip`**：多一处自造取 IP 逻辑 = 多一个
「伪造头绕过限流」的入口。备别忘了第 2 条成立的前提是反代**覆盖**（而非追加）`X-Real-IP`。

限流键在 IP 上再套一层 `rateKeyForIp()`（`server/utils/deal-subscriptions.ts`）：IPv6 收敛到 /64
（否则换一个地址就重置配额），再做 sha256 截断（内存里不存明文 IP）。

### 可测性：为什么不真等 30 分钟也能验证

所有阈值与窗口都能用环境变量覆盖，所以自测把「250 次/30 分钟」缩成「5 次/3 秒」跑**同一条代码路径**；
`consumeWindow(..., now?)` 另留可注入时钟。验证「两个窗口都生效」用的是**两次隔离实验**：
一次把短窗口调松、只让长窗口成为瓶颈（第 6 次被拒），一次把长窗口调松、只让短窗口成为瓶颈。
见 `scripts/third-batch-ratelimit.mjs`。

### 局限（内存实现，多实例部署前必须处理）

- **重启即清空**：配额不是账本，不能拿「还有多少额度」做业务判断。
- **单实例前提**：多实例/多副本时每个进程各算一份，实际阈值被放大 N 倍。届时需迁移到
  Redis 等共享存储（`consumeWindow` 的调用点已收敛，替换面小）。
- **IPv6 /64 聚合**：一个 /64 段内所有地址共享配额。
- **键淘汰**：超 `FAVSHUB_RL_MAX_KEYS` 后最久未使用的键会被丢弃 → 该键配额重置（极端情况）。
- **共享出口 IP**：公司/校园 NAT 后多人共用一个配额桶；全站写档 120/分钟 就是为此留出的余量。

### 调优提醒

**当前取值 25 次/分钟 + 250 次/30 分钟，是实测后的结论，不是拍脑袋。**

历史：最初按需求方口径设为 10 次/分钟 + 50 次/30 分钟，实测发现它**连本站自己的 AI 功能回归套件都跑不完**
（`ai-api-smoke-read.mjs` 一个用例要连打 20+ 个 AI 请求，第 11 个就 429；write 侧一张令牌要打 43 个），
也就是说正常干活的助手会被误伤。按团队建议上调到 25/250 后，两套回归能完整跑完，且仍显著严于收紧前的 600/分钟。

若线上仍出现「助手正常干活被打 429」，**优先调 `FAVSHUB_RL_AI_BURST`**（长窗口）而不是放宽短窗口 ——
短窗口挡瞬时突发、长窗口挡持续刷量，二者职责不同。一次「整理 20 条书签」的会话约需 20~40 个请求
（`PUT /api/ai/bookmarks/:id` 没有批量版），这正是长窗口要留出的余量。

## 部署

CI：仅 `VERSION` 推送 `main`（或 `workflow_dispatch`）→ `ghcr.io/<owner>/favshub:<ver|latest|sha>`。

快速参考（细节与密码见本地 `DEPLOY.md`）：

```bash
# 发版（功能提交不必 bump VERSION）
echo "1.0.X" > VERSION && git add VERSION && git commit -m "chore: bump VERSION to 1.0.X" && git push
gh run list --limit 1 && gh run watch <run-id> --exit-status     # 约 4 分钟，全部步骤应 success

# 服务器（compose 是 pull_policy: if_not_present，必须显式 pull）
cd /www/dk_project/dk_app && docker compose pull favshub && docker compose up -d --remove-orphans
curl -s https://hao.bx9y.com.cn/api/health
```

注意：

- 服务器 dockerd 走本机 mihomo 代理（`/etc/systemd/system/docker.service.d/http-proxy.conf`）—— ghcr.io 境内直连会卡死；改代理配置需 `systemctl daemon-reload && systemctl restart docker`，**会重启该机全部 20 个容器**
- GHCR 包须已授予本仓库 Write 权限（包设置 → Manage Actions access），否则 CI 报 `permission_denied: write_package`
- 离线兜底：本地 podman build → `save --format docker-archive` → scp → 服务器 `docker load` + `compose up`（**勿**先 `rmi`）
- 验证走域名 `https://hao.bx9y.com.cn`（3090 未对公网放行）

## 开发注意事项

- **async**：try/catch/finally；catch 用 `err`，勿遮蔽外层参数
- **Teleport**：弹层用全局选择器或无父链依赖的 scoped
- **SSR / hydration**：`useMobile` 等 SSR 与客户端宽度可能不一致；`isMobile` 默认须与 CSS 断点（约 `1024px`，`mobile-responsive.css`）一致，避免 mismatch / `insertBefore`
- **watch**：下一 tick 异步；同一操作勿「手动调 API + 依赖 watcher 再调」
- **CSS 缓存**：`layouts/default.vue` / `admin.vue` 的 `useHead` 上 `?v=`
- **移动端覆盖必须写进组件内（2026-10-30 踩坑）**：顶层 CSS 规则优先于 `@layer`；
  而 `<style scoped>` 的规则带 `[data-v-*]`，与外部类规则**同特异度**（都是 0,2,0），
  于是靠加载顺序决胜 —— 外部 `mobile-responsive.css` 与组件的先后顺序不可依赖。
  因此**改组件在移动端的表现，覆盖规则要写在组件自己的 `<style scoped>` 里**，
  别指望外部 `mobile-responsive.css` 能压住组件内样式（反之亦然）。
- **`v-html` 的内容命中不了 scoped 样式**：必须用 `:deep()`（如备注富文本
  `TokenDealDetail.vue` 的 `.tdd-note.markdown-body :deep(p)`）。
- **CI**：功能提交不必 bump `VERSION`
- **密钥**：勿提交 `DEPLOY.md`、密码、JWT secret
- **部署 skill 仅本机**：本机部署要点在同机 skill `bt-docker-reverse-proxy-deploy`（`%USERPROFILE%\.workbuddy\skills\`）与 `favshub-nuxt/DEPLOY.md`，内含服务器 IP、部署路径、SSH 私钥路径等本机专属信息，**只能留在本机**，不得提交。对外分发的技能包是仓库根的 `favshub-data-ops/`，两者不是一回事
