# FavsHub - 智能书签管理与 AI 提示词中心

**FavsHub** 是一个网站 + 浏览器扩展项目，为您提供一站式的书签管理和 AI 提示词管理平台。

三大核心模块：🔖 **书签导航** — 将浏览器书签转化为精美的可视化卡片网格；🔍 **搜索引擎聚合** — 汇聚 28+ 主流搜索引擎，支持多窗口对比检索；📝 **PromptPro** — 专业级 AI 提示词管理，提供版本回溯、差异对比与多维分类。

---

## 项目结构

```
FavsHub_web/
├── wwwroot/
│   ├── server/          # Node.js 后端 API 服务
│   │   ├── index.js     # Express 服务入口
│   │   ├── db.js        # SQLite 数据库（含 Schema 与迁移）
│   │   ├── routes/      # API 路由（auth, bookmarks, prompts, sync, admin 等）
│   │   └── middleware/   # 认证 & 管理员中间件
│   ├── web/             # 网站前端（原生 JS + TailwindCSS）
│   │   ├── index.html   # 主页面（书签导航）
│   │   ├── promptpro.html  # 提示词管理
│   │   ├── admin.html   # 管理员后台
│   │   └── login.html   # 登录/注册
│   └── images/          # 静态资源（搜索引擎 logo、favicon、壁纸）
├── zmark-ext/           # 浏览器扩展（Vue 3 + WXT）
│   ├── entrypoints/     # 扩展入口（background, content, popup）
│   ├── components/      # Vue 组件（Sync, Search, Settings 等）
│   └── utils/           # 工具函数与 API 请求封装
└── bak/                 # 旧版项目存档
```

---

## 快速开始

### 1. 启动后端服务

```bash
cd wwwroot/server
npm install
node index.js
```

服务默认运行在 `http://localhost:3000`，可通过 `PORT` 环境变量修改端口。

### 2. 访问网站

打开浏览器访问 `http://localhost:3000`，注册账号后即可使用。首个注册用户自动成为管理员。

### 3. （可选）安装浏览器扩展

浏览器扩展用于将 Chrome/Edge 书签同步到网站：

```bash
cd zmark-ext
pnpm install
pnpm build
```

然后在 Chrome 扩展管理页（`chrome://extensions/`）中加载 `zmark-ext/.output/chrome-mv3/` 目录。

---

## 核心功能

### 🔖 智能书签导航

- 自动将书签展示为彩色卡片网格，根据网站图标生成渐变色背景
- 拖拽排序、右键菜单（编辑/删除/复制/二维码/批量打开）
- 文件夹树形导航，支持层级折叠和默认首页设置
- 浏览器扩展一键同步书签至网站

### 🔍 多引擎搜索聚合

- 集成 28+ 搜索引擎（Google, Bing, 百度, ChatGPT, Claude, DeepSeek 等），分为 AI / 通用搜索 / 社交媒体三大类
- 对比搜索：一键在多个搜索引擎中同时查询
- 管理员可在后台自定义搜索引擎列表

### 📝 PromptPro 提示词管理

- 完整的 AI 提示词版本控制系统：自动保存历史版本，支持差异对比和一键还原
- 语义化版本号自动递增（1.0.0 → 1.0.1）
- 文件夹层级分类 + 标签多维筛选
- 收藏功能 + 智能搜索（权重评分算法）
- 数据备份：支持本地文件夹自动备份 + 百度网盘云端备份

### 🎨 个性化外观

- 亮色/暗色主题，可跟随系统或手动切换
- 壁纸系统：必应每日壁纸 + 预设壁纸 + 用户自定义上传
- 布局自定义：书签卡片宽度/高度、容器宽度比例调节

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 后端 | Node.js + Express + better-sqlite3 |
| 认证 | JWT (jsonwebtoken + bcryptjs) |
| 网站前端 | 原生 JavaScript + TailwindCSS |
| 浏览器扩展 | Vue 3 + TypeScript + WXT + Naive UI |

---

## API 概览

| 路径 | 说明 | 认证 |
|------|------|------|
| `/api/auth` | 注册、登录、获取用户信息 | 部分公开 |
| `/api/bookmarks` | 书签 CRUD + 排序 | 需要 |
| `/api/folders` | 书签文件夹管理 | 需要 |
| `/api/prompts` | 提示词 CRUD + 版本管理 + 文件夹管理 | 需要 |
| `/api/tags` | 标签管理 | 需要 |
| `/api/settings` | 用户设置 | 需要 |
| `/api/sync` | 扩展数据同步 | 需要 |
| `/api/admin` | 管理员后台 | 管理员 |
| `/api/search-engines` | 搜索引擎列表 | 无 |

---

## 数据存储

- 所有数据存储在 SQLite 数据库中（`wwwroot/server/data/favshub.db`）
- WAL 模式 + 外键约束确保数据完整性
- 支持手动/定时数据库备份，可备份至本地文件夹或百度网盘

---

## 许可证

本项目采用 ISC License。

## 致谢

- [TabMark-Bookmark-New-Tab](https://github.com/Alanrk/TabMark-Bookmark-New-Tab) - 原项目参考
- [TailwindCSS](https://tailwindcss.com/) - CSS 框架
- [WXT](https://wxt.dev/) - 浏览器扩展开发框架
- [Naive UI](https://www.naiveui.com/) - Vue 3 组件库
- [Sortable.js](https://github.com/SortableJS/Sortable) - 拖拽排序
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) - SQLite 驱动

---

**FavsHub - 让书签管理更优雅，让提示词管理更专业**
