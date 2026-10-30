# 第二批优化：移动端悬浮冲突 / 公告状态 / 邀请码 / 前端脱敏

> 日期：2026-10-30　范围：`favshub-nuxt/`　状态：实施中

## 0. 需求清单与验收

| # | 需求 | 验收口径 |
|---|------|----------|
| ① | 移动端「回到顶部」与公告悬浮图标不冲突 | ≤1024px 下两者可分别点击，不重叠 |
| ② | 公告状态：发布 / 待发布 / 删除（软删除） | 后台可切换三态；前端只展示「发布」且未删除的 |
| ③ | 通告详情页新增「邀请码」字段 | 多码、按展现比例随机出一码、达复制阈值后不再出现；支持 `/v1/models` 拉取模型并手动选择；备注上限 2000 且支持富文本 |
| ④ | 前端不得出现用户名等敏感信息 | 公开页面/接口不再下发 `username` / `verified_by` / 内部 `user_id` / `deleted_by` |
| ⑤ | 全站伪静态 | 待 ①–④ 上线后单独设计与实施 |

---

## 1. 需求①：移动端悬浮元素冲突

### 现状（实测 CSS 数值）

| 元素 | 定位 | ≤1024px 表现 | 占位（右 / 下，px） |
|------|------|--------------|--------------------|
| `#back-to-top-container` | `fixed; right:0; bottom:0; z-index:999999` | `bottom: calc(80px + safe-area)`、`z-index:10004` | 右 0–114，下 80–194 |
| `#back-to-top`（按钮） | 50×50 + `margin:32px` | 随容器 | 右 32–82，下 112–162 |
| `.announcement-fab` | `fixed; right:24px; bottom:120px; 48×48; z-index:990` | 无移动端覆盖 | 右 24–72，下 120–168 |

**结论**：横向 32–72、纵向 120–162 区间重叠；且 BackToTop 容器 `z-index:10004` 远高于 FAB 的 `990`，
FAB 被盖住后**点击无效**——与用户反馈一致。

### 方案

在 `SiteAnnouncement.vue` 自身的 `<style scoped>` 内加 `@media (max-width: 1024px)` 覆盖
（**不**写到 `public/css/mobile-responsive.css`）：scoped 规则带 `[data-v-*]` 属性，
与外部顶层规则同为 (0,2,0) 特异性，靠加载顺序决胜不可靠；写在组件内是唯一确定的解。

```css
@media (max-width: 1024px) {
  .announcement-fab {
    right: 16px;
    bottom: calc(176px + env(safe-area-inset-bottom, 0px));
  }
}
```

`176px = 80（底栏）+ 32（按钮 margin）+ 50（按钮高）+ 14（间距）`，即叠在 BackToTop **之上**。
桌面端（>1024px）FAB 下沿 168px、BackToTop 上沿 82px 本就不重叠，无需改动。

---

## 2. 需求②：公告三态 + 软删除

### 现状

`announcements.status`：`published | draft | offline`；`[id].delete.ts` 是**物理删除**。

### 目标模型

- 状态收敛为两态：`published`（发布）/ `pending`（待发布）
- 删除改为**软删除**：新增 `deleted_at` / `deleted_by`，与状态正交（与 `token_deals` 同一套心智）
- 有效可见性 = `status='published' AND deleted_at IS NULL`

| 关注点 | 口径 |
|--------|------|
| 公开列表/详情 | `status='published' AND deleted_at IS NULL` |
| 后台列表 | 全量，支持 `?status=published\|pending\|deleted` |
| 删除 | 写 `deleted_at`，可恢复 |
| 迁移 | 存量 `draft` / `offline` → `pending`（语义等价：都不该在前端露出） |

---

## 3. 需求③：邀请码 + 模型拉取 + 备注富文本

### 3.1 邀请码（新表 `token_deal_invite_codes`）

```sql
id INTEGER PK AUTOINCREMENT
deal_id TEXT NOT NULL      -- → token_deals(id) ON DELETE CASCADE
code TEXT NOT NULL         -- 邀请码/邀请链接
label TEXT DEFAULT ''      -- 备注（如「新用户专享」）
weight INTEGER DEFAULT 1   -- 展现比例（相对权重）
copy_limit INTEGER DEFAULT 0  -- 被复制次数上限；0 = 不限
copy_count INTEGER DEFAULT 0  -- 已复制次数
enabled INTEGER DEFAULT 1
sort_order INTEGER DEFAULT 0
created_at INTEGER NOT NULL
updated_at INTEGER NOT NULL
```

**关键设计：码池绝不出现在公开详情响应里。**
若详情接口直接下发 `invite_codes` 数组，前端「按比例只显示一个」就成了摆设（用户一开 F12 全看见）。
因此：

| 端点 | 认证 | 行为 |
|------|------|------|
| `GET /api/token-deals/:id/invite-code` | 公开 | 服务端按权重**随机选一码**返回 `{id, code, label}`；无可用码返回 `{code:null}` |
| `POST /api/token-deals/:id/invite-code/:codeId/copy` | 公开 | `copy_count + 1`，**仅当** `copy_limit=0 OR copy_count < copy_limit`，原子 `UPDATE ... WHERE` 防止超额 |
| `GET /api/token-deals/:id/invite-codes` | 作者/管理员 | 完整码池（编辑用），公开侧一律 403 |
| 写路径 | 作者/管理员 | `POST`/`PUT` 通告时以 `invite_codes: [...]` **全量替换**该通告码池 |

- 选出规则：`enabled=1 AND (copy_limit=0 OR copy_count < copy_limit)`，按 `weight` 加权随机（`weight<=0` 视为 1）
- 详情响应只多一个布尔 `has_invite_code`，用于决定是否渲染区块

### 3.2 模型拉取（`POST /api/token-deals/fetch-models`）

- 入参 `{ call_url, api_key? }`；登录用户可用，按用户+IP 限频
- URL 规整：去尾 `/`；以 `/models` 结尾则原样，以 `/v1` 结尾则补 `/models`，否则补 `/v1/models`
- 鉴权：`api_key` 存在则带 `Authorization: Bearer <key>`；**不回显、不落库**
- 返回 `{ models: string[] }`（取自 `data[].id`，去重、限 500 条）
- **SSRF 防护（必须）**：仅 `http|https`；解析主机名并拒绝环回/私网/链路本地/元数据地址；
  拒绝非 80/443/8080 等常规端口需谨慎——中转站常用自定义端口，故**只按 IP 段与协议拦截**，
  并限制响应体大小与超时；不复用重定向（`redirect: 'manual'` → 直接拒绝跳转）
- 编辑器交互：`[获取模型]` →（需要鉴权的平台先出现 `API Key` 输入框）→ 拉取 → 列表可点击勾选

### 3.3 备注富文本

- `LIMITS.note`：500 → **2000**（前后端同步校验）
- 支持 Markdown / HTML / 图片；**渲染前必须消毒**：
  - 服务端写入时用白名单消毒（新依赖 `sanitize-html`），**读取时同样消毒**（覆盖历史数据）
  - 前端用 `marked` 渲染后 `v-html`（与公告同一套渲染路径，抽成共享工具）
- 消毒白名单：允许常见排版标签与 `img/a/table/code/pre`，`a` 强制 `rel="noopener noreferrer"`、
  剥离 `on*` 事件属性与 `javascript:` / `data:`（除 `data:image/*`）协议

---

## 4. 需求④：前端脱敏

### 定性与根因

`TokenDealDetail.vue` 第 131 行在**公开前台**渲染 `{{ v.actor }}`（核验人用户名）。

接口层只做了「非管理员置空」：`[id].get.ts` 的 `.map(v => (isAdmin ? v : { ...v, actor: '' }))`。
于是**管理员浏览公开前台时仍会看到用户名**——用户的诉求是「前端就不该出现」，与登录身份无关。

### 修复

| 位置 | 改动 |
|------|------|
| `components/tokens/TokenDealDetail.vue` | **删除** `v.actor` 渲染节点（核验人只属于后台） |
| `server/api/token-deals/[id].get.ts` | `verified_by` 一律下发空串（不再按 `isAdmin` 分支）；`verifications[].actor` 一律置空；剥离 `user_id` / `deleted_by` |
| `server/api/token-deals/index.get.ts` | 公开列表剥离 `user_id` |

保留项（**不是**敏感信息，为用户自填展示名）：`nickname`、`guest_name`。
`is_owner` / `can_edit` 已由服务端计算，前端无需 `user_id` 即可判断归属。

---

## 5. 需求⑤：伪静态（待启动）

现状：站点已是干净路由（`/tokens`、`/collections/[id]`），但**通告详情是弹层、没有独立 URL**。
「伪静态」的可能含义需与用户确认后再动手，候选：

1. 为通告/精选集等实体提供 `.html` 后缀的静态化 URL（nginx `rewrite` → Nuxt 路由）
2. 直接生成真静态页（`nuxt generate`）交给 nginx 直出
3. 仅做 URL 美化（去查询参数、加尾斜杠统一）

→ 待 ①–④ 上线后单独确认范围与目标。

---

## 6. 实施顺序与验证

1. 需求①②③④ 编码 → `pnpm run ts:check` + `pnpm build`
2. 临时库冒烟：邀请码权重分布、阈值截断、模型拉取 SSRF 拦截、公告三态可见性
3. 安全清单复查（前端脱敏 + SSRF + XSS 消毒）
4. bump `VERSION` → CI → 服务器 `pull` + `up -d` → 生产端到端验收
5. 启动需求⑤

---

## 7. 实现结果与验证记录（2026-10-30）

### 7.1 交付物

| 需求 | 状态 | 关键落点 |
|----|----|----|
| ① 移动端回到顶部与公告图标冲突 | 已实现 | `components/common/SiteAnnouncement.vue`：FAB 抬到回到顶部之上并居中 |
| ② 公告三态 + 软删除 | 已实现 | `schema.ts` / `migrate.ts` / `admin/announcements/*` / `pages/admin/announcements.vue` |
| ③ 邀请码 + 模型拉取 + 备注富文本 | 已实现 | `server/utils/invite-codes.ts`、`server/utils/rich-text.ts`、`fetch-models.post.ts`、详情/编辑器组件 |
| ④ 前端不出现敏感信息 | 已实现 | `token-deals/[id].get.ts`、`index.get.ts`、`server/utils/deal-edits.ts`、`TokenDealDetail.vue` |
| ⑤ 全站伪静态 | **未开始**（按需求「先做上述部分，做完上线后」再启动） | 待与用户确认口径 |

**计划外发现并修复的既有缺陷**（各 1 行级改动）：
- `TokenDealEditor.vue` 的 `onMounted` 漏回填 `category`，导致编辑任何一条
  「免费云服务器 / 客户端额度」通告时分类被静默改回「API 额度」（保存走全量载荷）。
- `server/utils/token-deals.ts` 的 `purgeDealPermanently` 未清理邀请码表
  （该函数刻意不依赖 FK 级联，见 CLAUDE.md「迁移三坑」同类理由）。

### 7.2 验证证据

| 项 | 命令 | 结果 |
|----|----|----|
| 类型检查 | `pnpm run ts:check` | 通过：287 个 `.ts`、851 个具名导入全部解析 |
| 构建 | `pnpm build` | 通过；4 个邀请码端点 + `fetch-models` 均已进 `.output` |
| 功能端到端 | `node scripts/second-batch-e2e.mjs` | **85 通过 / 0 失败**（临时库自建自毁） |
| 生产库迁移 | 对生产库 `.backup` 副本启动服务 | **21 通过 / 0 失败** |

端到端脚本覆盖到的关键不变量：
- 邀请码：码池**不出现在**详情响应任何位置；60 次抽选结构上恒为「单个码」；
  权重 20 : 权重的码出现次数显著更多；`copy_limit=2` 时第 3 次复制不再计数且之后抽选返回空；
  同码重提交保留 `copy_count`（不复活）；非作者读/写均 403、未登录 401、重复码 400、缺字段 400。
- 备注：2000 字可存 / 2001 字拒；`note_html` 渲染加粗与表格、保留正常图片，
  同时剥掉 `<script>`、`onerror`、`javascript:`。
- 脱敏：匿名 / 普通用户 / **管理员**三视角下，详情与列表均无 `username`、
  `user_id` / `deleted_by` 不下发、`verified_by` 为空串、`verifications[].actor` 恒空。
- SSRF：环回 IP、`localhost`、`169.254.169.254`、`10.x`、`192.168.x`、`file://`、
  内嵌凭据、`.internal` 全部 400；公网地址放行（拿到上游 401 转成中文提示）。
- 公告：公开列表只见 `published` 且未软删；软删后公开详情 404 / 后台仍可见带 `deleted_at` / `restore` 后重新可读；未登录后台 401。

迁移验证（对生产库副本，迁移前 1 条 `published` 公告、80 条通告、无邀请码表）：
新增 `deleted_at` / `deleted_by` 列与 `token_deal_invite_codes` 表 + 2 个索引；
注入的 `draft` / `offline` 遗留行收敛为 `pending`（日志明确打印「2 条 draft/offline → pending」）；
通告 80 条、公告 4 条零丢失；`PRAGMA integrity_check` = ok；**二次启动幂等**、数据无变化。

### 7.3 与初版设计的偏差（含理由）

- **邀请码不入 AI 通道**：初版未决定，实现时定为「不开放」。码池属分发控制信息，
  开放给 PAT 会自动生成一堆「批量改码」类工具，收益远小于风险。
- **公开可见性口径**：`GET /:id/invite-code` 用 `canReadDeal`（与详情同口径），
  而非「只要码池有可用码就发」—— 否则已失效 / 已过期通告的邀请码仍会散出去。
- **`data:` 图片不放行**：2000 字上限下 base64 图片塞不下，放行只有风险没有收益。
- **公告正文沿用前端 `marked`**：该字段是管理员独有权限，本次不动以缩小回归面；
  新增的富文本场景一律走服务端的 `renderRichText()`。
- **需求⑤ 伪静态需先确认口径**：通告详情当前是弹层、没有独立 URL，
  「伪静态」至少有三种不同目标（`.html` 后缀重写 / 真正静态化生成 / URL 美化），
  三者的工作量与收益差一个量级，故先请用户明确。

### 7.4 回滚

镜像 `ghcr.io/huanyu-a/favshub:rollback-20261030`（上一版 1.0.44）+ 部署前数据库备份。
**迁移是单向的**：新增列/表本身可回滚（旧镜像会忽略它们），
但 `draft`/`offline` → `pending` 的状态收敛不可逆 —— 旧镜像读 `pending` 会当作未知状态。
回滚旧镜像前须先确认公告状态是否需要还原。

---

## 8. 上线前安全审查的发现与修复（2026-10-30）

由独立审查员（只读，临时库实测复现）完成。**初版结论是「不建议上线」**，共 2 个 CRITICAL、
5 个 MAJOR、9 个 MINOR。以下是处置结果 —— 全部 CRITICAL/MAJOR 已修，MINOR 修了 6 条。

### 8.1 已修（CRITICAL）

| 编号 | 问题 | 修法 |
|----|----|----|
| C1 | `canReadDeal()` 判漏 `status`，**未过审 / 已驳回通告的邀请码可被匿名读到**（实测 200 + 明文码，同一 deal 的详情却是 403）；`findWritableDeal()` 同样漏判，写入口也放行 | 两个函数内部补 `status === 'approved'` 判定，可见性口径收口。详情端点的 403 也一并改成 404（那句提示只有非作者看得到，等于确认「存在但没批」，与该文件「统一 404」的自述矛盾） |
| C2 | SSRF **TOCTOU**：`dns.lookup` 的校验结果只用于抛错，`fetch` 自己再解析一次 DNS，校验值与连接值可以是两个地址（实测经 fake-ip 从内网 `127.0.0.1:3999` 读出数据） | 弃用 `fetch`，改 `node:http/https` 的 `request` + **`lookup` 回调把已校验地址钉死到 socket**；重定向每跳重新解析并重新钉。TLS 的 SNI 仍按 hostname |

> C2 的修复过程本身踩了一个坑：`http.request` 内部是以 **`{ all: true }`** 调 `lookup` 的，
> 回调必须返回**数组**，返回 `(err, address, family)` 会报 `Invalid IP address: undefined`
> 而完全连不上。**这个坑差点溜进生产** —— 因为当时所有 SSRF 用例都在护栏处提前返回，
> 从未真正走到连接阶段，测试全绿也发现不了。已固化为 `scripts/ssrf-pin-check.mjs`（5 项断言）。

### 8.2 已修（MAJOR）

| 编号 | 问题 | 修法 |
|----|----|----|
| M1 | `isPrivateIP` 只是一串 `startsWith` 前缀匹配，漏判 `100.64/10`、`198.18/15`、`192.0.0/24`、`224/4`、`240/4`，以及 IPv4-mapped 的**十六进制**写法（`::ffff:7f00:1` 就是 127.0.0.1，实测确实连到 loopback） | 重写为正规 CIDR 判定（IPv4 前缀表 + IPv6 字节前缀表 + IPv4-mapped/compatible 递归），新增 5 个网段用例 |
| M2 | 响应体上限「读完再判」：2 MB 限制实际不设防（实测 40 MB 全量入内存，RSS +48 MB） | 改流式读取，超限立即 `req.destroy()` |
| M3 | 抽码端点**完全无限频**（实测 200 次请求全 200、期间 copy_count 全为 0）；copy 端点可枚举 `codeId` 把配额逐个烧满 | 抽码按 IP+通告限频 60/h；抽码时下发 32 位 HMAC 短时凭证 `t`，copy 必须携带（管理员豁免）。**并如实记录边界**：`copy_limit` 本质是「防君子不防小人」，手动抄码不点复制就不计数 |
| M4 | 公开详情/列表泄露 `guest_fingerprint`（`...row` 展开全列的锅），它是 `sha256(ip|ua)`、与游客评测身份同算法 → 可跨通告关联匿名投稿人 | 两个端点显式置 `undefined`；`guest_name` 保留（自填展示名） |
| M5 | 编辑器 `loadInviteCodes` 读失败时把列表置空，用户只改标题保存就会 `PUT {codes: []}` → **整池连同 copy_count 被静默删除** | 加 `inviteCodesLoaded` 标志：未成功读回则锁住编辑并**跳过这笔 PUT** |

### 8.3 已修（MINOR）

- 重定向每跳各给 12 s → 改为整个流程共享一个 deadline（最坏 24 s → 12 s）
- `normalizeModelsEndpoint` 用字符串拼接，会把 `/v1/models` 塞进 query（Azure 的 `?api-version=` 被打乱）→ 改用 `new URL()` 只操作 `pathname`
- `pickInviteCode` 权重和为 `Infinity` 时永远返回最后一个码、其余码被饿死 → 检出退化改等概率
- `enabled` 只认字面 `false`/`0`，`'false'` 被当启用 → 认 `'false'`/`'0'`
- 新建公告 status 缺省 `published`（fail-open）→ 改 `pending`，与 PUT/迁移口径一致
- `fetch-models` 的上游 5xx / 超时原本报 502/504，会被全站错误处理器统一改写成「服务器内部错误」、精心写的提示全部丢失 → 归为 400（用户侧地址问题）

### 8.4 未修（记录在案）

- **`replaceInviteCodes` 的大小写敏感匹配**：把 `KEEP` 改成 `keep` 会让计数归零、已用满的码「复活」。
  判定为**可接受并已写进文档**：改了内容就重新计数让运营可以借改码重置额度；若哪天不可接受，改成 `code.toLowerCase()` 建索引即可。
- **公告正文仍是前端 `marked` + `v-html`**：写入路径全部 `requireAdmin`，故当前只是「管理员可 XSS 访客」的纵深防御缺口。
  既然 `renderRichText()` 已存在，建议后续单独一批把公告也切过去（本次不动以缩小回归面）。
- **后台公告页仍用客户端过滤**，没用上新增的 `?status=` 后端筛选（非缺陷，属冗余）。

### 8.5 环境约束（重要）

`fetch-models` 的 SSRF 护栏**假定 DNS 解析器正常**。在 fake-ip 模式（Clash/mihomo TUN 等）下：
- 任何主机名都解析到 `198.18/15`，会被护栏判为保留段而拒绝 → **功能不可用**；
- 更根本的是，fake-ip 下的「解析结果」本就不代表真实对端，护栏的语义基础不成立。

已核实**生产服务器是正常 DNS**（`api.openai.com` → `108.160.172.204`，容器内无 proxy 变量），
故保留 `198.18/15` 拦截。**本机 WSL 是 fake-ip**，所以本地无法构造出一次成功的出站请求
（1.x 公网字面量会被 Cloudflare 301 到主机名，第二跳又落回 fake-ip）——
成功路径改由生产验收覆盖。

### 8.6 审查确认无问题的部分

XSS（50 个载荷全部被挡，含 SVG/mathML/编码/注释/mXSS 绕过尝试）、
计数原子性（4 进程 × 60 次 / limit 25 → 恰好 25，零超发）、
迁移幂等（二次启动 0 行迁移）、公告软删除全链路、备注 2000 前后端一致、
加权随机边界、重定向与 IP 编码绕过拦截、提案模式 diff 未被污染、除 M4 外的脱敏彻底。
