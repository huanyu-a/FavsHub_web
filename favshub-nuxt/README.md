<p align="center">
  <img src="public/images/favicon.png" alt="FavsHub" width="72" />
</p>

<h1 align="center">FavsHub 网站</h1>

<p align="center">
  书签导航 · 搜索聚合 · 精选集 · AI 提示词 · 个人/管理后台
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.7-blue" alt="版本" />
  <img src="https://img.shields.io/badge/Docker-ready-2496ED?logo=docker" alt="Docker" />
</p>

<p align="center">
  <a href="../README.md">← 仓库总览</a> ·
  <a href="#功能一览">功能</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#部署">部署</a> ·
  <a href="../favshub-ext/README.md">浏览器扩展</a>
</p>

<div align="center">
  <img src="docs/screenshots/search-engine-panel.png" alt="搜索引擎面板" width="49%" />
  <img src="docs/screenshots/prompts.png" alt="AI 提示词管理" width="49%" />
</div>

---

## 这是什么

这是 FavsHub 的 **网站本体**：你打开的浏览器主页、搜索框、精选集、提示词页，以及数据存储与登录，都由本目录提供。  
若要把 **Chrome / Edge 里的书签同步进来**，请再安装配套扩展：[favshub-ext](../favshub-ext/README.md)。

面向角色：

| 角色 | 你通常会做什么 |
|------|----------------|
| 访客 | 浏览公开主页、公开精选集 / 提示词（视管理员配置） |
| 登录用户 | 管理自己的书签与提示词、改主题与布局、进 `/admin` 自管 |
| 管理员 | 用户与全站配置、官方精选集、搜索引擎审核、备份与 SEO 等 |
| 自托管站长 | Docker / 本机部署、环境变量、备份与升级 |

> **文档分工：** 本页给**使用者与站长**。改代码、API 路由、数据库 schema 等见本目录 [CLAUDE.md](CLAUDE.md)（开发者 / AI）。

---

## 功能一览

### 书签导航

- 文件夹树 + 卡片网格，拖拽排序  
- 右键：新标签打开、复制链接、二维码、编辑 / 删除（本人）  
- 可设「登录后可见」；支持批量打开等操作  

### 搜索引擎聚合

- 内置约 29 款：通用搜索、AI、社交媒体  
- 一键切换；支持多引擎对比搜索  
- 用户可提交新引擎，由管理员审核；管理员可设默认引擎与排序  

### 精选集

- 浏览公开 / 官方导航合集  
- **订阅**：在首页以 tab 形式切换查看  
- **导入**：把合集书签复制到自己的书签空间  
- 管理员可维护官方精选集与合集内书签  

### AI 提示词（PromptPro）

- 文件夹、标签、收藏、搜索  
- 自动版本记录，可对比与还原  
- 对公开提示词可提交修改请求，管理员审核通过后生效  

### Token 白嫖通告

- 汇总各家大模型 API 的免费额度与中转福利，按品质、地区、来源筛选  
- 登录后可发布通告，经管理员审核后公开  
- 一人一票 + 一人一评：可点赞、可打分写评测，重复提交视为更新  
- 支持按热度 / 评分 / 临期排序；管理员可置顶优质通告  
- **一键分享卡片**：详情页「分享」生成竖版 3:4 信息卡 PNG（含渠道信息与详情页二维码），三种风格可切换（杂志 / 终端 / 暖阳），移动端可长按保存到相册  

### AI 数据操作（API 令牌）

- 在 **管理后台 → API 令牌** 创建个人访问令牌（PAT），让 Claude Code、Cherry Studio 等外部 AI 助手直接读写你的书签、文件夹、提示词、标签与 Token 通告  
- **明文令牌只显示一次**，站点只存哈希；遗失后重新创建即可  
- 权限分三级：`read`（查询）→ `write`（创建 / 更新）→ `delete`（删除）；`delete` 权限**仅管理员**可签发  
- 所有操作严格限定在令牌所属账号内，**AI 无法访问他人数据**  
- 写操作支持「预演」（`dry_run`）：先看将要发生的变更，确认后再真正执行；删除必须显式确认，单次批量上限 50 条  
- 除 REST 接口外还提供 **MCP 端点**（`/api/mcp`），可被支持 MCP 的客户端直接接入  
- 想省掉手搓请求？仓库带了一个可直接装进 AI 助手的 **技能包** —— 助手读完就懂全部接口与规则：见 [favshub-data-ops/README.md](../favshub-data-ops/README.md)

### 外观与多端

- 11 套主题（7 浅色 / 4 深色：墨夜·星云·极光·紫藤）  
- 壁纸：预设 / 必应日图 / 上传  
- 卡片尺寸、布局可调；移动端有适配布局  

### 账号与后台

- 注册登录；首次部署自动创建内置管理员 `admin_favs`（随机密码写入 `data/.initial-password`，仅 root 可读）。**仅当站内已无任何管理员时**，第一个注册用户才会兜底成为管理员（防站点锁死）；正常情况下新注册账号都是普通用户，需由管理员在后台提权  
- 所有登录用户可访问 `/admin` 管理**自己的**数据（后台长页均有回到顶部按钮）  
- 管理员额外：用户、系统配置、备份计划、全站内容、API 令牌等  

---

## 截图

### 前台

| | |
|:--:|:--:|
| ![搜索引擎面板](docs/screenshots/search-engine-panel.png) | ![搜索引擎清单](docs/screenshots/search-engines.png) |
| *搜索引擎面板* | *搜索引擎清单* |
| ![提示词](docs/screenshots/prompts.png) | |
| *AI 提示词管理* | |

### 后台（登录后 `/admin`）

| | |
|:--:|:--:|
| ![提示词后台](docs/screenshots/admin-prompts.png) | ![编辑提示词](docs/screenshots/admin-prompt-edit.png) |
| *提示词管理* | *提示词编辑* |
| ![审核](docs/screenshots/admin-review-requests.png) | ![备份](docs/screenshots/admin-backup.png) |
| *审核请求* | *备份* |
| ![设置](docs/screenshots/admin-settings.png) | ![系统配置](docs/screenshots/admin-config.png) |
| *用户设置* | *系统配置* |

---

## 快速开始

### 环境要求

- **Docker 部署**：Docker + Docker Compose  
- **本机开发 / 预览**：Node.js ≥ 20 且 **< 22**、pnpm ≥ 9

> ⚠️ Node.js 22+ 与 better-sqlite3 原生模块不兼容（NODE_MODULE_VERSION mismatch）。开发必须用 Node 20 或 21；Docker 镜像已锁定 `node:20-alpine`。  

### 方式 A：Docker（日常自托管推荐）

在仓库的 `favshub-nuxt` 目录：

```bash
docker compose up -d
```

浏览器打开：**http://localhost:3090**

1. 打开站点 → 注册账号（第一人 = 管理员；Docker 首次部署还会预置 `admin_favs`，随机密码见 `data/.initial-password`）  
2. 登录后在首页 / 设置中调整主题与书签  
3. 需要同步浏览器书签时，安装 [扩展](../favshub-ext/README.md) 并填写本站地址
4. 站点图标默认从各站点抓取并本地化（存 `data/favicons/`，属运行时数据、不入库）；首次部署后可在 **后台 → 书签管理 → 批量下载图标** 批量补齐
5. 生产环境请先阅读 [DEPLOY.md](DEPLOY.md)（SSH、镜像仓库、升级流程）

数据目录默认映射到 `./data`（数据库、JWT 密钥、备份、本地化图标 `data/favicons` 等）。**请定期备份 `data/`。**

### 方式 B：本机开发

在 `favshub-nuxt` 目录：

```bash
pnpm install
pnpm dev          # http://localhost:3000
pnpm build        # 生产构建 → .output/
pnpm preview      # 预览生产构建
```

首次启动会自动创建 `data/favshub.db` 与 JWT 密钥文件。

更完整的环境变量、备份与升级说明见 [部署文档](DEPLOY.md)。

## 部署

详细部署流程见 [DEPLOY.md](DEPLOY.md)（本目录内的本地文档，含服务器密码，已 gitignore、不入库）。本节仅概述核心概念。

### Docker Compose 要点

编排文件为目录内 **`compose.yaml`**（`docker compose up -d` 会自动读取）。典型映射：

- 主机 `3090` → 容器 `3000`
- 卷：`./data` → 容器内数据目录
- 环境变量：JWT、CORS、管理员名单等（见下表）

```bash
docker compose up -d
docker compose logs -f
curl -s http://localhost:3090/api/health
```

### 部署方式

- **镜像**：`ghcr.io/huanyu-a/favshub:<标签>`；推送 `VERSION` 文件变更触发 CI 自动构建
- **本地打镜像（可选）**：`pnpm build && bash build.sh`，再 `docker tag/save | gzip`

### 环境变量

| 变量 | 作用 | 默认 / 建议 |
|------|------|-------------|
| `NUXT_JWT_SECRET` | 登录令牌签名密钥 | 空则首次启动自动生成并写入 `data/.jwt-secret`；**生产建议显式设置** |
| `NUXT_DB_PATH` | SQLite 路径 | `./data/favshub.db`（容器内多为 `/opt/favshub/data/...`） |
| `NUXT_CORS_ORIGIN` | 允许的跨域来源 | 开发默认 `http://localhost:3000`；上线改为你的站点源 |
| `NUXT_ADMIN_USERS` | 额外管理员用户名（逗号分隔） | 空；内置 `admin_favs` 已足够，仅特殊场景需要 |
| `NUXT_TRUST_PROXY` | 是否信任反向代理的客户端 IP | `false`；前面有 Nginx 等再按需开启 |

### 备份与升级

- 后台 **备份管理**：手动下载、定时备份
- 健康检查：`GET /api/health`
- 升级流程：备份 `data/` → 拉新镜像 → `compose up` → 启动自动迁移 → 验证首页与登录

### Nexus 评测排序同步（可选）

Token 通告默认按热度 / 评分排序。若想让 **`/tokens` 支持「已接入 Nexus 优先」排序**（置顶 → 已接入启用 → 已接入禁用 → 未接入，同档按可用率降序、耗时升序），需要一个定时脚本把上游 new-api 的渠道清单与每日评测结果同步进本站库的两张表 `nexus_channels` / `nexus_deal_map`。

脚本 `scripts/nexus-sync/sync-nexus.py` **在服务器宿主上运行**，不是容器内：容器里没有 `sqlite3`，上游库与评测目录也不在容器挂载范围内。

**配置方式**：所有路径都写进同目录的 `nexus-sync.env`，**不用改脚本**。仓库只提供模板 `nexus-sync.env.example`，真实配置不入库：

```bash
cd scripts/nexus-sync
python3 sync-nexus.py --init-config     # 从模板生成 nexus-sync.env（已存在则跳过）
# 编辑 nexus-sync.env，把各项改成你自己的路径
python3 sync-nexus.py --print-config    # 确认最终生效值与来源
python3 sync-nexus.py --dry-run         # 只打印匹配结果，不写库
python3 sync-nexus.py                   # 正式写入
```

配置项（`nexus-sync.env` 键名 = 环境变量名 = 命令行参数名）：

| 键 | 含义 | 模板默认（占位，务必改） |
|----|------|--------------------------|
| `NEWAPI_DB` | 上游 new-api 的 SQLite 库（只读其 `channels` 表） | `/opt/app/new-api/data/one-api.db` |
| `EVAL_DIR` | 评测结果目录（内含 `eval_latest.json` 等） | `/opt/app/eval_api` |
| `FAVSHUB_DB` | 本站 FavsHub 的 SQLite 库（写入 `nexus_*` 两张表） | `/opt/app/data/favshub.db` |
| `OWN_DOMAINS` | 你自己的域名，逗号分隔；命中的 deal 不参与匹配，避免自家域互相误匹配 | `bx9y.com.cn` |
| `EVAL_FILES` | 参与聚合的评测文件名，逗号分隔 | `eval_latest.json,channel_eval_latest.json` |

**优先级**：命令行参数 > 环境变量 > `nexus-sync.env` > 内置默认。因此也能临时覆盖，不必改文件：

```bash
python3 sync-nexus.py --newapi-db /your/one-api.db --eval-dir /your/eval_api --dry-run
```

**定时**：建议在评测跑完之后（如每日 08:30）由 cron 触发，日志落盘便于排查：

```cron
30 8 * * * /usr/bin/python3 /path/to/scripts/nexus-sync/sync-nexus.py >> /var/log/nexus-sync.log 2>&1
```

> 提示：默认值只是 `/opt/app/...` 占位符，**首次部署务必先 `--init-config` 改成自己的真实路径**，否则脚本会因找不到库而报错退出（报错信息会指明该改哪个键）。若 `nexus_deal_map` 表不存在，`/tokens` 会自动降级为普通排序，不影响使用。

---

## 日常怎么用（简表）

| 场景 | 操作 |
|------|------|
| 当新标签页用 | 把浏览器主页 / 新标签设为你的 FavsHub 地址 |
| 整理书签 | 登录 → 首页或 `/admin/bookmarks` 增删改、文件夹 |
| 换搜索引擎 | 主页搜索框旁切换；管理员在后台改列表与默认 |
| 用别人整理好的导航 | 打开精选集 → 订阅或导入 |
| 存 AI 提示词 | 提示词页 / 后台提示词管理 |
| 找免费模型额度 | 打开 Token 白嫖通告，按品质 / 地区筛选；登录后可发布、投票、写评测 |
| 改主题壁纸 | 设置或侧栏用户相关入口 |
| 同步浏览器书签 | 安装扩展 → 配置网站地址并登录 → 同步 |

---

## 安全说明（站长须知）

- 登录 / 注册有频率限制；多次失败会短时锁定  
- 密码 bcrypt 存储；最小长度可在系统配置中调整（默认约 8 位）  
- JWT 可配置过期时间（默认约 7 天）  
- 生产环境隐藏详细 5xx 信息；favicon 拉取有 SSRF 限制  
- **API 令牌**：明文只返回一次、库中仅存 SHA-256 哈希；令牌只能操作所属账号的数据，删除权限仅管理员可签发；AI 接口有独立限频并记录审计日志（不记录请求内容）  
- 建议：HTTPS、强 `NUXT_JWT_SECRET`、限制 CORS、定期备份  

---

## 与扩展的关系

| | 网站 | 扩展 |
|--|------|------|
| 作用 | 展示与管理、账号、精选集、提示词 | 读浏览器书签并上传到网站 |
| 必须？ | 是（核心） | 否（可手写书签或仅用精选集导入） |
| 配置 | 部署本服务 | 在扩展设置中填写本站 URL 与账号 |

详见 [浏览器扩展 README](../favshub-ext/README.md)。

---

## 许可证

**MIT License**（本网站目录，全文见 [LICENSE](LICENSE)）。  
AI 技能包同为 **MIT**；配套扩展为 **AGPL-3.0**（继承自上游 [zmark-ext](../favshub-ext/README.md#项目来源与致谢)）。
