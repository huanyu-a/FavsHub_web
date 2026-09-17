---
name: favshub-data-ops
description: >
  通过 FavsHub 的 AI 数据接口读写站点数据 —— 书签、文件夹、提示词、标签、Token 白嫖通告。
  支持 REST（/api/ai/*）与 MCP（/api/mcp）两条通道，同一套 PAT 令牌鉴权。
  所有操作限定于令牌所属用户，写操作支持 dry_run 预演，删除必须显式确认。
  TRIGGER: "favshub 书签", "操作 favshub 数据", "把书签导入 favshub", "favshub 提示词管理",
  "favshub api token", "favshub mcp", "整理我的 favshub 书签", "批量添加书签到 favshub",
  "favshub token 通告", "查询 favshub 数据".
agent_created: true
---

# FavsHub 数据操作

通过站点提供的 AI 数据接口，安全地读写 FavsHub（书签 / 提示词 / Token 通告）中的数据。

## 何时用

- 用户要求"把一批链接存到 FavsHub"、"整理/清理我的书签"、"在 FavsHub 建个文件夹"
- 用户要求"把这些提示词存进 FavsHub"、"找一下我之前存的某个提示词"
- 用户要求"看看有哪些免费额度通告"、"帮我发一条 Token 通告"
- 需要先盘点站点数据规模，再决定操作策略

## 前置配置

| 配置项 | 说明 |
|---|---|
| `FAVSHUB_BASE_URL` | 站点地址，如 `https://hao.bx9y.com.cn`（本地开发为 `http://127.0.0.1:3000`） |
| `FAVSHUB_AI_TOKEN` | 个人访问令牌，形如 `favs_ai_xxxxxxxx...`。在站点 **管理后台 → API 令牌** 创建 |

**令牌获取**：登录站点 → 管理后台 → API 令牌 → 创建令牌 → 选择权限（read / write，删除需管理员）→ **立即复制明文**（只显示一次）。

## 第一步永远是 describe

```
GET {BASE}/api/ai/describe
Authorization: Bearer {TOKEN}
```

返回：能力清单（`endpoints`）、字段字典（`resources`）、规则（`rules`）、错误码（`errors`）、当前令牌身份与权限（`caller`）。
**不要凭记忆猜测字段**——以 describe 的返回为准。

## 核心规则（必须遵守）

### 1. 通道隔离
- AI 接口（`/api/ai/*`、`/api/mcp`）**只接受** `favs_ai_` 开头的 PAT。
- 用户的登录凭证（JWT）无法访问 AI 接口；PAT 也无法访问登录、用户管理等普通接口。
- 令牌泄漏的影响面被限制在"该用户自己的数据"内。

### 2. 权限分级
`read` < `write` < `delete`，高等级自动包含低等级。

| scope | 能力 |
|---|---|
| read | 所有 GET 查询 |
| write | 创建、更新（POST / PUT） |
| delete | 删除（DELETE），**仅管理员可创建含此权限的令牌** |

### 3. 写操作先预演
所有写操作支持 `dry_run: true` —— 只返回将执行的变更（`changes`），不写库。

**推荐流程**：`dry_run:true` 预演 → 把 changes 呈现给用户确认 → 去掉 dry_run 正式执行。

### 4. 删除必须确认
删除端点必须在请求体携带 `{"confirm": true}`，否则返回 400。
**删除前必须先向用户确认**，这是硬性要求。不支持批量删除，一次一条。

### 5. 数据隔离
所有查询与写入强制限定于令牌所属用户。操作他人资源返回 **404**（与"不存在"不区分，避免信息泄露）。

### 6. 可见性
非管理员写入的数据强制 `login_required = 1`（仅自己可见）；管理员可选择公开。

## 端点速查

### 书签

```
GET    /api/ai/bookmarks?q=&folder_id=&label=&limit=&page=
POST   /api/ai/bookmarks        { title, url, folder_id?, icon?, description?, label?, need_proxy?, dry_run? }
                                { items: [ {...}, ... ], dry_run? }   # 批量，≤50 条
PUT    /api/ai/bookmarks/:id    { title?, url?, folder_id?, description?, icon?, sort_order?, need_proxy?, dry_run? }
DELETE /api/ai/bookmarks/:id    { confirm: true, dry_run? }
```

- `url` 仅允许 http/https；同一用户下 URL 唯一（重复 → 409）
- `label`：`''` = 精选集公共池（仅管理员），`'web'` = 个人书签（默认）

### 文件夹

```
GET    /api/ai/folders?q=
POST   /api/ai/folders          { name, parent_id?, icon?, dry_run? }
PUT    /api/ai/folders/:id      { name?, parent_id?, sort_order?, icon?, dry_run? }
DELETE /api/ai/folders/:id      { confirm: true, dry_run? }
```

删除文件夹**不会**删除其中的书签（书签解除归属），子文件夹上提到被删文件夹的父级。

### 提示词

```
GET    /api/ai/prompts?q=&folder_id=&favorite=&limit=&page=
GET    /api/ai/prompts/:id
POST   /api/ai/prompts          { title, content, description?, folder_id?, tags?, dry_run? }
PUT    /api/ai/prompts/:id      { title?, content?, description?, folder_id?, tags?, is_favorite?, restore?, dry_run? }
DELETE /api/ai/prompts/:id      { confirm: true, permanent?, dry_run? }
```

- 内容变更自动创建新版本并自增版本号
- 删除默认**软删除**（进回收站），`PUT` 时传 `restore:true` 可恢复；`permanent:true` 才物理删除
- AI 只能操作**自己创建**的提示词（不能编辑管理员发布的公共提示词）

### 标签

```
GET    /api/ai/tags
POST   /api/ai/tags             { name, color?, dry_run? }      # 同名幂等
DELETE /api/ai/tags/:id         { confirm: true, dry_run? }     # 仅管理员
```

### Token 白嫖通告

```
GET    /api/ai/token-deals?q=&region=&quality=&mine=&limit=&page=
POST   /api/ai/token-deals      { provider, title, url, call_url?, quota?, models?, region?, quality?, source_tag?, expires_at?, note?, dry_run? }
DELETE /api/ai/token-deals/:id  { confirm: true, dry_run? }
```

- 列表默认返回公开的已审核通告 + 自己发布的全部（含待审核）
- 管理员发布直接上线（`approved`）；普通用户发布进入待审核（`pending`）
- `region`: `cn` | `global`；`quality`: 上上品 | 上品 | 中品 | 下品 | 下下品；`source_tag`: `official` | `relay` | `community`

### 盘点

```
GET /api/ai/stats     # 各资源计数（书签 / 文件夹 / 提示词 / 回收站 / 标签 / 通告）
```

### MCP 通道

```
POST /api/mcp         # JSON-RPC 2.0，同一令牌
```

支持 `initialize` / `tools/list` / `tools/call` / `ping`。工具与 REST 端点一一对应（`list_bookmarks`、`create_bookmarks`、`delete_bookmark` 等），参数结构相同。

## 错误码

| 状态码 | 含义 | 处置 |
|---|---|---|
| 400 | 参数非法（缺字段 / 超长 / 危险 URL / 批量超限 / 缺 confirm） | 按返回的 `error` 修正请求 |
| 401 | 令牌缺失、类型错误、无效或已吊销 | 提示用户检查 / 重建令牌 |
| 403 | scope 不足 / 越权写他人文件夹 / 非管理员专属操作 | 告知用户需要更高权限的令牌 |
| 404 | 资源不存在或不属于当前令牌 | 不要反复重试，确认 ID |
| 409 | 唯一约束冲突（同一用户下 URL 重复） | 视为"已存在"，通常无需报错 |
| 429 | 超出限频（每令牌 600 次/分钟） | 退避重试 |
| 500 | 服务器内部错误 | 报告用户，勿暴露内部细节 |

错误响应格式统一为 `{ "error": "中文说明" }`。

## 安全红线（不可逾越）

1. **不向用户以外的人暴露令牌**；不把令牌写入代码、日志、提交到仓库。
2. **删除前必须征得用户明确同意**，并携带 `confirm:true`。删除不可逆（提示词除外，可软删恢复）。
3. **大批量写入前先 `dry_run`**，把变更清单给用户过目。
4. **不改动他人数据**；接口本身也不允许（越权返回 404）。
5. **不尝试绕过权限**：scope 不足时如实告知用户，不尝试用其他端点变通。
6. 令牌疑似泄漏时，提醒用户到站点吊销并重建。

## 常见任务

见同目录 `examples.md`。
