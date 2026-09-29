# 实施方案：后台仪表盘待审角标 + QQ 机器人通知（2026-09-29）

> 本文档是实现规格（spec），工作流各子代理以本文档为准。实现前必须先读目标文件确认现状（文中行号是编写时的参考，可能有偏差）。
>
> **全局硬约束**：
> 1. 禁止执行 `git commit` / `git push`，禁止改动 `VERSION` 文件，禁止任何部署操作——所有改动只留在工作区。
> 2. 数据库是 **better-sqlite3 单文件（`data/favshub.db`）+ Drizzle**，迁移统一写在 `server/database/migrate.ts` 末尾（**独立 try/catch**，勿并入既有大 exec 块），启动时自动执行。
> 3. 多步写库必须 `db.transaction()`；原生 SQL 用 `getRawDb()`。
> 4. 通知一律 fire-and-forget：调用处 try/catch 包裹，失败只 `console.warn`，**绝不阻断主请求**。
> 5. 遵循项目现有代码风格（中文注释、server 端点内裸 SQL、无 repository 层）。
> 6. 类型检查命令是 `pnpm ts:check`（scripts/ts-check/index.mjs）。

---

## 功能 A：后台仪表盘「白嫖通告」板块 + 待审角标

### A1. 统计 API 扩展 — `server/api/admin/stats.get.ts`

在 `isAdmin` 分支（现返回 searchEngines/users/adminUsers/dbSize 处）追加：

```ts
// 白嫖通告按状态聚合（一次 GROUP BY 取全）
tokenDeals: { total, pending, approved, rejected },   // SELECT status, COUNT(*) FROM token_deals GROUP BY status
promptReviews: { pending },          // SELECT COUNT(*) FROM prompt_review_requests WHERE status='pending'
dealEdits: { pending },              // 修改建议待审（参考 server/utils/deal-edits.ts 中现有待审查询）
guestReviews: { pending },           // 游客评测待审（参考 server/utils/guest-reviews.ts 现有 pending_total 查询）
```

非管理员分支的响应保持不变。所有数字用合并/单条 SQL 取，避免 N 次查询。

### A2. 仪表盘页面 — `pages/admin/index.vue`

1. **统计面板**：新增一个「白嫖通告」`stat-group`（复用 `stat-group-title / stat-group-item / sgi-label / sgi-value` 既有类，样式在 `public/css/admin.css`）：显示 总数 / 待审 / 已发布 / 驳回，整组 `v-if="isAdmin"`（对齐现有「系统」「用户」组的写法）。「提示词」组内追加一项「待审」。
2. **快捷操作角标**：`nav-grid` 里给「白嫖通告」nav-card（→ `/admin/token-deals`）加红色待审角标，数字 = `tokenDeals.pending + dealEdits.pending + guestReviews.pending`（该板块全部待管理员处理量的总和，与页面内 Tab 口径对齐）；给「提示词管理」nav-card（→ `/admin/prompts`）加角标 = `promptReviews.pending`。数字为 0 不渲染。角标仅 `isAdmin` 可见。
3. 角标 DOM：nav-card 右上角绝对定位（nav-card 需补 `position: relative`，确认不破坏现有布局）。

### A3. 角标样式 — `public/css/admin.css`

新增 `.nav-card-badge`，样式值抄 `pages/admin/token-deals.vue` 中 `.tab-badge`（红底白字圆角 999px，`background: var(--danger); color: var(--text-inverse)`，最小宽 18px、居中、字号 12px、绝对定位右上 -8px/-8px）。

### A4. 验收

`pnpm ts:check` 通过；端到端脚本断言 `/api/admin/stats` 新字段存在且数值正确（见 §E）。

---

## 功能 B：QQ 机器人（OneBot 11 / NapCat）

### B0. 架构与选型

```
[ favshub Nitro 应用（单进程） ]
   ├─ server/utils/qq-notify.ts        出站：内存消息队列 → OneBot 11 HTTP API（NapCat :5701）
   ├─ server/api/bot/onebot.post.ts    入站：OneBot「HTTP 上报」事件 → 指令路由
   ├─ server/api/qq/bind-code.*.ts     网站侧绑定码 API
   └─ server/utils/qq-bot-commands.ts  指令实现 + 权限矩阵
[ NapCat（或 scripts/mock-onebot.cjs 模拟器） ] ⇄ QQ
```

- SQLite 单写者约束 → 机器人逻辑**全部同进程**实现，不引入独立服务/容器/新 npm 依赖（出站用原生 `fetch`）。
- 出站 = OneBot 11 HTTP API（`POST {url}/send_group_msg {group_id, message}`、`/send_private_msg {user_id, message}`，鉴权头 `Authorization: Bearer <token>`）；message 用字符串格式（可含 CQ 码）。
- 入站 = NapCat「HTTP POST 上报」到 `/api/bot/onebot`。**机器人回复不走上报响应**，统一走出站队列（与通知同路），入站端点恒返回 `{ status: 'ok' }`。

### B1. 配置

**runtimeConfig 私有键**（`nuxt.config.ts`）+ env：

| 键 | env | 默认 | 含义 |
|---|---|---|---|
| `qqBotHttpUrl` | `NUXT_QQ_BOT_HTTP_URL` | `''`（空=出站禁用） | NapCat HTTP API 地址，如 `http://127.0.0.1:5701` |
| `qqBotAccessToken` | `NUXT_QQ_BOT_ACCESS_TOKEN` | `''`（空=入站端点拒绝一切） | NapCat access_token（出站头 + 入站校验同一值） |

`compose.yaml` 的 favshub 服务 env 与 `.env.example` 各补两条空默认 + 注释（本次仅本地测试，但配置面先铺好）。

**system_config 热配置**（`server/utils/constants.ts` 的 `SYSTEM_ONLY_KEYS` 与 `SYSTEM_CONFIG_DEFAULTS` 各追加；管理员经 `/api/admin/config` 可改）：

| key | 默认 | 含义 |
|---|---|---|
| `qq_bot_enabled` | `'false'` | 总开关：false 时入站 403、出站不发送 |
| `qq_bot_group_id` | `''` | 通知目标群号 |
| `qq_admin_qq` | `''` | 群 @ 提醒的管理员 QQ 号（若管理员已绑定 QQ 则优先用绑定号） |

实现时检查 `pages/admin/config.vue`：若配置页是动态渲染（读 defaults）则新键自动出现；若是静态字段清单则补两组输入项。

### B2. 数据表（`server/database/migrate.ts` 末尾独立 try/catch + `server/database/schema.ts` 同步声明）

```sql
CREATE TABLE IF NOT EXISTS qq_bindings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,  -- users.id 是 INTEGER 自增
  qq_number TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_qq_bindings_qq ON qq_bindings(qq_number);
```

### B3. 出站通知服务 — `server/utils/qq-notify.ts`

- `queueGroupMessage(text)` / `queuePrivateMessage(qq: string, text)`：先判开关（`getConfig('qq_bot_enabled')` + `qqBotHttpUrl` 非空 + 群号非空）不满足直接丢弃；满足则推入模块级队列。
- 队列 flush：`setInterval` 每 1s 发一条（天然节流防刷屏）；单条失败重试最多 3 次（退避 1s/5s/25s），仍失败丢弃并 `console.warn`。
- 文案组装 helper（群消息带 CQ 码 @管理员：`[CQ:at,qq=${adminQQ}]`）：

| 事件 | 通道 | 文案 |
|---|---|---|
| 新通告待审 | 群 | `📥 新通告待审：《标题》（提交人：xxx），当前待审 N 条` + @管理员 |
| 管理员直接发布 | 群 | `🆕 新通告发布：《标题》`（不 @） |
| 通告修改回待审 | 群 | `✏️ 通告《标题》已修改，重新进入待审，当前待审 N 条` + @管理员 |
| 通告删除 | 群 | `🗑️ 通告《标题》已删除` |
| 通告审核通过 | 群 + 私聊作者 | 群：`✅ 通告《标题》已发布`；私聊：`✅ 你投稿的通告《标题》已通过审核，感谢贡献！` |
| 通告驳回 | 私聊作者 | `❌ 你投稿的通告《标题》未通过审核：原因` |
| 提示词修改待审 | 群 | `📝 提示词《标题》有新的修改审核请求，当前待审 N 条` + @管理员 |
| 提示词审核通过/驳回 | 私聊提交人 | 同通告风格 |

待审 N 条 = 实时查询（每次组装时 COUNT）。

### B4. 事件挂载点（8 处，每处在**写库成功之后**调用，try/catch 包裹）

| # | 文件 | 时机 | 通知 |
|---|---|---|---|
| 1 | `server/api/token-deals/index.post.ts`（INSERT 后） | 非管理员提交（status=pending） | 群·新通告待审 |
| 2 | 同上 | 管理员直接发布（status=approved） | 群·新通告发布 |
| 3 | `server/api/token-deals/[id].put.ts`（UPDATE 后且回 pending） | 群·修改回待审 |
| 4 | `server/api/token-deals/[id].delete.ts`（删除后） | 群·已删除 |
| 5 | `server/api/admin/token-deals/[id]/review.post.ts` | approve | 群·已发布 + 私聊投稿人（若已绑定） |
| 6 | 同上 | reject | 私聊投稿人·驳回 |
| 7 | `server/api/prompts/[id]/review-request.post.ts`（INSERT 后） | 群·提示词待审 |
| 8 | `server/api/admin/prompts/review-requests/[id]/approve.post.ts`、`reject.post.ts` | 私聊提交人 |

AI 通道（`server/utils/ai-service.ts` 的 createTokenDeal 等）与修改建议/游客评测审核 **v1 不挂**（见 §G backlog）。

### B5. 入站端点 — `server/api/bot/onebot.post.ts`

- 鉴权：`Authorization: Bearer <token>` 或 `?access_token=`，与 `runtimeConfig.qqBotAccessToken` 比对；配置为空或 `qq_bot_enabled=false` 时 403。
- 幂等：`message_id` 用 `lru-cache`（已有依赖）去重。
- 只处理 `post_type === 'message'`：`message_type: 'group' | 'private'`，文本取 `raw_message || message`，剥离头部 @CQ 码后 trim 作为指令。端点始终 `return { status: 'ok' }`。

### B6. 指令与权限矩阵 — `server/utils/qq-bot-commands.ts`

身份判定：私聊 `user_id`（QQ 号）→ 查 `qq_bindings` → 查 `users.is_admin`。三档：

| 身份 \ 通道 | 群 | 私聊 |
|---|---|---|
| 游客（未绑定） | `帮助` / `最新通告 [N]` / `通告统计` | 同群 |
| 普通用户（已绑定，非管理员） | 同游客；个人指令一律回复「请私聊机器人办理」 | 游客全部 + `我的投稿` / `绑定 <code>` / `解绑` |
| 管理员（已绑定且 is_admin） | **任何指令**固定回复「⚙️ 管理指令请私聊机器人办理」（安全要求） | 游客全部 + `待审` / `通过 <id前缀>` / `驳回 <id前缀> [原因]` |

指令语义：

- `帮助`：列出当前身份可用的指令（群内不展示管理指令）。
- `最新通告 [N]`：`token_deals` 中 status='approved' 按 created_at desc 取 N（默认 5，上限 10），格式「标题 · 来源 · ▲票数」，**不含 note 等内部字段**。
- `通告统计`：已发布总数 + 今日新增（公开口径）。
- `我的投稿`：本人最近 5 条通告的标题 + 状态（中文）。
- `绑定 <code>`：仅私聊。校验 §B7 绑定码 → INSERT/UPDATE `qq_bindings` → 回执「✅ 已绑定账号 xxx，现在可以用个人指令了」。码无效/过期 → 明确报错。
- `解绑`：仅私聊，删除绑定行。
- `待审`：待审通告 + 待审修改建议 + 待审提示词审核 + 待审游客评测 四个数。
- `通过 <id前缀>` / `驳回 <id前缀> [原因]`：用 `id LIKE '<前缀>%'` 匹配通告；匹配数 ≠1 时报错提示加长前缀；命中后**复用与 admin review 端点完全相同的写库语义**（approve→status='approved' 清空 reject_reason；reject→status='rejected' 写 reject_reason），并**复用 §B4 的通知链路**（群播 + 私聊作者）——即把 review 端点的核心写库+通知抽成 `server/utils/token-deals.ts` 内的共享函数供两处调用，避免逻辑复制。

### B7. 绑定码服务 — `server/utils/qq-bind-codes.ts` + `server/api/qq/bind-code.post.ts|delete.ts`

- 内存 `Map<code, { userId, expiresAt }>`（进程内即可，码本就 10 分钟有效）。
- `createBindCode(userId)`：6 位数字，TTL 10 分钟；同用户未过期时复用同一个码。
- `POST /api/qq/bind-code`（requireAuth）：返回 `{ code, expiresAt, bound: qq | null }`（bound 为当前用户已绑定的 QQ 号）。
- `DELETE /api/qq/bind-code`（requireAuth）：解绑当前用户。
- 注意：`/api/qq/**` 不在 admin 下，走正常登录鉴权即可；绑定动作本身只发生在机器人私聊指令中（网站侧只生成码），避免任何「知道用户名即可抢绑」的口子。

### B8. 前端绑定入口 — `components/sidebar/UserPanel.vue`

在该面板（现有「个人资料/退出登录」所在区域）加「QQ 绑定」入口：点击弹出小面板/弹窗，显示当前绑定状态（已绑 QQ 号 + 解绑按钮；未绑则显示「生成绑定码」按钮 → 展示 6 位码与文案「10 分钟内在 QQ 私聊机器人发送：绑定 XXXXXX」，倒计时后过期）。样式对齐面板现有风格，中文文案。

### B9. 本地模拟器 — `scripts/mock-onebot.cjs`

无依赖 node http server（env：`MOCK_PORT=5701`、`TOKEN=xxx`）：

- `POST /send_group_msg`、`POST /send_private_msg`：校验 Bearer token，打印 `[群 123456] 📥 新通告待审…` 彩色日志，内存保留最近 200 条。
- `GET /messages`：JSON 返回记录（人工检查用）。
- 文件头注释写清与 NapCat 的对接说明（NapCat 侧：HTTP 服务器端口 ↔ 本脚本、HTTP 上报地址 ↔ `http://<app-host>:<app-port>/api/bot/onebot`、access_token 两边一致）。

### B10. 端到端冒烟 — `scripts/dashboard-qqbot-e2e.mjs`（自包含，`node` 直跑，退出码 0/1）

先决条件：`pnpm build` 已产出 `.output/`。脚本流程：

1. **内置迷你 OneBot mock**（逻辑与 B9 相同，内联实现）监听 `127.0.0.1:5701`。
2. **spawn** `node .output/server/index.mjs`，env：`PORT=3211`、`NUXT_DB_PATH=data/e2e-qqbot-<时间戳>.db`（启动前删除旧文件，启动自动跑迁移）、`NUXT_ADMIN_USERS=e2eadmin`、`NUXT_QQ_BOT_HTTP_URL=http://127.0.0.1:5701`、`NUXT_QQ_BOT_ACCESS_TOKEN=e2e-token`。轮询 30s 等 ready。
3. **断言序列**（全部 HTTP fetch；读 `server/api/auth/register.post.ts` 等确认请求字段；涉及 admin/config、提示词端点的字段同样现读现用）：
   a. 注册 `e2eadmin`（经 NUXT_ADMIN_USERS 即管理员）、`alice`、`bob` 并登录拿 cookie。
   b. `GET /api/admin/stats`：含 `tokenDeals.pending=0`、`promptReviews.pending=0`。
   c. admin 经 `PUT /api/admin/config` 设 `qq_bot_enabled=true`、`qq_bot_group_id=123456`、`qq_admin_qq=88888`。
   d. alice 提交通告（POST `/api/token-deals`）→ **轮询**（最多 5s）mock 收到群消息，含「新通告待审」与 `[CQ:at,qq=88888]`；stats `tokenDeals.pending=1`。
   e. admin 审核通过 → mock 收到群「已发布」+ 私聊 alice「通过审核」；stats pending=0。
   f. bob 绑定：`POST /api/qq/bind-code` 得码 → 模拟 OneBot 上报（POST `/api/bot/onebot`，Bearer e2e-token，私聊事件 `绑定 <code>`）→ mock 收到私聊回执；错误 token → 403；`qq_bot_enabled=false` 时 → 403。
   g. bob 私聊「我的投稿」→ 回执含状态；bob 群内发「我的投稿」→ 回复含「私聊」；admin 群内发「待审」→ 回复「私聊」；admin 私聊「待审」→ 回执含四个待审数。
   h. 群内「最新通告」→ 回执含已发布通告标题。
   i. admin 创建公开提示词 → alice 对其提审（review-request）→ mock 群消息含「提示词」且带 @；admin approve → mock 私聊 alice。
4. 任一断言失败：打印期望/实际后 exit 1；全部通过清理子进程与临时库后 exit 0。

---

## G. 未来场景 backlog（本次不实现，策划备忘）

1. **每日群摘要**：每天 9:00 播报昨日新增通告数、待审数（Nitro 插件 setInterval 模式，照抄 `server/plugins/backup-scheduler.ts`）。
2. **通告到期提醒**：`expires_at` 前 3 天群播报。
3. **待审积压告警**：待审 > 10 条且最老一条 > 24h → 私聊管理员。
4. **修改建议 / 游客评测待审通知**：挂 `deal-edits.ts reviewDealEdit`、`guest-reviews.ts reviewGuestReview` 与对应提交端点。
5. **投票里程碑**：通告票数过 10/50 时群播报。
6. **AI 通道挂载**：`ai-service.ts` 的通告写路径补通知。
7. **群公告自动同步**：机器人定期把最新 5 条已发布通告写进群公告。

## 风险与回滚

- 仅新增表/文件/配置键，无破坏性迁移；总开关默认 false、不配置 env 时行为零变化。
- 回滚 = 工作区直接丢弃（本任务不提交），或删除新增文件 + 还原 8 个挂载点。

---

## H. 部署后实施补记（2026-09-29 下午）：出站传输改为 Hermes outbox

上线后实测确认两条平台级约束（服务器 gateway.log 与 `hermes send` 直接验证）：

1. **官方 QQ 机器人对群「主动消息」无权限**：`/v2/groups/{group_openid}/messages` 返回 400
   「主动消息失败, 无权限」；单聊 C2C 主动消息与被动回复窗口之外的群发均不可用。
   「在群里 @ 主人」的原设计在官方 QQ 机器人上物理不可行（他人能群发的是已申请到主动消息
   权限的机器人、QQ 频道，或 NapCat 等逆向 OneBot 协议）。
2. **消息接收模式 WebSocket 与 HTTP 回调二选一**：服务器 Hermes 已用 WebSocket 承载 QQ 对话，
   FavsHub 无法再占用同机器人的回调入站 → 本期纯出站，入站指令（绑定/通过/驳回）搁置，
   待审/审核管理操作留在网页后台 + 仪表盘角标（已上线）。

最终出站架构（transport='outbox'，为线上实际采用）：

- FavsHub 事件 → 1s 节流队列 → **spool 目录**：每条消息写
  `<qq_outbox_path>/<时间- pid-序号>.json`（tmp + rename 原子发布），
  群目标支持逗号分隔多通道、裸 id 归一化为 `qqbot:` 前缀、文本 CQ 实体反转义。
- 宿主机 cron（*/2 分钟）跑 `scripts/qq-outbox-deliver.py`：逐文件调
  `hermes send --to <target> --json`（**成功与否以 JSON 的 success 字段为准，hermes 失败也
  exit 0**），成功删文件、失败 attempts+1 原子回写，10 次或 12 小时超龄进死信。
  并发保护用脚本内部 fcntl 锁（勿在 cron 行外再套 flock 同一把锁文件：flock 与 fcntl 同文件
  互斥会互相视为占用导致空转——已踩）。
- 待审类提醒 = 群广播（群目标为空则跳过）+ **私聊主人**（`qq_admin_qq` 在 outbox 下语义为
  Hermes 私聊目标；QQ 私聊即「@ 主人」的等价可靠通道）。
- 配置：`NUXT_QQ_OUTBOX_DIR`（回落 /opt/favshub/data）/ 热配置 `qq_outbox_path`；
  `qq_bot_transport=onebot|outbox`（onebot 原链路保留，e2e 22 项仍全绿）。
- 线上已验证：容器写 spool → 宿主机 bind-mount 可见；两条自检消息经
  `deliver.py → hermes send → 主人 QQ 私聊`实测送达；cron 已装。

**开启群播报的前置**：在 QQ 开放平台为本机器人申请「主动消息」权限（AppID 见开放平台控制台，不入库不入仓库）；
批准后在 后台 → 系统配置 → QQ 机器人「通知目标」填 `qqbot:<群通道ID>`（群通道 ID 由 Hermes
channel_directory.json 取得，属机器人身份数据，只存线上热配置，文档与仓库不落值），如需同时播报钉钉群再追加
`,dingtalk:<群会话ID>`。权限未批前群发会按上述策略重试后进死信，不影响主流程。
