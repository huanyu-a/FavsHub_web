# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**读者：** AI 与开发者。用户安装 / 配置扩展见 [README.md](README.md)。  
**范围：** 仅 `favshub-ext/`（浏览器扩展）。仓库总览见 [../CLAUDE.md](../CLAUDE.md)；网站 API / 同步语义见 [../favshub-nuxt/CLAUDE.md](../favshub-nuxt/CLAUDE.md)。

## 技术栈

WXT · Vue 3 · Naive UI · Tailwind CSS · TypeScript · pnpm · vitest（纯函数单测）  
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
pnpm test             # vitest 单测（本机 pnpm run 受限时直跑 ./node_modules/.bin/vitest run）
```

- Chrome 加载：`favshub-ext/.output/chrome-mv3/`（开发产物路径以 WXT 输出为准）。
- 改代码后需 `pnpm build`（或 dev 热更）并在 `chrome://extensions` 重新加载。
- `.wxt/`、`.output/` 自动生成，**勿手改**。
- `tsconfig.json` 继承 `.wxt/tsconfig.json`；克隆后必须先 `pnpm install`。
- 本机若 `pnpm run` 报 `cmd.exe EACCES` / ELIFECYCLE，直接调用 `./node_modules/.bin/<命令>`。

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
  Sync.vue                 # 上传/下载/图标预热（三方同步操作入口）
  Add.vue                  # 快速收藏当前页
  Home.vue                 # 书签首页（含站内搜索）
  Search.vue               # 搜索输入框（Home 头部用）
  Settings.vue             # 服务器地址、登录、悬浮球、语言
  FolderItem.vue           # 文件夹节点（递归）
  BottomNav.vue            # 底部导航
  PopupLayout.vue          # 弹窗/侧栏布局
  title.vue                # 标题组件
utils/
  request.ts               # 统一 HTTP 封装（BASE_URL + JWT + 90s，错误消息 i18n）
  safe-url.ts              # URL 协议白名单（仅 http/https，全扩展统一用）
  favicon-display.ts       # 列表 favicon 渲染与回退链（本地缓存→Google→首字母）
  server-errors.ts         # 语言判定 + 无 vue 运行时的轻量翻译（background/内容脚本用）
  flatten-bookmarks.ts     # 书签树扁平化（folder_path 格式）
  diff-engine.ts           # 三次 diff 引擎（纯函数，key 段转义）
  sync-snapshot.ts         # 同步快照持久化
  browser-sync.ts          # 服务端→浏览器增量合并编排
  container-sync.ts        # 容器名↔类型映射（bar/other/mobile）
  storage.ts               # 扩展存储封装
  storage-session.ts       # 会话存储（含图标预热心跳状态）
i18n/                      # 自建轻量 i18n（**勿引入 vue-i18n**，见「i18n」节）
tests/                     # vitest 纯函数单测（diff-engine / safe-url / container-sync / flatten-bookmarks）
vitest.config.ts
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
- 自动从 storage 读 `BASE_URL`、`TOKEN`
- 相对 path 拼为 `BASE_URL + path`（例：`/api/bookmarks`）
- 有 TOKEN 时带 `Authorization: Bearer …`；超时固定 **90s**
- 默认需要鉴权；公开接口传 `auth: false`
- 响应约定：非 200 抛 `HTTP {status}` 错误；业务失败以响应体 `error` 字段表达——值为服务端错误码时经 `utils/server-errors.ts` 词典翻译为当前语言，未命中则原样透出；401 抛「未登录」提示
- 需要原始 `Response` 时用 `requestRaw`
- 设置页「测试连接」**不走** `request`（必须用表单当前值，而非已存 storage），超时 10s

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

**上传（浏览器 → 网站）**

- `Sync.vue` → `utils/flatten-bookmarks.ts` 扁平化为 `{ title, url, folder_path, container }`
- `folder_path`：层级路径，形如 `工作/子文件夹`；顶级容器（书签栏/其他书签）下的子夹提升为顶级
- **icon 字段不随同步上传**（防 Google URL 污染服务端书签表）；图标统一走 `POST /api/sync/favicons`（浏览器缓存图标转 base64）
- 调用网站：`PUT /api/sync/bookmarks`（增量 upsert）；名称含 `/` 的文件夹会被网站按路径模型拆为嵌套（固有限制）

**下载（网站 → 浏览器）**

- `utils/browser-sync.ts` 编排三方 diff：服务端快照（`utils/sync-snapshot.ts`）× 服务端数据 × 当前浏览器书签，经 `utils/diff-engine.ts`（纯函数）计算增/删/改
- 应用顺序安全优先：先建文件夹与书签 → 标题更新 → 最后删除（文件夹仅在清空时移除）
- **key 段转义**：diff key 中文件夹名段经 `encodeKeySegment` 转义（`/`→`%2F`、`%`→`%25`），防名称含 `/` 产生歧义；普通名称 key 不变，存量快照兼容
- 快照在每次下载同步后重建——**本地新增书签永不被误删、本地已删不被复活**（有单测锁定，见 `tests/diff-engine.test.ts`）
- 服务端行为（去重、不覆盖 icon、`ensureFolderPath`）见网站 CLAUDE，改协议时两边一起改

## i18n（自建轻量方案，**勿引入 vue-i18n**）

- 组件层：`i18n/index.ts` 的 `t(key, params)`（reactive locale，切换即时生效）；词典 `i18n/locales/{zh,en}.ts`，**两文件键集必须对齐**
- 非 vue 上下文（background / content script / request 错误）：`utils/server-errors.ts` 的 `tr()`（异步）与 `translateWith(lang, …)`（同步，构建右键菜单用）
- 语言切换：设置页写 `local:LANGUAGE` → background watch 后重建右键菜单；悬浮球每页注入时读取一次
- **性能红线**：曾因引入 vue-i18n 使 background.js 22KB→207KB；保持自建方案，新增文案先加词条再引用

## 测试

- `pnpm test`（vitest，纯函数层：diff-engine / safe-url / container-sync / flatten-bookmarks）
- 改 diff/同步逻辑先补用例再动手；`tests/diff-engine.test.ts` 锁定了「本地新增不误删、本地已删不复活」两条安全语义

## 与页面通信 / 安全

- **站点中继**：`entrypoints/content.ts` 仅注入到配置的 FavsHub 站点（background 动态注册）；`postMessage` 严格校验 `event.origin === window.location.origin` + action 白名单
- **background 消息防线**：`proxyFetch` 仅允许目标为配置站点 origin（防 SSRF）、60s 超时 + 5MB 上限；`searchHistory` 速率限制 + 入参校验 + 结果上限；`openTab` / `openUrlInSidePanel` 仅允许与站点同源
- **悬浮球**：closed Shadow DOM（宿主页脚本不可读内部数据）；书签/引擎数据懒加载（首次展开面板才请求）
- 打开外链：统一 `isSafeUrl`（`utils/safe-url.ts`）拒绝 `javascript:` / `data:` / `vbscript:` / `file:` 等危险 scheme
- manifest：`minimum_chrome_version: 114`（sidePanel API）；host_permissions 收窄为 `https://*/*` + 本地开发；最小权限原则，勿扩大

## 开发注意

- 网站 CORS / JWT 配置须允许扩展使用的 API 源
- 改同步字段或 API 契约时同步更新 `favshub-nuxt` 的 sync 路由与本文档
- 仅类型检查用 `pnpm compile`；发版产物用 `pnpm build`；改 diff/同步逻辑跑 `pnpm test`
