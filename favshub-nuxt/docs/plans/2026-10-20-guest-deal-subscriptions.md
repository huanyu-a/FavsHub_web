# 实施方案：游客 Hermes 订阅 · 白嫖通告变更推送（2026-10-20，第二版）

> 状态：**待评审，未开工**。目标读者：开发者 / AI。
> 第一版曾把重心放在「站点直连 Telegram/飞书/钉钉」。**已修正**：接收端是游客自己的
> **Hermes**，靠 `hermes send <target> <text>` 投到 QQ 群/单聊/钉钉。据此重排架构（§1）。
> 前置：通告生命周期改造（v1.0.28）已上线。

## 0. 需求与边界

| 项 | 内容 |
|---|---|
| 谁 | **游客**（无账号），他在自己机器/服务器上跑 **Hermes**，Hermes 里挂着 QQ 机器人 |
| 要什么 | 站点**公开白嫖通告有变化**时，自动出现在游客的 QQ 群/单聊里 |
| 装什么 | 游客把我们的技能包装进他的 Hermes，按说明加一条计划任务 |
| 权限 | **只读**：游客只能收，不能改通告、不能读非公开内容 |
| 不做什么 | 不推待审/驳回/审核备注；不做站内私信；不要求游客暴露任何入站端口 |

## 1. 可达性与职责划分（本版核心修正）

| 路径 | 可达？ | 结论 |
|---|---|---|
| 游客 Hermes → 站点 | ✅ | **这是主路径**。Hermes 定时拉取增量事件 |
| 游客 Hermes → 游客的 QQ | ✅ | `hermes send qqbot:<id>`（游客自有通道，与站点无关） |
| 站点 → 游客 Hermes | ❌ 一般不成立 | Hermes 默认不暴露公网入站。除非游客自己给出回调地址（P3 可选） |
| 站点 → 第三方平台（TG/飞书…） | ✅ | 对「没有 Hermes 的游客」才需要，**降级为可选**，本方案不优先 |

所以「站点变化 → 自动推到游客 QQ」这条链路，正确的拆法是：

```
站点：产生事件 → 提供增量接口（Pull）
游客 Hermes：定时拉 → 判断有变化 → hermes send qqbot:... → QQ 群/单聊
```

**站点不再负责出站投递**：没有 outbox、没有渠道适配器、没有 SSRF 面、没有「把站点当刷屏器」的滥用面。
站点只做两件事：**把事件记全**、**把增量接口做稳**（附带一条可直接发送的文案）。
这正是「游客只有接收能力」的物理体现：投递权限在游客自己的 Hermes 手里。

## 2. 架构总览

```
                      8 处写路径（同一事务）
                             │ appendDealEvent()
                             ▼
      token_deal_events（append-only，seq 单调，只记 public=1，含渲染好的 text）
                             │
              ┌──────────────┴───────────────┐
              ▼                              ▼
  GET /api/token-deals/changes        GET /api/token-deals/feed.atom
  技能脚本 / 游客 Hermes 定时拉        零代码订阅（Hermes 若支持 feed，或任意阅读器）
              │
              ▼
     游客 Hermes: hermes send qqbot:<目标> "<text>"
```

关键取舍：**事件表里直接存「渲染好的中文文案」**（`text` 字段），Hermes 侧无需理解业务字段，
`hermes send` 原样转发即可 —— 这让技能脚本短到 50 行，也保证 QQ 里看到的文案与站点一致。

## 3. 事件流（单一真源）

```sql
CREATE TABLE IF NOT EXISTS token_deal_events (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,  -- 游标：单调，客户端直接记忆
  deal_id    TEXT    NOT NULL,
  kind       TEXT    NOT NULL,   -- online|offline|updated|renewed|pinned
  reason     TEXT    NOT NULL DEFAULT '',   -- offline: expired|votes|manual|deleted
  snapshot   TEXT    NOT NULL,   -- 公开字段 JSON
  text       TEXT    NOT NULL,   -- 已渲染的单行中文文案（QQ 友好，≤ 200 字）
  public     INTEGER NOT NULL,   -- 1 = 写入时该通告对外可见
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_deal_events_created ON token_deal_events(created_at);
CREATE INDEX IF NOT EXISTS idx_deal_events_deal    ON token_deal_events(deal_id, seq);
```

`snapshot` 只允许公开字段：`id/title/provider/callUrl/quota/models/region/quality/expires_at/rating/tags/shareUrl`。
提交人、审核备注、下架操作人**永不入表**，从数据层根除「推送里夹带后台信息」。

### 3.1 事件类型与文案

| kind | 触发 | `text` 示例 |
|---|---|---|
| `online` | 待审 → 已通过 | `【上新】XX 渠道 · 额度 100 次 · 支持 Claude/GPT · 到期 11-20 https://…/tokens?deal=…` |
| `offline` | 到期归档 / 投票失效 / 管理员判失效 / 软删除 | `【下架】YY 渠道（已到期）` |
| `updated` | 已公开通告内容变更 | `【变更】ZZ 渠道 · 额度 100 → 200` |
| `renewed` | 续期 / 设为永久 | `【续期】ZZ 渠道 · 延长至 12-01` |
| `pinned` | 置顶变化 | `【置顶】ZZ 渠道`（默认订阅者不收，见 filters） |

**只推公开事件**：待审、驳回、建议被拒不产生事件（继续走现有站长 QQ 通知）。
订阅者拿到的范围 ≤ 匿名访客看公开列表能拿到的范围 —— 边界由 `public` 标志保证。

### 3.2 埋点位置（收敛到现有语义函数）

| 函数 | 事件 |
|---|---|
| `utils/token-deals.ts → softDeleteDeal()` | `offline(deleted)` |
| `→ markDealInvalid()` / `archiveExpiredDeals()` | `offline(expired|votes|manual)` |
| `→ restoreDeletedDeal()` / `clearDealInvalid()` | `online` 或 `updated` |
| `→ evaluateDealVoteInvalidation()` | 随 `markDealInvalid` 自动带上 |
| `api/token-deals/index.post.ts`、`utils/ai-service.ts`（创建） | 仅管理员直发上线时 `online` |
| `api/token-deals/[id].put.ts`、`ai-service.ts`（更新） | `updated` / `renewed` |
| `api/admin/token-deals/[id]/restore.post.ts` | 按 action 产出 |
| `api/token-deals/[id]/pin.post.ts` | `pinned` |

铁律：`appendDealEvent()` 与业务写库**同一事务**；回滚则事件不落库。

## 4. 三个对外接口

### 4.1 `GET /api/token-deals/changes`（主接口）

```
GET /api/token-deals/changes?since=<seq>&limit=50&kinds=online,offline&token=<sub_token>
```

| 项 | 设计 |
|---|---|
| 鉴权 | 无（信息范围等同公开列表）；可选 `token=` 做个性化过滤 |
| 响应 | `{ events:[{seq,kind,reason,text,deal}], next_since, has_more, server_time }` |
| 首次基线 | `?tail=1` → 只返回 `{ next_since }`，不读历史。脚本首次运行用它，**绝不回灌历史**（否则一装技能就被灌几百条） |
| 游标 | 客户端存 `next_since`；无 `since` 且无 `tail` → 返回最近 7 天并带 `notice`；`since > 当前 seq` → 400 |
| 下架事件 | `offline` 只给标题 + 原因类别（不给内容快照，不再传播已下架内容） |
| 限流 | `checkRateLimit('changes:'+ipHash, 60, 1h)`；ETag/304；`Cache-Control: no-store` |
| 排序 | `seq` 升序，稳定分页（`limit` 上限 100） |
| AI/MCP | `describe.get.ts` 登记；`mcp.post.ts` 增 `token_deals_changes` 工具 |

### 4.2 `GET /api/token-deals/feed.atom` + `feed.json`

给「Hermes 支持 feed 订阅」或「用阅读器」的游客留零代码路径：
Atom 200 条上限，只含 `online / updated / renewed`（不含下架，避免 feed 变噪音）；
`feed.json` 为 JSON Feed 1.1。成本约 30 行代码，收益是**不需要装任何脚本**。

### 4.3 `POST /api/deal-subscriptions`（可选账本，P1）

只在需要「后台看到有多少机器人订阅、各自关心什么」时才做。注意：**它不参与投递**。

```sql
CREATE TABLE IF NOT EXISTS deal_subscriptions (
  id         TEXT PRIMARY KEY,          -- sub_<random>
  sub_token  TEXT NOT NULL UNIQUE,      -- 32B hex，游客脚本凭此拉个性化结果
  filters    TEXT NOT NULL DEFAULT '{}',-- {kinds:[],providers:[],regions:[],keywords:[]}
  label      TEXT NOT NULL DEFAULT '',  -- 游客自填备注（如「我的 QQ 群」），便于他自己区分
  cursor     INTEGER NOT NULL DEFAULT 0,-- 站点记录最近拉到的 seq（只做统计，不判重）
  status     TEXT NOT NULL DEFAULT 'active', -- active|paused|revoked
  created_at INTEGER NOT NULL, last_pull_at INTEGER, pull_count INTEGER NOT NULL DEFAULT 0
);
```

端点：`POST`（Turnstile + 每 IP 每天 3 条）→ 返回 `sub_token`；`GET/PATCH/DELETE /:token`
（只能改 filters/label/paused，退订即 `revoked`）。不提供列表接口（token 即能力，防枚举）。

## 5. 游客侧：技能包 + 脚本（真正的交付物）

### 5.1 技能包新增章节

`favshub-data-ops/` 加 `subscribe.md`（或并入 SKILL.md 一节），给 AI 助手的指令：

1. 首次：`changes?tail=1` 取基线存本地，**不发历史**；
2. 常规：`changes?since=<cursor>&limit=50`；
3. 有新事件 → 把 `text` 字段**原样**交给 `hermes send`（不要改写，站点文案已控长度与格式）；
4. 成功后推进游标；失败则保持游标不动（下轮重试），不重复推送；
5. 每天最多推 N 条（建议 20），超出的合并成一条「今日白嫖汇总」；
6. 退订 = 删计划任务 + 删本地游标文件。

### 5.2 参考脚本（技能包内 `scripts/favshub-poll.py`，约 80 行）

```python
# 每 10 分钟由游客的 cron / Hermes 计划任务拉起
# 1) 读 ~/.favshub/state.json  {since, target}
# 2) GET <site>/api/token-deals/changes?since=<since>&limit=50
# 3) 无事件 → 退出
# 4) 有事件 → 拼文本（多条合并）→ subprocess.run(["hermes","send","--json",target,text])
# 5) 以 JSON 的 success 字段为准（与现有 qq-outbox-deliver.py 一致的判据），成功才写回 since
```

游客侧只需两条命令：

```bash
python3 favshub-poll.py --init --target qqbot:37BC... --site https://<站点域名>   # 取基线
# crontab:  */10 * * * * /usr/bin/python3 /opt/favshub/favshub-poll.py >> /var/log/favshub.log 2>&1
```

要点：`hermes send` 失败也返回 exit 0（error 在 stdout JSON），所以脚本必须看 `success` 字段 ——
这条坑现有 `scripts/qq-outbox-deliver.py` 已经踩过并写进注释，技能包的脚本直接沿用同一判据。

### 5.3 若游客的 Hermes 支持「feed 订阅」

则完全不需要脚本：在 Hermes 里订阅 `https://<站点>/api/token-deals/feed.atom`，
由 Hermes 自己决定投到哪个 QQ 目标。这是最省事路径，文档里作为「推荐先试」。

## 6. 后台观测（P2，只读）

`/admin/token-deals` 增「订阅」Tab：

- 计数：活跃订阅 / 今日拉取次数 / 最近拉动时间 / 已退订
- Top 过滤条件（便于判断游客关心什么）
- 事件流最近 50 条（回答「某条通告为什么没推」→ 看有没有 `public=1` 的事件）
- 单条订阅：`label`、filters、游标、拉取次数；操作仅 `暂停 / 撤销`
- **不显示**任何游客身份信息（本来也不采集）；`sub_token` 一律掩码

## 7. 限流与成本

| 项 | 值 |
|---|---|
| `changes` 轮询 | 每 IP 每小时 60 次（10 分钟一次 = 6 次/小时，余量充足） |
| 建订阅 | 每 IP 每天 3 条 |
| 事件保留 | 90 天（`db-init` 清理） |
| 出站 | **零**（站点不主动连任何人） |

成本：1000 个 Hermes × 6 次/小时 ≈ 1.7 QPS 入站，SQLite + WAL 完全够；
若未来到 1 万，加一层 ETag（绝大多数请求 304，几乎零成本）。

## 8. 安全与隐私清单

- [x] 推送内容 ≤ 匿名访客可见范围（`public=1` 才入表）
- [x] 游客只读：`sub_token` 仅能改自己的过滤条件
- [x] **无出站请求** → 没有 SSRF、没有被当刷屏放大器的风险
- [x] 不采集游客身份：不存 IP 明文（只留哈希做限频），不与任何账号关联
- [x] 退订即生效（`revoked`），游客本地删任务即可彻底断开
- [x] 事件写入与业务同事务，不会「通告没变但推了通知」
- [x] 文案字段站内渲染，不透传用户输入到 `hermes send` 的命令行（避免注入）

## 9. 分阶段实施

| 阶段 | 内容 | 工作量 |
|---|---|---|
| **P0** | 事件表 + 8 处埋点 + `changes`（含 `tail`/`text`）+ 限流 + `feed.atom/json` | 0.5–1 天 |
| **P1** | 技能包 `subscribe` 章节 + `favshub-poll.py` + 计划任务示例 + 端到端演示（假 hermes 脚本） | 0.5 天 |
| **P2** | 订阅账本（`deal_subscriptions`）+ 后台「订阅」Tab + MCP 工具 | 1 天 |
| **P3**（可选） | 游客提供回调地址时站点主动 POST（HMAC 签名 + 退避）；以及给没有 Hermes 的游客做 Telegram/飞书直投 | 按需 |

**P0 + P1 就是完整可用的产品**：游客装技能、填目标、加一条 cron，从此 QQ 群里有上新就收到。
P2 只是让**你**能看见有多少人在订阅；P3 是扩张场景，可延后。

## 10. 验收

1. 每条写路径产生**恰好一条**事件，`seq` 严格递增；事务回滚无事件；
2. pending/rejected 通告**不产生**事件；下架事件不含内容快照；
3. `changes`：`tail=1` 只给游标；`since` 分页/`has_more`/越界 400/限流 429；
4. `text` 长度 ≤ 200 且含分享链接；同一事件在多次请求中 `text` 稳定；
5. `feed.atom` 通过 `xmllint`（或 Python `xml.etree`）解析，条目数上限正确；
6. 技能脚本：首次基线不推历史；有新事件推一条；`hermes send` 失败时游标不推进；
7. 模拟 cron 连跑两轮，同一事件**不重复**推送；
8. 现有冒烟（通告 111 / AI 122+124）与 `ts:check`、`build` 全绿。

## 11. 风险与回滚

| 风险 | 处理 |
|---|---|
| 事件表膨胀 | 90 天保留 + `idx_deal_events_created` |
| 游客轮询过频 | 限流 + ETag；文档建议 10 分钟 |
| 文案刷屏 | 脚本侧每日上限 + 合并；站点侧 `public` 只记有意义的变化（`pinned` 默认不进订阅） |
| 埋点漏发 | 收敛在 `utils/token-deals.ts` 的语义函数，端点改动绕不过 |
| 回滚 | `deal_events_enabled=false` 关事件写入；`deal_changes_public=false` 关接口。两者都不动现有通告读写 |

## 12. 新增配置项（`server/utils/constants.ts` 白名单 + 默认值）

```
deal_events_enabled          true    # 事件流总开关
deal_changes_public          true    # 公开增量接口
deal_feed_enabled            true    # Atom / JSON Feed
deal_sub_enabled             false   # 订阅账本（P2），默认关
deal_sub_per_ip_per_day      3
deal_events_retention_days   90
deal_changes_max_limit       100
```

## 13. 待确认

1. 游客的 Hermes **是否支持计划任务 / cron 触发**（或 Hermes 原生有没有「定时跑脚本」）？
   有 → 技能包里直接给任务定义；没有 → 让游客用系统 cron，文档给一行。
2. 游客的 Hermes **是否支持订阅 feed/RSS**？支持的话第一推荐路径是 `feed.atom`，连脚本都不用。
3. 「所有关联机器人」= 一个游客的**多个** QQ 目标（群 + 单聊 + 钉钉）都要收吗？
   若是，脚本支持 `--target` 多值，逐目标 `hermes send`。
4. 你希望游客在站点有个**可管理的订阅记录**（后台能看到 N 人在订阅、各自偏好）吗？
   要 → 做 P2 账本；不要 → 只靠 `changes` 接口，站点完全无状态。
5. 是否需要在 QQ 消息里带**分享短链/追踪参数**（用于统计点击）？（默认不带，保持干净）
