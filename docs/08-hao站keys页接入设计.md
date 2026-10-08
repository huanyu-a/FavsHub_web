# 08 - hao 站「福利 Key」页面接入设计（F1-F4 + F6 + F7 + 本地数据桥）

> **状态：设计定稿；本地实施已在 FavsHub 工作区落地（4 个新文件 + 10 处既有文件修改），尚未过 `pnpm build` / `pnpm ts:check` 构建门禁，未做生产部署。**
> 上游依据：[07-最终执行方案.md](./07-最终执行方案.md)（下称 07）§6.1 改动清单 F1-F8。
> **本轮范围** = 07 的 F1、F2、F3、F4、F6、F7 + 本地数据桥（爬虫库 → FavsHub 本地 dev 库）。
> **本轮不做**：F5 揭示端点（07 :185 定为 P1，页面按钮留降级态，见 §3.3）；F8 www 站入口（07 :188，本轮完全不动，`markflow-wiki` 零改动）。
> **写作纪律**：本文所有 `文件:行号` 均在 2026-09-30 当天逐一打开现场核实，**行号是当前工作区（含已实施改动）的实际行号**；与上一稿（实施前锚点）或勘察稿不一致处已按现场修正（偏差记录见 §0.2）。

---

## 0. 现场核实记录（写/改本文时实际执行的检查）

### 0.1 核实清单与结果

| 检查 | 命令/方式 | 结果 |
|---|---|---|
| 六处导航锚点 + sitemap | Read 6 个 Vue/TS 文件 + `git diff -- <file>` 逐文件比对 | 全部已按本设计落地，行号见 §2；四页 diff 与设计逐字一致 |
| 新增文件 | `wc -l` + Read 全文 | `pages/tokens/keys.vue` 663 行、`components/tokens/TokenKeyCard.vue` 466 行、`server/api/token-keys/index.get.ts` 109 行、`server/api/ai/token-keys/index.post.ts` 22 行 |
| F1 三表 | Read `migrate.ts:1044-1140` | `createTokenKeysSchema(db)` :1061-1140：三表各一个独立 try/catch（token_keys :1062-1091、probe_log :1093-1110、reveal_log :1112-1124），4 条索引逐条独立 try/catch 的 for 循环 :1127-1139；`initializeDatabase` 在 createNexusSchema(:1602) 与 createQqBotSchema(:1604) 之间插调用 :1603 |
| F2 三表 | Read `schema.ts:300-369` | `tokenKeys` :312-340、`probeLog` :344-358、`revealLog` :363-369；:337 `uniqueIndex('idx_token_keys_hash_base')` 带注释「对应 migrate.ts DDL 的表级 UNIQUE（真实索引为 sqlite_autoindex）」 |
| F3/F4 服务层 | Read 两文件全文 + `ai-service.ts:985-1319` | `KEY_LIMITS` :990-998、`PLAIN_KEY_SOURCE` :1017-1021、`TOKEN_KEY_PUBLIC_FIELDS` :1028-1031、`validateTokenKeyPayload` :1084-1178、`upsertTokenKey` :1199-1319（事务 :1237、UPDATE 不动 deal_status :1244-1271、INSERT 22 列 :1273-1303） |
| tokenhub.db 现状 | `python -c` 以 `file:...?mode=ro` URI 只读查询（纯 COUNT/GROUP BY，未输出任何 key/hash 值） | token_keys 共 **29 行**：verdict 全部 `unknown`；source `post`=1 / `reply_visible_guide`=28；deal_status 全部 `published`；confidence high=28 / medium=1；DISTINCT key_hash = 29（无碰撞）；key_masked 非空 1 行、key_encrypted 非空 1 行；manual_queue 218 行全 `pending`（low_confidence_classify 91 / card_or_paid_benefit_info 77 / suspected_valuable_E 49 / unknown_5_rounds 1）——与上一稿数据摘要一致，无新数据 |
| FavsHub 本地库路径 | Read `nuxt.config.ts`(:39)、`server/database/index.ts`(:38-60)；`ls data/` | `data/` 目录下**只有 `favicons/`，`favshub.db` 仍不存在**（dev 首次启动或桥脚本自举时才建库，CLAUDE.md:44「`data/` 已 gitignore，首次启动自动建库」） |
| 桥脚本 | `python scripts/sync_to_favshub_local.py --help` | exit 0；`--dry-run`（缺失目标库时内存模拟）、`--source/--db/--no-encrypted` 参数齐全；默认路径常量即 §5.1 两库绝对路径 |
| 验证脚本纯函数 | `node scripts/verify_hao_keys_local.mjs --self-test` | **16/16 全部 PASS，exit 0**（明文 key 形状命中/脱敏放行/负向断言/红线子串/行形状/dead 筛选语义） |
| verify 运行日志 | Read `scripts/verify_hao_keys_local.log` | 交付阶段为**占位文件**——完整 HTTP 断言（需先 `pnpm build` 产出 `.output/`，脚本自起 server）由主流程门禁执行 |
| docs/07 引用锚点 | `rg -n` 精确定位 | D12=:45、F1-F8=:181-188、§6.2=:192（C3=:198）、§6.3=:201、§7.2=:235、§8.4=:342（DDL 自 :344）、勘误=:393、§8.5=:395（第 4 条免责原文=:400）、回滚总原则=:422 |
| 既有模式锚点 | Read/rg | `createNexusSchema` migrate.ts:996-1042；`token-deals/index.get.ts`（optionalAuth :50、分页 :53-55、sqlite_master 降级 :66-68、mine 401 :79-88、approved 过滤 :87、排序 :110-121、`SELECT d.*` :127、返回 :163-171）；`ai-auth.ts`（verifyPat :105-125、authenticateAi :133-179、IP 300/min :136、`favs_ai_` 前缀 :148-154、令牌 600/min :166、「所有 `/api/ai/*` 端点必须经此包装」:239、defineAiHandler :246-266、403 也入审计 :241-242）；`server/utils/token-deals.ts`（LIMITS :34、escapeLike :58、normalizeModels :63、validateDealPayload :99）；`rate-limit.ts`（checkRateLimit :46、getClientIP :136）；`auth.ts`（requireAuth :64、optionalAuth :79、requireAdmin :86、getAuthRole :114）；`cache-control.ts`（跳过 `/api/` :19、排除 /admin 与 /login :26、游客升级 public :34）；`admin-guard.ts`（仅拦 `/admin` :12）；`database/index.ts`（getRawDb :17、initDatabase :38、resolve :41、mkdirSync :46、`new Database(absPath,{timeout:10000})` :49、WAL/foreign_keys/bus_timeout pragma :52-54、drizzle :57）；`db-init.ts`（initDatabase :16、initializeDatabase :20、closeDatabase :26）；`ai-service.ts` 既有 `db.transaction` 先例 6 处 :187/:392/:465/:550/:634/:834 |
| 爬虫侧锚点 | Read | `crawler/store/db.py`：SCHEMA_STATEMENTS :90-169（token_keys 22 列 :92-115、probe_log :118-129、reveal_log :132-138、索引 5 条 :164-168——token_keys/probe_log 4 条 + manual_queue 1 条，hao 侧只建前 4，见 §4.1）、`guide_key_hash` :182-185、`upsert_token_key` :354-420（列所有权注释 :365-372、UPDATE 仅可变列 :405-419）、`set_deal_status` :423-429、`update_verdict` :502-519、`select_publishable` :522-534（**:531 含 `AND verdict != 'dead'`——这是 feed 口径**）；`crawler/interfaces.py`：VERDICTS :49-58、CONFIDENCES :70-74、KEY_SOURCES :77-83、DEAL_STATUSES :86、MANUAL_REASONS :89-95、FeedEntry :431-450（published_at 取 first_seen_at :448-450）；`local_server.py`：HOST/PORT :39、PLAIN_KEY_RE :47-52、DENY_BASENAME_RE :56、VERDICT_META :64-75、CONF_META :79-83、SOURCE_META :85-89、REASON_META :99-105、徽标基元 :379-383、`.deal-card.is-dead{opacity:.6}` :509、scrub :756-758、esc1 :761、未映射回退 :781、home 免责改写版 :1003-1004、`_key_card` :1013-1097（C 类豁免置信 :1033-1037、guide-block :1056、models 前 3+N :1076-1083、连续失败 :1090-1091、dead 类 :1095）、`render_keys` :1100（SELECT 白名单 :1104-1108、published 过滤 :1108、排序 :1109、verdict 计数 :1110-1117）、/keys 免责逐字 :1120-1122、selftest 红线断言 :1399-1405、masked 仅 /keys :1419-1421 |
| 样式锚点 | Read `public/css/mobile-responsive.css:68-90`、`pages/tokens/index.vue:766-770` | `.mobile-bottom-nav` fixed 居中浮动条 :68-75、`.mobile-nav-item` 内容自适应 :76-83；768px 断点 `@media (max-width:768px){ .tokens-header{display:none} }` index.vue:766-770 |
| 第二轮评审复核（2026-09-30，五条意见） | `git diff -U1 -- favshub-nuxt/components/mobile/MobileBottomNav.vue`（3 个 hunk：@@ -22 / @@ -28 / @@ -122，无样式 hunk）；`git show HEAD:favshub-nuxt/components/mobile/MobileBottomNav.vue`（尾部已含完整收紧样式块，注释「底栏由 6 项增至 7 项」）；`grep -n "watch(\[page" pages/tokens/index.vue` → :342；`sed -n '1119,1123p' local_server.py`（/keys 免责含「（07 §8.5）。」尾注）；`sed -n '1,3p' server/database/schema.ts` 与 `sed -n '297,300p' MobileBottomNav.vue`（两处陈旧注释）；`sed -n '12,15p' server/api/token-keys/index.get.ts`（缓存注释） | 五条全部属实，已修订：① MobileBottomNav :297-307 收紧样式系**上一轮白嫖导航的已提交改动**，非本设计引入——§2 #2 归因与 §8 回滚动作已改正；② index.vue watch 先例实为 **:342**（原写 :338）；③ 8018 /keys 免责与 hao 页**非严格逐字**（§3.2/§7 表述已改，以 07:400 为准）；④ F3 文件头缓存注释（index.get.ts:13-14）陈述了尚未落地的 routeRules（§0.2 偏差 2 已补说明）；⑤ schema.ts:2「10 张表」、MobileBottomNav.vue:298「6 项增至 7 项」两处既有注释陈旧（§9.7 打磨项） |
| 第三轮读者反馈（2026-09-30，六条） | 重读 §2 总述 bullet / §3.3 / §4.1 索引括注 / §5.3 / §6.1 A15 / §9.3-9.4；复核 `db.py:164-168`（第 5 条 `idx_manual_queue_status` 属 manual_queue）、`cache-control.ts:29-35`（已登录保持 private :29-32、Vary 无 Cookie :35）、verify 脚本无登录态请求路径 | 六条全部属实，已修订：① §2 总述 bullet 样式归因残留（与 §2 #2/§8 矛盾）已统一为「既有已提交改动、本设计沿用」；② A15 改为双态互斥口径（游客态可执行 / 已登录态需登录路径，当前无从执行）；③ §5.3 改为如实陈述 A3/A4 未覆盖 + 替代人工闸门 + §9.6 补门禁前置；④ §4.1/§0.1 索引口径改为「一致仅指前 4 条，第 5 条属 manual_queue 不上 hao 站」；⑤ §2 缓存结论补全（UI 差异 vs 数据差异、Vary 无 Cookie 的单向后果与代价）；⑥ pending 转正闭环 §4.3 提示 + §9.3/§9.4 两案（管理员 PAT 推荐 / 普通 PAT+人工 SQL）留拍板 |

### 0.2 实施偏差（与上一稿设计的差异，均已按现场如实记录）

| # | 项 | 设计原稿 | 现场 | 本文处置 |
|---|---|---|---|---|
| 1 | hero 互链（原 §2 #8） | `pages/tokens/index.vue` hero-toolbar 内、发布按钮前加 `.hero-review` 次级链接 | **未实施**：该文件 diff 仅 +4 行（即 §2 #6 的 header tab），hero-toolbar（:49-68）无福利 Key 链接 | 正式裁剪（§2 #8）：双向闭环已由「/tokens 页头 tab(#6) → keys」+「keys 页头白嫖通告 tab(keys.vue:20-24) → /tokens」成立，hero 次级按钮边际价值低；如需恢复按 §2 #8 原文案实施 |
| 2 | F3 CDN 缓存 routeRules | `nuxt.config.ts` 加 `'/api/token-keys': { headers: { 'Cache-Control': 'public, max-age=300' } }` | **未实施**：`nuxt.config.ts` 不在本轮改动文件之列，`/api/token-keys` 落入 `'/api/**'` 默认 no-store（nuxt.config.ts:114-118） | 记为待补项（§9.5）：功能无损（每次回源取最新），仅少 5 分钟 CDN/浏览器缓存；补法照 `/api/search-engines` 先例（nuxt.config.ts:120-124）。另（第二轮评审修正）：F3 文件头注释（index.get.ts:13-14「由 nuxt.config.ts routeRules 配置」）是按 routeRules 落地后的**终态**书写的，补配置前该陈述不成立（实际 no-store），以本偏差行为准；补 routeRules 时该注释自动成立，无需回改代码注释 |

**按约束未在本设计会话执行**（由主流程门禁统一跑）：`pnpm build`、`pnpm ts:check`、桥脚本对目标库的写入、验证脚本的 HTTP 断言（A8-A14 语义，见 §6）。本文引用的既有代码模式均已逐行读过；新增代码片段已落地为工作区文件并经本人逐行核对，但**未经编译器/构建验证**。

---

## 1. 目标与范围

### 1.1 目标

把 P0 爬虫已产出的福利 Key 数据（当前 29 行：1 行真 key + 28 行 C 类回帖指引，实测见 §0.1）以**公开、脱敏、可筛选**的形态呈现在 hao 站 `/tokens/keys`，并在全站六处导航 + sitemap 给出入口。数据链路两条：

- **本地链路（本轮已交付）**：`tokenhub/crawler/data/tokenhub.db` → `scripts/sync_to_favshub_local.py` → `FavsHub_web/favshub-nuxt/data/favshub.db`（本地 dev 库）→ F3 读接口 → 页面。用于 `pnpm dev` 本地联调与端到端验证。
- **生产链路（设计定稿，本轮不部署）**：爬虫 → F4 PAT 写端点（`POST /api/ai/token-keys`）→ 同一批表。本地与生产**共用同一套 DDL 与读写接口**，切生产时只换数据来源，页面零改动。

### 1.2 范围边界

| 项 | 状态 | 说明 |
|---|---|---|
| F1 migrate.ts 三表（07 :181） | ✅ 已实施 | `createTokenKeysSchema()` migrate.ts:1061-1140，一表一 try/catch |
| F2 schema.ts 三表 Drizzle（07 :182） | ✅ 已实施 | schema.ts:312-369，仅查询/类型层，建表真源仍在 migrate.ts |
| F3 公开读接口（07 :183） | ✅ 已实施 | `GET /api/token-keys`（index.get.ts），字段白名单 + hidden/pending 过滤；**缓存 routeRules 待补（偏差 2）** |
| F4 PAT 写接口（07 :184） | ✅ 已实施 | `POST /api/ai/token-keys`（index.post.ts:19-22 薄端点），dry_run + upsert + PAT→pending/管理员→published |
| F5 揭示端点（07 :185） | ❌ 本轮不做（P1） | 页面按钮渲染**双态降级**（未登录→引导登录；已登录→禁用占位，§3.3），落 F5 时只改按钮事件层 |
| F6 `/tokens/keys` 页面（07 :186） | ✅ 已实施 | keys.vue + TokenKeyCard.vue：免责声明 + 统计条 + 筛选器 + 卡片列表 + C 类指引卡 + 三态 |
| F7 导航 6 处 + sitemap（07 :187） | ✅ 已实施（6/6 + sitemap） | 另有白嫖通告页互链设计项，本轮裁剪 1 处（§2 #8，偏差 1） |
| F8 www 站入口（07 :188） | ❌ 不动 | `markflow-wiki` 零改动 |
| 本地数据桥 | ✅ 已实施（tokenhub 侧新增） | `scripts/sync_to_favshub_local.py` 398 行，CLI 实测可执行 |
| 生产部署（VERSION 镜像 / nginx feed alias / PAT 签发 / cron 切换） | ❌ 不在本轮 | 见 §9 |

### 1.3 全局约束（实施/评审逐条自查）

1. FavsHub 工作区存在**用户未提交的手写改动**：只新增/修改本文点名的文件与代码块，禁用 `git checkout/restore/stash` 做任何"还原"——回滚一律手工删除新增块（§8）。
2. 两个仓库均不执行任何 git add/commit/push。
3. 密钥红线（07 §8.5 + 任务约束）：`key_encrypted`/`key_hash`/`error_message_raw` **绝不 SELECT 进任何读接口、绝不渲染、绝不出现在日志/返回值**；`tokenhub.db` 一律只读打开；所有动态文本过转义（hao 站 Vue 模板插值天然转义，**禁止 `v-html` 渲染任何来自 DB 的字段**，CLAUDE.md「前端：避免对用户内容 v-html」）。
4. 迁移铁律（CLAUDE.md「迁移三坑」：多语句 `db.exec` 原子性陷阱、`PRAGMA table_xinfo`、重建表丢列）：新表/新索引**独立 try/catch**，绝不并入 `createTables()` 的大 exec 块；多步写用 `db.transaction`。
5. 通道隔离铁律（CLAUDE.md「通道隔离」）：`/api/ai/*` 端点必须经 `defineAiHandler` 包装（ai-auth.ts:239 注释原文「所有 `/api/ai/*` 端点必须经此包装（禁止直接用 requireAuth）」），绝不回退 JWT。
6. 样式走 SFC `<style scoped>`（Vite 打包成 `/_nuxt/*.css`），**不改 `public/css/tokens.css`** → 免去布局 `useHead` 的 `?v=` bump；SSR head 不得出现明文 `<style>` 块（`features.inlineStyles: false`，nuxt.config.ts:22）。
7. `BackToTop` 是逐页手动引用组件（CLAUDE.md「BackToTop 为逐页引用组件」）。

---

## 2. 入口矩阵（F7 重点，全部现场核实行号）

共 8 处设计项，**7 处已实施**。文案统一**「福利 Key」**（导航标签）；移动端底部导航因标签区宽度限制用短标签**「福利」**（同排相邻标签 2-3 字：白嫖/精选集/分类，MobileBottomNav.vue:27/18/40）。图标两套：**stroke 内联 SVG**（sidebar 与三个页头 nav 的既有风格，key 图形 feather 风 `stroke-width="2"`）与 **remixicon `ri-key-2-line`**（mobile 底栏与 admin 侧栏的既有 `<i>` 风格）。

| # | 文件 | 实施位置（现场行号） | 对齐的相邻项写法 | 图标 | 文案 | 状态 |
|---|---|---|---|---|---|---|
| 1 | `components/sidebar/Sidebar.vue` | :33-38（白嫖通告 :27-32 之后） | :27-32 白嫖项（18×18 SVG + `activePage` 绑定） | 18×18 key SVG | 福利 Key | ✅ |
| 2 | `components/mobile/MobileBottomNav.vue` | :29-37（白嫖项 :20-28 之后、分类按钮 :38 之前）+ `isKeysPage` :132 | :20-28 白嫖项（`<i>` + `@click="closeDrawer"`） | `ri-key-2-line` | 福利 | ✅ |
| 3 | `pages/collections/index.vue` | :24-27（白嫖通告 :20-23 之后、提示词 :28 之前） | :20-23 白嫖项（16×16 SVG + span） | 16×16 key SVG | 福利 Key | ✅ |
| 4 | `pages/prompts/index.vue` | :33-38（白嫖通告 :27-32 之后） | :27-32 白嫖项（18×18 SVG，无 active 绑定） | 18×18 key SVG | 福利 Key | ✅ |
| 5 | `layouts/admin.vue` | :35-37（白嫖通告 :32-34 之后、搜索引擎 :38 之前） | :32-34 白嫖 nav-item；无 active 绑定（前台链接先例 :67-70「前台首页」同样无 active） | `ri-key-2-line` | 福利 Key | ✅ |
| 6 | `pages/tokens/index.vue`（页头 tab） | :24-27（白嫖 active tab :20-23 之后、提示词 :28 之前） | :20-23 白嫖 active tab（16×16 SVG） | 16×16 key SVG | 福利 Key | ✅ |
| 7 | `server/routes/sitemap.xml.ts` | :54-60（`/tokens` 条目 :47-53 之后） | :47-53 `/tokens` 条目（loc/lastmod/changefreq/priority） | — | — | ✅ |
| 8 | `pages/tokens/index.vue`（hero 互链） | —（hero-toolbar :49-68） | :54-64 待我审核次级按钮（`.hero-review`） | `ri-key-2-line` | 福利 Key | **本轮裁剪**（偏差 1） |

两处既有行为核实结论：

- `MobileBottomNav.vue:131` `isTokensPage = computed(() => route.path.startsWith('/tokens'))` 会把 `/tokens/keys` 也点亮白嫖 tab。实施已按设计消除双高亮：:23 白嫖项 `:class="{ active: isTokensPage && !isKeysPage }"`，:132 新增 `isKeysPage = computed(() => route.path.startsWith('/tokens/keys'))`。底栏样式收紧块（:297-307）**不是本设计引入**：它系上一轮新增白嫖导航项时的已提交改动（`git show HEAD` 证实 HEAD 已含，本设计工作区 diff 无样式 hunk），本设计新增第 8 项后**沿用**该收紧间距，未再改样式——统一口径见 §2 #2「样式说明」；:298 注释陈旧见 §9.7，回滚边界见 §8（不删该块）。
- `server/middleware/admin-guard.ts:12` 只拦 `/admin` 前缀；`middleware/admin.ts` 是 opt-in → `/tokens/keys` 默认公开，无需任何中间件配置。游客态 HTML 会被 `cache-control.ts:34` 升级为 `public, max-age=60, s-maxage=120, stale-while-revalidate=300`，且 `Vary` 仅 `Accept-Encoding, Origin`（:35，**不含 Cookie**）。缓存安全边界（第三轮读者反馈修订，把结论说全）：
  - 页面**数据**（F3 响应）与登录态零相关 → 共享缓存无任何隐私/数据泄露风险；
  - 页面 HTML 的唯一登录态差异是**揭示按钮形态**（§3.3 双态，纯 UI）——由于 Vary 不含 Cookie，CDN 上的游客版 HTML 会被后续**已登录用户**命中（单向：已登录请求因 `cache-control.ts:29-32` 保持 private、不入共享缓存，反向不存在），表现为已登录用户看到「登录后揭示」引导链接而非禁用按钮，点击跳登录页——属轻微 UX 瑕疵，可接受；
  - 与 §4.2 判 `/api/search-engines` 为「既有隐患」不矛盾：该接口的登录态差异在**数据内容**（个性化排序/默认引擎），共享缓存会串号数据；本页差异仅在 UI 形态。若要把 UX 瑕疵也消掉，可在 F5 落地时给揭示按钮改为客户端登录态渲染（`onMounted` 后判定），本轮不做。

key SVG（三处页头 nav 与 sidebar 共用同一 path，仅宽高不同：sidebar 18、页头 16）：

```html
<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
```

### #1 `components/sidebar/Sidebar.vue`（:33-38 已落地）

`sidebar-hub-nav`（:14-39）四项：主页(:15-20)/提示词(:21-26)/白嫖通告(:27-32)/**福利 Key(:33-38)**。新项逐字对齐 :27-32 写法（`class="sidebar-hub-link"` + `:class="{ active: activePage === 'tokens-keys' }"` + `title="福利 Key"` + 18×18 SVG + label）。`activePage` 是父页面硬编码传入的 prop（首页 `pages/index.vue:10` 传 `active-page="home"`），当前无页面传 `tokens-keys`，该绑定是惰性的——保留是为与相邻项写法完全对齐，未来 keys 页若复用此侧栏可直接点亮。

### #2 `components/mobile/MobileBottomNav.vue`（:29-37 已落地，三处配套改动）

a) :23 白嫖项改 `:class="{ active: isTokensPage && !isKeysPage }"`（消除双高亮）；
b) :29-37 插入福利项（`ri-key-2-line` + 标签「福利」+ `@click="closeDrawer"`）；
c) :132 补 `isKeysPage` computed。

样式说明（第二轮评审修正）：底栏间距收紧块（:297-307 scoped：`.mobile-bottom-nav { gap:4px; padding:4px 8px }`、`.mobile-nav-item { padding:4px 8px }`）是**上一轮新增白嫖项时的已提交改动**——`git show HEAD` 证实 HEAD 版本尾部已含该块（注释原文「底栏由 6 项增至 7 项（新增「白嫖」）」），本设计工作区 diff 仅 3 个 hunk（:23 / :29-37 / :132），**无样式 hunk**。本设计新增第 8 项后沿用该收紧间距，未再改样式；:298 注释「7 项」与现状 8 项不符，记入 §9.7 打磨项。
风险与对策复核：首两项 `v-if`/`v-else` 互斥（:3-10），同屏 8 项；`.mobile-bottom-nav` 是 fixed 居中浮动条（`public/css/mobile-responsive.css:68-75`：`position:fixed; left:50%; transform:translateX(-50%)`），item 按内容自适应（:76-83，全文件无 flex:1 均分）——沿用收紧样式后 375px 预期可容纳；320px 是否需进一步缩小 item padding 属实施后手动联调项（联调目测，溢出再兜底，不动既有条目与既有样式块）。

### #3 `pages/collections/index.vue`（:24-27 已落地）

`collections-header-nav`（:11-37）：主页(:12-15)/精选集(:16-19)/白嫖通告(:20-23)/**福利 Key(:24-27)**/提示词(:28-31)/评测看板原生 `<a>`(:32-36，注释 :32 说明「非 Nuxt 路由用原生 a」)。新项是 Nuxt 路由，用 `NuxtLink`（照 :20-23，不照 :33），插入在白嫖通告之后、提示词之前（体现层级关系）。

### #4 `pages/prompts/index.vue`（:33-38 已落地）

`sidebar-hub-nav`（:14-39）四项，白嫖通告 :27-32 **无 active 绑定**（本页自己点亮的是 :21 提示词项的硬编码 `class="sidebar-hub-link active"`）。新项对齐 :27-32 的无绑定写法。

### #5 `layouts/admin.vue`（:35-37 已落地）

`admin-sidebar-nav`（:16-71），白嫖通告 :32-34，新项 :35-37 `<NuxtLink to="/tokens/keys" class="nav-item" @click="closeSidebar"><i class="ri-key-2-line"></i><span>福利 Key</span></NuxtLink>`。不带 active 绑定：目标是前台路由，点击即离开 admin 布局；对齐同文件前台链接先例 :67-70（`<a href="/" … class="nav-item nav-item-external">`，同样无 active）。`ri-key-2-line` 与 :52「API 令牌」图标重复，但相隔 15 行且分区不同（前台跳转 vs 后台管理），可接受；避让可换 `ri-key-line`。

### #6 `pages/tokens/index.vue`（页头 tab，:24-27 已落地）

`tokens-header-nav`（:11-37）：主页(:12-15)/精选集(:16-19)/白嫖通告 **active**(:20-23)/**福利 Key(:24-27)**/提示词(:28-31)/评测看板原生 `<a>`(:32-36)。移动端 @media ≤768px 隐藏整个 `.tokens-header`（:766-770），移动端入口由 #2 底栏承担——两处已同批落地。

### #7 `server/routes/sitemap.xml.ts`（:54-60 已落地）

`urls` 数组内 `/tokens` 条目 :47-53，新条目 :54-60：

```ts
// 福利 Key 看板（公开页面，随爬虫轮次日更）
{
  loc: `${baseUrl}/tokens/keys`,
  lastmod: now,
  changefreq: 'daily',
  priority: 0.8,
},
```

`baseUrl` 来自 `config.public.baseUrl`（:8-9，默认 `https://hao.bx9y.com.cn`，nuxt.config.ts:56）；`loc` 经 `escapeXml`（:93-100）转义；`Content-Type: application/xml` + 24h 缓存由既有 :87-88 承担。合规确认：D12「feed/sitemap 永不包含明文 key」约束的是 key 内容；此处只是页面 URL，页面本身只出脱敏数据。

### #8 `pages/tokens/index.vue` hero 互链（**本轮裁剪，未实施**）

设计原稿：hero-toolbar（:49-68）内、发布通告按钮(:65-67)之前插入 `<NuxtLink to="/tokens/keys" class="hero-review" title="福利 Key 看板"><i class="ri-key-2-line"></i> 福利 Key</NuxtLink>`（样式复用待我审核按钮 :54-64 在用的 `.hero-review` class）。
裁剪理由：双向闭环已由 #6（/tokens 页头 tab → keys）与 keys 页头「白嫖通告」tab（keys.vue:20-24 → /tokens）成立，header tab 已把 keys 提升为与白嫖通告同级的一等入口，hero 次级按钮属锦上添花。恢复实施时照上文原文案 + 目测 `.hero-review` 对 `<a>` 元素的样式适配（class 选择器对 `<a>` 同样生效，仅需核对 hover 态）。

---

## 3. 页面信息架构：`pages/tokens/keys.vue`（663 行，已实施）

### 3.1 路由与骨架

- `definePageMeta({ layout: 'default' })`（keys.vue:141，照 index.vue:158），无 middleware → 公开可达。
- 页头复制 `pages/tokens/index.vue:3-39` 的专属 sticky header 结构（keys.vue:3-40），title「福利 Key」，nav 六项：主页 / 精选集 / **白嫖通告(→/tokens，反向互链 :20-24)** / **福利 Key(active :25-28)** / 提示词 / 评测看板（原生 `<a href="/tokens/eval/"` :34，照 index.vue:33 先例）。≤768px 隐藏（keys.vue:641-644，同 index.vue:766-770 断点），移动端靠 §2 #2 底栏。
- SEO `useHead`（keys.vue:184-202）：title「福利 Key — 免费 API Key 时效看板」+ description/keywords + og/twitter 全套 + canonical。
- 数据获取：`useFetch('/api/token-keys', { query, server: true, lazy: false, getCachedData })`（keys.vue:213-218，照 index.vue:272-276，SSR 预取防闪烁）；`watch([page, verdict, provider], () => refresh())`（:278，照 index.vue:342 同款 watch 语义）；厂商输入 300ms debounce（:261-267）。
- 列表网格 `.keys-grid { grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); }`（keys.vue:509-514，照 `.tokens-grid` index.vue:633）；分页条 :123-128；`<BackToTop />` :131。
- 样式全部在 SFC `<style scoped>`（:285-663，类名 `keys-` 前缀防撞），不碰 `public/css/`（约束 6）；页头复用了 `tokens-header-*` 类名的 scoped 重写。

### 3.2 区块自上而下（keys.vue 实际行号）

```
┌─ sticky 页头（福利 Key · nav 六项）            :3-40
├─ ① 免责声明条（D12 原文，warning 软底，不可关闭）:43-47
├─ 错误态（不渲染任何部分数据 + 重试按钮）        :49-54
├─ ② 统计条（总数/有效/失效 + 数据截至）          :57-65
├─ ③ 筛选器（状态下拉 + 厂商输入）               :67-87
├─ 加载骨架 / 空态 / ④ 卡片列表（TokenKeyCard）  :89-121
├─ ⑤ 分页 + <BackToTop />                       :123-131
```

**① 免责声明条** — 文案逐字取 07 §8.5 第 4 条（docs/07:400）的页面原文，keys.vue:46：

> 内容来自第三方论坛公开帖，仅供测试，如有侵权请联系删除

常驻页面顶部第一视觉位（`.keys-disclaimer` :386-401，`var(--warning)` 12% 软底 + `var(--warning)` 文字，风格对齐 TokenDealCard q-low/q-bottom 徽标软底语法）。不出「关闭」按钮。与 8018 的比对（第二轮评审修正）：8018 `/keys` 页（local_server.py:1120-1122）同源但**非严格逐字**——其版本多「（07 §8.5）」尾注与句号；hao 页 keys.vue:46 与 07 §8.5 第 4 条（docs/07:400）逐字一致（无尾注），以 07:400 为准。8018 首页（:1003-1004）是**改写版**（含「本地只读预览：…」上下文句式），不要求对齐。

**② 统计条**（:57-65）— `共 {pagination.total} 条 · 有效 {verdict_counts.valid||0} · 失效 {verdict_counts.dead||0}`，附「数据截至」（:229-237：取行内最大 `last_probe_at`，无探测数据时显示最早 `first_seen_at`，全空则不显示）。`verdict_counts` 来自 F3 的 published 全集口径（index.get.ts:91-97），不受筛选参数影响。有效数绿（:422）、失效数红（:423）。

**③ 筛选器**（:67-87）—

- 状态下拉「全部状态 / 有效(valid) / 受限可用(limited) / 额度受限(quota) / 未知(unknown) / 受限(restricted) / WAF 拦截(blocked_by_waf) / 端点不支持(endpoint_unsupported) / 失效(dead)」（`VERDICT_OPTIONS` :249-258）——dead 殿后并配「● 」前缀 + 红色 option（:77、:462-466，原生 option 着色为渐进增强），落实 D3「页面置灰标红、**可筛选**、不删除」；每项带计数后缀（:79，取 verdict_counts）。
- 厂商输入框（300ms debounce :261-267，照 index.vue:280-283 同款交互），对应 F3 `provider` LIKE 参数（escapeLike 转义）。
- 非组件化，内联两个控件（TokenFilterBar 是三 v-model 的通告专用组件，语义不合，不复用——:432 注释已记）。

**④ 卡片列表**（:113-121 渲染 `TokenKeyCard`）— 每行一张卡（信息架构对齐 `local_server.py:1013-1097 _key_card`，用 Vue 重写）：

| 区 | B 类（有 key） | C 类（指引） |
|---|---|---|
| 头 | provider 首字母 fallback 块 + provider 名（空则兜底帖标题→「未知来源」，TokenKeyCard.vue:121-124）+ 来源徽标（SOURCE_META :127-134：post→绿「帖子直提取」/ aggregator_leak→灰「聚合源泄漏」） | 同左，来源徽标固定蓝「回帖解锁指引」 |
| 主体 | `key_masked` 等宽块（:13-16，`font-family: var(--font-mono,…)`，前缀+星号+后缀形态，模板插值天然转义，**禁 v-html**） | 🔒 指引块（:19-22）：「key 需在原帖回复后可见，点击下方链接去论坛回复领取」 |
| 行 | API 地址 `base_url`（存在才渲染 :25-28）；models chips 前 3 + N（:29-32、:166-167，照 local_server.py:1076-1083） | — |
| 徽标行 | verdict 徽标（见下表 :35-38）+ confidence 徽标（仅 B 类：high→绿「置信 · 高」/medium→黄「置信 · 中」/low→灰「置信 · 低」，CONFIDENCE_META :153-160；C 类不出——豁免理由同 local_server.py:1033-1037：C 类无 (key,base_url) 配对，置信无意义） | 无徽标行 |
| 脚 | 原帖链接 `source_url`（:41-50，`rel="noopener noreferrer nofollow"` target=_blank；**协议白名单** :170-173 只放行 http(s)，防 `javascript:` 注入）+ 收录/探测时间（:184-190） | 原帖链接 + **主按钮「去论坛回复领取」**（:56-64，同一 source_url，按钮强化 CTA） |

**verdict 徽标色语义**（07 F6 权威口径 = 本任务指定：valid 绿 / quota·limited 黄 / dead 置灰标红 / unknown·restricted 灰；07 未点名的两项沿用 local_server.py:64-75 语义。实施 `VERDICT_META` TokenKeyCard.vue:138-150）：

| verdict | class | 文案 | 依据 |
|---|---|---|---|
| valid | `is-ok`（绿） | 有效 | 07 F6 / local_server.py:65 |
| limited | `is-warn`（黄） | 受限可用 | local_server.py:66 |
| quota | `is-warn`（黄） | 额度受限 | local_server.py:67 |
| **restricted** | `is-muted`（灰） | 受限 | **07 F6 明文「unknown·restricted 灰」**（local_server.py:68 渲染为黄，属本地预览站实现偏差，hao 页按 07 执行） |
| blocked_by_waf | `is-warn`（黄） | WAF 拦截 | local_server.py:69（07 未点名，沿用） |
| endpoint_unsupported | `is-muted`（灰） | 端点不支持 | local_server.py:72（07 未点名，沿用） |
| **dead** | `is-bad`（红）+ 整卡 `.is-dead` | 失效 | 07 F6 / local_server.py:70、:509 `.deal-card.is-dead { opacity: 0.6; }`、:1095；实施 TokenKeyCard.vue:2/:118/:204-206 |
| unknown | `is-muted`（灰） | 未知 | 07 F6 / local_server.py:71 |
| 未映射值 | `is-muted` 显示原值 | — | local_server.py:781 回退语义同构（TokenKeyCard.vue:148-150） |

置灰先例双源：本地 `local_server.py:509`（is-dead）与 hao 站既有 `TokenDealCard.vue` is-expired → `opacity: 0.6`；新组件 `.keys-card.is-dead { opacity: 0.6; }`（TokenKeyCard.vue:204-206）与两者一致。

### 3.3 F5 降级态（本轮核心边界，实施为**双态**，比原设计更细）

B 类卡脚部（TokenKeyCard.vue:66-84）：

- **未登录**（`loggedIn=false`）：渲染 `<NuxtLink to="/login?redirect=/tokens/keys" class="keys-reveal is-guide" title="登录后揭示完整 Key">`——照 index.vue:315-322 一带的 `?redirect=` 回跳先例，用户登录后自动回到 keys 页；
- **已登录**：渲染 `<button class="keys-reveal" disabled title="揭示功能 P1 上线">`——禁用占位。

C 类卡无揭示按钮。F5（P1）落地时：移除 disabled → 登录态调 `POST /api/ai/token-keys/[id]/reveal`、未登录跳登录（`NuxtLink` 换事件即可）、429 弹 toast——页面只需改这一个按钮的事件层，`reveal_log` 表本轮已建好（§4.1）。

### 3.4 三态

- 加载态：骨架屏 6 卡（keys.vue:89-104，`aria-hidden="true"`，结构照 index.vue:78-93）。
- 空态（:106-111）：无数据 → 「暂无福利 Key 记录 / 爬虫每 3 小时抓取一轮，敬请期待」；筛选无结果 → 「没有符合条件的记录 / 试试放宽筛选条件」（照 index.vue:96-100 双文案语义）。
- 错误态（:49-54）：`useFetch` error 时整页提示「数据加载失败，请稍后刷新」+ 重试按钮，**不渲染任何部分数据**（防半截白页误导）。

---

## 4. 数据层

### 4.1 三表 DDL（F1，已实施 = migrate.ts:1061-1140，权威 SQL = 07 §8.4 原样 + 爬虫已验证实现）

`server/database/migrate.ts` 新增独立函数 `createTokenKeysSchema(db: Database.Database)`（:1061-1140，位于 `createNexusSchema` :996-1042 之后），并在 `initializeDatabase` 的 `createNexusSchema(db)`(:1602) 与 `createQqBotSchema(db)`(:1604) 之间插调用（:1603）。表结构**逐字**取 07 §8.4（:342 起）+ :393 勘误，与爬虫侧 `crawler/store/db.py:92-138 SCHEMA_STATEMENTS` 完全同构（两库直拷互通的前提，migrate.ts:1048 注释已标「改一处必须同步三处」）：

```sql
CREATE TABLE IF NOT EXISTS token_keys (
  id TEXT PRIMARY KEY,
  source_id TEXT DEFAULT 'linux_sb',
  source_tid INTEGER,
  source_url TEXT DEFAULT '',
  source_title TEXT DEFAULT '',
  source_author TEXT DEFAULT '',
  key_masked TEXT DEFAULT '',          -- 脱敏展示（前6+后4）；C 类恒空
  key_hash TEXT DEFAULT '',            -- sha256 去重；C 类存无凭证哨兵（07 :393 勘误）
  key_encrypted TEXT,                  -- 密文，仅供 F5 揭示；C 类恒 NULL；永不上读接口
  base_url TEXT DEFAULT '',
  provider TEXT DEFAULT '',
  models TEXT DEFAULT '[]',
  source TEXT DEFAULT 'post',          -- post | aggregator_leak | reply_visible_guide
  confidence TEXT DEFAULT 'low',       -- high | medium | low（(key,base_url) 配对置信度，07 §8.2）
  verdict TEXT DEFAULT 'unknown',      -- valid|quota|limited|dead|unknown|restricted|blocked_by_waf|endpoint_unsupported
  consecutive_failures INTEGER DEFAULT 0,
  last_probe_at INTEGER,
  first_seen_at INTEGER,
  deal_status TEXT DEFAULT 'published',-- published | hidden | pending（pending 为 07 F4 审核语义）
  note TEXT DEFAULT '',
  created_at INTEGER, updated_at INTEGER,
  UNIQUE(key_hash, base_url)
);

CREATE TABLE IF NOT EXISTS probe_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  credential_id TEXT NOT NULL,
  base_url TEXT NOT NULL,
  probe_kind TEXT NOT NULL,
  http_status INTEGER,
  error_code TEXT DEFAULT '',
  error_message_raw TEXT DEFAULT '',   -- 仅审计，永不上页面（07 §8.5 第 3 条）
  attempt_n INTEGER DEFAULT 1,
  verdict TEXT NOT NULL,
  probed_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reveal_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  credential_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  ip TEXT DEFAULT '',
  revealed_at INTEGER NOT NULL
);
```

**实现模式逐条照 `createNexusSchema`（migrate.ts:996-1042）**：每张表独立 `try { db.exec(...) } catch (err) { console.error('[DB] 创建 xxx 失败:', err.message) }`（实施 :1062-1091/:1093-1110/:1112-1124），绝不抛出；索引逐条独立 try/catch 的 for 循环（实施 :1127-1139）：

```ts
const tokenKeysIndexes = [
  'CREATE INDEX IF NOT EXISTS idx_token_keys_verdict ON token_keys(verdict)',
  'CREATE INDEX IF NOT EXISTS idx_token_keys_status ON token_keys(deal_status)',
  'CREATE INDEX IF NOT EXISTS idx_probe_log_probed_at ON probe_log(probed_at)',
  'CREATE INDEX IF NOT EXISTS idx_probe_log_credential ON probe_log(credential_id)',
]
```

（与爬虫侧同名同列的是**前 4 条**：token_keys 2 条 + probe_log 2 条 = 爬虫 `db.py:164-167`；爬虫侧另有**第 5 条** `idx_manual_queue_status`（db.py:168）属 `manual_queue` 表——该表不上 hao 站（§5.2 第 3 条：manual_queue 不搬），hao 侧不建，故「两库索引集一致」**仅就 token_keys/probe_log 而言**（第三轮读者反馈澄清）。`reveal_log` 两侧均无索引：hao 侧 F5 落地时按需追加、同样独立 try/catch（migrate.ts:1059 注释已记），爬虫侧 07 §8.4 权威 DDL 本就未为其定义索引。）

**关于 `deal_status` 取 'pending'**：07 F4（docs/07:184）明文「普通 PAT→pending / 管理员 PAT→approved」，把 token_deals 的审核语义映射到 token_keys 即 `deal_status='pending'`。DDL 是无 CHECK 的 TEXT 列（07 §8.4 与 db.py:92-115 均无 CHECK），零迁移成本；F3 的 `WHERE deal_status='published'` 天然同时挡住 `hidden`（下架）与 `pending`（待审）。普通 PAT 写入的行在管理员手动转正前不上页——转正动作 = 一条 `UPDATE token_keys SET deal_status='published' WHERE id=?`，后台管理界面留待后续（§9.4）。

**勘误继承（07 :393）**：C 类指引行的 `key_hash` 存无凭证哨兵 `sha256("guide|{source_id}|{tid}")`（爬虫实现 `db.py:182-185 guide_key_hash`），`key_masked`/`key_encrypted`/`base_url` 恒空/NULL，`UNIQUE(key_hash, base_url)` 由此成立。爬虫库实测 29 个 DISTINCT key_hash 无碰撞（§0.1）。

**F2（已实施）**：`server/database/schema.ts` 在 qq_bindings 之后追加三张 `sqliteTable` 定义：`tokenKeys` :312-340、`probeLog` :344-358、`revealLog` :363-369，风格照 `tokenDeals`（列定义 + 回调数组形式的 `index()`）。仅作 Drizzle 查询/类型层；**建表真源永远是 migrate.ts 原始 SQL**（schema.ts:307-308 注释明示）。一处命名须知：schema.ts:337 声明 `uniqueIndex('idx_token_keys_hash_base')` 对应 DDL 的表级 `UNIQUE(key_hash, base_url)`——真实索引是 SQLite 自动命名的 `sqlite_autoindex_token_keys_N`，`sqlite_master` 里**不存在**名为 `idx_token_keys_hash_base` 的索引对象，任何按索引名探测的断言都要按「存在 unique=1 且列覆盖 (key_hash, base_url) 的索引」口径写（§6 A4）。

### 4.2 F3 公开读接口契约：`server/api/token-keys/index.get.ts`（已实施，109 行）

| 项 | 契约 | 实施 |
|---|---|---|
| 路径 | `GET /api/token-keys` | index.get.ts（Nuxt 文件路由自动注册） |
| 鉴权 | **无**（不调 `optionalAuth`——响应与登录态零相关，才允许 CDN 公开缓存）。⚠️ `/api/search-engines` **不是**零鉴权先例：其 handler 实调 `optionalAuth` 且登录态个性化排序，响应含登录态差异却被 routeRules public 缓存——属既有隐患，**不可照抄其鉴权写法**；本设计只借鉴其 routeRules 覆写形式 | :46-56 纯 `getQuery`，无任何鉴权调用 |
| Query | `page`（默认 1）、`limit`（默认 24，钳制 `min(100, max(1, …))`，照 token-deals/index.get.ts:53-55）、`verdict`（可选，白名单校验 ∈ 8 值 VERDICTS，非法值忽略）、`provider`（可选，LIKE 模糊，经 `escapeLike` 转义——`server/utils/token-deals.ts:58`） | :49-56、:63-71 |
| hidden/pending 过滤 | 恒定 `WHERE deal_status = 'published'`，**无任何旁路**（无 token-deals 的 `mine=1` 分支——本表没有用户归属；07 §8.5 第 5 条「通知即下架」） | :61 |
| 排序 | 固定一条：`ORDER BY (source = 'post') DESC, last_probe_at DESC, first_seen_at DESC, id`（照 local_server.py:1109 的实测排序；无 mine 场景不需要 5 种 sort 参数） | :81 |
| 返回 | `{ keys, pagination, verdict_counts }`；`pagination = { page, limit, total, totalPages }`（照 :163-171）；`verdict_counts` 对同一 published 全集 `GROUP BY verdict` 计算（**不受筛选参数影响**，统计条恒显全量口径） | :99-108、:91-97 |

**返回字段白名单（SELECT 列清单即白名单，敏感列根本不进 SELECT）**（实施 `KEY_FIELDS` :30-33）：

```sql
SELECT id, key_masked, verdict, confidence, provider, base_url, models, source,
       source_id, source_tid, source_url, source_title, first_seen_at, last_probe_at
FROM token_keys
WHERE deal_status = 'published' [AND verdict = ?] [AND (provider LIKE ? ESCAPE '\')]
```

- 14 个字段之外**一律不返回**。明确排除：`key_encrypted`、`key_hash`、`error_message_raw`（三红线列）、`deal_status`（恒 published 无信息量）、`consecutive_failures`、`note`（内部诊断，8018 内部视图专用）、`created_at`/`updated_at`。
- `models` JSON.parse + `Array.isArray` 防御（`parseModels` :36-44，照 index.get.ts:13-21 同名函数）。
- 不做 token-deals 的 sqlite_master 降级探测（index.get.ts:66-68）——本接口与建表同版本发布，表缺失直接 500 暴露迁移失败（独立 try/catch 已保证迁移失败不拖垮其他表；文件头注释 :17-18 已记此决策）。

**缓存（设计定稿，实施待补 = 偏差 2）**：`nuxt.config.ts` routeRules 应增加（放在 `/api/search-engines` :120-124 旁）：

```ts
'/api/token-keys': {
  headers: { 'Cache-Control': 'public, max-age=300' },
},
```

更具体的路径规则覆盖 `/api/**` 的 no-store（:114-118）——search-engines 的 routeRules 覆写形式证明可行；`server/middleware/cache-control.ts:19` 对 `/api/` 直接 return，不干扰。5 分钟缓存与爬虫 3 小时轮询节奏匹配，时效损失可忽略。**当前未加的行为**：`/api/token-keys` 响应 `no-store`，每次请求回源——功能无损（数据反而更新鲜），仅无共享缓存。补加前 A9-A12 断言不受影响。

### 4.3 F4 PAT 写接口契约：`server/api/ai/token-keys/index.post.ts`（已实施，22 行薄端点）

薄端点（逐字对齐 `ai/token-deals/index.post.ts` 的三层结构，实施 :19-22）：

```ts
export default defineAiHandler('write', async (event, token) => {
  const body = await readBody(event).catch(() => ({}))
  return upsertTokenKey(getRawDb(), token.user_id, body)
})
```

**鉴权与限频（全部继承 defineAiHandler，零新代码）**：`favs_ai_` Bearer PAT 前缀校验（ai-auth.ts:148-154）→ `verifyPat` SHA-256 + timingSafeEqual（:105-125，先判长度防 RangeError）→ IP 兜底 300 次/分（:136）→ 令牌级 600 次/分（:166）→ `finally` 审计 `ai_audit_logs`（403 也入、401/429 不入，:241-242/:262-264）。**绝不回退 JWT**（CLAUDE.md 通道隔离铁律）。

**请求体**（实施 `TokenKeyPayload` ai-service.ts:1034-1053）：

```jsonc
{
  "key_hash": "…64 位小写 sha256 hex，必填",
  "base_url": "https://api.example.com/v1",      // C 类恒 ""
  "key_masked": "sk-abc…*wxyz",                   // C 类恒 ""
  "key_encrypted": "…Fernet 密文，可选（开放点见 §9.4）",
  "provider": "OpenRouter",
  "models": ["gpt-4o", "claude-…"],               // ≤20 条，normalizeModels 复用
  "source": "post",                               // post | aggregator_leak | reply_visible_guide
  "confidence": "medium",                          // high | medium | low
  "verdict": "unknown",                            // 8 值白名单
  "source_id": "linux_sb",
  "source_tid": 23684,
  "source_url": "https://linux.sb/topic/23684",
  "source_title": "…", "source_author": "…",
  "consecutive_failures": 0,
  "last_probe_at": 1759190400,                     // 秒级，与爬虫库一致
  "first_seen_at": 1759190400,
  "note": "",
  "dry_run": false
}
```

**校验（实施 `validateTokenKeyPayload` ai-service.ts:1084-1178，风格照 `validateDealPayload` server/utils/token-deals.ts:99 的「只做字段级校验」分工）**：

- `key_hash` 必填且 `^[0-9a-f]{64}$`（:1086-1089）；`source`/`confidence`/`verdict` 枚举白名单（:1091-1104，值集 = interfaces.py:49-83）；
- 长度上限（`KEY_LIMITS` :990-998，照 LIMITS token-deals.ts:34 风格）：source_url 500、source_title 200、source_author 60、provider 60、note 500、models 20 条（normalizeModels 复用）、key_masked 260；
- 时间戳「正整数或缺省」/「非负整数或缺省」（:1063-1077 两个 helper）；
- **B 类 `key_masked` 脱敏形态校验（硬闸门，防明文直入公开页）**：`source != 'reply_visible_guide'` 且 `key_masked` 非空时，必须含 `*` 且**不得**匹配明文 key 形状正则（:1142-1146；正则 `PLAIN_KEY_SOURCE` :1017-1021 = `local_server.py:47-52` 的 JS 等价式，脱敏值的星号截断 `{10,220}` 尾段、天然通过——self-test 已验证该性质，§6）；命中即 400「key_masked 必须是脱敏形态（含 *），不得提交明文」。这是硬闸门的理由：F3 白名单把 `key_masked` 原样透传上公开页（§4.2），服务端不拦明文形状，明文 key 就能经 F4 入库、经 F3 上页；
- **C 类服务端强制覆盖（不信任客户端，D2 红线）**：`source === 'reply_visible_guide'` 时强制 `key_masked=''`、`key_encrypted=null`、`base_url=''`（:1171-1175）——即使 payload 带了值也丢弃；
- 错误信息只报字段名不回显值（ai-service.ts:985-987 红线注释），防校验错误把 key 材料回显进响应。

**dry_run**：`body.dry_run === true` → 只返回 `{ dry_run: true, changes: { …归一化行(白名单子集), deal_status } }` 不落库（实施 :1208-1228，照 createTokenDeal 的 dry_run 模式）。爬虫切 PAT 时第一轮全量 dry_run 预演（07 §6.2 C1）。

**审核映射**：`const isAdmin = isUserAdmin(db, token.user_id)`（ai-service.ts:60 既有实现，与 Web requireAdmin 同序 NUXT_ADMIN_USERS→DB is_admin）；`deal_status = isAdmin ? 'published' : 'pending'`（:1204-1205）——普通 PAT 写入待审、管理员 PAT 直上（07 F4 原文语义，D9）。⚠️ **生产闭环提示（第三轮读者反馈）**：若爬虫配普通 PAT，每个新 key 的 INSERT 都落 pending，而本轮无审核界面 → 公开页只显示被人工转正过的行，等于每轮爬虫后都要手工 UPDATE，数据流闭环缺失。两案处置与推荐见 §9.4「pending 转正闭环」拍板项。

**upsert（按 `key_hash + base_url`，实施 `upsertTokenKey` :1199-1319，照爬虫 `db.py:354-420 upsert_token_key` 的列所有权纪律重写为 TS）**：

- 事务内先 `SELECT id FROM token_keys WHERE key_hash = ? AND base_url = ?`（:1237-1239）；
- **命中（更新 ：1244-1271）**：只更新可变列——`key_masked`、`key_encrypted = COALESCE(?, key_encrypted)`（传 null 保留既有密文）、`provider`、`models`、`source`、`confidence`、`verdict`、`consecutive_failures`、`last_probe_at`、`note`、`updated_at`。**绝不动**：`deal_status`（不复活 hidden，也不把 pending 刷成 published——07 F4 的审核映射只在 INSERT 时判定；爬虫 `db.py:365-372` 注释原文「an upsert must never resurrect a row that was hidden after a takedown notice」）、`first_seen_at`/`created_at`/`id`/`source_*`（身份历史）。verdict 在此**允许更新**：与爬虫本地库（verdict 由状态机 `update_verdict` db.py:502-519 独占写）不同，PAT 通道里爬虫是唯一写者，07 §6.2 C3（:198）明文「存量 key 每轮 upsert 最新 verdict」；
- **未命中（插入 :1273-1303）**：全列 INSERT（22 列），`id = randomUUID().replace(/-/g,'')`（:1230，newDealId 风格），`deal_status` = 审核映射值，`created_at/updated_at = 秒级 now`（:1231）——**token_keys 沿爬虫语义存秒**，站点其余表（token_deals 等）用毫秒；页面渲染时 `× 1000`（keys.vue:240-246、TokenKeyCard.vue:176-182 的 formatTs），两库直拷才不需要换算，此差异已写死在 F4 文件头注释（index.post.ts:11）与 schema.ts:309；
- C 类哨兵 hash：**爬虫侧已算好**（db.py:182-185）随 payload 传入，服务端不重复派生（保证两库同值）；
- **事务**：查存量 + 插入/更新整体包 `db.transaction(() => { … })()`（:1237，CLAUDE.md「多步写必须 db.transaction」；ai-service.ts 既有 6 处先例 ：187/:392/:465/:550/:634/:834）；
- 返回（:1307-1318）：`{ token_key: { …白名单 14 字段（同 F3，不含红线列）, deal_status }, upserted: 'inserted'|'updated', status: deal_status, message }`——回读走 `TOKEN_KEY_PUBLIC_FIELDS`（:1028-1031）+ deal_status，密文/hash 不回流。

**限频**：继承的 IP 300 / 令牌 600 每分钟对「每 3 小时一轮、每轮 ≤ 百行」的爬虫流量绰绰有余，不额外加限频。

---

## 5. 本地数据桥：`scripts/sync_to_favshub_local.py`（tokenhub 仓库，已实施 398 行）

> Python 3 标准库 only（sqlite3/argparse/hashlib/pathlib），幂等可重跑，stdout 只打计数。

### 5.1 路径（现场核实）

| 库 | 路径 | 依据 |
|---|---|---|
| 源（只读） | `D:\project\wwwroot\tokenhub\crawler\data\tokenhub.db` | 本会话以 `file:...?mode=ro` URI 实际只读打开查询过（§0.1） |
| 目标（读写） | `D:\project\wwwroot\FavsHub_web\favshub-nuxt\data\favshub.db` | `nuxt.config.ts:39` `dbPath: './data/favshub.db'` → `initDatabase` 里 `resolve(dbPath)`（server/database/index.ts:41）相对进程 cwd，dev 下即仓库根；`NUXT_DB_PATH` 可覆盖（CLAUDE.md 环境变量表）。**现场 `ls data/`：目前只有 `favicons/`，favshub.db 尚不存在**——桥脚本自举建库（下）；脚本两默认路径为其常量 `DEFAULT_SOURCE_DB`/`DEFAULT_TARGET_DB`（绝对路径，子进程 cwd 不可假设），`--source`/`--db` 可覆盖 |

时序建议：先 `pnpm dev` 跑一次让 Nitro 建出全量 favshub.db，再跑桥；但桥不依赖此前提——目标库不存在时自举建库也能工作（FavsHub 首次启动 migrate 全部 `IF NOT EXISTS`，互不冲突）。WAL 多进程并发由 FavsHub 侧 `busy_timeout=5000`（index.ts:54）兜底；最稳妥的用法仍是 dev 服务停着跑桥。`--dry-run` 语义（--help 实测）：「count only, never write the target DB (a missing target is simulated in memory, an existing one is attached read-only)」。

### 5.2 CLI 与行为（脚本已实现，头部 docstring 逐条引用本节编号）

```
python scripts/sync_to_favshub_local.py [--dry-run] [--source PATH] [--db PATH] [--no-encrypted]
```

1. **打开源库**：`mode=ro` URI（`open_source_readonly` :173-175）——强制只读，红线。
2. **自举建表**（目标库，`bootstrap_schema` :204）：逐条执行 §4.1 三表 DDL + 4 索引，**每条独立 try/except**（与 F1 完全同一段 SQL，注释标注与 07 §8.4 / `crawler/store/db.py:92-169` 同源，改一处必须同步三处）。目标库文件不存在则 sqlite3 自动创建（父目录不存在则先建）。probe_log/reveal_log 建表但**不搬行**。
3. **读源**（`read_source_rows` :220）：`SELECT * FROM token_keys WHERE deal_status = 'published'`——**不过滤 verdict，dead 行照搬、由 hao 页面置灰**。真先例是 `local_server.py:1104-1109`（render_keys 的读 SQL：`FROM token_keys WHERE deal_status = 'published'`，无 verdict 条件）。⚠️ `db.py:522-534 select_publishable` **不是**本处先例：它多一个 `AND verdict != 'dead'`（:531），那是 **feed 的口径**（D3：dead 从 feed 剔除），不是页面口径。两种口径下 hidden 行都绝不外流。manual_queue / probe_log / reveal_log **不搬**（人工队列是 8018 内部视图资产，probe/reveal 是站点自身运行时审计）。
4. **逐行 upsert 到目标库**（`normalize_record` :232 + `sync_rows` :260，upsert 键 = `UNIQUE(key_hash, base_url)`；C 类哨兵 hash 在源侧已生成，直拷不二次派生，保证两库同值）。映射规则：

| token_keys 列 | 桥行为 |
|---|---|
| id / source_id / source_tid / source_url / source_title / source_author | 同名直拷；命中存量时**不覆盖**（身份历史） |
| key_masked / key_encrypted / provider / models / source / confidence / note | 同名直拷；命中存量时覆盖（UPDATE 模板 :152-154 `key_encrypted = COALESCE(:key_encrypted, key_encrypted)`；`--no-encrypted` 时传 NULL，既有密文由 COALESCE 保留） |
| verdict / consecutive_failures / last_probe_at | 直拷（本地桥是目标库唯一写者，等价生产链路里爬虫经 F4 独占写 verdict 的地位） |
| first_seen_at / created_at | 命中存量不覆盖；新行直拷（保留源侧首次发现时间，页面「收录时间」不失真） |
| updated_at | 每次同步刷为 now() |
| deal_status | 新行写 `'published'`；命中存量**绝不 UPDATE**（hidden 不复活，同 db.py:365-372 纪律） |

   另有 C 类守卫（`normalize_record` 内，镜像 F4 服务端规则）：`source='reply_visible_guide'` 的行强制无凭证列为空/NULL——对规整爬虫数据是无操作，防脏数据把 key 材料混进指引行。
5. **事务**：全部写包在一个 `with conn:`（:277，单连接单事务，失败整体回滚——比逐行事务更接近「快照同步」语义；CLAUDE.md 的 db.transaction 纪律是 FavsHub TS 侧规矩，Python 侧同理由 `with conn` 落实）。
6. **输出（红线：只打数字，不打行内容）**：

```
[bridge] source rows(published): 29
[bridge] inserted: 29  updated: 0  total_in_target: 29
[bridge] skipped hidden at source: 0
[bridge] OK
```

   `--dry-run`：只打印计数，不写目标库。
7. 退出码：0 成功；源库/目标库打开失败或 SQL 异常 → 非 0 + stderr 消息（只含路径与异常类名，不含行数据）。

### 5.3 为什么自举建表而不是等 F1

本地 dev 时序上桥脚本先于「FavsHub 生产部署」运行：dev 联调当天 F1 代码已在工作区（Nitro 启动即建表），但桥脚本保持**自带 DDL**，使「不启动 dev、纯脚本验证数据链路」（§6 的 A1-A8 断言）成为可能。**关于「改一处必须同步三处」的守门现状（第三轮读者反馈澄清）**：设计上由 §6 A3/A4（DB 层列集/索引断言）兜底，但当前脚本只覆盖 HTTP 子集（§6.1：A1-A7 全部未实现），即该同步纪律**眼下没有自动化断言在守**——补齐前的替代闸门：① 三处 DDL（migrate.ts:1064-1087 / sync 脚本 SCHEMA 段 / db.py:92-115）在每次评审时逐字比对；② 已覆盖的 A8/A10/A14 可间接暴露「列缺失」型漂移（F3/页面断言会失败），但暴露不了「多列/类型漂移」。A1-A7 补入脚本列为 §9.6 的门禁前置项。**当前现场**：favshub.db 尚不存在（桥未跑过）——桥的首次真跑属主流程门禁/联调阶段。

---

## 6. 端到端验证：`scripts/verify_hao_keys_local.mjs`（tokenhub 仓库，已实施 571 行）

**脚本形态（现场核实）**：Node ESM、stdlib only。不带参数运行时由脚本**自行拉起被测服务器**：入口固定 `D:/project/wwwroot/FavsHub_web/favshub-nuxt/.output/server/index.mjs`（:28，**即 `pnpm build` 的产物**，cwd 固定 favshub-nuxt 仓库根 :29）、端口候选 3100/3101/3102（:33）、就绪轮询 90s（:34）→ 断言 → 杀进程；详细日志全量重写 `scripts/verify_hao_keys_local.log`（:30），server 子进程输出**落盘前先过 PLAIN_KEY_RE 脱敏**（:56-65 的 JS 移植），日志只记计数/布尔/形状，绝不记 key 值、key_hash、密文或 cookie。`--self-test` 跑纯 helper（无网络无子进程，**本会话实跑 16/16 PASS**）。

**门禁运行方式**：`pnpm build`（先产出 `.output/`）→ `node D:/project/wwwroot/tokenhub/scripts/verify_hao_keys_local.mjs`；exit 0 = 全过。

### 6.1 断言清单全集（设计口径 A1-A18）与脚本当前覆盖

下表「脚本」列 = 当前 571 行脚本的实际覆盖（HTTP 层）；未覆盖项保留清单原义，供门禁/后续补齐。

| # | 断言 | 层 | 脚本 |
|---|---|---|---|
| A1 | favshub.db 存在且可只读打开 | 文件 | 未覆盖（脚本走 HTTP 路径） |
| A2 | `sqlite_master` 含 `token_keys` / `probe_log` / `reveal_log` 三表 | DDL | 未覆盖（同上） |
| A3 | `PRAGMA table_info(token_keys)` 列名集合 == 22 列权威清单（与 `crawler/store/db.py:92-115` 逐一比对） | DDL | 未覆盖 |
| A4 | 存在覆盖 `(key_hash, base_url)` 的 UNIQUE 索引（`PRAGMA index_list` + `index_info`，按「unique=1 且列覆盖」口径，**勿按索引名**——真实索引为 sqlite_autoindex，§4.1 F2 须知） | DDL | 未覆盖 |
| A5 | 目标库 token_keys 行数 == 源库 `WHERE deal_status='published'` 行数（当前基线 29，脚本动态比对不写死） | 数据 | 未覆盖 |
| A6 | 目标库 `deal_status` 取值 ⊆ {'published'}（无 hidden/pending 外流） | 数据 | 未覆盖 |
| A7 | C 类不变式：`source='reply_visible_guide'` ⇒ `key_masked='' AND base_url='' AND key_encrypted IS NULL` | 红线 | 未覆盖（等效语义已由 F4 服务端强制覆盖 + 桥守卫双保险） |
| A8 | B 类脱敏形状：`key_masked` 为 `''`（C 类）或含 `*`（B 类脱敏），长度 ≤ 260 | 红线 | ✅ API 层逐行（`rowMaskOk` :92-96，PASS 文案「每行 key_masked 含 * 或为空」:381；空集 vacuous PASS 并提示结合 total 复核 :384） |
| A9 | `GET /api/token-keys` → 200，JSON 含 `keys` / `pagination` / `verdict_counts` | F3 | ✅（:342-374；verdict_counts 缺失仅记录不判失败 :373） |
| A10 | 响应**原始文本**不含 `"key_encrypted"`、`"key_hash"`、`"error_message_raw"` 三个子串（全文子串口径，任何嵌套位置都算 FAIL） | 红线 | ✅ 页面与 API 双查（:331-334、:349-352；`findForbiddenSubstrings` :84-86） |
| A11 | 每行字段键集 ⊆ §4.2 的 14 字段白名单 | F3 | 未覆盖（A10 的红线子串口径兜住敏感列） |
| A12 | `?verdict=dead` → 每行 `verdict==='dead'`（结构不变式而非数量，0 行空集 PASS） | F3 | ✅（:401-436；status/verdict 双参数探测 :54，命中的参数记入日志，偏离说明 :429-431） |
| A13 | `GET /tokens/keys` → 200，HTML 含免责声明原文「内容来自第三方论坛公开帖，仅供测试，如有侵权请联系删除」 | F6 | ✅（:304-317，原文常量 :43 = docs/07:400 逐字） |
| A14 | 页面 HTML 不匹配明文 key 形状正则（`local_server.py:47-52` 的 JS 等价式；`key_masked` 的星号形态天然通过） | 红线 | ✅（:327-330，`countPlainKeyHits` :75-78） |
| A15 | F5 降级态（**双态互斥，同一响应只出其一**，§3.3）：① 游客态——HTML 含 `/login?redirect=/tokens/keys` 引导链接（`NAV_HREF_NEEDLE` 同款 needle 即可断言）；② 已登录态——HTML 含 `disabled` 揭示按钮 + title「揭示功能 P1 上线」（**需带登录 cookie 的请求路径**） | F6 | 未覆盖：当前脚本全无登录态请求路径，② 无从执行；① 可并入现有游客请求组（后续补 needle 即可）。不存在「同一 HTML 同时含二者」的口径——那与 §3.3 互斥设计矛盾 |
| A16 | `GET /sitemap.xml` 含 `<loc>…/tokens/keys</loc>`（§2 #7） | F7 | 未覆盖 |
| A17 | `GET /` 首页 HTML 含 `href="/tokens/keys"`（sidebar SSR，§2 #1）；`GET /tokens` 含同 href（页头 tab，§2 #6）；keys 页自身含自指导航 | F7 | 部分：keys 页自指导航 ✅（`NAV_HREF_NEEDLE` :45、:318-321）；首页与 /tokens 页 needle 未覆盖 |
| A18 | 仅当提供 PAT：`POST /api/ai/token-keys`（Bearer，合法 key_hash + `dry_run:true`）→ 200 且响应含 `dry_run:true`，且目标库行数不变 | F4 | 未覆盖（本地联调默认无 PAT） |

> 注：脚本当前覆盖集即门禁的最小可执行集（A8-A14 语义 + keys 页自指导航）；A1-A7 只依赖数据库文件，可在桥首跑后由任一 sqlite 客户端人工复核（或后续并入脚本）。

**本会话已实跑**：`node scripts/verify_hao_keys_local.mjs --self-test` → 16/16 PASS, exit 0（明文 sk-/gsk_ 命中、星号脱敏放行、词内前缀负向断言、scrub 幂等、红线子串发现、rowMaskOk 四态、deadFilterResult 四态）。**未实跑**：完整 HTTP 断言（依赖 `pnpm build` 产物 + 端口拉起，门禁统一执行，约束 5）。

---

## 7. 与 8018 本地预览站的分工

`local_server.py`（tokenhub 仓库根，`HOST, PORT = "127.0.0.1", 8018`，:39 现场核实）是 **P0 内部运维视图**：只读 tokenhub.db，绑 127.0.0.1 不对外。hao 站 `/tokens/keys` 是**公开产品视图**。分工边界：

| | 8018（local_server.py，不动） | hao `/tokens/keys`（本轮已建） |
|---|---|---|
| 受众 | 只有本机（爬虫运维/人工复核） | 公网访客 |
| 数据面 | token_keys 全量（含 dead/内部诊断）+ **manual_queue 218 行**（REASON_META :99-105）+ 日报 reports/ + crawl_state 水位 | 仅 F3 白名单 14 字段、published 行 |
| 特有内容 | 「连续失败 N 次」（:1090-1091）、probe 时间线、人工队列中文详情、日报目录 | 免责声明条、统计条、状态筛选器、C 类「去论坛回复领取」CTA、F5 揭示按钮降级态 |
| 禁止上 hao 页的 | `consecutive_failures`、`note`、manual_queue、reports、`error_message_raw` | — |
| 免责声明 | /keys(:1120-1122) 同源原文但多「（07 §8.5）」尾注，非严格逐字；home(:1003-1004) 为改写版 | 页顶免责条取 07:400 原文（keys.vue:46 逐字，无尾注）；与 8018 /keys 非严格逐字，以 07:400 为准 |

结论：8018 **保留原样、零改动**——队列与日报是 P0 运维资产（07 §7.2 :235 才正式化），不随 F6 上公网；hao 页面不重复实现任何运维视图能力。两站读取的是同一条数据链的两端（8018←tokenhub.db←爬虫→桥→favshub.db→hao）。

---

## 8. 回滚清单（逐文件，按当前工作区状态）

**总原则（07 :422）**：全部改动是新增（新表/新路由/新页面/新导航项），旧代码不引用新表；FavsHub 工作区有用户未提交的手写改动，**回滚 = 手工删除本设计引入的代码块/文件，禁止 `git checkout/restore`**（会把用户改动一并冲掉）。

| 文件 | 回滚动作 |
|---|---|
| `server/database/migrate.ts` | 删 `createTokenKeysSchema` 函数（:1044-1140 含注释）+ `initializeDatabase` 里的调用行（:1603） |
| `server/database/schema.ts` | 删新增三表定义块（:306-369）；确认无 import 增量残留 |
| `server/api/token-keys/index.get.ts` | 删除整个文件 |
| `server/api/ai/token-keys/index.post.ts`（连同 `server/api/ai/token-keys/` 目录） | 删除整个目录 |
| `server/utils/ai-service.ts` | 删新增块（:984-1319：红线注释、KEY_LIMITS、枚举、PLAIN_KEY_SOURCE、TOKEN_KEY_PUBLIC_FIELDS、TokenKeyPayload、str/posIntOrNull/nonNegIntOrNull 若无他用一并删、validateTokenKeyPayload、upsertTokenKey）；逐一确认删后无残留引用 |
| `pages/tokens/keys.vue` | 删除整个文件 |
| `components/tokens/TokenKeyCard.vue` | 删除整个文件 |
| `pages/tokens/index.vue` | 删 :24-27 的 tab 块（4 行） |
| `components/sidebar/Sidebar.vue` | 删 :33-38 新增块（6 行） |
| `components/mobile/MobileBottomNav.vue` | 删 :29-37 新增块 + :132 `isKeysPage` 行；:23 还原为 `:class="{ active: isTokensPage }"`。**不删 :297-307 scoped 样式块**——它是上一轮白嫖导航的已提交改动（`git show HEAD` 证实，HEAD 已含，见 §0.1 评审复核①），不属本设计引入内容，删除会误伤既有功能 |
| `pages/collections/index.vue` / `pages/prompts/index.vue` | 各删新增 NuxtLink 块（:24-27 / :33-38） |
| `layouts/admin.vue` | 删 :35-37 nav-item 块（3 行） |
| `server/routes/sitemap.xml.ts` | 删 :54-60 `/tokens/keys` 数组对象（含注释行） |
| `nuxt.config.ts` | 无改动（routeRules 待补项未实施，无需回滚） |
| tokenhub `scripts/sync_to_favshub_local.py`、`scripts/verify_hao_keys_local.mjs`、`scripts/verify_hao_keys_local.log` | 删除文件（`scripts/` 目录若空则一并删；log 是占位/运行产物） |
| FavsHub 本地库数据 | 新表不被旧代码引用，**留着无害**（07 :422）；彻底清理 = 于 `data/favshub.db` 执行 `DROP TABLE IF EXISTS token_keys/probe_log/reveal_log`（含同名 idx_ 索引自动随表），或直接删 `data/favshub.db`（dev 库，下次启动自动重建；当前该文件尚不存在） |
| 线上（未来生产回滚，存档 07 §6.3 :201） | 回退上一 `VERSION` 镜像 + 还原 `favshub.db` 备份；爬虫停 cron 即全停 |

---

## 9. 遗留项（本轮不做，显式留痕）

1. **F5 揭示端点（P1，07 D2「必做」，:185）**：`server/api/ai/token-keys/[id]/reveal.post.ts`（登录态 + `checkRateLimit('reveal:{ip}:{userId}')`（rate-limit.ts:46 同款）+ 写 `reveal_log` + 解密 `key_encrypted`）。页面已留双态降级按钮（§3.3），F5 落地只改按钮事件层；`reveal_log` 表本轮已建。注意该端点路径在 `/api/ai/*` 下但需要 **JWT 登录态**而非 PAT——与 CLAUDE.md 通道隔离铁律存在张力，F5 设计时须先拍板通道归属（07 原文「要求登录态（复用 server/utils/auth.ts/JWT cookie）」倾向 JWT，则路径不宜挂在 `/api/ai/` 下，或作为该铁律的首个显式豁免记录在案）。
2. **F8 www 站入口**：`markflow-wiki` hero 第 4 按钮指向 `hao.bx9y.com.cn/tokens/keys`——本轮完全不动，实施时按 07 F8（:188）现场看 `scripts\deploy.cmd` 发布链。
3. **生产部署链**（07 §6.3 :201）：bump VERSION → 镜像 → 服务器 `docker compose pull + deploy.sh`；nginx feed.xml alias（07 C4）；管理后台创建 PAT（**普通 or 管理员绑定**——pending 转正方案见 §9.4 拍板项）填入爬虫 `.env`；爬虫发布层从本地文件切 PAT（07 §6.2 C1-C3）。前置 = P0 七天闸门数据 + 用户拍板。
4. **开放点（需拍板）**：
   - F4 POST 载荷是否携带 `key_encrypted`——07 未明定；不同步则 F5 无密文可解。本地桥默认同步（`--no-encrypted` 可关），生产 F4 按本文契约默认接收；若拍板不同步则删该字段并同步删桥开关。
   - **pending 转正闭环（生产数据流，需拍板——第三轮读者反馈）**：若爬虫配普通 PAT，所有新行落 pending 而本轮无审核界面，公开页将只显示被人工转正过的行（每行都要手工 UPDATE，闭环缺失）。两案：
     - **方案 a（推荐）**：给爬虫发**管理员绑定 PAT**（isUserAdmin 命中 → INSERT 直上 published）——数据源是自家可信爬虫，F4 全链路已有脱敏硬闸门（B 类 key_masked 形状校验 :1142-1146、C 类服务端强制清空 :1171-1175、读侧白名单 SELECT），spam 直通风险低；公开页随爬虫轮次日更，零人工介入。风险与缓解：PAT 泄漏 = 管理员写权限 → 令牌可随时吊销 + write scope（无 delete）+ 令牌级 600/min 限频（ai-auth.ts:166）+ `ai_audit_logs` 逐请求审计（:246-266）。
     - **方案 b（最小权限）**：维持普通 PAT，约定**每轮爬虫后**人工执行一条批量转正 SQL（`UPDATE token_keys SET deal_status='published' WHERE deal_status='pending'`，谁执行、写进爬虫运维手册），或等后台审核界面（对齐 `/admin/token-deals` 队列模式）落地后改走界面转正；代价是公开页时效依赖人工、易漏转。
     - 两案对本地联调零影响（本地桥直写 published，§5.2 第 4 条）；对 F4 代码也零影响（映射逻辑已实现），差异只在「给爬虫签哪类 PAT」。
   - 「restricted 徽标灰色」与 local_server.py:68 的黄色不一致——按 07 F6 执行灰；8018 是否同步改另行小任务（本回合不动 8018）。
5. **本轮实施偏差待补**（§0.2）：① `nuxt.config.ts` 加 `'/api/token-keys'` 的 `public, max-age=300` routeRules（照 :120-124 search-engines 形式，加一行即可）；② `pages/tokens/index.vue` hero 互链（§2 #8，可选）。两者均无阻塞风险。
6. **验证边界**：`pnpm build` / `pnpm ts:check` 未在本设计会话运行（约束：门禁统一执行）；桥对目标库的首次写入与 §6 完整 HTTP 断言（A8-A14 语义）依赖 build 产物 + dev/preview 服务，均留待门禁。**A1-A7（DB 层断言）当前脚本未实现**（§5.3）：门禁跑桥后建议以任一 sqlite 客户端按 A2-A6 口径人工复核一次，后续补入脚本。已实跑并全绿：verify 脚本 `--self-test`（16/16）、桥脚本 `--help`（exit 0）、tokenhub.db 只读数据核对。
7. **两处既有文件头注释陈旧（打磨项，本轮按「只改文档」约束不动代码）**：`server/database/schema.ts:2`「完整映射 FavsHub SQLite 数据库的 10 张表」实际已 13 张（本设计 +3）；`components/mobile/MobileBottomNav.vue:298`「底栏由 6 项增至 7 项」实际 8 项（且该样式块系上一轮已提交代码，见 §0.1 评审复核①）。均不影响功能；建议与 §9.5① routeRules 补齐同批顺手更新（无需单独任务）。
