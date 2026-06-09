# FavsHub Nuxt 3 前端样式审核报告

> 审核目标：确保新框架 (favshub-nuxt) 的主题样式与旧框架 (wwwroot) 100% 一致  
> 审核日期：2026-06-08

---

## 核心问题：全局 CSS 未引用

**根本原因**：新框架没有引用旧框架的 CSS 文件（`main-bundle.css` 166KB、`mobile-responsive.css` 14KB、`promptpro-bundle.css` 156KB 等），而是在每个 Vue 组件中重写了样式。这导致大量细节差异。

**建议方案**：在 `nuxt.config.ts` 或 `layouts/default.vue` 中全局引入旧 CSS 文件，然后在 Vue 组件中仅做增量调整，而非全部重写。

```ts
// nuxt.config.ts 中添加：
css: [
  '/css/main-bundle.css',
  '/css/mobile-responsive.css',
],
```

---

## P0 - 重大差异（必须修复）

### 1. 管理后台统计卡片样式错乱
- **文件**：`pages/admin/index.vue`
- **问题**：
  - 数值/标签上下位置颠倒（旧版标签在上数值在下，新版相反）
  - 数值颜色从多色（蓝/绿/紫/橙）变为统一蓝色 `#1976d2`
  - 阴影 `box-shadow` 变为边框 `border`
  - 圆角从 `12px` 缩为 `10px`
  - 对齐从左对齐变为居中
  - 数值字号从 `28px` 变为 `32px`
  - 网格列宽从 `minmax(200px, 1fr)` 变为 `minmax(180px, 1fr)`
- **修复**：恢复旧版 stat-card 样式

### 2. "公开" Badge 颜色完全不同
- **文件**：`pages/admin/bookmarks.vue`, `pages/admin/prompts.vue`
- **问题**：旧版"公开"标签为绿色系 (`background:#f0fdf4; color:#166534`)，新版为蓝紫系 (`background:#e0e7ff; color:#3730a3`)
- **修复**：`.badge-public` 改为 `background: #f0fdf4; color: #166534`，圆角从 `10px` 改为 `4px`

### 3. 管理后台移动端响应式完全缺失
- **文件**：`layouts/admin.vue` 及所有 admin 页面
- **问题**：旧版有完整的 768px/480px 断点适配（侧边栏折叠、汉堡菜单、表格横向滚动、弹窗 95% 宽），新版无任何移动端样式
- **修复**：在 `layouts/admin.vue` 中补充完整的响应式样式

### 4. PromptPro 主题色系统差异
- **文件**：`pages/prompts/index.vue`
- **问题**：旧框架使用翡翠绿 (`#10B981`) + 暖白背景 (`#FDF8F0`)，新框架使用紫蓝渐变 (`#667eea → #764ba2`) + 冷灰背景 (`#f5f5f7`)
- **影响**：按钮、focus 状态、active 状态、标签 badge 等所有交互元素颜色不一致
- **修复**：将新框架所有绿色相关色值替换为旧版的翡翠绿色系

### 5. PromptPro 暗色模式未生效
- **文件**：`pages/prompts/index.vue`
- **问题**：新版 scoped CSS 中无 `[data-theme="dark"]` 规则，`layouts/default.vue` 全局暗色规则的类名 (`.sidebar`, `.bookmark-card`) 与 PromptPro 页面类名不匹配
- **修复**：添加 PromptPro 专属的暗色主题规则

### 6. PromptPro 移动端响应式缺失
- **文件**：`pages/prompts/index.vue`
- **问题**：无 `@media` 查询，小屏设备不会自适应
- **修复**：补充移动端断点样式

---

## P1 - 中等差异（应当修复）

### 7. 管理后台弹窗尺寸缩小
- **文件**：`admin/users.vue`, `folders.vue`, `bookmarks.vue`, `search-engines.vue`, `prompts.vue`
- **问题**：
  - `max-width` 从 `700px` 缩为 `500px`（部分页面 `550px`）
  - 缺少 `max-height: 80vh; overflow-y: auto` 限制
  - header padding 从 `20px 24px` 缩为 `16px 20px`
  - body padding 从 `20px 24px` 缩为 `20px`
- **修复**：恢复旧版弹窗尺寸

### 8. 部分管理页面按钮缺少 hover 效果
- **文件**：`admin/bookmarks.vue`, `prompts.vue`, `search-engines.vue`
- **问题**：缺少 `transition: all 0.2s` 和 hover 背景色变化
  - `.btn-primary:hover` 应为 `#5a6fd6`
  - `.btn-danger:hover` 应为 `#c0392b`
  - `.btn-ghost:hover` 应为 `#f5f5f5`
- **修复**：补充 transition 和 hover 规则

### 9. 表格 th/td padding 不统一
- **文件**：`admin/bookmarks.vue`, `prompts.vue`, `search-engines.vue`
- **问题**：部分页面 th/td padding 为 `10px 14px`，td 字号 `13px`，应为旧版的 `12px 16px` 和 `14px`
- **修复**：统一为 `12px 16px` / `14px`

### 10. 导航项样式微调
- **文件**：`layouts/admin.vue`
- **问题**：
  - padding 从 `12px 24px` 变为 `11px 24px`
  - 默认颜色从 `rgba(255,255,255,0.7)` 变为 `0.65`
  - hover 背景从 `rgba(255,255,255,0.1)` 变为 `0.06`
  - transition 从 `0.2s` 变为 `0.15s`
- **修复**：恢复旧版数值
- **可保留**：新版 active 状态的左侧紫色指示条是增强设计

### 11. Logo 区域尺寸
- **文件**：`layouts/admin.vue`
- **问题**：标题字号从 `20px` 变为 `18px`，副标题从 `12px` 变为 `11px`，padding 不一致
- **修复**：恢复旧版字号和 padding

### 12. 设置页表单细节
- **文件**：`admin/settings.vue`
- **问题**：
  - switch option padding 从 `10px 12px` 变为 `8px 12px`
  - 缺少 hover 背景色 `#f0f2f5` 和 transition
  - section-title 颜色从 `#555` 变为 `#888`，字号从 `14px` 变为 `13px`
  - 缺少 range 滑块的自定义样式（绿色 thumb）
- **修复**：恢复旧版表单样式

---

## P2 - 轻微差异（建议修复）

### 13. 首页侧边栏样式差异
- **文件**：`components/sidebar/Sidebar.vue`
- **问题**：侧边栏宽度、品牌区域、文件夹树、底部工具栏等细节与旧版有微小差异
- **修复**：逐像素对齐旧版 `main-bundle.css` 中的 `.sidebar` 相关样式

### 14. 搜索栏样式差异
- **文件**：`components/search/SearchBar.vue`
- **问题**：圆角、阴影、搜索引擎图标样式与旧版不完全一致
- **修复**：对齐旧版 `.search-form` 相关样式

### 15. 书签卡片样式差异
- **文件**：`components/bookmark/BookmarkCard.vue`
- **问题**：卡片 hover 效果、图标背景色、标题字号等与旧版有微小差异
- **修复**：对齐旧版 `.bookmark-card` 相关样式

---

## 新框架改进项（可保留）

以下新框架的增强设计建议保留：

- 导航 active 状态增加左侧紫色指示条
- 登录页增加 `max-width: 90vw` 响应式限制
- 错误消息增加粉色背景和圆角
- 登录表单输入框增加 placeholder 文本
- `index.vue` 仪表盘增加暗色主题 `@media` 规则（但不完整，需扩展到所有页面）

---

## 修复优先级建议

| 优先级 | 项目 | 预估工作量 |
|--------|------|-----------|
| P0-1 | 全局引入旧 CSS 文件 | 10 分钟 |
| P0-2 | 统计卡片样式恢复 | 15 分钟 |
| P0-3 | Badge 颜色恢复 | 5 分钟 |
| P0-4 | 管理后台移动端适配 | 30 分钟 |
| P0-5 | PromptPro 主题色对齐 | 30 分钟 |
| P0-6 | PromptPro 暗色模式 | 20 分钟 |
| P0-7 | PromptPro 移动端适配 | 20 分钟 |
| P1 | 弹窗/按钮/表格/导航/设置 细节对齐 | 40 分钟 |
| P2 | 首页组件细节对齐 | 30 分钟 |

**最快路径**：在 `nuxt.config.ts` 中全局引入旧 CSS 文件（`main-bundle.css` + `mobile-responsive.css` + `promptpro-bundle.css`），然后逐个修复组件 scoped 样式中与全局 CSS 冲突的部分。这样可以保留 90%+ 的旧样式，只需微调差异。
