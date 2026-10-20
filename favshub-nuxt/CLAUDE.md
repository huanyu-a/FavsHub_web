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
| `NUXT_DB_PATH` | SQLite 路径 | `./data/favshub.db` |
| `NUXT_CORS_ORIGIN` | CORS | `http://localhost:3000` |
| `NUXT_ADMIN_USERS` | 额外管理员用户名（逗号分隔）；**AI 通道的管理员判定同样读取它** | 空 |
| `NUXT_TRUST_PROXY` | 信任 X-Forwarded-For | `false` |
| `NUXT_PUBLIC_BASE_URL` | 站点对外地址（canonical / og:url / og:image / sitemap.xml 用） | `https://hao.bx9y.com.cn` |

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
- **`text` 不落库**：只存 `snapshot`（公开字段）+ `meta.changes`（差异结构），文案在读取时渲染
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
- **限频**：IP 级 300 次/分钟（兜底防令牌暴力猜测）→ 令牌级 600 次/分钟。
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
- **CI**：功能提交不必 bump `VERSION`
- **密钥**：勿提交 `DEPLOY.md`、密码、JWT secret
- **部署 skill 仅本机**：本机部署要点在同机 skill `bt-docker-reverse-proxy-deploy`（`%USERPROFILE%\.workbuddy\skills\`）与 `favshub-nuxt/DEPLOY.md`，内含服务器 IP、部署路径、SSH 私钥路径等本机专属信息，**只能留在本机**，不得提交。对外分发的技能包是仓库根的 `favshub-data-ops/`，两者不是一回事
