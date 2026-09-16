# FavsHub 数据操作 — 常见任务示例

所有示例假设已配置：

```bash
BASE=https://hao.bx9y.com.cn
TOKEN=favs_ai_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
AUTH="Authorization: Bearer $TOKEN"
```

---

## 1. 接入自检（第一步）

```bash
curl -s -H "$AUTH" "$BASE/api/ai/describe" | head -60
```

确认 `caller.scopes` 包含所需权限，并读取 `resources` 了解字段。

---

## 2. 盘点当前数据

```bash
curl -s -H "$AUTH" "$BASE/api/ai/stats"
```

返回各类资源计数（书签 / 文件夹 / 提示词 / 回收站 / 标签 / 通告），便于规划后续操作。

---

## 3. 批量导入书签（先预演再执行）

**场景**：用户给了一批链接，要求存进 FavsHub 的「工具」文件夹。

**第一步 — 查文件夹 ID**

```bash
curl -s -H "$AUTH" "$BASE/api/ai/folders?q=工具"
```

**第二步 — 预演**

```bash
curl -s -X POST -H "$AUTH" -H 'Content-Type: application/json' \
  "$BASE/api/ai/bookmarks" \
  -d '{
    "dry_run": true,
    "items": [
      { "title": "Nuxt 文档", "url": "https://nuxt.com/docs", "folder_id": 12 },
      { "title": "H3 文档",   "url": "https://h3.dev",        "folder_id": 12 }
    ]
  }'
```

返回 `{ "dry_run": true, "planned_count": 2, "changes": [...] }`。
**把 changes 呈现给用户确认。**

**第三步 — 正式执行**（去掉 `dry_run`）

```bash
curl -s -X POST -H "$AUTH" -H 'Content-Type: application/json' \
  "$BASE/api/ai/bookmarks" \
  -d '{ "items": [ ...同上... ] }'
```

返回 `{ "created": [...], "count": 2 }`。

---

## 4. 搜索并整理书签

**找出某个关键词的书签**

```bash
curl -s -H "$AUTH" "$BASE/api/ai/bookmarks?q=github&limit=50"
```

**把它们移动到另一个文件夹**

```bash
# 对每条书签
curl -s -X PUT -H "$AUTH" -H 'Content-Type: application/json' \
  "$BASE/api/ai/bookmarks/1234" \
  -d '{ "folder_id": 20, "dry_run": true }'   # 先预演

curl -s -X PUT -H "$AUTH" -H 'Content-Type: application/json' \
  "$BASE/api/ai/bookmarks/1234" \
  -d '{ "folder_id": 20 }'
```

**新增文件夹**

```bash
curl -s -X POST -H "$AUTH" -H 'Content-Type: application/json' \
  "$BASE/api/ai/folders" -d '{ "name": "AI 工具" }'
```

---

## 5. 删除书签（必须先确认）

```bash
# 1) 先向用户确认：是否删除「XXX」这条书签？
# 2) 可先预演看将被删除的内容
curl -s -X DELETE -H "$AUTH" -H 'Content-Type: application/json' \
  "$BASE/api/ai/bookmarks/1234" -d '{ "confirm": true, "dry_run": true }'

# 3) 用户确认后执行
curl -s -X DELETE -H "$AUTH" -H 'Content-Type: application/json' \
  "$BASE/api/ai/bookmarks/1234" -d '{ "confirm": true }'
```

> 缺少 `confirm` 会返回 400；`delete` 权限仅管理员令牌具备。

---

## 6. 创建提示词（含标签）

```bash
# 先建/取标签（同名幂等，重复调用安全）
curl -s -X POST -H "$AUTH" -H 'Content-Type: application/json' \
  "$BASE/api/ai/tags" -d '{ "name": "写作" }'
# → { "tag": { "id": "uuid...", "name": "写作" } }

# 创建提示词
curl -s -X POST -H "$AUTH" -H 'Content-Type: application/json' \
  "$BASE/api/ai/prompts" \
  -d '{
    "title": "公众号标题生成器",
    "content": "你是一位资深新媒体编辑……",
    "description": "根据主题生成 10 个候选标题",
    "tags": ["uuid..."]
  }'
```

**更新正文会自动产生新版本**（版本号自增），无需手动处理。

**误删恢复**（软删除后可恢复）：

```bash
curl -s -X PUT -H "$AUTH" -H 'Content-Type: application/json' \
  "$BASE/api/ai/prompts/<id>" -d '{ "restore": true }'
```

---

## 7. 浏览 Token 白嫖通告

```bash
# 全部（已审核公开 + 自己发布的）
curl -s -H "$AUTH" "$BASE/api/ai/token-deals?limit=20"

# 只看国内直连 + 上品及以上
curl -s -H "$AUTH" "$BASE/api/ai/token-deals?region=cn&quality=上品"

# 只看自己发布的（含待审核）
curl -s -H "$AUTH" "$BASE/api/ai/token-deals?mine=true"
```

**发布一条通告**：

```bash
curl -s -X POST -H "$AUTH" -H 'Content-Type: application/json' \
  "$BASE/api/ai/token-deals" \
  -d '{
    "provider": "某服务商",
    "title": "新用户赠送 100 万 token",
    "url": "https://example.com/free",
    "call_url": "https://api.example.com/v1",
    "quota": "100 万 token / 新用户",
    "models": ["gpt-4o-mini", "claude-haiku"],
    "region": "global",
    "quality": "中品",
    "source_tag": "official",
    "note": "需注册后绑定手机号"
  }'
```

> 管理员发布直接上线；普通用户发布进入待审核队列。

---

## 8. MCP 通道调用

```bash
# 握手
curl -s -X POST -H "$AUTH" -H 'Content-Type: application/json' \
  "$BASE/api/mcp" \
  -d '{ "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": { "protocolVersion": "2025-06-18" } }'

# 列出工具
curl -s -X POST -H "$AUTH" -H 'Content-Type: application/json' \
  "$BASE/api/mcp" \
  -d '{ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }'

# 调用工具
curl -s -X POST -H "$AUTH" -H 'Content-Type: application/json' \
  "$BASE/api/mcp" \
  -d '{ "jsonrpc": "2.0", "id": 3, "method": "tools/call",
        "params": { "name": "list_bookmarks", "arguments": { "limit": 5 } } }'
```

返回结构：`result.content[0].text` 为 JSON 字符串，`result.structuredContent` 为同内容的对象形式。

---

## 9. 错误排查对照

| 现象 | 原因 | 处理 |
|---|---|---|
| 401 `令牌类型无效` | 用了登录凭证而非 PAT | 改用 `favs_ai_` 开头的令牌 |
| 401 `令牌无效、已吊销或已过期` | 令牌被吊销或过期 | 到站点重新创建 |
| 403 `该令牌缺少 write 权限` | 令牌权限不足 | 用更高权限令牌，或告知用户 |
| 404 反复出现 | ID 错误，或资源属于他人 | 先列表确认 ID |
| 409 | 同用户下 URL 重复 | 视为已存在，跳过或改用 PUT 更新 |
| 429 | 触发限频（600 次/分钟） | 退避重试 |
