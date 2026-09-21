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

## 7.5 更新通告（部分更新，不必删除重建）

修改通告的某个字段时**不要删除重建** —— 删除不可逆，且会丢失投票与评测记录。
`PUT` 是**部分更新**：只传要改的字段，其余字段自动保持原值。

### 场景：把标题里的「邀请 3 人 45 天」删掉

```bash
# 1) 先找到通告 ID
curl -s -H "$AUTH" "$BASE/api/ai/token-deals?q=StepFun"

# 2) 预演：只传 title，看变更差异
curl -s -X PUT -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{ "title": "【新老均享】登录 15 天 ＋ 首次调用 15 天", "dry_run": true }' \
  "$BASE/api/ai/token-deals/<deal_id>"
# → { "dry_run": true, "changes": { "title": { "from": "...含邀请 45 天", "to": "..." } } }

# 3) 确认后正式执行（去掉 dry_run）
curl -s -X PUT -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{ "title": "【新老均享】登录 15 天 ＋ 首次调用 15 天" }' \
  "$BASE/api/ai/token-deals/<deal_id>"
```

响应里的 `changes` 会列出实际改动的字段，`token_deal` 为更新后的完整对象 ——
用 `provider` / `url` / `region` 等字段确认其余内容未被误改。

### 其它常用更新

```bash
# 改免费额度描述
curl -s -X PUT -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{ "quota": "登录 15 天 + 首调 15 天" }' "$BASE/api/ai/token-deals/<deal_id>"

# 更新模型列表（整体替换，不是追加）
curl -s -X PUT -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{ "models": ["step-2", "step-1v"] }' "$BASE/api/ai/token-deals/<deal_id>"
```

### 注意事项

- **只传要改的字段**。传了 `title` 就只改 `title`，不会碰其它字段。
- `models` 是**整体替换**：要保留原有模型需一并列出。
- 普通用户修改已通过审核的通告，状态会回到 `pending`（需管理员重新审核）；
  管理员修改保持原状态。
- 触发条件是「字段实际有变化」；传了与原值相同的值不会导致状态回退。
- 权限：通告作者或管理员。他人通告返回 404（不区分「不存在」与「无权限」）。

---

## 7.6 生成通告分享卡片

把通告渲染成 **900×1200 的竖版图片**，适合发到群聊/朋友圈。
卡片内容与网页端「分享通告」按钮产出的**完全一致**（服务端复用同一份绘制逻辑）。

```bash
# 三种风格：magazine（编辑杂志，默认）/ neon（深色终端）/ clay（暖阳陶土）
curl -H "Authorization: Bearer $FAVSHUB_AI_TOKEN" \
     "$BASE/api/ai/token-deals/deal_1789870204833_tvvzzp/card.png?style=clay" \
     -o stepfun-card.png
```

**注意：这是二进制 PNG，不是 JSON** —— 必须用 `curl -o` 落盘，
不要接 `jq`，也不要试图解析响应体文本。

核对生效风格与缓存状态：

```bash
curl -sI -H "Authorization: Bearer $FAVSHUB_AI_TOKEN" \
     "$BASE/api/ai/token-deals/<id>/card.png?style=neon" \
  | grep -iE "content-type|content-length|x-card"
# content-type: image/png
# content-length: 168542
# x-card-style: neon
# x-card-cached: miss      ← 首次渲染；再请求一次会变 hit
```

要点：

- 卡片上会自动带上**详情页二维码**，扫码直达对应通告；
- 需要 `read` scope 即可，无需 write/delete；
- 未审核通过的通告，仅作者与管理员能取到（他人 `403`）；
- 渲染结果有缓存（按通告 `updated_at` 自动失效）；调试时可加 `refresh=1` 强制重绘；
- 首次请求某风格约 100~300ms，命中缓存后 <10ms。

> 想让卡片显示渠道图标？先确保该域名 favicon 已缓存（站点后台「批量下载图标」），
> 否则卡片回退为服务商首字母占位（不影响出图）。

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

## 9.5 检查并更新技能自身

技能包带版本号。站点提供公开清单（**无需令牌**），含全部文件正文。

```bash
# 查看站点分发的技能版本与最近变更
curl -s "$BASE/skills/favshub-data-ops.json" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const m=JSON.parse(s);
      console.log("站点分发版本:", m.version, "| 站点版本:", m.site_version);
      console.log("最近变更:"); (m.changelog[0]?.changes||[]).forEach(c=>console.log("  -", c));
      console.log("文件:", m.files.map(f=>f.path).join(", "));});'

# 或直接从 describe 拿（需令牌）
curl -s -H "$AUTH" "$BASE/api/ai/describe" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.stringify(JSON.parse(s).skill,null,2)));'
```

### 判断是否需要更新

把清单的 `version` 与本技能 `SKILL.md` frontmatter 的 `version` 比较：

- 相同 → 已最新，无需动作
- 清单更高 → 有新版本，**先展示 `changelog` 给用户，获得同意后再更新**

### 执行更新（一次请求写全部文件）

```bash
curl -s "$BASE/skills/favshub-data-ops.json" -o /tmp/favshub-skill.json
node -e '
const fs = require("fs"), path = require("path");
const m = JSON.parse(fs.readFileSync("/tmp/favshub-skill.json", "utf8"));
const dir = process.argv[1];
let n = 0;
for (const f of m.files) {
  if (f.path.includes("..")) throw new Error("路径非法: " + f.path);
  fs.writeFileSync(path.join(dir, f.path), f.content);
  n++;
}
console.log("已更新到 v" + m.version + "（" + n + " 个文件）");
' "<本技能所在目录>"
```

**更新纪律**：只覆盖清单列出的文件（不删本地新增文件）→ 写入前校验路径无 `..`
→ 更新后告知用户新版本号与主要变更。

---

## 10. 错误排查对照

| 现象 | 原因 | 处理 |
|---|---|---|
| 401 `令牌类型无效` | 用了登录凭证而非 PAT | 改用 `favs_ai_` 开头的令牌 |
| 401 `令牌无效、已吊销或已过期` | 令牌被吊销或过期 | 到站点重新创建 |
| 403 `该令牌缺少 write 权限` | 令牌权限不足 | 用更高权限令牌，或告知用户 |
| 404 反复出现 | ID 错误，或资源属于他人 | 先列表确认 ID |
| 409 | 同用户下 URL 重复 | 视为已存在，跳过或改用 PUT 更新 |
| 429 | 触发限频（600 次/分钟） | 退避重试 |
