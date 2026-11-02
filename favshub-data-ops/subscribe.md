# 通告订阅：把 FavsHub 的新通告推到我的机器人（Hermes 方案）

> 本文为 **Hermes 专属订阅指南**。读完这一页，你的 AI 助手即可实现：**站点一有新的白嫖通告（或额度变更、下架、续期），自动通过 Hermes 广播到你的 QQ 群 / 单聊。**

---

## 核心架构与设计原则

FavsHub 的白嫖通告随时在变：有人发新的、有人续期、有人下架、社区投票判定失效。
用户不想天天刷网站，想让**自己的 QQ 机器人**在变化发生时第一时间收到通知。

**关键事实与安全边界**：
> 站点**不主动向外推送**。站点只提供「有变化了」的数据出口，投递由**用户在本机通过 Hermes 统一完成**。

```
站点公开出口 (/api/token-deals/changes 或 feed.atom)
                    │  Hermes 本机定时轮询增量
                    ▼
          你的机器（运行 Hermes）
                    │  统一多通道投递
                    ▼
       hermes send -t qqbot:<群OpenID> "【上新】..."
```

### 为什么优先推荐 Hermes 方案？
1. **零代码与框架级统一**：无需自行编写或维护脆弱的轮询脚本与依赖库，由 Hermes 集中管理机器人通道、网络超时、格式解析与凭证保密；
2. **多通道支持**：支持 QQ 官方机器人（`qqbot:`）、钉钉（`dingtalk:`）、飞书、Telegram 等，同一份通告可通过 `hermes send` 一键广播到多个不同平台；
3. **零封号风险**：Hermes 对接的是腾讯 QQ 官方开放平台（OpenAPI API v2）或企业通道，合法合规，无第三方协议冻结封号风险；
4. **凭证隔离与安全性**：机器人 AppSecret 仅保存在本机 Hermes 配置中，不向 FavsHub 站点泄漏；FavsHub 仅作为只读数据源，安全性最高。

---

## 接入方式对比与选型

| 接入方式 | 适合场景 | 优势 | 局限 |
|---|---|---|---|
| **路径 A：Hermes Feed 订阅（推荐新手）** | 已运行 Hermes，需要快速订阅 | **零代码**，直接在 Hermes 订阅管理中添加 Atom/RSS 链接即可 | 仅同步「上新 / 变更 / 续期」，收不到下架事件 |
| **路径 B：Hermes 技能 + CLI 驱动（推荐群主）** | 需要全量事件（含下架/脱敏）、自定义过滤与多群广播 | **全功能支持**，支持按服务商/分类/关键词深度过滤，支持精确游标跟踪 | 需配置一次订阅与 Hermes 定时任务 |

---

## 路径 A：Hermes 原生 Feed 订阅（零代码）

FavsHub 提供符合标准规范的 Feed 出口：

```http
GET https://hao.bx9y.com.cn/api/token-deals/feed.atom          # Atom 1.0 标准格式
GET https://hao.bx9y.com.cn/api/token-deals/feed.json          # JSON Feed 1.1 标准格式
```

### 使用方式：
1. 在你的 Hermes 管理后台或配置文件中，添加 Feed 订阅源：
   - URL：`https://hao.bx9y.com.cn/api/token-deals/feed.atom`
   - 投递目标：`qqbot:<你的群OpenID>`（或私聊目标）
   - 轮询间隔：建议设置为 `5m` 或 `10m`
2. **按需过滤（可选）**：
   若只想订阅特定服务商（如仅免费云服务器或特定大模型），可先按「路径 B 第 1 步」创建订阅获得 `sub_token`，随后在 Feed 链接后附加 `?token=<sub_token>`，Feed 会自动继承该订阅的所有过滤规则！

---

## 路径 B：Hermes 技能 + CLI 投递（全事件推荐）

通过调用站点增量事件流接口，由 Hermes 驱动投递，能捕获包括 **下架、续期、变更、置顶** 在内的完整生命周期事件。

### 第 1 步：创建订阅，获取专属凭证与起步游标

在终端向 FavsHub 站点发起一次请求（无需登录注册，游客直接可用）：

```bash
curl -sS -X POST https://hao.bx9y.com.cn/api/deal-subscriptions \
  -H 'content-type: application/json' \
  -d '{
    "label": "我的QQ通告群",
    "filters": {
      "kinds": ["online", "offline", "updated", "renewed", "pinned"]
    }
  }'
```

返回示例：
```json
{
  "success": true,
  "sub_token": "sub_tok_abc123456789...",
  "baseline_seq": 105,
  "subscription": {
    "label": "我的QQ通告群",
    "changes_url": "https://hao.bx9y.com.cn/api/token-deals/changes?token=sub_tok_abc123456789...&since_seq={since_seq}"
  }
}
```

> **关键要点**：
> - `sub_token`：你的订阅私钥，仅在此处返回一次，请妥善保管。
> - `baseline_seq`：**初始基线游标**。初次拉取时必须以该游标为起点，避免把站点的历史通告全量轰炸进群内。

### 第 2 步：增量拉取通告事件

Hermes 或定时任务每次根据上次保存的 `last_seq` 发起增量拉取：

```bash
curl -sS "https://hao.bx9y.com.cn/api/token-deals/changes?token=YOUR_SUB_TOKEN&since_seq=105&limit=20"
```

响应字段中：
- `events[].text`：已为您排版渲染完毕的**单行纯文本通告**（开头带 `【上新】`、`【变更】`、`【下架】` 等标签，已做 200 字长度护栏与安全脱敏，最适合 QQ 群聊）；
- `events[].markdown`：带标题、粗体、字段列表与跳转链接的 Markdown 富文本（适合支持 Markdown 卡片的群聊或频道）；
- `cursor.next_seq`：下一次轮询的新游标。若 `has_more: true`，可继续拉取直到取完。

### 第 3 步：使用 `hermes send` 投递到 QQ 群

Hermes 提供了极其简洁的标准发送 CLI：

```bash
# 发送群聊消息（纯文本）
hermes send -t qqbot:<群OpenID> "【上新】服务商名称｜某免费额度通告标题..."

# 多通道广播（同时推 QQ 官方群与钉钉群）
hermes send -t qqbot:<群OpenID_1>,dingtalk:<钉钉Token> "【上新】..."
```

#### Hermes 返回结果判定：
使用 `--json` 参数调用 `hermes send` 时，请务必以返回 JSON 中的 `"success": true` 作为投递成功的唯一依据：
```json
{
  "success": true,
  "message_id": "ROBOT1.0_xxxxxx"
}
```

---

## QQ 官方机器人群聊权限注意（重要）

无论使用哪种 Hermes 投递模式，将 QQ 官方机器人加入群聊后：
1. **群主必须在手机 QQ 进群设置 →「群机器人」→ 点击该机器人 → 开启【机器人主动在群聊内发言】**；
2. 若未开启该开关，平台将直接拒绝主动发言并返回错误码 `40034105`；
3. 官方频控规则：每个群单日最多接收 **1000 条** 主动消息，单群频控 **20 次/分钟**，完全满足日常通告推送。
