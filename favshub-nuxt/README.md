
<h1 align="center">FavsHub</h1>

<p align="center">
  <strong>智能书签工作台 — 管理收藏、提示词与搜索引擎，一站式搞定</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.3-blue" alt="版本" />
  <img src="https://img.shields.io/badge/Nuxt-3.21-00DC82?logo=nuxt" alt="Nuxt" />
  <img src="https://img.shields.io/badge/Vue-3.5-4FC08D?logo=vue.js" alt="Vue" />
  <img src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/SQLite-003B57?logo=sqlite" alt="SQLite" />
  <img src="https://img.shields.io/badge/Docker-2496ED?logo=docker" alt="Docker" />
</p>

<div align="center">
  <img src="docs/screenshots/homepage.png" alt="首页（访客视图）" width="49%" />
  <img src="docs/screenshots/homepage-logged-in.png" alt="登录后首页" width="49%" />
</div>

---

## 目录

- [功能特性](#功能特性)
- [截图展示](#截图展示)
- [技术栈](#技术栈)
- [快速开始](#快速开始)
- [Docker 部署](#docker-部署)
- [项目结构](#项目结构)
- [浏览器扩展](#浏览器扩展)
- [环境变量](#环境变量)
- [License](#license)

---

## 功能特性

- **智能书签管理** — 文件夹分类、拖拽排序、标签管理、批量操作，让收藏井井有条
- **AI 提示词管理** — 版本追踪、文件夹组织，高效管理你的 AI 提示词库
- **搜索引擎聚合** — 内置 29 款搜索引擎（通用搜索、AI、社交），一键切换，还可自定义排序
- **浏览器扩展同步** — 通过浏览器扩展一键收藏，增量同步到服务器，URL 自动去重
- **多用户支持** — 首个注册用户自动成为管理员，管理面板一览全局
- **深色/浅色主题** — 跟随系统偏好，适配你的视觉习惯
- **Docker 一键部署** — 使用 Docker Compose 快速部署到任何服务器
- **百度网盘备份** — 支持将书签备份到百度网盘（需 Chrome 扩展环境）

---

## 截图展示

<div align="center">
  <table>
    <tr>
      <td align="center" width="50%">
        <a href="docs/screenshots/homepage.png">
          <img src="docs/screenshots/homepage.png" alt="首页（访客视图）" width="100%" />
        </a>
        <br />
        <em>首页 — 访客视图，搜索栏 + 文件夹侧栏 + 书签网格</em>
      </td>
      <td align="center" width="50%">
        <a href="docs/screenshots/homepage-logged-in.png">
          <img src="docs/screenshots/homepage-logged-in.png" alt="登录后首页" width="100%" />
        </a>
        <br />
        <em>登录后首页 — 用户面板 + 书签全文展示</em>
      </td>
    </tr>
    <tr>
      <td align="center" width="50%">
        <a href="docs/screenshots/search-engine-panel.png">
          <img src="docs/screenshots/search-engine-panel.png" alt="搜索引擎选择面板" width="100%" />
        </a>
        <br />
        <em>搜索引擎选择面板 — 一键切换 29 款引擎</em>
      </td>
      <td align="center" width="50%">
        <a href="docs/screenshots/login.png">
          <img src="docs/screenshots/login.png" alt="登录页" width="100%" />
        </a>
        <br />
        <em>登录页 — 品牌展示，登录表单，搜索引擎快捷面板</em>
      </td>
    </tr>
    <tr>
      <td align="center" width="50%">
        <a href="docs/screenshots/prompts.png">
          <img src="docs/screenshots/prompts.png" alt="提示词管理" width="100%" />
        </a>
        <br />
        <em>提示词管理 — 文件夹分类管理 AI 提示词</em>
      </td>
      <td align="center" width="50%">
        <a href="docs/screenshots/admin-dashboard.png">
          <img src="docs/screenshots/admin-dashboard.png" alt="管理后台仪表盘" width="100%" />
        </a>
        <br />
        <em>管理后台 — 统计概览：书签数、用户数、系统信息</em>
      </td>
    </tr>
    <tr>
      <td align="center" width="50%">
        <a href="docs/screenshots/admin-users.png">
          <img src="docs/screenshots/admin-users.png" alt="用户管理" width="100%" />
        </a>
        <br />
        <em>用户管理 — 查看和管理所有用户</em>
      </td>
      <td align="center" width="50%">
        <a href="docs/screenshots/admin-bookmarks.png">
          <img src="docs/screenshots/admin-bookmarks.png" alt="书签管理" width="100%" />
        </a>
        <br />
        <em>书签管理 — 全局书签列表和文件夹管理</em>
      </td>
    </tr>
    <tr>
      <td align="center" width="50%">
        <a href="docs/screenshots/admin-prompts.png">
          <img src="docs/screenshots/admin-prompts.png" alt="提示词管理（后台）" width="100%" />
        </a>
        <br />
        <em>提示词管理（后台） — 所有用户的提示词和标签</em>
      </td>
      <td align="center" width="50%">
        <a href="docs/screenshots/admin-backup.png">
          <img src="docs/screenshots/admin-backup.png" alt="备份管理" width="100%" />
        </a>
        <br />
        <em>备份管理 — 数据下载与定时备份</em>
      </td>
    </tr>
    <tr>
      <td align="center" width="50%">
        <a href="docs/screenshots/admin-settings.png">
          <img src="docs/screenshots/admin-settings.png" alt="用户设置" width="100%" />
        </a>
        <br />
        <em>用户设置 — 主题、布局、语言等个性化配置</em>
      </td>
      <td align="center" width="50%">
        <a href="docs/screenshots/admin-config.png">
          <img src="docs/screenshots/admin-config.png" alt="系统配置" width="100%" />
        </a>
        <br />
        <em>系统配置 — JWT 密钥、管理员列表、备份设置</em>
      </td>
    </tr>
    <tr>
      <td align="center" width="50%">
        <a href="docs/screenshots/search-engines.png">
          <img src="docs/screenshots/search-engines.png" alt="搜索引擎管理" width="100%" />
        </a>
        <br />
        <em>搜索引擎管理 — 29 款内置引擎，拖拽排序</em>
      </td>
      <td align="center" width="50%"></td>
    </tr>
  </table>
</div>

---

## 技术栈

### 前端（favshub-nuxt）

| 技术 | 说明 |
|------|------|
| [Nuxt 3](https://nuxt.com/) | Vue 全栈框架（SSR，Nitro 服务端预设） |
| [Vue 3](https://vuejs.org/) | 响应式 UI 框架 |
| [Naive UI](https://www.naiveui.com/) | 组件库 |
| [TypeScript](https://www.typescriptlang.org/) | 类型安全 |
| [Pinia](https://pinia.vuejs.org/) | 状态管理 |
| [SortableJS](https://sortablejs.github.io/Sortable/) | 拖拽排序 |
| [Drizzle ORM](https://orm.drizzle.team/) | 数据库 ORM |

### 后端（Nitro / Express）

| 技术 | 说明 |
|------|------|
| [Nitro](https://nitro.unjs.io/) | Nuxt 服务端引擎 |
| [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) | SQLite 数据库驱动（WAL 模式） |
| [JWT](https://jwt.io/) | 身份认证 |
| [bcryptjs](https://github.com/dcodeIO/bcrypt.js) | 密码加密 |

### 浏览器扩展（favshub-ext）

| 技术 | 说明 |
|------|------|
| [Vue 3](https://vuejs.org/) | UI 框架 |
| [WXT](https://wxt.dev/) | 跨浏览器扩展框架 |
| [Naive UI](https://www.naiveui.com/) | 组件库 |
| [TypeScript](https://www.typescriptlang.org/) | 类型安全 |

### DevOps

| 技术 | 说明 |
|------|------|
| [Docker](https://www.docker.com/) | 容器化部署（node:20-alpine） |
| [GitHub Actions](https://github.com/features/actions) | CI/CD 自动构建 |
| [GHCR](https://ghcr.io/) | 容器镜像仓库 |

### 包管理器

| 技术 | 说明 |
|------|------|
| [pnpm](https://pnpm.io/) | 包管理器（v9.15） |

---

## 快速开始

### 环境要求

- Node.js >= 20
- pnpm >= 9

### 安装与启动

```bash
# 克隆仓库
git clone https://github.com/huanyu-a/FavsHub_web.git
cd FavsHub_web/favshub-nuxt

# 安装依赖
pnpm install

# 开发模式启动（默认端口 3000）
pnpm dev
```

首次启动会自动创建 SQLite 数据库文件 `data/favshub.db` 并初始化表结构。注册的第一个用户自动成为管理员。

### 生产构建

```bash
pnpm build
pnpm preview
```

---

## Docker 部署

使用 Docker Compose 一键部署（项目根目录已提供 `compose.yaml`）：

```yaml
services:
  favshub:
    image: ghcr.io/huanyu-a/favshub:latest
    pull_policy: if_not_present
    environment:
      - TZ=Asia/Shanghai
      - NUXT_JWT_SECRET=${NUXT_JWT_SECRET:-please-change-this-to-a-random-string}
      - NUXT_DB_PATH=/opt/favshub/data/favshub.db
      - NUXT_CORS_ORIGIN=${NUXT_CORS_ORIGIN:-*}
      - NUXT_ADMIN_USERS=${NUXT_ADMIN_USERS:-}
    dns:
      - 119.29.29.29
      - 223.5.5.5
    volumes:
      - ./data:/opt/favshub/data
    ports:
      - "3090:3000"
    restart: always
```

启动服务：

```bash
docker compose up -d
```

应用默认在 `http://localhost:3090` 访问。

首次部署后，第一个注册的用户自动成为管理员。请务必通过环境变量 `NUXT_JWT_SECRET` 修改 JWT 签名密钥。

### GitHub Actions 自动构建

每次推送 `favshub-nuxt/VERSION` 文件修改到 `main` 分支时，GitHub Actions 自动执行：

1. 安装依赖并构建 Nuxt 应用（`pnpm install --frozen-lockfile` + `pnpm build`）
2. 准备 Docker 构建上下文（拷贝 `.output/server` 和 `.output/public`）
3. 构建并推送 Docker 镜像到 `ghcr.io/huanyu-a/favshub`
4. 打标签：版本号标签、`latest` 标签、Git SHA 标签

---

## 项目结构

```
favshub-nuxt/
├── app.vue                  # 应用入口（NuxtLayout + NuxtPage）
├── error.vue                # 错误页面（404/500）
├── nuxt.config.ts           # Nuxt 配置（Pinia 模块、View Transition、安全头）
├── package.json             # 依赖与脚本
├── pnpm-lock.yaml           # pnpm 锁定文件
├── compose.yaml             # Docker Compose 编排
├── Dockerfile               # Docker 镜像构建（node:20-alpine）
├── VERSION                  # 版本号（推送此文件触发 CI 自动构建）
├── docs/
│   └── screenshots/         # 文档截图（6 张）
├── public/                  # 静态资源目录（CSS、图片、favicon 缓存等）
├── components/              # Vue 组件
│   ├── auth/
│   │   └── LoginDialog.vue         # 登录弹窗
│   ├── bookmark/
│   │   ├── BookmarkCard.vue        # 书签卡片
│   │   ├── BookmarkContextMenu.vue # 书签右键菜单
│   │   ├── BookmarkEditDialog.vue  # 书签编辑弹窗
│   │   └── BookmarkGrid.vue        # 书签网格布局
│   ├── common/
│   │   └── IconPicker.vue          # 图标选择器
│   ├── mobile/
│   │   ├── MobileBottomNav.vue     # 移动端底部导航
│   │   ├── MobileHeader.vue        # 移动端顶栏
│   │   └── MobileOverlay.vue       # 移动端遮罩
│   ├── prompts/
│   │   └── PromptDialogs.vue       # 提示词编辑弹窗
│   ├── search/
│   │   ├── SearchBar.vue           # 搜索栏
│   │   └── SearchEngineDropdown.vue # 搜索引擎下拉切换
│   ├── sidebar/
│   │   ├── FolderTreeItem.vue      # 文件夹树节点
│   │   ├── Sidebar.vue             # 侧边栏
│   │   └── UserPanel.vue           # 用户面板
│   ├── BackToTop.vue               # 回到顶部按钮
│   ├── FloatingNav.vue             # 浮动导航
│   ├── WelcomeMessage.vue          # 欢迎信息
│   └── YearProgress.vue            # 年度进度组件
├── layouts/
│   ├── admin.vue             # 管理后台布局
│   └── default.vue           # 默认布局（主应用）
├── pages/
│   ├── index.vue             # 首页 — 书签浏览
│   ├── login.vue             # 登录/注册页
│   ├── prompts/
│   │   └── index.vue         # 提示词管理页
│   └── admin/
│       ├── index.vue              # 管理后台仪表盘
│       ├── backup.vue             # 数据备份
│       ├── bookmarks.vue          # 书签管理
│       ├── config.vue             # 系统配置
│       ├── prompts.vue            # 提示词管理
│       ├── search-engines.vue     # 搜索引擎管理
│       ├── settings.vue           # 设置
│       └── users.vue              # 用户管理
└── server/                   # 服务端 API
    ├── api/                  # API 路由（书签、认证、同步、管理后台等）
    ├── middleware/           # 中间件（JWT 认证、管理员检查）
    └── db.js                 # SQLite 数据库初始化与增量迁移
```

---

## 浏览器扩展

FavsHub 配套的浏览器扩展位于项目根目录的 `favshub-ext/`，基于 **Vue 3 + WXT + TypeScript** 构建，支持 Chrome 和 Firefox。

主要功能：

- **一键收藏** — 右键或点击扩展图标快速收藏当前网页，自动提取标题、URL、favicon
- **增量同步** — 自动同步书签到 FavsHub 服务器，以 URL 为基准去重
- **跨设备** — 多浏览器间书签实时同步
- **文件夹分类** — 收藏时选择目标文件夹

开发扩展：

```bash
cd favshub-ext
pnpm install         # 首次运行自动执行 wxt prepare
pnpm dev             # Chrome 开发模式
pnpm build           # Chrome 生产构建
pnpm build:firefox   # Firefox 生产构建
```

---

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `NUXT_JWT_SECRET` | JWT 签名密钥（生产环境务必修改） | `please-change-this-to-a-random-string` |
| `NUXT_DB_PATH` | SQLite 数据库文件路径 | `./data/favshub.db` |
| `NUXT_CORS_ORIGIN` | CORS 允许的跨域来源 | `*` |
| `NUXT_ADMIN_USERS` | 管理员用户名列表（逗号分隔） | 空（首个注册用户自动为管理员） |

---

## License

MIT
