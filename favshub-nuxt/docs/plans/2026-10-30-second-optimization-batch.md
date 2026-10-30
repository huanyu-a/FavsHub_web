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

---

## 9. 部署记录与生产验收（2026-10-30 14:37）

镜像 `ghcr.io/huanyu-a/favshub:latest` = `sha256:4b825808e771`（CI run 41014632659，构建 ~4 min）。

| 步骤 | 结果 |
|----|----|
| 一致性备份（WAL 模式下必须 `.backup`，不可直接拷文件） | `data/backups/favshub.db.pre-deploy-20261030_143702`，`integrity_check=ok` |
| 迁移前基线 | deals=80 / announcements=1 / users=3 |
| 容器重建 | `docker compose -f compose.yaml up -d favshub` |
| 迁移日志 | `announcements 表添加 deleted_at 字段` / `deleted_by`（新表、索引为静默 `IF NOT EXISTS`） |
| 迁移后核对 | `token_deal_invite_codes` 11 列齐全，`idx_invite_deal`、`idx_ann_deleted` 均存在 |
| 数据无损 | deals=80 / announcements=1 / users=3，`PRAGMA integrity_check=ok` |
| HTTP 验收 | `/` 200、`/tokens` 200、`site_version=1.0.46`、公开公告数=1 |
| 脱敏验收 | 详情 `verified_by=''`、`user_id`/`deleted_by`/`guest_fingerprint` 均为 null、核验记录 actor 全空、无 `invite_codes` 字段 |
| 邀请码端点 | 有码池的通告返回单个码 + 凭证；无码池返回空结构；不存在的 id → 404 |
| 出站成功路径 | `https://api.deepseek.com/v1` → 上游 401 → 「该平台需要鉴权，请先填写 API Key」（**证明 DNS→校验→钉地址→TLS→解析全链路在生产可用**） |
| SSRF 对照 | `http://127.0.0.1:3090/v1` → 「不允许访问内网地址」 |

> 出站成功路径此前**从未被真正执行过**（本机 fake-ip DNS 构造不出成功请求），
> 而 `{ all: true }` 那个 bug 恰恰只在这条路径上暴露 —— 所以这一步不是走过场。

---

## 10. ⚠️ 待决：生产 JWT 密钥是公开默认值（CRITICAL，既存问题）

**不是本批改动引入的**，是部署副本 `compose.yaml` 的历史遗留，但会抵消本次全部权限加固。

### 现象与实证

服务器 `/www/dk_project/dk_app/compose.yaml`：

```yaml
- NUXT_JWT_SECRET=${NUXT_JWT_SECRET:-please-change-this-to-a-random-string}
```

`.env` 里**没有**定义 `NUXT_JWT_SECRET`，故容器实际用的就是这个公开占位串
（`docker inspect` 实测 len=37，等于该占位串）。仓库里被跟踪的
`favshub-nuxt/compose.yaml` 写的是 `:-}`（空默认值）—— 空值会走
「生成随机密钥并持久化到 `data/.jwt-secret`」的安全分支；是这份**部署副本**把默认值换坏了。

用该密钥为 `_system`（`is_admin=1`）签发令牌后实测：

```
伪造令牌访问 /api/admin/announcements → 200
伪造令牌访问 /api/admin/token-deals  → 200
```

即**任何人凭猜测即可伪造管理员令牌**，等同站点接管（改通告、进后台、发公告）。
站点公网可达，且仓库是公开仓库。

### 修复方案与代价（已核实）

在 `/www/dk_project/dk_app/.env` 写入强随机 `NUXT_JWT_SECRET`（并把 compose.yaml 默认值
对齐仓库版本 `:-}`），重建容器。代价很小：

- 所有已登录用户需重新登录（含管理员）—— 会话失效，属预期；
- `users.qq_cipher` 非空行数 = **0**，无需重加密；
- `token_deal_guest_reviews.qq_cipher` 非空行数 = **2** —— 这 2 条游客头像解不开、
  退化为字母头像（`decryptQQ` 返回 null → 上游 404 → 前端回退），**评测正文不受影响**；
- `digest()` 派生的去重指纹（`ip_hash` / `guest_fingerprint`）整体轮换 →
  历史行的指纹与新提交不再匹配，「同一访客同一通告只能评一次/投一票」对**旧行**短暂失效
  （可再评一次）。208 条游客评测的小站点，影响可接受，无需数据迁移。

> 不能靠改 `users` 表或加白名单绕过 —— 只要签名密钥可猜，权限判定就形同虚设。

---

## 11. 生产 JWT 密钥轮换（2026-10-30 14:55）— §10 已处置

用户决策：**立刻轮换，并一并处理那 2 条 QQ 密文**。

### 执行与证据

| 步骤 | 结果 |
|----|----|
| 轮换前备份 | `data/backups/favshub.db.pre-rotate-20261030_*`，`integrity_check=ok` |
| 密文重加密（先自校验再落地） | 2 条 `token_deal_guest_reviews.qq_cipher`：旧密钥可解 → 新密文回解一致 → **旧密钥已无法解开**；不变量校验不通过则中止且不写库 |
| 新密钥 | `crypto.randomBytes(48).toString('base64')`（64 字符），写入 `.env` 的 `NUXT_JWT_SECRET`，保留原有 `COMPOSE_PROJECT_NAME`；原 `.env` 另存备份 |
| 部署副本 compose.yaml | 默认值由公开占位串改回 `:-}`，与仓库版本一致（另存备份） |
| 容器重建 | `docker compose -f compose.yaml up -d favshub` |
| **密钥一致性校验** | 容器实际取到的值 与 `.env` 中值的 sha256 前 16 位一致（`04509cf86e619d3b`）—— 证明 `.env` 解析没有把值改坏（改坏了那 2 条密文就解不开） |

### 验证

```
用【旧的公开默认值】伪造令牌 → /api/admin/announcements  401   ← 漏洞已关闭（轮换前是 200）
                              /api/admin/token-deals     401
用【新密钥】签发令牌           → /api/admin/announcements  200   ← 应用确实在用新密钥，管理鉴权仍正常
/avatar/<新密文1>.jpg          → 200  image/jpeg  3329B        ← 重加密正确，端点能用新密钥解开
/avatar/<新密文2>.jpg          → 200  image/jpeg  3804B
home / tokens                  → 200 / 200
启动日志中的「公开默认值」告警   → 0 条
```

### 附带影响（如实记录）
- 所有此前签发的登录会话已失效，用户（含管理员）需重新登录一次 —— 这是轮换签名密钥的必然结果。
- 历史游客评测/投票的去重指纹（`digest()` 派生）已同批轮换，旧行与新提交不再匹配，
  「同一访客同一通告只能评一次/投一票」对**旧行**短暂失效（可再评一次）。未做数据迁移。
- 代码侧新增防线：`server/utils/jwt.ts` 在启动时若发现密钥等于已知公开占位值会大声告警
  （只告警不阻断，避免站点因一个配置项起不来），相关说明记入 `favshub-nuxt/CLAUDE.md`。

---

## 12. 伪静态（已完成，见 §13）

用户澄清的需求：「部分详情页还是有 ? 参数」—— 即通告详情 `/tokens?deal=<id>` 与
提示词详情 `/prompts?prompt_id=<id>` 仍是查询参数形式。

已核实的关键事实：`components/tokens/TokenDealDetail.vue` 的内容由 `ref` + `onMounted` + `$fetch`
**在客户端**拉取，因此**仅把地址从 `?deal=x` 换成 `/tokens/x.html` 只是换了个地址，
爬虫拿到的 HTML 里仍然没有详情正文** —— 真正的伪静态必须让详情页服务端渲染出内容
（改造为可 SSR 取数，并处理 Cookie 转发以避免 hydration 不一致）。

已确认无需改动 nginx：`location /` 会把所有非静态路径反代给 Nitro，`.html` 亦进 Nuxt 路由。

该工作已派给 teammate `pseudo-static-coder`（共享任务 `task-2`），
验收标准含「curl 到 SSR HTML 并 grep 出详情正文」与「旧地址 301」。

---

## 13. 伪静态交付 + 第三轮复核 + 上线记录（2026-10-30 收尾）

### 13.1 伪静态实现（task-2，teammate `pseudo-static-coder`）

关键事实（决定了实现方式）：详情内容原本由 `TokenDealDetail.vue` 在客户端 `$fetch` 拉取，
**只改地址不会让爬虫看到正文** —— 所以必须真做 SSR。

- 路由：`nuxt.config.ts` 的 `pages:extend` 把 `pages/{tokens,prompts}/[id].vue` 改写成
  `/tokens/:id([\w-]+).html`。实测（**vue-router 是 5.1.0，不是 v4**）：
  `:id` 紧跟 `.html` 时后缀由路由消费、`params.id` 是纯 id；裸 `/tokens/x` 不误匹配。
- SSR 取数走 `useRequestFetch()`：把入站头转发给内部 API（Nitro `localFetch`，不走网络），
  保证登录态视角与客户端一致。复核用「外域 `X-Forwarded-Host`/`Forwarded` 伪造」实测：
  陷阱服务器命中 0 次、Cookie 未出站 → **转发严格限定本站同源**。
- 老地址 301：`server/middleware/legacy-detail-redirect.ts`，其它 query 原样保留；
  id 走白名单 `[A-Za-z0-9_-]+`，非法 id 不重定向（避免 301 到必然 404 的地址）。
  复核测了 18 种 id 变体 + 4 种保留 query 变体：`Location` **恒为站内相对路径**，
  `%0d%0a` 一律 400（拒绝而非注入），保留 query 被 `URLSearchParams` 重编码
  （`next=//evil.com` → `next=%2F%2Fevil.com`）。
- 所有生成链接改新形态：`utils/deal-share.ts`（权威构造器）、分享卡片、QQ 通知、
  `deal-events.ts` 的 `share_path`（RSS/Atom 两个对外入口此前仍在发旧地址）、
  编辑建议面板、搜索建议。**全仓已无功能性旧形态消费方**（只剩解释性注释）。
- 列表卡片改成真锚点 `<a href>` + `preventDefault` 就地弹窗（爬虫拿到真链接，用户行为不变）；
  `/prompts` 因卡片内有按钮、整卡做 `<a>` 会非法嵌套，改为标题是真链接。
- sitemap 收录详情页：通告侧**复用 `publicVisibleClause()`**（与公开列表同一口径，
  不另写一套），提示词侧与 `/api/prompts` 游客口径一致。复核实测：公开通告收录，
  待审/已删/已过期/已失效**全部不收录**，XML 里搜不到任何非公开标题。
- 详情页三处绝对日期改为固定站点时区（`Asia/Shanghai`）：页面现在 SSR，
  时间格式化必须是确定性的，否则跨日边界会 hydration 不一致。

**验收（构建产物 + curl）**：两个详情路由 200 且 SSR HTML 含标题/`note_html` 渲染结果/
提示词正文；旧地址 301；`ts:check` / `build` / 各 e2e 全绿。

### 13.2 第三轮复核查出并修掉的 [MAJOR]：详情页缓存豁免可被路径拼写绕过

`cache-control.ts` 原先用**未解码的原始 pathname** 做精确正则匹配来豁免详情页，
而 vue-router **先解码再匹配**路由参数 —— 于是同一张页面有多种等价写法能绕过豁免、
掉进「游客 → public」分支。复核实测 5 种写法（尾斜杠、结尾 `/.`、`%2Ehtml`、`%5F`、`%64eal`）
都拿到 `public, s-maxage=120` 且 **`Vary` 被覆盖成 `Accept-Encoding, Origin`**（丢掉 `Vary: Cookie`）。

危害：这两页的 SSR HTML **按 Cookie 定制**（`is_owner`/`can_edit`/`my_vote`/`my_review`/
`guest_review`/评测的 `my_marked`），复核用「两个不同 visitor cookie」实测确认 HTML 确实不同
（游客 A 投过票有 `class="active vote-btn is-up"`，B 没有）。有共享缓存时会把某访客的
个性化 HTML 发给别人。

**修法**：先归一化（解码 → 折叠重复斜杠 → 去掉结尾 `/.` → 去掉尾斜杠）再判，
且把「以 `.html` 结尾」作为**后缀规则而非枚举具体路由** —— 以后新增任何 `.html` 页面
都自动继承「不被共享缓存」这个安全默认。公开列表页都无扩展名，不会误伤。
常驻检测器 `scripts/cache-privacy-check.mjs`（20 项）锁住这条不变量。

### 13.3 生产缓存环境的实情（决定了上面那条的实际严重度）

2026-10-30 实测：`/www/server/panel/vhost/nginx/hao.bx9y.com.cn.conf` 第 1 行**定义了**
`proxy_cache_path ... keys_zone=hao_bx9y_com_cn_cache:20m`，但全文件**没有任何 `proxy_cache`
指令** → 该 zone 未启用；站点响应头也无 `cf-ray`/`x-cache`/`age`（前面**没有 CDN**）。

结论：这条 MAJOR 在生产**当前不可触发**，但那个 zone 是宝塔面板一键即可启用的，
且缓存设计（`s-maxage=120` + `stale-while-revalidate=300`）本身是按「前面有共享缓存」做的
—— 属埋着的雷，已按上面修掉。

另注：nginx 的 `location /` 会 `add_header Cache-Control "private, no-cache"`，
与中间件设置的 `public, ...` **同时存在**（响应里出现两个 `Cache-Control` 头）。
按 RFC 9111「任一 `Cache-Control` 声明 private 即视为 private」，实际效果偏保守；
但这个双头本身语义含糊，若将来要做 CDN 缓存需先理顺（记录，未改）。

### 13.4 第二轮复核报出的 3 个 MAJOR / 3 个 MINOR（全部已修住，第三轮独立复验通过）

| 项 | 问题 | 修法 |
|---|---|---|
| MAJOR | `fetch` 换原生 `http` 时丢掉 `AbortSignal.timeout()` 的真总时限，慢速服务器可无限占住连接 | `requestOnce` 加硬定时器到点 `req.destroy`，空闲超时仅作补充；`pinnedGet` 按序尝试**全部**已校验地址（顺带修双栈只钉 `addrs[0]`）；`dns.lookup` 套 `Promise.race` 超时 |
| MAJOR | AI 通道仍下发 `guest_fingerprint`（脱敏按端点各写一遍，AI 走 `SELECT td.*`） | 内部字段收进一份清单 `DEAL_PRIVATE_FIELDS`（`verified_by`/`guest_fingerprint`/`deleted_by`），列表循环与 `stripDealPrivateFields` 共用 |
| MAJOR | NAT64 词条 `64:ff9b::/96` 是死代码（写了 4 字节前缀却按 96 位比，恒为 false） | 补齐前缀字节 + `matchCidr` 长度断言 + `matchAnyCidr` 对写错的表项 **fail-closed** 并报错；内嵌 IPv4 统一为精确递归（mapped/compat/6to4/NAT64） |
| MINOR | `verifyDrawToken` 用 `t.length`（UTF-16 码元）判长却用 `timingSafeEqual` 比字节 → 32 个汉字致未认证 **500** | 按 `Buffer.from(t,'utf8').length` 比较 |
| MINOR | `pickInviteCode` 只防 `Infinity`，`MAX_VALUE + 2 === MAX_VALUE` 的有限极大权重会让其余码饿死 | 判据加 `total <= Number.MAX_SAFE_INTEGER` |
| MINOR | 待审通告返回 403「尚未通过审核」＝确认「该 id 存在且待审」 | `import.post.ts` 与 `card.png.get.ts` 统一为 404「通告不存在」 |

复核对 MAJOR 1 的独立复验：复刻接线实测 40/40 成功、**残留 Timeout = 0**（`close`→`clearTimeout`
确实触发、不泄漏定时器）、后续请求仍 200（keep-alive 池未被 `destroy` 误伤）、无
`unhandledRejection`；且**超时预算不会放大**（每跳重算 `remaining`，最坏 ≈ 单个 deadline）。

### 13.5 门禁（`pnpm build` 后全部实跑）

| 门禁 | 结果 |
|---|---|
| `pnpm run ts:check` | 857 个具名导入全部存在 |
| `node scripts/second-batch-e2e.mjs` | **117 通过 / 0 失败** |
| `node scripts/private-ip-check.mjs` | **98 通过 / 0 失败**（直接加载真实源码；负向验证：改回错误前缀 → 红灯） |
| `node scripts/ssrf-pin-check.mjs` | **12 通过 / 0 失败**（含慢速响应 before/after 对照 + 4 条源码防漂移断言） |
| `node scripts/cache-privacy-check.mjs` | **20 通过 / 0 失败** |
| `node scripts/dashboard-qqbot-outbox-e2e.mjs` | 13/13 PASS |
| `pnpm skill:check` | v1.9.8（6 个文件） |

**断言纪律（本轮踩过）**：`array.every(...)` 在**空集上恒为真** —— 我最初写的 5 条
「AI 通道不含某敏感键」断言在列表为空时会**全部假通过**。已补「列表非空且含探针」的前提，
并统一了 3 处同类写法。复核复查后确认 AI 那组前提有效；其余同类写法已对齐。

### 13.6 上线记录（1.0.47）

- 提交：`e29cd78`(安全修复) → `98959e3`(伪静态) → `ce3e264`(缓存豁免) → `e98af67`(VERSION 1.0.47)，CI success。
- 备份：`data/backups/favshub.db.pre-1.0.47-20261030_154854`（`integrity_check`=ok，
  deals=80 / announcements=1 / users=3）。
- 回滚点：镜像标签 `ghcr.io/huanyu-a/favshub:rollback-1.0.46`（= `sha256:4b825808e771a`）。
- 新镜像：`sha256:4879b18852dea4339152133717b292b79818a1a82b11d1c1892c04dad18a830e`。
- 容器 `favshub_b8j8-favshub-1` 已重建，健康；`NUXT_JWT_SECRET` 容器内指纹与 `.env` 一致
  （`04509cf86e619d3b`，轮换未被回退）；启动日志无告警。
- **生产端到端验收 24 项全通过**：站点 5 个页面 200；详情页 200 且 SSR HTML 含通告标题
  （实测 `deal_1789980617061_xnr12c`）；列表卡片含真锚点；老地址 **301** 且 `Location` 正确；
  **缓存隐私的 5 种绕过写法在生产 nginx 下全部不再是 `public`**；sitemap 含详情页 URL；
  公开页仍为 `public`（没一刀切）；非法 id 不重定向。

### 13.7 遗留项（下一轮可做，均非阻塞）

1. **Teredo `2001::/32` 未覆盖**（内嵌 IPv4 在 bit 32–63 且按位取反）——需 Teredo 基础设施才可利用，
   复核判低风险，记录即可。
2. `favicon-download.ts` 的两点可选优化：CIDR 表校验提到**模块加载时**（让错误在启动/CI 暴露）、
   `console.error` 降为**只报一次**（避免潜在刷日志）。
3. `scripts/second-batch-e2e.mjs` 会留下 `data/e2e-second-batch-<ts>.db` 与
   `data/cache-privacy-<ts>.db` 临时库，建议加清理。
4. **移动端布局未被任何人实测**（①的回到顶部 / FAB 几何改动用 CSS 静态比对确认过，
   但无浏览器环境）——**需用户在手机上确认**。
5. **hydration 控制台告警无直接证据**（本机无浏览器：Chrome DevTools MCP 连不上 9222，
   kimi-webbridge 扩展未连接）。已用替代证据（payload 同源 + 时区确定性）做结构级证明，
   但不等价。相对时间标签（「3 天后到期」）由 `Date.now()` 现算，跨日边界 SSR 与客户端
   可能差一个字 —— **列表页 `TokenDealCard` 早就是这个行为**，属既有口径，非本次引入。
6. **真实搜索引擎抓取未验证**（只验证了 SSR 含正文 + canonical/og/sitemap/RSS/站内锚点
   四条发现路径都在）。
7. 容器 DNS **不可使用 fake-ip 模式**（Clash/mihomo TUN 等）：会让所有域名解析到
   `198.18.0.0/15`，被 SSRF 护栏拦截 → 模型拉取与 favicon 下载全部失效。
   该约束已写入 `CLAUDE.md`。
8. `favshub-nuxt/docs/` 下 3 个历史计划文档仍含旧地址形态（按指示不改历史文档）：
   `plans/2026-10-20-guest-deal-subscriptions.md`、本文件（§12 已改写）、`plan-token-share-card.md`。
