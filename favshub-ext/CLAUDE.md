# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**读者：** AI 与开发者。用户安装 / 配置扩展见 [README.md](README.md)。  
**范围：** 仅 `favshub-ext/`（浏览器扩展）。仓库总览见 [../CLAUDE.md](../CLAUDE.md)；网站 API / 同步语义见 [../favshub-nuxt/CLAUDE.md](../favshub-nuxt/CLAUDE.md)。

## 技术栈

WXT · Vue 3 · Naive UI · Tailwind CSS · TypeScript · pnpm  
图标统一 **`@vicons/ionicons5`**（勿混用其它图标库）。

## 常用命令

```bash
pnpm install          # 首次自动 wxt prepare，生成 .wxt/tsconfig
pnpm dev              # Chrome 开发模式
pnpm dev:firefox
pnpm build            # Chrome MV3 → .output/chrome-mv3/
pnpm build:firefox
pnpm zip / pnpm zip:firefox
pnpm compile          # vue-tsc --noEmit（不产出构建）
```

- Chrome 加载：`favshub-ext/.output/chrome-mv3/`（开发产物路径以 WXT 输出为准）。
- 改代码后需 `pnpm build`（或 dev 热更）并在 `chrome://extensions` 重新加载。
- `.wxt/`、`.output/` 自动生成，**勿手改**。
- `tsconfig.json` 继承 `.wxt/tsconfig.json`；克隆后必须先 `pnpm install`。

## 项目结构

```
entrypoints/               # 每个文件/目录 = 一个扩展入口
  background.ts            # Service Worker
  content.ts               # Content Script（matches 在 defineContentScript 中）
  floating-ball.content.ts # 页面内浮动球
  popup/
    index.html             # <meta name="manifest.type" content="browser_action"> 或 side_panel
    main.ts
    App.vue
components/                # 共享 Vue 组件
  Sync.vue                 # 书签树读取与扁平化上传
  Add.vue                  # 快速收藏当前页
  Home.vue                 # 书签首页
  Search.vue               # 搜索已同步书签
  Settings.vue             # 服务器地址、主题、语言
  FolderItem.vue           # 文件夹节点
  BottomNav.vue            # 底部导航
  PopupLayout.vue          # 弹窗/侧栏布局
  title.vue                # 标题组件
utils/
  request.ts               # 统一 HTTP 封装（BASE_URL + JWT + 90s）
  flatten-bookmarks.ts     # 书签树扁平化（folder_path 格式）
  diff-engine.ts           # 增量差异比对引擎
  sync-snapshot.ts         # 同步快照持久化
  browser-sync.ts          # 浏览器书签同步编排
  container-sync.ts        # 容器/书签栏同步
  storage.ts               # 扩展存储封装
  storage-session.ts       # 会话存储
i18n/                      # vue-i18n，zh / en 双语
public/icon/               # 扩展图标 16/32/48/128.png
assets/                    # 构建期资源，@/assets/
.wxt/                      # 自动生成
.output/                   # 构建输出
```

路径别名：`@/` → 项目根；`@/assets/`、`@/components/` 同理。

## 框架约定

### 自动导入（无需手动 import）

- Vue：`ref`、`reactive`、`computed`、`watch`、`defineComponent` 等
- Naive UI 组合式：`useDialog`、`useMessage`、`useNotification`、`useLoadingBar`
- WXT：`defineBackground`、`defineContentScript`、`browser` 等

### 组件

Naive UI 经 `unplugin-vue-components` 按需解析；模板可直接写 `<n-button>`、`<n-modal>` 等。

### WXT / Vite

- Vite 插件**必须**嵌套在 `vite: () => ({ plugins: [...] })`，不能写在 `defineConfig` 顶层
- Content script 的 `matches` 在 `entrypoints/content.ts` 的 `defineContentScript` 中
- 弹窗 manifest 类型由 `popup/index.html` 的 `<meta name="manifest.type">` 指定

## 请求封装（`utils/request.ts`）

- 统一用 `@/utils/request` 访问网站后端
- 自动从 `WxtStorage` 读 `BASE_URL`、`TOKEN`
- 相对 path 拼为 `BASE_URL + path`（例：`/api/bookmarks`）
- 有 TOKEN 时带 `Authorization: Bearer …`；超时固定 **90s**
- 默认需要鉴权；公开接口传 `auth: false`
- HTTP 200 时业务体约定 `{ code, msg, data }`：`code !== 200` 抛 `Error(msg)`，成功只返回 `data`
- 需要原始 `Response` 时用 `requestRaw`
- 设置页「测试连接」**不走** `request`（必须用表单当前值，而非已存 storage）

```ts
import { request, requestRaw } from '@/utils/request'

const bookmarks = await request<BookmarkItem[]>('/api/bookmarks')

await request('/api/sync/bookmarks', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ /* ... */ }),
})

await request('/api/auth/login', {
  method: 'POST',
  auth: false,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username, password }),
})

const response = await requestRaw('/api/export', { method: 'GET' })
```

API 前缀永远是 **`/api/`**（不是 `/api/v1/`）。具体路径与鉴权以网站为准。

## 书签同步语义

- 主逻辑：`components/Sync.vue` — 读浏览器书签树，扁平化为  
  `{ title, url, folder_path, icon }`
- `folder_path`：层级路径，形如 `收藏夹栏/子文件夹/...`；顶级容器（收藏夹栏 / 其他收藏夹）下的子夹可提升为顶级（以实现代码为准）
- 调用网站：`PUT /api/sync/bookmarks`（增量）或 `POST`（全量）
- Favicon：可通过 `chrome.runtime.getURL('/_favicon/')` 取浏览器缓存再上传
- 服务端行为（去重、不覆盖 icon、`ensureFolderPath`）见网站 CLAUDE，改协议时两边一起改

## 与页面通信 / 安全

- Content script ↔ 页面：`postMessage`，origin 使用 **`window.location.origin`**（或与站点约定的严格校验）
- 打开外链：拒绝 `javascript:` / `data:` / `vbscript:` / `file:` 等危险 scheme
- 权限：最小权限原则；勿扩大 manifest 无必要权限

## 开发注意

- 网站 CORS / JWT 配置须允许扩展使用的 API 源
- 改同步字段或 API 契约时同步更新 `favshub-nuxt` 的 sync 路由与本文档
- 仅类型检查用 `pnpm compile`；发版产物用 `pnpm build`
