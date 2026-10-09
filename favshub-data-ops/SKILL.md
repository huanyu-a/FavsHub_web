---
name: favshub-data-ops
version: 1.7.0
description: >
  通过 FavsHub 的 AI 数据接口读写站点数据 —— 书签、文件夹、提示词、标签、Token 白嫖通告、福利 Key。
  支持 REST（/api/ai/*）与 MCP（/api/mcp）两条通道，同一套 PAT 令牌鉴权。
  所有操作限定于令牌所属用户，写操作支持 dry_run 预演，删除必须显式确认。
  TRIGGER: "favshub 书签", "操作 favshub 数据", "把书签导入 favshub", "favshub 提示词管理",
  "favshub api token", "favshub mcp", "整理我的 favshub 书签", "批量添加书签到 favshub",
  "favshub token 通告", "更新 favshub 通告", "查询 favshub 数据", "更新 favshub 技能",
  "favshub 分享卡片", "生成通告卡片", "favshub card.png",
  "favshub 福利 Key", "上报 favshub key", "favshub token key".
agent_created: true
---

# FavsHub 数据操作

通过站点提供的 AI 数据接口，安全地读写 FavsHub（书签 / 提示词 / Token 通告）中的数据。

## 何时用

- 用户要求"把一批链接存到 FavsHub"、"整理/清理我的书签"、"在 FavsHub 建个文件夹"
- 用户要求"把这些提示词存进 FavsHub"、"找一下我之前存的某个提示词"
- 用户要求"看看有哪些免费额度通告"、"帮我发一条 Token 通告"
- 用户要求"上报一批探测到的福利 Key 到站点"、"看看站点有哪些可用的福利 Key"
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

**先判类型，再取字段**：返回里**数组与对象混用**——`endpoints`、`recommended_workflow` 是**数组**；
`rules`、`resources`、`errors`（以 HTTP 状态码为键）、`caller`、`scopes`、`skill` 是**对象**。
写检查脚本前先确认形态（JS `Array.isArray(x)`、Python `isinstance(x, list)`）：对数组调 `.keys()`、对对象按下标取，都会抛错。

**检查脚本必须真的跑起来**：断言要放在会执行、且失败即中止的路径上。异常被 `try` 吞掉、或代码根本没走到，
却仍按旧假设输出结论，等于没检查。**推断不等于事实**——得出「清单里少了某端点」「服务端漏登记」这类结论前，
先把命中项打印出来跑一次真实检查，再向用户陈述；把"看起来像"当事实说出去，错误结论会沿下游传导。
（实例：曾有客户端把 `endpoints` 当 dict 调 `.keys()`，异常被吞后报出「describe 漏登记 edits 端点」的假缺陷 ——
实际 29 条端点里 edits 占 5 条，一直是齐的。）

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
**唯一的例外是通告**：通告内容允许所有人修改，但必须走**修改建议**通道（见 Token 通告小节）——
他人**已公开**通告的直接 PUT 返回 **403 并给出建议通道指引**（按指引提交建议即可，不必找用户要管理员令牌）；
直接 DELETE 返回 403（下架他人通告只能由创建者/管理员操作）。

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
PUT    /api/ai/token-deals/:id  { title?, provider?, url?, call_url?, quota?, models?, region?, quality?, source_tag?, expires_at?, note?, dry_run? }
DELETE /api/ai/token-deals/:id  { confirm: true, dry_run? }
GET    /api/ai/token-deals/:id/card.png?style=&refresh=   # 分享卡片（PNG 二进制）

# ── 修改建议（提案通道）：普通用户对他人/管理员通告的唯一修改路径 ──
POST   /api/ai/token-deals/:id/edits      { <要改的字段...>, comment?, dry_run? }   # 提交建议（write）
GET    /api/ai/token-deals/:id/edits      ?status=pending|approved|rejected|all     # 某通告的建议列表（read）
GET    /api/ai/token-deal-edits           ?limit=&page=                             # 「待我审核」的建议（read）
POST   /api/ai/token-deal-edits/:id/review { action: 'approve'|'reject', reason?, dry_run? }   # 审核（write，作者/管理员）
DELETE /api/ai/token-deal-edits/:id       # 撤回自己的待审建议（write）
```

- 列表默认返回公开的已审核通告 + 自己发布的全部（含待审核）
- 管理员发布直接上线（`approved`）；普通用户发布进入待审核（`pending`）
- `region`: `cn` | `global`；`quality`: 上上品 | 上品 | 中品 | 下品 | 下下品；`source_tag`: `official` | `relay` | `community`
- **`PUT` 是部分更新**：只传要改的字段，未传字段保持原值 —— 改标题不必回填其余字段
- 作者编辑已通过审核的通告会回到 `pending` 重新审核；管理员编辑保持原状态
- `models` 若传入则**整体替换**（不是追加）

#### 修改他人（含管理员）创建的通告 —— 提交修改建议

站点规则：**通告内容允许所有人修改，但需经「通告作者」或「管理员」审核后才生效。**
因此普通用户令牌对他人通告**不能直接 `PUT`**（会收到 403 + 本小节指引），正确做法：

1. `POST /api/ai/token-deals/:id/edits`，**只传要改的字段**（可选 `comment` 说明修改理由），先 `dry_run:true` 预演差异；
2. 正式提交后建议进入待审队列 —— **通告内容在通过前保持原样**；同一人对同一通告只保留一条待审建议，再次提交即覆盖；
3. 用 `GET /api/ai/token-deals/:id/edits?status=pending` 跟踪自己的建议状态；
4. 通告作者或管理员审核：`POST /api/ai/token-deal-edits/:id/review` `{ action:'approve'|'reject', reason? }`；
5. 想反悔：`DELETE /api/ai/token-deal-edits/:id` 撤回（仅待审状态）。

MCP 工具同名同参数：`submit_token_deal_edit` / `list_token_deal_edits` / `list_reviewable_token_deal_edits` / `review_token_deal_edit` / `withdraw_token_deal_edit`。

> 发现他人通告信息过期/有误时，**绝不要「删除重建」**：新通告会丢失原通告的投票、评测与链接。
> 提交一条修改建议就够了。

#### 分享卡片（生成图片）

```
GET /api/ai/token-deals/:id/card.png?style=poster
```

- **返回 `image/png` 二进制**（900×1200），不是 JSON —— 用 `curl -o` 直接落盘，不要 `jq`
- `style` 六选一：`poster` 夜幕鎏金海报（默认）| `magazine` 编辑杂志 | `neon` 深色终端 | `clay` 暖阳陶土 | `blast` 喜报爆款 | `voucher` 卡券票根
- 卡片内容与网页端「分享通告」面板**完全同源**（同一份绘制逻辑），含：服务商 + 品质 + 标题 + 免费额度 + 有效期 + 模型 + Nexus 实测 + 投票/评分 + 备注 + 详情页二维码
- 响应头 `x-card-style`（实际生效风格）、`x-card-cached`（`hit`/`miss`）便于核对
- 渲染有缓存，通告更新后自动失效；`refresh=1` 可强制重绘
- 未审核通过的通告仅作者与管理员可取（`403`）
- 需要 `read` scope

```bash
# 落盘到本地
curl -H "Authorization: Bearer $FAVSHUB_AI_TOKEN" \
     "https://<站点域名>/api/ai/token-deals/<id>/card.png?style=clay" \
     -o deal-card.png

# 核对响应头（缓存命中 / 生效风格）
curl -sI -H "Authorization: Bearer $FAVSHUB_AI_TOKEN" \
     "https://<站点域名>/api/ai/token-deals/<id>/card.png" | grep -i "x-card"
```

### 福利 Key

```
POST /api/ai/token-keys   { key_hash, base_url?, key_masked?, key_plain?, post_time?, provider?,
                            models?, source?, confidence?, verdict?, source_id?, source_tid?,
                            source_url?, source_title?, consecutive_failures?, last_probe_at?,
                            first_seen_at?, note?, dry_run? }   # 上报快照（write）
POST /api/ai/token-keys/prune   { keep: [{key_hash, base_url}, …], confirm: true }  # 对账清理（delete，仅管理员）
GET  /api/token-keys            # 公开脱敏列表（无需令牌）
GET  /api/token-keys/{id}/copy  # 复制专用：{ key_plain, base_url } 完整值（无需令牌）
```

- **用途**：采集端（爬虫 / 探测器）把「福利 Key」的最新探测快照上报到站点；服务端按
  `(key_hash, base_url)` **幂等 upsert** —— 已存在则更新探测结论，不存在则新建（重复上报不产生重复行）
- **审核语义**：普通用户令牌上报 → `pending`（待审）；**管理员令牌上报 → 直接 `published`**
- **2026-10-08 协议变更**：上报改传 `key_plain` **明文**（供站点「复制 Key」链路）与 `post_time`
  （原帖发帖时间原文字符串）；`key_encrypted` 密文**不再过网**（上行传了也会被忽略）
- **公开展示**：仅 `published` 行进入公开脱敏列表 `GET /api/token-keys`（**无需令牌**，
  15 字段白名单：`id / key_masked / verdict / confidence / provider / base_url / models / source /
  source_id / source_tid / source_url / source_title / first_seen_at / last_probe_at / post_time`；
  `base_url` 中的 key 形态片段已服务端遮蔽）；`pending`（待审）与 `hidden`（下架）永不外流
- **给用户提供完整 Key / API 地址**：调 `GET /api/token-keys/{id}/copy`（与列表同可见口径：
  `published`、非 `dead`、回帖指引限 24h；指引行恒 404），响应 `{ key_plain, base_url }`
  —— 明文 key 只在此响应出现，**取到后直接交给用户，不要写入日志或过程输出**
- `verdict` 枚举：`valid` 有效 | `quota` 额度耗尽 | `limited` 限次 | `dead` 失效 |
  `unknown` | `restricted` | `blocked_by_waf` | `endpoint_unsupported` |
  `tls_invalid` TLS 异常（中转站证书过期/自签，请求死在握手，与凭证无关）
- **时间戳为秒**：`first_seen_at` / `last_probe_at` 等沿采集端语义存**秒**
  （站点其余表是毫秒），不要混用
- 支持 `dry_run: true` 预演；响应返回 `{ token_key: {…白名单字段, deal_status}, upserted, status, message }`
- **绝对红线**：明文 key、`key_hash`、`key_encrypted` **绝不出现在任何日志、报告或响应正文**；
  上报报错时也只会返回通用校验错误，不会回显敏感值
- 该通道暂无对应 MCP 工具（REST 专用）；`describe` 的 `endpoints` 清单会同步列出

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
| 403 | scope 不足 / 越权写他人文件夹 / 非管理员专属操作 / **越权直接编辑他人已公开通告（响应会给出建议通道）** | scope 不足→告知用户重建更高权限令牌；通告→按指引提交修改建议 |
| 404 | 资源不存在或不属于当前令牌（隐私资源不区分二者） | 不要反复重试，确认 ID；**通告收到 403 时按建议通道走，不要删除重建** |
| 409 | 唯一约束冲突（同一用户下 URL 重复） | 视为"已存在"，通常无需报错 |
| 429 | 超出限频（每令牌 600 次/分钟） | 退避重试 |
| 500 | 服务器内部错误 | 报告用户，勿暴露内部细节 |

错误响应格式统一为 `{ "error": "中文说明" }`。

## 技能自身版本与更新

本技能包带版本号（见 frontmatter 的 `version`），站点提供公开清单用于自查与自动更新。

### 检查是否有新版本

```bash
curl -s {BASE}/skills/favshub-data-ops.json | head -20
```

清单结构：

| 字段 | 含义 |
|---|---|
| `version` | 站点当前分发的技能版本号 |
| `site_version` | 站点自身版本（用于判断接口是否匹配） |
| `changelog` | 变更历史数组，每项含 `version` / `date` / `changes` |
| `files` | **全部文件的完整正文**，每项含 `path` / `bytes` / `sha256` / `content` |

比较清单的 `version` 与本文件 frontmatter 的 `version`：

- **相同** → 已是最新，无需更新。
- **清单更高** → 有新版本。**先看 `changelog` 告知用户改了什么**，再决定是否更新。
- 若本文件读不到 `version` 字段 → 这是旧版技能包，按新版本更新。

### 自动更新自身

清单已包含全部文件正文，**一次请求即可完成更新**，无需逐个下载：

```bash
# 1) 取清单，查看版本与变更
curl -s {BASE}/skills/favshub-data-ops.json -o /tmp/favshub-skill.json

# 2) 把 files 中每个条目写入技能目录（覆盖同名文件）
#    技能目录 = 本 SKILL.md 所在目录
node -e '
const fs = require("fs"), path = require("path");
const m = JSON.parse(fs.readFileSync("/tmp/favshub-skill.json", "utf8"));
const dir = process.argv[1];
for (const f of m.files) {
  if (f.path.includes("..")) throw new Error("路径非法: " + f.path);  // 防目录穿越
  fs.writeFileSync(path.join(dir, f.path), f.content);
}
console.log("已更新到 v" + m.version + "（" + m.files.length + " 个文件）");
' "<本技能所在目录>"
```

### 更新纪律（重要）

1. **更新前先征得用户同意**，并说明变更内容（从 `changelog` 摘取）。
2. **只覆盖清单中列出的文件**，不删除目录内其它文件 —— 用户可能有自己的本地补充。
3. **写入前校验路径不含 `..`**，防止清单被篡改导致任意文件写入。
4. **不要用清单内容覆盖用户自己新增的配置**（如本地令牌说明）；只更新 `SKILL.md`、`README.md`、`examples.md`、`CHANGELOG.md`、`LICENSE`。
5. 更新后**告知用户新版本号与主要变更**；若 `site_version` 与用户站点不匹配，提示可能需要同步升级站点。
6. 清单是公开资源，**不含任何令牌或用户数据**，可以安全请求。

## 安全红线（不可逾越）

1. **不向用户以外的人暴露令牌**；不把令牌写入代码、日志、提交到仓库。
2. **删除前必须征得用户明确同意**，并携带 `confirm:true`。删除不可逆（提示词除外，可软删恢复）。
3. **大批量写入前先 `dry_run`**，把变更清单给用户过目。
4. **不改动他人数据**；接口本身也不允许（越权 PUT 已公开通告返回 403，其余返回 404）。
   唯一合法通道是对其提交**修改建议**——建议不算改动他人数据：内容经作者/管理员审核通过才生效，通过前通告不受影响。
5. **不尝试绕过权限**：scope 不足时如实告知用户，不尝试用其他端点变通。
6. 令牌疑似泄漏时，提醒用户到站点吊销并重建。
7. **输出脱敏（硬性）**：回答、报告、文档中**禁止出现站点的物理部署信息** —— 服务器 IP、部署根绝对路径、容器宿主挂载路径、数据库绝对路径、SSH 私钥路径、环境变量文件真值。
   - 引用数据来源时只写**逻辑名**：如「站点数据库」「公开 API `/api/ai/*`」，不写 `/www/...` 这类物理路径。
   - 内部表名（如 `token_deals`）可讲，**表所在文件的绝对路径不可讲**。
   - 真值只允许出现在**执行命令**里，不进入输出正文。
   - 本规则同时适用于「渠道清单 / 通告列表」这类汇总性回答的 `Sources` 脚注。

## 常见任务

见同目录 `examples.md`。
