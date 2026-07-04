# FavsHub-Ext — 浏览器扩展

<p align="center">
  <img src="https://img.shields.io/badge/version-3.0.0-green" alt="版本" />
  <img src="https://img.shields.io/badge/WXT-0.20-7E3DE3?logo=wxt" alt="WXT" />
  <img src="https://img.shields.io/badge/Vue-3.5-4FC08D?logo=vue.js" alt="Vue" />
  <img src="https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Naive_UI-2.44-00B4FF?logo=naive-ui" alt="Naive UI" />
</p>

FavsHub 配套浏览器扩展，将 Chrome/Edge 书签一键同步到 FavsHub 网站。

## 功能特性

- **📚 书签同步** — 读取浏览器书签树，扁平化后同步到网站，以 URL 为基准自动去重
- **⭐ 一键收藏** — 右键菜单或扩展图标快速收藏当前网页，自动提取标题、URL、favicon
- **📱 侧边栏模式** — 通过 `Alt+B` 快捷键打开侧边栏，随时管理书签
- **🔮 浮动球** — 内容脚本浮动球，快速访问和收藏
- **🌐 跨浏览器** — 支持 Chrome（MV3）和 Firefox
- **🌍 国际化** — 支持中文 / English 双语界面

## 技术栈

| 技术 | 说明 |
|------|------|
| [Vue 3](https://vuejs.org/) | UI 框架 |
| [WXT](https://wxt.dev/) | 跨浏览器扩展开发框架 |
| [TypeScript](https://www.typescriptlang.org/) | 类型安全 |
| [Naive UI](https://www.naiveui.com/) | 组件库 |
| [TailwindCSS 4](https://tailwindcss.com/) | 样式 |
| [Vue I18n](https://vue-i18n.intlify.dev/) | 国际化（zh / en） |

## 快速开始

### 安装依赖

```bash
cd favshub-ext
pnpm install       # 首次运行自动执行 wxt prepare
```

### 开发模式

```bash
pnpm dev           # Chrome
pnpm dev:firefox   # Firefox
```

在 `chrome://extensions/`（开发者模式）中加载 `favshub-ext/.output/chrome-mv3/` 目录。

### 生产构建

```bash
pnpm build         # Chrome MV3
pnpm build:firefox # Firefox
pnpm zip           # 打包 zip（用于发布）
```

## 项目结构

```
favshub-ext/
├── wxt.config.ts              # WXT 配置（manifest、权限、快捷键、Vite 插件）
├── package.json               # 依赖与脚本
├── components/
│   ├── Add.vue                # 快速收藏弹窗
│   ├── Home.vue               # 书签首页
│   ├── Search.vue             # 搜索
│   ├── Settings.vue           # 设置页面（服务器地址、主题、语言）
│   ├── Sync.vue               # 书签同步（读取浏览器书签树 → 扁平化 → 上传）
│   ├── FolderItem.vue         # 文件夹树节点
│   ├── BottomNav.vue          # 底部导航
│   ├── PopupLayout.vue        # 弹窗布局
│   └── title.vue              # 标题组件
├── entrypoints/
│   ├── background.ts          # Service Worker（后台任务、定时同步）
│   ├── content.ts             # Content Script（页面注入）
│   ├── floating-ball.content.ts  # 浮动球内容脚本
│   └── popup/                 # 弹窗/侧边栏入口
├── utils/
│   ├── request.ts             # API 请求封装（BASE_URL + JWT token + 90s 超时）
│   ├── flatten-bookmarks.ts   # 书签树扁平化（folder_path 格式）
│   ├── browser-sync.ts        # 浏览器书签同步逻辑
│   ├── container-sync.ts      # 容器/书签栏同步
│   ├── diff-engine.ts         # 增量差异比对引擎
│   ├── sync-snapshot.ts       # 同步快照
│   ├── storage.ts             # 扩展存储封装
│   └── storage-session.ts     # 存储会话管理
├── i18n/
│   ├── index.ts               # i18n 配置（vue-i18n）
│   └── locales/
│       ├── zh.ts              # 中文语言包
│       └── en.ts              # 英文语言包
├── public/
│   └── icon/                  # 扩展图标（16/32/48/128.png）
├── assets/                    # 样式资源
└── .output/                   # 构建输出（gitignore）
```

## 同步机制

1. 扩展读取浏览器 `chrome.bookmarks` 书签树
2. 扁平化为 `{ title, url, folder_path, icon }` 格式
3. `folder_path` 格式为 `收藏夹栏/子文件夹/...`，顶级文件夹的子文件夹提升为顶级
4. 调用 `POST /api/sync/bookmarks` 上传到服务端
5. 服务端通过 `ensureFolderPath()` 递归创建层级文件夹
6. 通过 `chrome.runtime.getURL('/_favicon/')` 获取浏览器缓存的 favicon 并上传

## 扩展权限

```json
{
  "permissions": [
    "storage",      // 存储用户配置和同步状态
    "tabs",         // 获取当前标签页信息
    "contextMenus", // 右键菜单
    "notifications",// 同步结果通知
    "bookmarks",    // 读取/修改浏览器书签
    "sidePanel",    // 侧边栏模式
    "commands",     // 快捷键（Alt+B 打开侧边栏）
    "favicon",      // 获取网站 favicon
    "history",      // 基于浏览历史推荐快捷链接
    "scripting"     // 注入内容脚本
  ],
  "host_permissions": ["http://*/*", "https://*/*"]
}
```

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Alt+B` (Mac: `Cmd+B`) | 打开侧边栏 |

## 国际化

扩展支持中文和英文界面，自动检测浏览器语言：

- 浏览器语言为中文 → 默认中文界面
- 其他语言 → 默认英文界面
- 可在设置页面手动切换语言

## 许可证

**AGPL-3.0 License**（浏览器扩展采用强 Copyleft 许可证，确保衍生作品开源）
