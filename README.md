<p align="center">
  <img src="favshub-nuxt/public/images/favicon.png" alt="FavsHub Logo" width="80" />
</p>

<h1 align="center">FavsHub</h1>

<p align="center">
  <strong>智能书签管理与 AI 提示词中心</strong>
</p>

<p align="center">
  🔖 书签导航 · 🔍 搜索引擎聚合 · 📝 PromptPro 提示词管理
</p>

<p align="center">
  <a href="#快速开始">快速开始</a> ·
  <a href="favshub-nuxt/README.md">网站文档</a> ·
  <a href="favshub-ext/README.md">扩展文档</a>
</p>

---

## 项目简介

FavsHub 是一个**网站 + 浏览器扩展**项目，提供一站式书签管理和 AI 提示词管理：

- **🔖 书签导航** — 将浏览器书签转化为精美的可视化卡片网格，支持文件夹分类、拖拽排序、标签管理
- **🔍 搜索引擎聚合** — 内置 29 款搜索引擎（通用搜索、AI、社交），一键切换，多窗口对比检索
- **📝 PromptPro** — 专业级 AI 提示词管理，版本追踪、差异对比、文件夹分类、标签筛选、协作审核

<div align="center">
  <table>
    <tr>
      <td align="center" width="33%">
        <a href="favshub-nuxt/docs/screenshots/homepage.png">
          <img src="favshub-nuxt/docs/screenshots/homepage.png" alt="首页 — 书签导航" width="100%" />
        </a>
        <br />
        <em>🔖 书签导航 — 可视化卡片网格</em>
      </td>
      <td align="center" width="33%">
        <a href="favshub-nuxt/docs/screenshots/search-engine-panel.png">
          <img src="favshub-nuxt/docs/screenshots/search-engine-panel.png" alt="搜索引擎面板" width="100%" />
        </a>
        <br />
        <em>🔍 搜索引擎聚合 — 29 款引擎一键切换</em>
      </td>
      <td align="center" width="33%">
        <a href="favshub-nuxt/docs/screenshots/prompts.png">
          <img src="favshub-nuxt/docs/screenshots/prompts.png" alt="提示词管理" width="100%" />
        </a>
        <br />
        <em>📝 PromptPro — 提示词管理与协作</em>
      </td>
    </tr>
  </table>
</div>

## 项目结构

```
FavsHub_web/
├── favshub-nuxt/         # 网站前端 + 后端 API（Nuxt 3 全栈）
├── favshub-ext/          # 浏览器扩展（Vue 3 + WXT）
├── .github/              # GitHub Actions CI/CD
├── AGENTS.md             # AI 开发指南
├── CLAUDE.md             # Claude Code 开发指南
└── README.md             # 本文件
```

| 目录 | 技术栈 | 说明 |
|------|--------|------|
| [favshub-nuxt/](favshub-nuxt/) | Nuxt 3 + Vue 3 + SQLite + Docker | 网站主体，前端页面 + 后端 API + 数据库 |
| [favshub-ext/](favshub-ext/) | Vue 3 + WXT + TypeScript + Naive UI | 浏览器扩展，书签同步到网站 |

## 快速开始

### 网站部署（Docker 推荐）

```bash
# 克隆仓库
git clone https://github.com/huanyu-a/FavsHub_web.git
cd FavsHub_web/favshub-nuxt

# Docker Compose 一键启动
docker compose up -d
```

访问 `http://localhost:3090`，注册第一个用户自动成为管理员。

详细部署方式见 [favshub-nuxt/README.md](favshub-nuxt/README.md)。

### 本地开发

```bash
cd favshub-nuxt
pnpm install
pnpm dev          # http://localhost:3000
```

### 浏览器扩展

```bash
cd favshub-ext
pnpm install
pnpm dev          # Chrome 开发模式
```

在 `chrome://extensions/` 加载 `favshub-ext/.output/chrome-mv3/` 目录。

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `NUXT_JWT_SECRET` | JWT 签名密钥（生产务必修改） | `please-change-this-to-a-random-string` |
| `NUXT_DB_PATH` | SQLite 数据库路径 | `./data/favshub.db` |
| `NUXT_CORS_ORIGIN` | CORS 允许来源 | `*` |
| `NUXT_ADMIN_USERS` | 管理员用户名（逗号分隔） | 空（首个注册用户为管理员） |

## 许可证

- **网站** (`favshub-nuxt/`)：ISC License
- **浏览器扩展** (`favshub-ext/`)：AGPL-3.0 License

## 致谢

- [TabMark-Bookmark-New-Tab](https://github.com/Alanrk/TabMark-Bookmark-New-Tab) — 原项目参考
- [TailwindCSS](https://tailwindcss.com/) · [Naive UI](https://www.naiveui.com/) · [Sortable.js](https://sortablejs.github.io/Sortable/) · [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) · [WXT](https://wxt.dev/)
