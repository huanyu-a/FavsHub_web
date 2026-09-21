# FavsHub AI 数据操作 Skill

<p align="center">
  <a href="../README.md">← 仓库总览</a> ·
  <a href="../favshub-nuxt/README.md">网站使用与部署</a> ·
  <a href="#安装">安装</a> ·
  <a href="#安全边界">安全边界</a>
</p>

一个 **AI 技能包（SKILL.md）**：把 FavsHub 站点的数据读写能力教给你的 AI 助手，让它能帮你批量整理书签、管理提示词、发布 Token 通告 —— 全程走站点的 AI 数据接口，用令牌鉴权。

> 不能单独使用：需要一个可访问的 [FavsHub 站点](../favshub-nuxt/README.md)（自托管或你管理的实例），以及一张该站点签发的 **个人访问令牌（PAT）**。

---

## 它能做什么

| 资源 | 助手能做的事 |
|------|-------------|
| **书签** | 查询 / 单条或批量（≤50）新增 / 改标题、描述、换文件夹 / 删除 |
| **文件夹** | 建目录树、改名、调整层级、删除（删除文件夹不会删里面的书签） |
| **提示词** | 增删改查、收藏、版本号自动递增、回收站恢复 |
| **标签** | 列标签、新建（同名幂等）；删除仅管理员 |
| **Token 通告** | 查公开通告、发布自己渠道的免费额度信息、**更新**（改标题/额度等）、删除、**生成分享卡片图片** |
| **盘点** | 一次拿全部资源计数，先摸清规模再动手 |

写操作统一支持 `dry_run` 预演：先返回"将要发生什么"给你确认，再真正执行。删除则必须显式确认。

---

## 安装

### 前提

1. 有一个可访问的 FavsHub 站点（例如 `https://你的域名` 或 `http://localhost:3000`）
2. 在该站点注册并登录过
3. 已创建一张 **PAT 令牌**：登录站点 → 管理后台 → API 令牌 → 创建 → 选权限 → **立即复制明文**

   > 令牌形如 `favs_ai_xxxxxxxx...`，**明文只在创建时显示一次**，关掉就看不到了。

4. 你使用的 AI 助手支持 `SKILL.md` 技能包（WorkBuddy / CodeBuddy / Claude Code 等均可）

### 装到 WorkBuddy / CodeBuddy

用户级（所有项目都能用）：

```bash
# macOS / Linux
mkdir -p ~/.workbuddy/skills
cp -r favshub-data-ops ~/.workbuddy/skills/

# Windows PowerShell
Copy-Item -Recurse favshub-data-ops "$env:USERPROFILE\.workbuddy\skills\"
```

项目级（只在某个项目里生效）：把整个目录复制到该项目的 `.workbuddy/skills/` 下。

### 装到 Claude Code

```bash
# 用户级
mkdir -p ~/.claude/skills
cp -r favshub-data-ops ~/.claude/skills/

# 项目级
cp -r favshub-data-ops 你的项目/.claude/skills/
```

### 其它助手

只要它支持 `SKILL.md` 格式，把 `favshub-data-ops/` 整个目录放进它的技能目录即可 —— 目录名保持 `favshub-data-ops`。

### 验证是否生效

装好后，在对话里问一句：

```
用 favshub 技能查一下我书签的统计
```

助手若先去请求 `/api/ai/describe` 自检，就说明加载成功了。

---

## 配置

技能需要两个值：

| 配置项 | 说明 |
|--------|------|
| `FAVSHUB_BASE_URL` | 站点地址，如 `https://hao.bx9y.com.cn`（本地开发 `http://127.0.0.1:3000`） |
| `FAVSHUB_AI_TOKEN` | 你创建的 PAT，形如 `favs_ai_xxxxxxxx...` |

两种给法任选：

- **环境变量**（助手支持时推荐）：设置上面两个变量
- **对话里直接说**："站点是 `https://xxx`，令牌是 `favs_ai_xxx`"

---

## 安全边界

技能本身内置了硬性约束，安装后也会强制遵守：

| 机制 | 说明 |
|------|------|
| **通道隔离** | AI 接口只认 `favs_ai_` 令牌；登录密码（JWT）不能用，令牌也碰不到登录、用户管理等普通接口 |
| **数据隔离** | 所有读写强制限定在令牌所属用户，碰他人数据一律返回 404 |
| **权限分级** | `read` < `write` < `delete`，高等级含低等级；**含删除权限的令牌仅管理员可签发** |
| **写前预演** | 写操作默认可 `dry_run:true`，先看变更清单再执行 |
| **删除需确认** | 删除必须带 `confirm: true`，且助手**必须先征得你同意**；不支持批量删除 |
| **限频** | 每令牌 600 次/分钟 |
| **输出脱敏** | 助手回答中不会出现站点服务器的物理部署信息（IP、部署路径、数据库绝对路径等），只以「站点数据库 / API 接口」这类逻辑名引用来源 |

你要做的两件事：**不要把令牌写进代码、日志或提交到仓库**；怀疑泄漏时到站点吊销并重建。

---

## 目录里有什么

| 文件 | 给谁看 |
|------|--------|
| `SKILL.md` | **给 AI 助手**：完整接口速查、权限规则、错误码、安全红线、自更新流程 |
| `examples.md` | **给 AI 助手**：常见任务的可复制命令示例 |
| `CHANGELOG.md` | **给人看**：版本变更历史 |
| `README.md` | 本文件，**给人看**：安装与配置说明 |

---

## 版本与更新

技能包带语义化版本号（`SKILL.md` frontmatter 的 `version`）。站点提供公开清单用于自查与自动更新：

```
GET {BASE}/skills/favshub-data-ops.json
```

清单里含 **全部文件的完整正文** 与各自的 SHA-256，所以更新只需一次请求 —— AI 助手可直接把新内容写入技能目录。

### 让助手自己更新

在对话里说：

```
检查 favshub 技能是否有新版本，有就更新
```

助手会：读 `describe` 的 `skill` 字段（或直接拉清单）→ 比较版本号 → 展示变更 → **征得你同意后**覆盖文件。

### 手工更新

```bash
curl -s https://你的站点/skills/favshub-data-ops.json -o /tmp/skill.json
node -e '
const fs=require("fs"),path=require("path");
const m=JSON.parse(fs.readFileSync("/tmp/skill.json","utf8"));
for(const f of m.files){ if(f.path.includes(".."))throw 0; fs.writeFileSync(path.join(process.argv[1],f.path),f.content); }
console.log("已更新到 v"+m.version);
' ~/.workbuddy/skills/favshub-data-ops
```

### 版本号规则

| 变更类型 | 版本位 | 例 |
|---|---|---|
| 接口破坏性变更（旧调用会失败） | 主版本 | `1.x.x` → `2.0.0` |
| 新增能力（向后兼容） | 次版本 | `1.0.x` → `1.1.0` |
| 文案修正与勘误 | 修订号 | `1.1.0` → `1.1.1` |

更新前请留意 `site_version` 字段：它标记清单对应的站点版本，与你的站点差距过大时，可能意味着接口有变，建议同步升级站点。

---

## 许可证

**MIT**，与网站一致 —— 全文见 [LICENSE](LICENSE)。
