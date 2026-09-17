# FavsHub AI Skill — 数据操作能力方案（评审稿）

> 分支：`feature/ai-skill`（独立演进，不合并 main）
> 日期：2026-09-16
> 状态：待寰宇评审

## 0. 目标与结论（TL;DR）

**目标**：让 AI 助手（WorkBuddy / Claude / 任意支持 HTTP 调用的 AI 客户端）能通过一份"skill"安全地读写 FavsHub 站点数据（书签、文件夹、提示词、Token 通告等）。

**推荐架构**：`站点新增 /api/ai/* 专用 API 层 + PAT 令牌鉴权 + 审计日志 + 仓库内 SKILL.md 操作手册`。

**核心安全原则**：AI 永远不直接碰数据库、不拿到用户密码/JWT；只能通过带 scope 的可撤销令牌访问高层 API；一切操作留痕、可限频、可回滚。

---

## 1. 为什么是这个架构（三个候选对比）

| 候选 | 说明 | 结论 |
|---|---|---|
| **A. REST API + PAT + Skill 文档**（推荐） | 站点新增 AI 专用 REST 前缀，AI 按文档发 HTTP 请求 | ✅ 复用现有 H3/better-sqlite3 全套设施，零新增运行时依赖，任何 AI 客户端可用 |
| B. MCP Server（streamable HTTP） | 在 Nitro 里实现 MCP endpoint，AI 走 MCP 协议 | ⏸ 二期可选。MCP 是好东西，但要多实现一层协议握手；且不是所有客户端都支持远程 MCP |
| C. 裸 SQL / 直接开放 SQLite | AI 直接执行 SQL | ❌ 绝对禁止。注入、误删、越权全部不可控 |

选 A 的关键理由：站点已有一套成熟的 REST API 与安全设施（限频器 `server/utils/rate-limit.ts`、URL scheme 白名单、folder 归属校验、软删除），AI 层只需"站在肩膀上"重新封装一层带审计的入口，而不是另起炉灶。

---

## 2. 总体架构

```
AI 客户端（WorkBuddy skill / Claude / 脚本）
   │  Authorization: Bearer favs_ai_xxxxxxxx
   ▼
┌─────────────────────────────────────────┐
│  /api/ai/*  （AI 专用前缀，与 /api/* 隔离）│
│  ┌───────────────────────────────────┐  │
│  │ 中间件：requireAiAuth             │  │
│  │  1. PAT 校验（SHA-256 比对）       │  │
│  │  2. scope 检查（read/write/delete）│  │
│  │  3. token 级限频（默认 60/min）     │  │
│  │  4. 审计落库                       │  │
│  └───────────────────────────────────┘  │
│  端点：describe / bookmarks / folders   │
│        / prompts / token-deals / stats  │
│  （复用现有 service 层逻辑，强制         │
│   WHERE user_id = token.user_id）       │
└─────────────────────────────────────────┘
   ▼
better-sqlite3（现有库，新增 2 张系统表）
```

**通道隔离铁律**：
- 用户 JWT 只能访问 `/api/*`，**不能**访问 `/api/ai/*`
- PAT 只能访问 `/api/ai/*`，**不能**访问 `/api/*`（包括登录、管理后台）
- 两条通道互不重叠，泄漏一个不影响另一个

---

## 3. 数据库新增表（2 张）

### 3.1 `api_tokens`（PAT 令牌）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK | |
| user_id | INTEGER | 归属用户，外键 users |
| name | TEXT | 令牌用途名（如 "workbuddy-布谷"） |
| token_hash | TEXT | SHA-256(明文)，**明文永不落库** |
| token_prefix | TEXT | 前 8 字符，用于列表展示识别 |
| scopes | TEXT(JSON) | `["read"]` / `["read","write"]` / `["read","write","delete"]` |
| rate_limit_per_min | INTEGER | 默认 60 |
| last_used_at | INTEGER | |
| expires_at | INTEGER | 可空 = 永久；建议默认 90 天 |
| created_at / revoked_at | INTEGER | revoked_at 非空即失效 |

**令牌格式**：`favs_ai_` + 43 字符 base64url（32 字节 CSPRNG 随机）。只在创建响应里出现一次。

### 3.2 `ai_audit_logs`（审计日志）

| 字段 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK | |
| token_id / user_id | INTEGER | 冗余 user_id 便于按人查 |
| method / path | TEXT | 如 `POST /api/ai/bookmarks` |
| body_digest | TEXT | 请求体摘要（截断 512 字符，敏感字段脱敏） |
| status_code | INTEGER | |
| duration_ms | INTEGER | |
| ip | TEXT | |
| created_at | INTEGER | |

> 审计表只增不改，保留策略：默认全量保留（个人站量级可控）。

---

## 4. API 设计（AI 友好三原则：自描述、可预演、批量有上限）

```
GET    /api/ai/describe                # 能力清单 + 数据字典（AI 第一步永远先调这个）
GET    /api/ai/stats                   # 各表计数盘点
GET    /api/ai/bookmarks?q=&folder_id=&label=&limit=&offset=
POST   /api/ai/bookmarks               # 单条或批量（items 数组，≤50/批）；支持 dry_run
PUT    /api/ai/bookmarks/:id           # 部分字段更新；支持 dry_run
DELETE /api/ai/bookmarks/:id           # 需 delete scope + body {confirm: true}
GET/POST/PUT/DELETE  /api/ai/folders          # 同构
GET/POST/PUT/DELETE  /api/ai/prompts          # prompts 删除走软删除（复用 deletedAt）
GET/POST             /api/ai/token-deals       # 通告投稿（status 恒 pending，走人工审核）
GET/POST/PUT/DELETE  /api/ai/tags
```

**设计细节**：
- `dry_run: true` → 返回"将执行的变更"但不写库。AI 呈现给用户确认后再真执行。
- 批量操作上限 50 条/请求，超出直接 400。
- 所有写端点复用现有校验逻辑：URL scheme 白名单（拒绝 `javascript:`/`data:` 等）、字段长度限制、folder 归属校验、`normalizeUrl` 去重。
- `GET /api/ai/describe` 返回：端点清单、字段字典（复用 `schema.ts` 注释）、错误码表、使用红线。AI 客户端无需预装知识。

**明确不暴露的表**：`users`（密码哈希！）、`settings`、`system_config`、`api_tokens` 本身。搜索引擎管理（admin/search-engines）暂不开放。

---

## 5. 安全设计（威胁模型驱动）

| # | 威胁 | 对策 |
|---|---|---|
| T1 | 令牌泄漏（AI 配置文件、聊天记录里带出去） | ① 明文只显示一次；② 随时可撤销；③ 可设过期时间；④ SHA-256 存储泄漏库也难还原；⑤ 令牌级限频限制损害面 |
| T2 | 越权操作他人数据 | 令牌绑定 user_id，所有 SQL 强制 `WHERE user_id = ?`；admin 级操作（如全局书签管理）需要单独 `admin` scope 且默认不发 |
| T3 | AI 误操作批量删数据 | ① `delete` scope 单独显式授予；② 删除必须 `confirm:true`；③ 一期不做批量删除；④ prompts 软删除可恢复；⑤ 写上限 50 条/批 |
| T4 | 暴力猜测令牌 | 32 字节熵（2^256）+ 无效尝试按 IP+前缀限频 |
| T5 | SQL 注入 / 存储型 XSS | 全参数化 SQL（现有模式）；URL scheme 白名单；字段长度上限 |
| T6 | 审计被规避 | 鉴权中间件里写审计，业务代码无法绕过 |
| T7 | 审计/日志泄敏 | 令牌明文永不落库落日志；审计 body 截断脱敏 |
| T8 | 普通用户自助发 token 骚扰公共池 | write scope 创建的书签继承现有规则：非 admin 用户强制 `login_required=1`（私有），无法污染游客可见内容 |

**与站点现有安全设施的衔接**：限频直接复用 `checkRateLimit()`（内存 Map，单实例部署符合现状）；`/api/**` 的 `no-store` 缓存头天然覆盖 `/api/ai/**`；CORS 维持现状（AI 客户端非浏览器场景不受影响）。

---

## 6. Skill 交付物（本仓库根 `favshub-data-ops/`）

```
favshub-data-ops/
├── SKILL.md          # AI 操作手册：能力清单、API 文档、数据字典、
│                     #   安全红线（先查后写、删除必先征得用户确认）、错误处理
├── examples.md       # 常见任务的操作序列示例（盘点、批量导入、清理）
└── README.md         # 给人看的安装说明：怎么装到 WorkBuddy / Claude Code
```

使用方式：把整个目录复制进 WorkBuddy / Claude Code 的 skills 目录即可，详见其中的 `README.md`。配置项只有两个：`FAVSHUB_BASE_URL` 和 `FAVSHUB_AI_TOKEN`。

---

## 7. 实施阶段（每阶段独立可验证）

| 阶段 | 内容 | 验证方式 |
|---|---|---|
| P1 最小可用 | `api_tokens` 表 + 迁移、`requireAiAuth` 中间件、审计表、`/api/ai/describe` + bookmarks 四个端点 | smoke 脚本（复制库到临时路径跑） |
| P2 全量端点 | folders / prompts / token-deals / tags + 用户设置页的令牌管理 UI | smoke 扩展 |
| P3 Skill | `SKILL.md` + `examples.md` + `scripts/ai-api-smoke.mjs` | 本地起服务 + AI 实测一轮 |
| P4 可选 | MCP streamable HTTP endpoint（包装同一 service 层）；`DELETE bookmarks` 软删除化 | 按需 |

**smoke 断言必须覆盖的安全用例**（P1 起就要有）：
- 无 token / 错 token → 401；JWT 访问 `/api/ai/*` → 401（通道隔离）
- read-only token 发写请求 → 403
- 操作他人 user_id 的数据 → 403 或空结果（越权）
- 超过批量上限 → 400
- `dry_run` 不落库（前后 count 不变）
- 删除不带 confirm → 400
- 限频触发 → 429
- 审计表有对应记录、明文 token 不在任何表/日志中出现

---

## 8. 迁移安全（遵守 2026-09-16 铁律）

- 新增 2 张表的 `CREATE TABLE` 各自独立 `try/catch`，不进大 exec 块
- 幂等判断用 `PRAGMA table_xinfo` 统一走 `ensureColumn()`
- 上线前：生产库 `.backup` → 本地副本跑迁移 → 端到端冒烟 → 再推服务器
- 预期基线变化：20 表 / 51 索引 → **22 表 / 52+ 索引**

---

## 9. 明确不做的事（一期红线）

1. ❌ AI 直接执行 SQL
2. ❌ AI 操作用户账号体系（建号、提权、改密码）
3. ❌ 批量删除
4. ❌ admin 管理面 API（审核、备份、全局配置）——观察一期使用情况再说
5. ❌ 修改 `system_config` / 注册开关 / TDK
