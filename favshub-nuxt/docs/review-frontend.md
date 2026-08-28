# 前端与 UI 审查报告

> reviewer: 前端与 UI · 2026-08-05
> 审查范围：favshub-nuxt/ 前端代码（Vue 3 + Pinia + Naive UI + Nuxt 3 SSR），30+ 文件

---

## [CRITICAL] 严重问题

### 1. BookmarkGrid: `gridEls` 数组只累加不清理 — 内存泄漏
- **文件**：`components/bookmark/BookmarkGrid.vue:97-100`
- `setGridRef` 每遇到新 DOM 元素就 push 到 `gridEls`，无移除逻辑。切换路由、增减书签时 stale 引用堆积；组件卸载时未清空。长期运行积累大量无用 HTMLElement 引用，阻止 GC。
- **建议**：在 `onBeforeUnmount` 中 `gridEls.length = 0`；或改用 `ref()` 数组 + `v-for` key 变化自动回收。

### 2. BookmarkCard: `localStorage` 写入无错误处理 — 运行时崩溃风险
- **文件**：`components/bookmark/BookmarkCard.vue:131`
- 直接 `localStorage.setItem(cacheKey, JSON.stringify(...))`，无 try-catch。用户 localStorage 满额或隐私模式下抛出 `QuotaExceededError`，导致整个 BookmarkCard 渲染链崩溃。
- **建议**：包裹 `try { ... } catch { /* 降级：内存缓存 */ }`，用 `Map<string, {colors, ts}>` 兜底。

### 3. layouts/default: 全局 `keydown` 监听器永久存在，移除引用不匹配
- **文件**：`layouts/default.vue:36-40`
- setup 顶层用 `document.addEventListener('keydown', handler)` 注册 Escape 关闭抽屉，无对应 `onBeforeUnmount` 清理；且移除时用另一个匿名函数，与注册引用不同，移除无效。
- **建议**：将 handler 提取为具名函数，`onBeforeUnmount` 中调用 `document.removeEventListener('keydown', handler)`。

---

## [MAJOR] 重要问题

### 4. FolderTreeItem: `v-html` 渲染静态 SVG — 违反项目安全约定
- **文件**：`components/sidebar/FolderTreeItem.vue:74-76`
- 两处 `<svg>` 箭头使用 `v-html` 渲染纯静态内容，触发 `eslint-disable-next-line vue/no-v-html`。虽当前无注入风险，但违反 CLAUDE.md 中「避免 v-html」约定。
- **建议**：直接写 `<svg>` 元素普通模板。

### 5. stores/auth: JWT 明文存 localStorage，XSS 即可窃取
- **文件**：`stores/auth.ts:76,96`
- `localStorage.setItem('favshub_token', res.token)` 将 JWT 明文存储。攻击者若通过书签标题/描述等用户内容注入脚本，可直接读出 token 长期持有。扩展侧 token 与 cookie 并存，任意一侧泄露即账户沦陷。
- **建议**：扩展端改用 `sessionStorage`（标签页级生命周期）；审查所有用户输入渲染路径确保无 XSS。

### 6. SearchBar: 普通用户可调用管理 API 修改搜索引擎默认状态
- **文件**：`components/search/SearchBar.vue:595`
- `toggleEngine` 直接调用 `PUT /api/admin/search-engines/:id`，无前端权限校验。任何登录用户都可切换搜索引擎默认状态。服务端有权限中间件，但前端无任何提示或阻止，用户操作后静默失败（`.catch(() => {})`）。
- **建议**：增加前端守卫，非管理员点击时提示「仅管理员可修改」；调用前检查 `authStore.isAdmin`。

### 7. BookmarkGrid: 多个 watchEffect 直接操作 DOM 且无清理机制
- **文件**：`components/bookmark/BookmarkGrid.vue:117-145`
- 三个 `watchEffect` 分别设置 CSS 变量、注入 `<style>` 标签、设置容器宽高。每次 props 变化创建/修改 DOM，无 `onBeforeUnmount` 清理注入的 `<style>` 元素（id=`custom-card-height`），组件卸载后残留全局样式污染后续页面。
- **建议**：将 DOM 操作封装到 composable；style 注入添加上下文 ID 并在卸载时移除。

### 8. stores/settings: `_persistToBackend` 静默吞错，设置可能永远不生效
- **文件**：`stores/settings.ts:183-206`
- `catch {}` 完全忽略持久化失败（网络错误、401 过期等）。用户修改主题/布局后刷新丢失，找不到任何错误提示。401 场景尤其严重——token 过期后所有 `set()` 调用都静默失败。
- **建议**：catch 中将当前状态标记为 `pendingSync: true`，在 `fetchSettings` 成功后清除；检测 401 并触发重新登录流程。

### 9. layouts/default: 客户端初始化代码混在 setup 顶层
- **文件**：`layouts/default.vue:18-41`
- `document.body.classList.add(...)` 和 `document.addEventListener('keydown', ...)` 直接在 setup 顶层执行。虽包了 `if (import.meta.client)`，但 Nuxt 3 setup 语法糖模块顶层代码在服务端也会被求值，可能导致 hydration mismatch。
- **建议**：将客户端初始化逻辑移入 `onMounted` 回调。

### 10. SearchBar: 二维码 API 明文发送用户 URL 至第三方
- **文件**：`components/bookmark/BookmarkContextMenu.vue:110`
- `qrUrl` 直接拼接 `https://api.qrserver.com/v1/create-qr-code/...`，用户书签 URL 经 `encodeURIComponent` 后明文发送至第三方服务。若该服务被墙/down，二维码功能永久失效；且用户浏览 URL 泄露至外部。
- **建议**：引入本地 QR 码生成库（如 `qrcode`），避免外部依赖和隐私泄露。

---

## [MINOR] 轻微问题

### 11. SearchBar: prompt 详情点击丢失 prompt_id
- **文件**：`components/search/SearchBar.vue:501-503`
- 点击 prompt 建议项后执行 `window.location.href = '/prompts'`，丢失了已计算的 `promptId`。用户点击后需重新搜索才能找到目标 prompt。
- **建议**：跳转时携带 prompt_id 参数。

### 12. YearProgress: setInterval 永久运行无 pause/resume
- **文件**：`components/YearProgress.vue:16-19`
- `setInterval(..., 60000)` 组件挂载后永久运行，即使用户切换到其他标签页也持续触发。
- **建议**：配合 `document.visibilitychange` 在页面隐藏时暂停。

### 13. stores/settings: `get(key)` 对 falsy 值处理不正确
- **文件**：`stores/settings.ts:131-134`
- 当 `this.settings[key]` 为 `0`、`false`、`''` 等合法 falsy 值时行为不确定。
- **建议**：使用 `key in this.settings` 或 `Object.hasOwn(this.settings, key)` 判断。

### 14. pages/index: watch(currentCollectionId) 在 hydration 后立即触发
- **文件**：`pages/index.vue:269-277`
- SSR 已有值，客户端 hydrate 后 watch 立即触发一次，初始化阶段可能重复调用 `loadCollectionBookmarks`。
- **建议**：加 `flush: 'post'` 或使用 `onMounted` + `route.query` 对比判断是否已加载。

### 15. BookmarkGrid: dynamic import + onMounted 混用不确定生命周期
- **文件**：`components/bookmark/BookmarkGrid.vue:187-199`
- `if (import.meta.client)` 块中的 `await import('sortablejs')` 和 `onMounted` 在模块顶层求值。模块顶层 `await` 会延迟组件渲染；若组件多次卸载-挂载，不会重新初始化 Sortable。
- **建议**：将 Sortable 初始化移到 `onMounted` 内，并在 `onBeforeUnmount` 中 `instance.destroy()`。

### 16. FolderTreeItem: 自引用 import 命名冲突
- **文件**：`components/sidebar/FolderTreeItem.vue:3`
- `import FolderTreeItem from './FolderTreeItem.vue'` 在同一文件内自引用。Vue 单文件组件内自引用合法，但降低了代码可读性，IDE 跳转容易混淆。
- **建议**：重命名 import 为 `ChildFolder` 或使用 `defineAsyncComponent`。

### 17. 弹窗缺少 ARIA 属性和焦点管理
- 多处自定义 modal（`BookmarkEditDialog`、删除确认、右键菜单二维码弹窗）均缺少 `role="dialog"`、`aria-modal="true"`、`aria-labelledby`、初始焦点设定和 Escape 关闭后的焦点还原。

### 18. 右键菜单缺少键盘导航支持
- 右键菜单（`BookmarkContextMenu`）、文件夹右键菜单（`Sidebar`）仅支持鼠标操作。方向键无高亮项，Tab 键焦点顺序不明确。

---

## 统计

| 严重度 | 数量 |
|--------|------|
| CRITICAL | 3 |
| MAJOR | 8 |
| MINOR | 8 |
| **总计** | **21** |

## 最重要的 3 条

1. **JWT 明文存 localStorage**（CRITICAL）— XSS 即可完全窃取用户身份，是最严重的安全风险。
2. **gridEls 内存泄漏**（CRITICAL）— 长期运行页面 DOM 引用不释放，性能逐渐劣化直至卡顿。
3. **普通用户可调用管理 API**（MAJOR）— 前端虽非最后防线，但缺失导致用户体验困惑且暗示攻击面。

**结论：Request Changes**
