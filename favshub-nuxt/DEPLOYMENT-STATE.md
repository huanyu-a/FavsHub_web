# 部署状态与注意事项

> **读者：执行部署的人 / AI 助手。**
> 本文件记录**当前生产环境的状态**与易踩的坑。日常部署步骤见 `README.md`；
> 含密码的本机步骤见 `DEPLOY.md`（gitignore，不入库）。

**最后更新：2026-11-04（第 18 次修订：正式部署 1.0.69，定位并修复「详情页偶发加载失败」的根因 —— 限流响应头含中文导致 429 变 500）**

## ✅ 当前状态：生产已跑 CI 构建的正规镜像 1.0.70（2026-11-04）

生产现在运行的镜像由 GitHub Actions 构建并推送：

| 项 | 值 |
|---|---|
| **版本** | `1.0.69` |
| **来源提交** | `57670c8e471a7a086239bbb4e0d0316f85c36c0d` |
| **镜像 label** | `org.opencontainers.image.version=1.0.69`、`revision=57670c8…` —— 部署前拿它当**闸门**：不符就不重建容器 |
| **RepoDigest** | `ghcr.io/huanyu-a/favshub@sha256:35896b734934f53d2224aad73fb49f3162db6005249a07c900ea5f94769e3ddd`（上版 1.0.68 是 `cfdff281…`）|
| **容器 Image ID** | `sha256:0738121d05ba26afb0040d4115ad4a130fa539f207bd199f2ddbd25b5f43c804` |
| **CI run** | `41769915926`，`success`，含「文档里的断言总数与实测一致」这一步（971 项断言）|
| **部署后验证** | `scripts/post-deploy-verify.mjs` → **5 通过 / 0 失败**；单独跑 `full-deal-row-audit` → 62 条：两行都在 39 / 只有 API 地址 2 / 只有领取地址 20 / 需抽码·无 API 1 / **两行都无 0 / 错误 0**（与 1.0.68 基线同分布，无回归）|
| **回滚锚点** | 镜像 tag `rollback-20261104115453`（= 1.0.68 的 `50b0d631…`）+ `data/backups/favshub.db.pre-1.0.69-20261104115453`（`integrity_check`=ok）|

> ⚠️ **「健康」的口径**：镜像**没有定义 `HEALTHCHECK`**（`docker inspect` 会报
> `Health=(no healthcheck defined)`）。所以只能背书**应用层**健康：容器内
> `/api/health` = `{"status":"ok","database":"connected"}`。
> 别拿 `docker ps` 的 `(healthy)` 当证据 —— 它不会出现。

### ✅ 已结案：详情页偶发渲染成「加载失败」（2026-11-04 定位并修复）

**症状**：持续并发下，若干详情页返回 **HTTP 200**，页内却是兜底文案「加载失败，请稍后重试」；
而 `docker logs` **干净**（0 条 `[SSR Error]`、0 条 `[API Error]`）—— 既不是 5xx，也不是能自证的限流 429。

**根因（本地起 instrumented 实例复现后定位）**，一条链四步：

1. 持续并发把同 IP 的**全站读桶**（`FAVSHUB_RL_SITE_READ_PER_MIN=600`）或**同 IP 并发槽**
   （`FAVSHUB_RL_SITE_CONCURRENCY=24`）打满 → `rateLimitError()` 触发；
2. 它把**中文标签**写进 `X-RateLimit-Reason`（`全站 读接口 每 IP 600 次/分钟`）。
   而 HTTP 头值只能是 ByteString（0–255）；
3. 非 ASCII 头值在**解析响应头**时抛
   `TypeError: Cannot convert argument to a ByteString because the character at index 0 has a value of 20840 which is greater than 255`
   （20840 = `全`）→ 本该是 **429** 的响应变成 **500**；
4. 该失败发生在**响应落盘阶段、不经过 error hook**，所以**服务端零日志**；
   SSR 详情页的内部取数拿到 500 后，`error.data` 不是 `{error}` → 回落成兜底文案「加载失败」。

**复现证据**（同一批 URL、1000 次详情页请求、并发 12，本地 instrumented 实例）：

| | 结果 |
|---|---|
| 修前 | `800 × status=500`（页内「加载失败」），`docker logs` 无痕 |
| 修后 | `800 × status=429`（`Retry-After: 1` + `x-ratelimit-reason: site-read-per-ip`），非 ASCII 头值 0 处 |

**生产验证（1.0.69 上线后）**：

- 容器内直连 app 把读桶打满：700 请求 → **恰好** `600 × 200` + `100 × 429`（阈值 600/分钟，分毫不差）。
  429 的 body 是 `{"error":"超出限频（全站 读接口 每 IP 600 次/分钟）：请在 59 秒后重试"}`，
  头是 `retry-after: 59` + `x-ratelimit-reason: site-read-per-ip`，**无任何非 ASCII 字节**。
- 对详情页连发 2232 次请求（并发 12）：`2034 × 429` + `198 × 200`，**0 个 500、0 个「加载失败」** ——
  同一突发档位在 1.0.68 上是**静默降级**，现在退化成**诚实、可退避的 429**。

**改法**（提交 `57670c8`；只动限流层，不碰业务逻辑 / 接口 / 数据库）：

- `X-RateLimit-Reason` 只写 **ASCII 短码**（`site-read-per-ip` / `site-write-per-ip` / `site-asset-per-ip` /
  `site-ip-concurrency` / `ai-quota` / `ai-token-concurrency` / `ai-ip-concurrency`）；
  人读的中文长文案留在 body 的 `data.error`（客户端契约不变，「错误文案里同时写清秒数」照旧）；
- 新增 `asciiHeader()` 兜底 percent-encode 非 ASCII —— **以后新加的中文标签也不会再炸**；
- **回归断言（第一版是错的，已被独立验证打回并重做）**：
  第一版在 `third-batch-ratelimit` 里加了「响应头全为 ASCII」（+9 项）。独立验证实测：
  **把 `asciiHeader(code)` 改回 `label`、重新构建后，该断言依然 115 项全过、退出码 0** ——
  因为 `rateLimitError()` 外层本就有 try/catch，中文头被**静默丢弃**，客户端收不到非 ASCII 头。
  它咬的是 latin-1 `é` 那类「Node 会接受并真上线」的值，**不是本次这条路径**，
  故按「纵深防御」保留，但标签已改成「无 latin-1 乱码」并注明**不是主证据**。
  真正的门重做在 `third-batch-detail.mjs` 的 **⑨ 段**（+5 项）：把全站读档压到 1/分钟，
  断言「页面**不再**回落成『加载失败』」+「页面诚实展示『超出限频』」+ 状态码语义 +
  源码仍走 `asciiHeader()`。**实测会真的翻转**：

  | 构建 | 结果 |
  |---|---|
  | 含修复 | 252 通过 / 0 失败，exit 0 |
  | 回退 `asciiHeader`→`label` | 249 通过 / **3 失败**，exit 1（`出现「加载失败」=1 次`） |

  套件与总数：`third-batch-ratelimit` 106 → 115、`third-batch-detail` 247 → 252，
  总断言 **962 → 976**（文档两处 + workflow 注释已同步，否则 CI 那步会红）。

> **教训（写给下一次）**
>
> 1. 「响应头写中文」这类错误**在服务端不留任何日志**，现场只剩**下游用户可见的兜底文案** ——
>    归因成本极高。凡是「**上游日志干净、下游有兜底文案**」的症状，优先怀疑**响应头/协议层**，而不是业务逻辑。
> 2. **限流会掩盖 bug**：排查时先确认「限流到底有没有真的触发过」，别在业务代码里空转。
> 3. `server/plugins/error-handler.ts:27-31` 记录的 2026-10-31「61 个详情页同时找不到接入信息区块 + 页面 500 +
>    事后无任何痕迹」，**与本例是同一失败模式**（限流触发 → 头含中文 → 500 且不走 error hook）。
>    那条注释当年的结论今天被证实：**「无法解释的瞬时 500」往往正来自这种「不走 error hook」的路径。**
> 4. **打限流会把自己打到云 WAF 拉黑**：用本机连发 700 个 API 请求后，本机 IP 连 TLS 握手都过不去
>    （`SSL_ERROR_SYSCALL`），而服务器自己访问一切正常。**验收请从服务器侧跑**，或换源 IP。

### ⚠ 待拍板（不是 bug，是取舍）：SSR 自取数也占访客自己的限流额度

限流中间件只作用于 `/api`，但**详情页 SSR 会内部再取一次** `/api/token-deals/<id>`（另加评论区一次），
这些**服务端自取数按访客 IP 计费**（每看一页约 2 次读额度）。后果：

- 正常访客要触发需要 ≈300 页/分钟，基本无感；
- 但**爬虫 / 批量抓取**会把自己的额度打满，之后**整批页面变 429**（现在至少是诚实的 429，不再静默 500）。

取舍：若把内部自取数豁免，页面就**永远不会因限流而降级**，但也**同时失去「爬虫刹车」**——
那层刹车目前正是由限流顺带提供的。**要不要豁免需要按业务意图拍板，我没有单方面改。**

### 1) 回归门重做：前一版是**装饰**，已被独立验证打回

v1.0.69 用「断言响应头全为 ASCII」守那次 429→500。独立验证用 `git archive 57670c8` 抽出确切 commit、
只把 `asciiHeader(code)` 改回 `label` 重新构建：**两边都是 115 通过 / 0 失败 / exit 0**。
因为 `rateLimitError()` 外层本就有 try/catch，中文头被**静默丢弃**，客户端收不到非 ASCII 头 ——
那条断言在当前技术栈下**不可能触发**（真实机制：`new Headers({...中文})` 直接抛 `value of 20840`）。
它并非恒真（latin-1 `é` 会被 Node 接受并真上线，客户端读回 `Ã©`，那种值它能抓），故按**纵深防御**保留，
但标签已改成「无 latin-1 乱码」并注明**不是主证据**。

真正的门重做在 `third-batch-detail.mjs` 的 **⑨ 段**（+5 项）：把全站读档压到 1 次/分钟并按 phase 重启实例，
断言**用户可见语义** —— 页面不得回落成「加载失败」、必须诚实显示「超出限频」、状态码是 429、
响应体仍带中文长文案、源码仍走 `asciiHeader()`。**实测会真的翻转**：

| 构建 | 结果 |
|---|---|
| 含修复 | 252 通过 / 0 失败，exit 0 |
| 回退 `asciiHeader`→`label` | 249 通过 / **3 失败**，exit 1（`出现「加载失败」=1 次`）|

断言总数 962 → **976**（ratelimit 106→115、detail 247→252）。`assertion-count.mjs --check-only` 实测
三条（DEPLOYMENT-STATE 两处 + workflow 注释）**全一致** —— 顺带更正 1.0.69 时的一处口径错误：
`--check` 只校验 `DEPLOYMENT-STATE.md`，**不校验 workflow 注释**（注释写错 CI 不会报警）。

> **教训**：「断言跑得通」不等于「断言守得住」。**证明一个回归门有效，唯一办法是把修复回退掉，看它红不红。**
> 我上一版没做这个实验就宣称「装了门」，是这次被独立验证打回的直接原因。

### 2) 无障碍：axe/Lighthouse 实测，修两条**全站性**缺陷

实测基线：`/tokens` **86**、`/tokens/keys` **91**、详情页 **90**（Best Practices / SEO 均 100）。

- **`html-has-lang`**：三页全红 —— `<html>` 从无 `lang`。已在 `nuxt.config.ts` 补
  `app.head.htmlAttrs.lang='zh-CN'`。线上复核：`/`、`/tokens`、`/tokens/keys`、`/prompts`、`/collections`
  **五页全部 `lang="zh-CN"`**。
- **`landmark-one-main`**：`/tokens/keys` 无 main 地标 → `.tokens-page` 由 `<div>` 改 `<main>`
  （样式全用类选择器，不影响外观）。线上复核：`<main>` 存在。

**未修（如实标注，不假装修好）**：`color-contrast`（`/tokens` 6 处、`/keys` 9 处、详情页 **73** 处）、
`heading-order`（卡片里的 `h3`）、`label-content-name-mismatch`（卡片 `aria-label` 与可见文本）。
这三类属**设计取舍**且集中在 `components/tokens/*`（另一团队正在改），未单方面改 —— 需按视觉意图定。

### 3) 镜像补 `HEALTHCHECK`（补上长期缺口）

此前 `docker inspect` 恒报 `Health=(no healthcheck defined)`，`docker ps` 永远不显示 `(healthy)`，
运维只能手打 `/api/health`。本版加：
`HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1`
（用 alpine 自带 busybox wget，不额外装包）。上线实测：`Up (healthy)`、`FailingStreak=0`。

### ⚠ 发布时踩到的坑：**工作区的探针可能已先于代码前进**

`post-deploy-verify` 跑出 `public-field-matrix 15 通过 / 16 失败`，一度像是回归。
查下来是**另一团队刚改了工作区里的 `scripts/public-field-matrix.mjs`**（+23/-4），新增对
`summary` / `limits` / `requirements` / `verify_scope` / `faq` / `featured` 等**尚未发布字段**的断言；
而我部署的 commit 里这些字段**一个都没有**（`git show HEAD:…schema.ts | grep -c` = 0）。
换用**已提交版本**的探针（`git show HEAD:…`）再跑：**17 通过 / 0 失败**。

> **教训**：验收必须跑**与发布 commit 同版本**的探针，不能跑工作区里的。
> 多人共用一个工作区时，「探针比代码跑得快」会伪装成线上回归 —— 差一点就要回滚一个没坏的系统。
## 历史：1.0.68 状态（2026-11-04）

| 项 | 值 |
|---|---|
| **版本** | `1.0.68` |
| **来源提交** | `5058f61430817092f01fb177ba1326df5382f3d4` |
| **镜像 label** | `org.opencontainers.image.version=1.0.68`、`revision=5058f61…` —— 部署前拿它当**闸门**：不符就不重建容器 |
| **RepoDigest** | `ghcr.io/huanyu-a/favshub@sha256:cfdff281e4bc9b6219cd6bde792d87d82f37d84dc6f6df9c463cb488bea2b980`（部署前是 `9c927e97…`）|
| **容器 Image ID** | `sha256:50b0d6315d53c6721cbd1f846be5ed4ded8407f493ba16f40fd6bd9ec436bc1e` |
| **CI run** | #64（41765505327），`success`，03:11:04→03:14:45 UTC |
| **部署后验证** | `scripts/post-deploy-verify.mjs` → **5 通过 / 0 失败**（首次全绿；此前恒红的 `full-deal-row-audit` 已修好，见下）|
| **回滚锚点** | 镜像 tag `rollback-20261104111154`（= 1.0.67 的 `b7fb62c1…`）+ `data/backups/favshub.db.pre-1.0.68-20261104111154`（`integrity_check`=ok）|

当时两件事，性质不同：

1. **产品改动（进了镜像）**：评测头像 `<img>` 由 `:alt="r.author"` 改成 `alt=""`。
   那个头像紧邻 `.review-author`（同一行就印着作者名），再给 alt 等于让读屏读两遍；
   装饰性头像用空 alt，与卡片 favicon 的既有口径一致。
   已核对**已发布的客户端 chunk**：`/_nuxt/DyGcuVhm.js` 里渲染成
   `{key:0,src:d.avatar,alt:"",loading:"lazy",onError:…}`。
   注意：生产现有评测**没有带头像的**，所以线上页面不出现这个 img（条件未命中）——
   该结论得自发布的 bundle，不是页面 HTML，别误当成「线上已验证」。

2. **工具改动（不进镜像，推上去即生效）**：`scripts/full-deal-row-audit.mjs` 的判据修正，见下。

### 通告行审计的判据修正（2026-11-04）

`full-deal-row-audit` 此前**每次部署都会红一条**。查下来是判据没覆盖一个**合法**组合：
`call_url` 为空（结构上不可能有「API 地址」行）+ 需要抽邀请码（SSR 阶段「领取地址」行被有意扣住）
→ 「接入信息」区块两行皆空。用改动前的镜像（`rollback-20261104111154`）配生产库副本来跑同一页，
该区块与线上**逐字节同构**（同为 `<h4…>接入信息</h4><!----><!----></section>`、同为 `is-disabled`
按钮）；两版正文的差异只有 `alt="Logo"→"FavsHub"`（+3 字符）与 Vue scope-id / buildId 取值 —— 确认不是回归。

改动（提交 `4136b06`）：

- 新增第 4 条分支「需抽码·无 API」（判据取自组件自身的 `claimReady`/`showApiRow`/`apiReady`，
  即 `components/tokens/TokenDealDetail.vue:1140-1180`），不再把合法中间态报成「两行都无」；
- 「区块整个拿不到」从「两行都无」改归「**错误（无法判定）**」，并附上**页面里实际看到的东西**；
- 这种情况改**退避重试**（默认 3 次，`--retries` 可调）后才上报 —— 真回归不会因重试变绿
  （已反向验证：把豁免关掉、或把 `call_url` 换成实值 → 仍 exit 1）；
- 大面积拿不到区块时额外点名提示「更像限流/降级，**不要据此回滚**」。

独立验证随后还查出**一处不对称**（我自测没覆盖）：脚本原先把占位符写成**字面量表**，
而真源 `server/utils/invite-codes.ts` 的 `CLAIM_PLACEHOLDER_PATTERN` 与组件
`TokenDealDetail.vue:1110` 都是正则 `/[｛{](?:邀请码|code|invite_code)[｝}]/` ——
认**全角括号 + 拉丁 key**，于是 `｛code｝` 这类写法会让**合法**页被误报成「两行都无」
（方向是误报，偏保守，不会掩盖真回归；当时生产那条用的是半角 `{邀请码}`，未受影响）。
已改为与真源同形的正则（提交 `ed2b8ec`，仅脚本、不进镜像），并用独立验证留下的
mock 用例回归：全角词组从 `exit 1` 变 `exit 0`，而「`call_url` 有实值却不渲染 API 行」的
真回归仍 `exit 1`。**教训：验证脚本的判据也是代码，必须与产品真源同形，否则它自己会漂移。**

## 历史：1.0.67 状态（2026-11-04）

当时运行的镜像由 GitHub Actions 构建并推送：

| 项 | 值 |
|---|---|
| **版本** | `1.0.67` |
| **来源提交** | `b4b1a40715bfbb2a27ff4f705f077b64f7b4b875` |
| **`latest` / `1.0.67` / `sha-b4b1a40`** | 三者指向**同一个** digest：`sha256:9c927e975a1d1a65a37153c880d53db09127757da34f203356a1ebfa47dd8edd` |
| **容器 Image ID** | `sha256:b7fb62c1b63985e0438a9328ac5a2353af5637aeebe17aed78a962fc79771460` |
| **CI run** | #63（41757199103），约 4 分 8 秒，全步 success，962 项断言 |
| **部署后验证** | `scripts/post-deploy-verify.mjs` → **4 通过 / 1 失败**；失败项 `full-deal-row-audit` 是**改动前就存在**的既有数据边角，见下方「1.0.67 的已知既有失败」|
| **回滚锚点** | 镜像 `rollback-202611040950`（= 旧的 `c9890971414a`）+ `data/backups/favshub.db.pre-1.0.67-20261104095305`（`integrity_check`=ok）|

- 本次改了什么（纯 SEO / 分享卡片，**不涉及业务逻辑、接口与数据库**）：
  - **/tokens 全段换用专属分享封面**：新增 `public/images/og-cover-tokens.png`（1200x630，154413 B）；
    `pages/tokens/index.vue`、`keys.vue`、`[id].vue` 各自在页面级 `useHead` 覆盖 `og:image` /
    `og:image:secure_url` / `og:image:alt` / `twitter:image` / `twitter:image:alt`（共 5 键，实测各只出现 1 次，
    页面级正确压过 `layouts/default.vue` 的默认值）。旧 `public/images/og-cover.png` **一字未动**，
    首页 / 精选集 / 提示词等页面继续用它（`og:*/twitter:*` 17 键与部署前逐键 IDENTICAL）。
  - **修掉「图片 alt 描述错对象」**：`og:image:alt` 与 `twitter:image:alt` 原先由布局统一取 `siteTitle`
    （"FavsHub-网址导航与智能书签管理工作台"）—— 对 Token 通告页来说描述的是**首页那张封面**，
    属真实缺陷；现在三页各自给出与图内容一致的 alt（详情页为 `computed`，随 deal 变化）。
  - **全站 8 处页头 logo 的 `alt="Logo"` → `alt="FavsHub"`**：`alt="Logo"` 是无意义占位符，
    且它是「返回主页」链接的**可访问名**。只改属性、不动任何图片；页脚原本就是 `alt="FavsHub"`，
    未触碰（残留 `alt="Logo"` 现在为 0）。
  - `twitter:card` 三页**保持 `summary`**（用户明确：新图缩到小图时中心内容仍完整可见）。

#### 1.0.67 的已知既有失败（**不是本次改动引入的**，2026-11-04 已用旧镜像实证）

`post-deploy-verify.mjs` 的 `full-deal-row-audit`（「两行可见性」回归哨兵）报 **「两行都无 1」**（期望 0），
命中 `deal_1793671760979_8xit89`（AutoClaw，`category=client`）。

- **成因是数据边角，不是渲染回归**：该通告 `call_url` 为空 → 结构上不可能有「API 地址」行；
  同时 `has_invite_code=true` / `claim_url_has_placeholder=true` → SSR 阶段不抽码，
  「领取地址」行被有意扣住（页脚按钮呈 `is-disabled`，`title` 为「该平台需邀请码，抽取后自动生成领取地址」）。
  两条叠加 → SSR 的「接入信息」区块两行皆空；客户端挂载抽到码后该行才出现。
  即 `full-deal-row-audit` 的四分支判据没有覆盖「无 `call_url` **且** 需抽码」这一组合。
- **为什么 1.0.66 那次报 0 失败**：该通告创建于 `2026-11-03 10:09`，**晚于** 1.0.66 的部署后验证（2026-11-02）。
  也就是说这是「新数据触发了旧判据的盲区」，与 1.0.67 无关。
- **实证手法（可复现）**：把 `rollback-202611040950`（= 旧生产镜像）用**生产库副本**
  （`sqlite3 … ".backup"` 到 `/tmp/pre/`）在服务器本机 `docker run` 起来，同一详情页 URL 渲染出的
  「接入信息」区块与线上**逐字节同构**（同为 `<h4 …>接入信息</h4><!----><!----></section>`、
  同为 `is-disabled` 按钮）。两版**正文**的全部差异只有 `alt="Logo"→"FavsHub"`（+3 字符）与
  Vue scope-id / buildId 的取值；**head 之外的业务内容零差异**。验证后已删除临时容器与 `/tmp/pre`。
- **未修**：属产品/数据口径决策（补第 5 条判据，还是让该组合回退显示领取行），
  不属本次「换图 + 修 alt」的范围，留待单独评估。下一位部署者看到这条 **不必回滚**。
- **2026-11-04 已处理**：判据已补（提交 `4136b06`），见 1.0.68 一节的「通告行审计的判据修正」。

## 历史：1.0.66 状态（2026-11-02）

当时运行的镜像由 GitHub Actions 构建并推送：

| 项 | 值 |
|---|---|
| **版本** | `1.0.66` |
| **来源提交** | `a0125060e1f94a99429852d2f5c50b53cc2440f2` |
| **`latest` / `1.0.66`** | 指向当前最新构建 |
| **CI run** | #61（41430721119），21 步全过，962 项断言 |
| **部署后验证** | `scripts/post-deploy-verify.mjs` → **5 通过 / 0 失败** |
| **重构与优化** | 侧边栏二级子菜单样式内置进 `layouts/admin.vue` 并更新 CSS 版本戳，彻底解决子分类未正确纵向换行的问题 |
| **技能包版本** | `favshub-data-ops` **`v1.11.0`**（全面优先推荐 Hermes 方案）|

- 核心特性已上线：
  - **修复子分类正确纵向换行**：在 `layouts/admin.vue` 增加 scoped 样式并更新 `admin.css?v=20261102`，确保 `.nav-submenu` 和 `.nav-subitem` 呈现清晰优雅的纵向列表布局，不再受浏览器旧静态缓存挤在单行；
  - **排版彻底紧凑化与二级子菜单折叠合并**（沿用 1.0.65 架构）。

## 历史：1.0.65 状态（2026-11-02）
  - **在线连通性自检（`POST /api/admin/bot/test`）**：在管理后台一键发送测试群消息，即时回显成功/失败诊断；
  - QQ 机器人官方 OpenAPI 直连（`api.bot.qq.com` 纯 HTTPS 无状态直连，零第三方框架依赖）；
  - 自动处理 `304003` 网址未报备降级、`40054010` 禁止URL降级、自增 `msg_seq` 防 `40054005` 消息去重拦截；
  - `40034105` 主动权限、`40034100` 频控、`40054002` 禁言等高频状态精准中文诊断；
  - 多 QQ 机器人与多群 OpenID 广播，目标前缀规范化（剥离 `qqbot:`）；
  - 官方 Webhook 入站（`/api/bot/qq`）：原生 Ed25519 握手与被动回复支持。

## 历史：1.0.57 状态（2026-11-02）
  - **在线连通性自检（`POST /api/admin/bot/test`）**：在管理后台一键发送测试群消息，即时回显成功/失败诊断；
  - QQ 机器人官方 OpenAPI 直连（`api.bot.qq.com` 纯 HTTPS 无状态直连，零第三方框架依赖）；
  - 自动处理 `304003` 网址未报备降级、`40054010` 禁止URL降级、自增 `msg_seq` 防 `40054005` 消息去重拦截；
  - `40034105` 主动权限、`40034100` 频控、`40054002` 禁言等高频状态精准中文诊断；
  - 多 QQ 机器人与多群 OpenID 广播，目标前缀规范化（剥离 `qqbot:`）；
  - 官方 Webhook 入站（`/api/bot/qq`）：原生 Ed25519 握手与被动回复支持；
  - 游客通告订阅（`favshub-data-ops` v1.11.0）：支持纯 Python 原生直连 QQ 官方机器人群推送，脱离 Hermes 依赖。

## 历史：1.0.56 状态（2026-11-02）
  - 多 QQ 机器人与多群 OpenID 广播，目标前缀规范化（剥离 `qqbot:`）；
  - 官方 Webhook 入站（`/api/bot/qq`）：原生 Ed25519 握手与被动回复支持；
  - 游客通告订阅（`favshub-data-ops` v1.11.0）：支持纯 Python 原生直连 QQ 官方机器人群推送，脱离 Hermes 依赖。

## 历史：1.0.55 状态（2026-10-31）

**手工组装补丁镜像的历史到此结束。** 生产现在运行的镜像由 GitHub Actions 构建并推送：

| 项 | 值 |
|---|---|
| **版本** | `1.0.55` |
| **来源提交** | `417696cb13f5d1067734ea1c25f49b4727e825fd` |
| **镜像 ID** | `sha256:421e28c86819…` |
| **GHCR 索引 digest** | `sha256:389c6605d719edf25161ef002209974e62e05b16234a5ea2d34ad8f712e7ef71` |
| **`latest` / `1.0.55` / `sha-417696c`** | 三者指向**同一个** digest（上面那个）|
| **CI run** | #50，6 分 18 秒，21 步全过，962 项断言 |
| **部署后验证** | `scripts/post-deploy-verify.mjs` → **5 通过 / 0 失败** |
| **回滚锚点** | `ghcr.io/huanyu-a/favshub:fix-col404-4c33a83`（`sha256:01e3ed69…`，本地仍在）|

镜像里的 OCI 标签可自证来源（`docker inspect <img>`）：

```
org.opencontainers.image.version  = 1.0.55
org.opencontainers.image.revision = 417696cb13f5d1067734ea1c25f49b4727e825fd
```

### ⚠️ 但「推送前不要 pull」这个坑**没有消失**，只是这次躲过了

下面那一大段保留原文 —— 它是**每一次发版都会重新遇到**的操作顺序问题，
不是一次性事故。规则：

> **push → CI 跑完 → 先确认 GHCR `latest` 的 digest 变了 → 才 `pull`。**

判断方法（这次就是这么做的）：

```bash
docker buildx imagetools inspect ghcr.io/huanyu-a/favshub:latest | grep -m1 Digest
```

它必须等于 CI 里那个 `sha-<短提交>` 的 digest。**跳过这一步就可能把生产拉回旧版却以为在升级。**

## 历史：2026-10-31 之前的状态（保留原记录）

| 位置 | 当时的内容 |
|---|---|
| **GHCR 上的 `latest`** | `1.0.54`（`sha-07017b8`）= 仓库 `origin/main` 的快照 |
| **生产服务器本地 `latest`** | 手工组装的镜像 **`fix-col404-4c33a83`**（`sha256:01e3ed69…`），**比 GHCR 新** |
| **生产容器实际运行** | 就是上面那个手工镜像 |

因为 `compose.yaml` 写的是 `image: ...:latest` + `pull_policy: if_not_present`，
**在当时执行 `docker compose pull favshub` 会把生产拉回 `1.0.54`**，
丢掉下面这 11 项修复：

### 佐证：本地镜像根本没有 RepoDigests（2026-10-31 实测）

这一条不是推测，有直接证据。逐个查 `docker inspect <img> --format '{{.RepoDigests}}'`：

| tag | RepoDigests |
|---|---|
| `latest` | **（空）** |
| `fix-col404-4c33a83` | **（空）** |
| `fix-describe-cdaaf47` | **（空）** |
| `rollback-20261010` | **（空）** |

经 `docker pull` 得到的镜像，Docker 一定会记录 `RepoDigests`（形如
`ghcr.io/…@sha256:…`）。**全为空 ⇒ 这台机器上的 favshub 镜像从未从 registry 拉过**，
都是本地构建 / `docker load` 来的 —— 与「手工组装补丁镜像」的部署方式吻合。

> **2026-10-31 部署后这条已改变**：执行过 `docker compose pull` 之后，
> `latest` 现在带 digest 了 —— `ghcr.io/huanyu-a/favshub@sha256:389c6605…`。
> 也就是说 **RepoDigests 是否为空，本身就是「这台机器上的镜像来自哪」的判据**：
> 为空 = 手工镜像，有值 = registry 拉取。下次怀疑「生产跑的到底是什么」时可以直接看它。

两边实际的 digest：

```
GHCR latest : sha256:7264b8f9b383f24131644489d5aa7f9157c0f61d5b5bfae3552a54d5c3846fe6
本地 latest : sha256:01e3ed69821bcce630df68974927ac54905cb2b3b7169c081ea1aa3ecda38806
```

**顺序必须是：push → CI 推完 → 先确认 GHCR latest 的 digest 变了 → 才 pull。**
跳过「确认 digest」这一步，就可能把生产拉回旧版却以为在升级。

另外记一个容易误会的点：`pull_policy: if_not_present` 只影响 **`compose up` 时
要不要自动拉**，对显式 `docker compose pull favshub` 无效 —— 那条命令一定会去拉。

| # | 修复 | 提交 |
|---|---|---|
| 1 | 无码时隐藏整条「领取地址」行 | `18cdcfc` |
| 2 | 「API 地址」行不再被误隐藏（曾影响 39/46 条通告） | `18cdcfc` |
| 3 | 公开事件流不再下发邀请码占位符与码池明文 | `b04916f` |
| 4 | 公开详情不再透传 `deleted_at` / `invalid_reason` | `3d7c569` |
| 5 | AI 通道内部字段清单补齐（3 → 5 项） | `d4b8962` |
| 6 | 公开列表同样剔除 `deleted_at` / `invalid_reason` | `144fc9c` |
| 7 | `prompts` 列表不再透传 `deleted_at` | `99b2f01` |
| 8 | `prompts` 详情同样不下发 `deleted_at` | `d4c2c24` |
| 9 | `prompts` 已软删除条目不再对他人/匿名公开（回收站私有化） | `a6f1155` |
| 10 | `/api/ai/describe` 字段字典不再宣称已下发的字段 | `cdaaf47` |
| 11 | `/collections/<不存在>` 返回 404，不再软 404 | `4c33a83` |

**正确顺序**：先把本地提交推送到 `origin/main` → 等 CI 构建完 → 再 `pull`。
推送后 CI 先跑 **9 个测试套件**（3 个自包含：`private-ip-check` / `sanitize-test` /
`ssrf-pin-check`；6 个跑产物：`second-batch-e2e` / `third-batch-detail` /
`third-batch-notify` / `third-batch-ratelimit` / `cache-privacy-check` /
`third-batch-server`，共 **976 项断言**），另加 `ts:check` 与文档数字一致性检查，通过才构建镜像。

| 套件 | 断言数 | 需要 Node 22 |
|---|---|---|
| `ts:check`（具名导入） | 895 | |
| `private-ip-check` | 102 | **是** |
| `sanitize-test` | 17 | **是**（`--experimental-strip-types`） |
| `ssrf-pin-check` | 12 | |
| `cache-privacy-check` | 20 | |
| `second-batch-e2e` | 150 | |
| `third-batch-detail` | 252 | |
| `third-batch-notify` | 161 | |
| `third-batch-ratelimit` | 115 | |
| `third-batch-server` | 147 | |
| **合计（断言）** | **976** | |

`sanitize-test` 与 `private-ip-check` 都要 **Node ≥ 22.6**（`--experimental-strip-types`
直接加载 `.ts` 源文件），CI 用的是 `node-version: 22`，不要降到 20 ——
在 Node 20 下 `private-ip-check` 会报 `ERR_UNKNOWN_FILE_EXTENSION ".ts"` 而**假失败**。

**不在 CI 里**（需真实环境或直接打生产，故列为部署后手动核对项）：
`ai-api-smoke-read`（122 项）、`public-field-matrix`（17 项）、`full-deal-row-audit`。

### 生产镜像落后 HEAD 的那部分：既有注释，也有**功能修复**

生产跑的是 `fix-col404-4c33a83`，HEAD 比它多 **36 个提交**（14 个文件，+504/−62）。

⚠️ **2026-10-31 更新：此前这里写「改动 100% 是注释」，该结论已失效。**
后续几轮审查又发现并修了 3 处**真实运行时缺陷**，所以这次部署**不再是纯追平**：

| 文件 | 改动性质 | 影响 |
|---|---|---|
| `server/utils/deal-events.ts` | **功能**：`containsPoolCode` 加最小码长 4 位 | 防止短码（如 `"a"`）让公开链接被误清空 |
| `server/utils/ai-service.ts` | **功能**：`listPrompts` 补 `?recycle=1` 分支 | 此前文档承诺了该能力但代码没实现（静默失效） |
| `server/api/mcp.post.ts` | **功能**：`list_prompts` 暴露 `recycle` 参数 | 此前 REST 能用、MCP 用不了 |
| `server/api/prompts/[id].get.ts` | 纯注释 | 无 |
| `server/api/prompts/index.get.ts` | 纯注释 | 无 |
| `server/api/token-deals/[id].get.ts` | 纯注释 | 无 |

其余提交改的是 CI 配置、部署文档、测试脚本、AI 技能包（`favshub-data-ops/` 1.10.2 → 1.10.3）、
manifest（`skill-manifest.ts` / `public/skills/*.json`）。

**结论（已修正）**：
- 部署后**有**行为变化，共 3 处，都是「堵漏 / 补承诺」，不是新功能界面；
- 这 3 处对现有数据的影响面**当前为 0**（生产码池 3 个码均 ≥6 位；提示词 46 条、
  0 条软删除），所以**上线不会立刻改变可见结果**，属于预防性修复；
- 回滚到 `4c33a83` 会丢掉这 3 处修复与前 11 项修复 —— 但**不会**造成数据不兼容
  （零 schema / 零迁移改动，见下）。

### CI 里新增的三个 e2e 套件

`second-batch-e2e`（150）/ `third-batch-notify`（161）/ `third-batch-detail`（247）/ `third-batch-server`（147）
原先**从未进过 CI**。它们需要 `.output/`，所以排在 `pnpm build` 之后；实测合计 9–15 秒。

⚠️ **这些套件内部 `spawn('node', ...)` 取 PATH 上的 node，而 `better-sqlite3` 是原生模块、
ABI 与 Node 大版本绑定。**手工在本地跑时，必须用「装 `node_modules` 的那个 Node」去跑，
否则会得到极具误导性的报错「应用 30s 内未就绪」（真实原因藏在应用 stderr 的
`NODE_MODULE_VERSION xxx vs yyy`）。CI 里 install 与 run 都是 node 22，不会遇到。

## 回滚档

服务器上按 tag 保留了逐次部署的镜像，回滚只需改 `compose.yaml` 的 tag 并 `up -d`
（**不要**先 `rmi`）。

**注意 `fix-X` 与 `rollback-before-X` 是同一个 image ID 的两个标签**，不占额外空间
（18 个 tag 只对应 9 个唯一镜像 ≈ 2.8GB）。

| tag（= 同一镜像的别名） | 内容 |
|---|---|
| **`1.0.55` = `latest` = `sha-417696c`** | **CI 正规镜像（当前生产，`sha256:421e28c8…`）** |
| **`fix-col404-4c33a83`** | 手工镜像：全部 11 项修复（**2026-10-31 部署前的生产，现为回滚锚点**）|
| `rollback-before-col404` | 去掉「精选集不存在返回 404」 |
| `fix-describe-cdaaf47` | 去掉 describe 字段字典修正 |
| `rollback-before-describe` | 去掉上述两项 |
| `fix-precycle-a6f1155` | 去掉 describe 修正 |
| `rollback-before-precycle` | 去掉 prompts 隐私修复 |
| `fix-pdetail-d4c2c24` | 去掉 prompts 详情脱敏 |
| `fix-prompts-99b2f01` | 去掉 prompts 列表脱敏 |
| `fix-list-144fc9c` | 去掉 token-deals 列表脱敏 |
| `fix-fields-3d7c569` | 去掉 token-deals 详情脱敏 |
| `fix-events-b04916f` | 去掉事件流脱敏 |
| `fix-claimrow-18cdcfc` | 去掉领取行/API 行修复 |

**回滚链已验证可用**（2026-10-31 实测）：9 档逐个冷启动均为 `running`；
最旧档 `fix-claimrow-18cdcfc` 配**当前生产库副本**能正常启动，
`/api/health` 返回 `{"status":"ok","database":"connected"}`、`/api/token-deals` 正常出数据。
本轮 58 个提交**零 schema / 零迁移改动**，所以回滚不存在结构不兼容
（两个方向都验过：旧镜像启动后 `token_deals` 仍是 34 列、42 张表，与回滚前一致）。

## 为什么用「补丁镜像」而不是完整重建

服务器 `apk add gcc` 走官方源极慢，所以不在服务器上跑完整 `docker build`。

**2026-10-31 补了量化数据**（此前只记「>18 分钟未完成」，看不出是卡死还是慢）：

```
apk add curl  （13 MB）→ 1 分 55 秒   ≈ 113 KB/s
apk add gcc 全套（188 MB）→ 按此速度约 28 分钟
实际跑              → 17 分钟后仍停在 (12/30) Installing gcc
```

**结论：不是卡死，是带宽只有 ~110 KB/s。** 完整 build（apk + `pnpm install` +
`pnpm build`）预计 40–60 分钟，**只可当兜底，不可当常规路径**。
日常仍是「CI 建镜像 → 服务器 `pull`」（pull 走 mihomo 代理，快）。

当前做法是**本机构建 → 只拷贝产物**：

```dockerfile
FROM ghcr.io/huanyu-a/favshub:latest
COPY .output/server/chunks      /opt/favshub/.output/server/chunks
COPY .output/server/index.mjs   /opt/favshub/.output/server/index.mjs
COPY .output/server/package.json /opt/favshub/.output/server/package.json
COPY .output/public             /opt/favshub/.output/public
```

**关键：不拷贝 `node_modules`。** 本机是 macOS（`.node` 为 Mach-O），容器是
alpine（musl x86_64）。把本机的原生模块带进去会报 `Error loading shared library`。
保留基础镜像自带的 musl 版本。

打包时用 `COPYFILE_DISABLE=1 tar czf`，否则 macOS 的 `._*` 文件会让 `docker build`
报 `Unexpected "\x00"`。

## 本地构建的两个必需动作

1. **重签原生模块**（本机 Node 是硬化运行时签名，adhoc 签名的 `.node` 加载会失败）：
   ```bash
   for f in $(find .output/server/node_modules -name "*.node"); do
     codesign -f -s - --entitlements <ent.plist> "$f"
   done
   ```
2. **还原被构建改写的文件**（`build` 会重写这两个，不该提交）：
   ```bash
   git checkout -- public/skills/favshub-data-ops.json server/utils/skill-manifest.ts
   ```

## 验证清单（每次部署后）

> **一键版（推荐）**：`node scripts/post-deploy-verify.mjs`
> 它按顺序跑下面 5 项、逐项判定、**任一项失败即非零退出**。
> 加 `--skip-suites` 只跑 curl 那几项（几秒出结果）。

```bash
# 1) 健康检查（期望 200）
curl -s -o /dev/null -w "%{http_code}\n" https://hao.bx9y.com.cn/api/health

# 2) 公开出口 × 内部字段 全矩阵探针（期望 17 通过 / 0 失败）
cd favshub-nuxt && node scripts/public-field-matrix.mjs

# 3) 全量通告「两行可见性」审计（期望 两行都无:0 / 错误:0）
#    这是「API 地址行被误隐藏」那个 bug 的回归哨兵
node scripts/full-deal-row-audit.mjs        # 支持 --base / --limit / --concurrency

# 4) 软 404 回归（期望 404）
curl -s -o /dev/null -w "%{http_code}\n" -H "User-Agent: Mozilla/5.0" \
  https://hao.bx9y.com.cn/collections/nonexistent_xyz

# 5) 关键页面冒烟（期望全 200）
for p in / /tokens /tokens/keys /prompts /collections; do
  printf "%s " "$(curl -s -o /dev/null -w '%{http_code}' https://hao.bx9y.com.cn$p)"; echo "$p"
done
```

`public-field-matrix.mjs` 是**只读探针**，检查「公开出口 × 内部字段」全矩阵：
token_deals 列表/详情/SSR、prompts、collections、tags、token-keys。
它会把「跳过」单独计数——**跳过不等于通过**，看到跳过要查清原因（2026-10-31 加严：
非 200 或不可解析一律计失败，只有显式 `allowSkip` 才跳过）。

## 生产环境事实

- 服务器：3G RAM / 4 CPU，`/` 约 **9.4G 可用（87% 已用）** —— 磁盘偏紧，清理前先确认是否本项目的
  （本项目回滚档 9 个唯一镜像 ≈ 2.8GB；占大头的是其它项目：`rust:1-bookworm` 1.57G、
  `agentmemory/*` 约 5.6G）
- 可安全回收的：悬空镜像 4 个（690M）+ build cache 2.12G，命令
  `docker image prune -f && docker builder prune -f` —— **不会**删掉有标签的回滚档
- 数据库：`data/favshub.db` 4.3M / WAL 338K / 41 张表 / 空闲页 0（无需 VACUUM）
- 备份：每日 03:00 自动（`data/backups/auto-backup-*.db`），保留 7 份 ≈ 29M，
  今日备份 `PRAGMA integrity_check` = **ok**（已验可恢复）
- `dockerd` 走本机 mihomo 代理访问 ghcr.io（境内直连会卡死）
- 改 docker 代理配置会重启该机全部 20 个容器，非必要不要动
- 容器内 nginx 对 `/api/**` 加 `private, no-cache`，公开页面仍走 CDN 缓存
- 容器内 Node **v20.20.2**（满足 Nuxt 的 `^20.19.0`）；CI runner 用 Node 22（测试需要
  ≥22.6 的 `--experimental-strip-types`），两者分工不同、都不是笔误