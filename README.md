<p align="center">
  <img src="favshub-nuxt/public/images/favicon.png" alt="FavsHub Logo" width="80" />
</p>

<h1 align="center">FavsHub</h1>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.7-green" alt="版本" />
  <img src="https://img.shields.io/badge/Docker-ready-2496ED?logo=docker" alt="Docker" />
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT" />
  <img src="https://img.shields.io/badge/ext-AGPL--3.0-red" alt="扩展 AGPL-3.0" />
</p>

<p align="center">
  <a href="#它能做什么">功能</a> ·
  <a href="#快速上手">快速上手</a> ·
  <a href="favshub-nuxt/README.md">网站使用与部署</a> ·
  <a href="favshub-ext/README.md">浏览器扩展</a> ·
  <a href="favshub-data-ops/README.md">AI 技能包</a>
</p>

---

## 它能做什么

FavsHub 由 **网站**、可选的 **浏览器扩展**，以及可选的 **AI 技能包** 组成，面向日常「收藏 / 检索 / 提示词」场景：

| 你想… | 用什么 |
|--------|--------|
| 把书签做成卡片主页，按文件夹浏览、搜索 | 网站首页 |
| 用 Google / 百度 / ChatGPT 等一键搜、对比搜 | 顶部搜索栏（约 29 款引擎） |
| 浏览官方/公开导航合集，订阅或导入到自己的书签 | **精选集** |
| 管理 AI 提示词、版本与协作修改 | **PromptPro** |
| 把浏览器里的书签同步到网站 | **FavsHub 扩展** |
| 让 AI 助手直接帮你批量整理数据 | **AI 技能包**（`favshub-data-ops/`） |
| 自己改主题、壁纸、布局；管理自己的数据 | 设置与 `/admin` 后台 |

<div align="center">
  <table>
    <tr>
      <td align="center" width="33%">
        <img src="favshub-nuxt/docs/screenshots/search-engines.png" alt="搜索引擎" width="100%" />
        <br /><em>搜索引擎清单</em>
      </td>
      <td align="center" width="33%">
        <img src="favshub-nuxt/docs/screenshots/search-engine-panel.png" alt="搜索引擎" width="100%" />
        <br /><em>多搜索引擎切换</em>
      </td>
      <td align="center" width="33%">
        <img src="favshub-nuxt/docs/screenshots/prompts.png" alt="提示词" width="100%" />
        <br /><em>AI 提示词管理</em>
      </td>
    </tr>
  </table>
</div>

### 特色：让 AI 直接管你的数据

除了在网页上手动操作，FavsHub 还提供一个可分发的 **AI 技能包**，装进你的 AI 助手（WorkBuddy / Claude Code 等）后，用说话就能做完批量活：

- 「把这 30 个链接存进书签，按主题分好文件夹」
- 「找一下我之前存的那个写周报的提示词」
- 「看看最近有哪些渠道在送免费额度」

助手通过站点开放的 AI 接口（`/api/ai/*` 与 `/api/mcp`）操作，**只碰你自己的数据**：用站点签发的个人令牌（PAT）鉴权，读写强制限定在令牌所属用户；写操作可先 `dry_run` 预演给你过目，删除必须你明确同意。

安装方法与能力清单见 [favshub-data-ops/README.md](favshub-data-ops/README.md)。

---

## 仓库里有什么

```
FavsHub_web/
├── favshub-nuxt/        # 网站 → 用法与部署：favshub-nuxt/README.md
├── favshub-ext/         # 扩展 → 安装与同步：favshub-ext/README.md
├── favshub-data-ops/    # AI 技能包 → 装给 AI 助手：favshub-data-ops/README.md
├── README.md            # 本文件（使用者总览）
└── CLAUDE.md            # 仅开发者 / AI 需要（可忽略）
```

你只需要关心三份用户文档：

1. **网站** → [favshub-nuxt/README.md](favshub-nuxt/README.md)  
2. **扩展** → [favshub-ext/README.md](favshub-ext/README.md)  
3. **AI 技能包**（可选，让 AI 助手直接操作你的数据）→ [favshub-data-ops/README.md](favshub-data-ops/README.md)

---

## 快速上手

### 1. 用 Docker 跑起网站（推荐）

```bash
git clone https://github.com/huanyu-a/FavsHub_web.git
cd FavsHub_web/favshub-nuxt
docker compose up -d
```

浏览器打开 **http://localhost:3090**。

- 首次部署会自动创建内置管理员 `admin_favs`（随机密码写入 `favshub-nuxt/data/.initial-password`，登录请立即改密）；此外第一个注册的用户也会成为**管理员**。
- 数据默认落在 `favshub-nuxt/data/`，容器重启不会丢。
- 更完整的部署、备份、环境变量见 [网站文档 · 部署](favshub-nuxt/README.md#部署)。

### 2. （可选）安装浏览器扩展

1. 先保证网站已可访问，并完成注册登录。  
2. 按 [扩展文档](favshub-ext/README.md) 加载扩展，在扩展设置里填入网站地址与登录凭据。  
3. 一键同步浏览器书签到网站。

### 方式 B：本机开发

需已安装 Node.js ≥ 20 与 pnpm ≥ 9：

```bash
cd favshub-nuxt
pnpm install
pnpm dev          # http://localhost:3000
pnpm build        # 生产构建 → .output/
pnpm preview      # 预览生产构建
```

更完整的环境变量、备份与升级说明见 [网站文档](favshub-nuxt/README.md)。

---

## 典型使用路径

```text
打开网站主页
  → 注册 / 登录
  → 在首页浏览书签、切换搜索引擎
  → 打开「精选集」订阅或导入导航
  → 打开「提示词」管理 Prompt
  → 进入 /admin 管理自己的书签、设置、备份（管理员可管全站）
  → （可选）装扩展，把浏览器书签同步进来
```

权限一句话：

- **访客**：看公开内容（视站点配置而定）。  
- **登录用户**：管自己的书签 / 提示词 / 设置，进 `/admin` 自管。  
- **管理员**：用户、全站配置、官方精选集、备份策略等。

---

## 文档导航

| 文档 | 适合谁 | 内容 |
|------|--------|------|
| [本 README](README.md) | 所有使用者 | 产品是什么、最快怎么跑起来 |
| [favshub-nuxt/README.md](favshub-nuxt/README.md) | 站长 / 日常用户 | 网站功能、Docker 部署、环境变量、备份与安全 |
| [favshub-ext/README.md](favshub-ext/README.md) | 扩展用户 | 安装、连接站点、同步书签、权限与快捷键 |
| [favshub-data-ops/README.md](favshub-data-ops/README.md) | 想让 AI 助手代管数据的用户 | 技能包安装、令牌配置、能力范围与安全边界 |
| 部署与运维 | — | 公开部署要点见 [网站文档 · 部署](favshub-nuxt/README.md#部署)；含密码的服务器 runbook 为本地 `favshub-nuxt/DEPLOY.md`（已 gitignore，不入库） |
| [CLAUDE.md](CLAUDE.md) / 子目录 `CLAUDE.md` | **仅**开发者与 AI | 架构、命令、改代码约定 — **使用产品时不必阅读** |

---

## 许可证与致谢

| 部分 | 许可证 | 说明 |
|------|--------|------|
| 网站 `favshub-nuxt/` | MIT | — |
| 扩展 `favshub-ext/` | AGPL-3.0 | 继承自上游 [zmark-ext](https://github.com/helloxz/zmark-ext)，见[来源与致谢](favshub-ext/README.md#项目来源与致谢) |
| AI 技能包 `favshub-data-ops/` | MIT | 同网站 |

> 仓库根目录的 `LICENSE` 是**默认许可证（MIT）**，适用于网站与 AI 技能包；GitHub 侧栏显示的也是它。
> `favshub-ext/` 目录下另有一份 `AGPL-3.0` 全文，**该目录及其衍生分发以 AGPL-3.0 为准**，不受根许可证覆盖。

感谢 [zmark-ext](https://github.com/helloxz/zmark-ext)（ZMark 浏览器扩展，AGPL-3.0）—— 本仓库的浏览器扩展在它基础上衍生，许可证随之继承；  
感谢 [TabMark-Bookmark-New-Tab](https://github.com/Alanrk/TabMark-Bookmark-New-Tab)、[TMD_Type-Markdown](https://github.com/KoniKee/TMD_Type-Markdown)，以及 Nuxt、Vue、Naive UI、WXT、better-sqlite3 等开源项目。
