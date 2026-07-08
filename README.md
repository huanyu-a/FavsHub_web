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
- **🎨 15 套主题** — 浅色/暗色/壁纸背景，完整 CSS 变量主题系统，跟随系统或手动切换
- **🔒 安全防护** — Rate Limiting、SSRF 防护、CSP 安全头、密码策略、JWT 自动生成与持久化

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
├── TMD_ref/              # 主题配色参考项目（Type-Markdown Editor）
├── .github/              # GitHub Actions CI/CD
├── AGENTS.md             # AI 开发指南（通用）
├── CLAUDE.md             # Claude Code 开发指南
└── README.md             # 本文件
```

| 目录 | 技术栈 | 说明 |
|------|--------|------|
| [favshub-nuxt/](favshub-nuxt/) | Nuxt 3 + Vue 3 + SQLite + Docker | 网站主体，前端页面 + 后端 API + 数据库 |
| [favshub-ext/](favshub-ext/) | Vue 3 + WXT + TypeScript + Naive UI | 浏览器扩展，书签同步到网站 |
| [TMD_ref/](TMD_ref/) | React 18 + Vditor + Tauri | 主题配色参考项目（FavsHub 的 15 套主题灵感来源） |

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

JWT 密钥首次启动时自动生成并持久化到 `data/.jwt-secret`，无需手动配置。生产环境建议通过环境变量 `NUXT_JWT_SECRET` 覆盖。

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
| `NUXT_JWT_SECRET` | JWT 签名密钥。留空则首次启动自动生成并持久化到 `data/.jwt-secret` | 自动生成（48 字节随机） |
| `NUXT_DB_PATH` | SQLite 数据库路径 | `./data/favshub.db` |
| `NUXT_CORS_ORIGIN` | CORS 允许来源 | `http://localhost:3000` |
| `NUXT_ADMIN_USERS` | 管理员用户名（逗号分隔） | 空（首个注册用户为管理员） |
| `NUXT_TRUST_PROXY` | 是否信任反向代理的 X-Forwarded-For | `false` |

## 安全特性

- **JWT 密钥管理** — 环境变量优先 → 持久化文件回退 → 自动生成，48 字节随机密钥
- **Rate Limiting** — 登录/注册接口频率限制，5 次失败后账户锁定 15 分钟
- **CSP 安全头** — X-Content-Type-Options、X-Frame-Options、Referrer-Policy、CSP 等完整安全头
- **SSRF 防护** — favicon 下载限制协议、重定向次数、IP 黑名单
- **密码策略** — 可配置最小密码长度（默认 8 位），bcrypt 哈希存储
- **JWT 可配置过期** — 默认 7 天，通过系统配置调整
- **错误脱敏** — 生产环境隐藏 5xx 错误细节，防止信息泄露

## 许可证

- **网站** (`favshub-nuxt/`)：ISC License
- **浏览器扩展** (`favshub-ext/`)：AGPL-3.0 License

## 致谢

- [TabMark-Bookmark-New-Tab](https://github.com/Alanrk/TabMark-Bookmark-New-Tab) — 原项目参考
- [TMD_Type-Markdown](https://github.com/KoniKee/TMD_Type-Markdown) — 主题配色参考
- [TailwindCSS](https://tailwindcss.com/) · [Naive UI](https://www.naiveui.com/) · [Sortable.js](https://sortablejs.github.io/Sortable/) · [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) · [WXT](https://wxt.dev/)
