# FavsHub 深度自检汇总报告

> ⚠️ **历史归档**：本报告生成于 2026-07-28，反映当时代码状态。部分问题已在后续迭代中修复，部分结论可能已过时。请结合最新代码交叉验证，勿直接当作当前待办清单。

> 范围：favshub-nuxt（Nuxt 3 + better-sqlite3 + JWT）

## 一、按严重度总览

| 级别 | 数量 | 说明 |
|------|------|------|
| [CRITICAL] | 7 | 必须尽快修 |
| [MAJOR] | 12 | 本迭代内修 |
| [MINOR] | 11 | 有空就修 |

---

## 二、CRITICAL（7 条）

### C1. 缺失 HTTP 缓存头，CF 每次回源
- 文件：`nuxt.config.ts:39-54`
- `routeRules` 只有安全头，没有 `Cache-Control`。CF 对 HTML 不缓存，每次都穿透源站渲染 232KB HTML，TTFB 1.4–2s。
- 修复：给动态页加 `public, max-age=60, stale-while-revalidate=300`；API 加 `max-age=30`。

### C2. 首页 SSR 232KB，245 张卡片全量渲染
- 文件：`pages/index.vue`、`components/bookmark/BookmarkGrid.vue`、`BookmarkCard.vue`
- 首屏 232KB HTML ≈ 3670+ DOM 节点，首屏解析慢。
- 修复：首屏 SSR ≤30 张卡片，其余客户端懒加载；API 加 `?limit=` 默认 50。

### C3. 客户端 favicon 请求风暴（200+ 并发）
- 文件：`utils/favicon.ts:32-42`、`BookmarkCard.vue:13-22`
- 无本地 icon 的书签走 `google.com/s2/favicons`，国内被墙 → 请求阻塞 5–10s。
- 修复：服务端代理 + 本地缓存；首屏 favicon `fetchpriority="high"`，其余 `loading="lazy"`。

### C4. bookmarks 表缺失关键复合索引
- 文件：`server/database/schema.ts:36-56`、`migrate.ts`、`server/api/bookmarks/index.get.ts:95`
- `WHERE COALESCE(b.label,'')!=''` 和 `ORDER BY created_at DESC` 无索引，随数据增长线性变慢。
- 修复：
  ```sql
  CREATE INDEX idx_bookmarks_user_label_created
    ON bookmarks(user_id, login_required, label, created_at DESC);
  ```
- 附加：`COALESCE(b.label,'')` 让索引失效。建议列约束改为 `DEFAULT '' NOT NULL`，查询简化为 `b.label != ''`。

### C5. BookmarkGrid.vue `gridEls` 内存泄漏
- 文件：`components/bookmark/BookmarkGrid.vue:97-100`
- `setGridRef` 把 DOM 推入 `gridEls` 数组，组件销毁时未清空。
- 修复：在 `onBeforeUnmount` 里 `gridEls.length = 0`。

### C6. 切换文件夹的 `setTimeout` 泄漏
- 文件：`pages/index.vue:294-307`
- 每次点击创建 `setTimeout`，组件销毁时未 `clearTimeout`。快速点击累积多个。
- 修复：存 timeout ID，在 `onBeforeUnmount` 清理。

### C7. API 层的 `getLockedFolders` + `filterByInheritance` 双重 O(n²)
- 文件：`server/api/bookmarks/index.get.ts:18-58`
- 两次遍历都用了 `folders.find(p => p.id === f.parent_id)`，1000 文件夹时 ≈ 200 万次比较。
- 修复：用 `Map` 替换 `find`，合并为单次遍历。

---

## 三、MAJOR（12 条）

### M1. `/api/bookmarks` 无分页，单次可返回 500 条
- 文件：`server/api/bookmarks/index.get.ts:134-135`
- 响应体积随数据量线性增长，前端也没有虚拟滚动。
- 修复：API 加 `?page=&limit=` 默认 50；客户端做无限滚动或分页器。

### M2. `folderGroups` computed 对每个文件夹过滤全量书签
- 文件：`components/bookmark/BookmarkGrid.vue:150-184`
- F 个文件夹 × N 张书签 = O(F×N)。
- 修复：先按 `folder_id` 建 `Map`，O(N) 构建 + O(1) 取。

### M3. `search-engines` 端点高频做 JSON 反序列化
- 文件：`server/api/search-engines.ts`
- 每次请求 `JSON.parse(settingsRow.data)` 后排序。首页搜索栏高频调用。
- 修复：排序字段独立存储为列，避免全量 JSON 反序列化。

### M4. 备份调度每 30 秒轮询一次
- 文件：`server/plugins/backup-scheduler.ts:98-100`
- 按天执行的任务，30 秒检查过于频繁。
- 修复：改为每分钟，或用 `node-cron` 精确到分钟触发。

### M5. Rate limiter 清理定时器无插件作用域保护
- 文件：`server/utils/rate-limit.ts:20-26`
- 模块顶层执行，多实例/热更新时可能泄漏定时器。
- 修复：移入 `defineNitroPlugin`，`SIGTERM` 时清除。

### M6. CSP 包含 `unsafe-eval` 且生产未移除
- 文件：`nuxt.config.ts:50`
- 注释说 dev 模式 HMR 需要，但 Nuxt 3.15+ 生产已不需要。
- 修复：区分 dev/prod CSP，生产去掉 `unsafe-eval`。

### M7. bookmark-labels.ts label 回填逻辑误判管理员公共池
- 文件：`server/database/migrate.ts:385-408`、`server/api/bookmarks/index.get.ts`
- 历史迁移曾把公共池书签标成 `legacy`，已通过 `migrate.ts` 修正，但仍有遗留风险。
- 修复：确认 `label=''` 只在管理员且无 source/container 标记时保留；加审计查询。

### M8. `collections/[id].get.ts` 精选集 JOIN 无覆盖索引
- 文件：`server/api/collections/[id].get.ts:46-48`
- COUNT 虽走 `idx_cb_collection`，但书签 JOIN + 多列 COALESCE 排序无复合索引。
- 修复：加 `idx_cb_collection_sort = (collection_id, sort_order)`。

### M9. `BookmarkCard` 每个卡片写 localStorage（245 key）
- 文件：`BookmarkCard.vue:131`
- localStorage 同步写入阻塞主线程，部分浏览器 5MB 上限易触发 `QuotaExceededError`。
- 修复：合并为单 key `bookmark-colors:{userId}` → `{id: {primary, secondary, ts}}`。

### M10. `useFetch` 缓存策略未启用
- 文件：`pages/index.vue` 等
- 客户端 Pinia 数据未做 `stale-while-revalidate`。
- 修复：`useFetch` 加 `dedupe: 'defer'` + 合适的 `Cache-Control`。

### M11. 前端 error.ts 全局错误处理未分类
- 文件：`server/plugins/error-handler.ts`
- 错误响应统一返回 500，缺少 400/403/404 细分。
- 修复：按错误类型映射状态码，避免把 404 显示成 500。

### M12. `admin/bookmarks` 与 `admin/collections` 前端未做请求去重
- 文件：`pages/admin/bookmarks.vue`、`pages/admin/collections.vue`
- 同一 API 在 `onMounted` + `watch` 里可能重复调用。
- 修复：请求去重或共享 store 缓存。

---

## 四、MINOR（11 条）

1. `BookmarkCard.vue:46` `iconFailed` 用 `ref(false)` 重置不够健壮，建议用 `watch` 监听 `bookmark.icon` 重置。
2. `BookmarkEditDialog.vue` 表单校验：URL 未校验格式、标题未限制长度。
3. `Sidebar.vue` 折叠状态存 localStorage，但换用户不清缓存（不同用户文件夹不同）。
4. `admin/config.vue` 的 `favicon_source_url` 未做 URL 格式校验。
5. `backup/download.get.ts` 下载前未 `wal_checkpoint(TRUNCATE)`（仅主流程调了一次）。
6. `search-engines.get.ts` 排序算法用 `localeCompare` 在高频调用时有小开销。
7. `prompts` 模块的 XSS 防御：描述字段用 `v-text` 渲染，但部分入口用 `{{ }}` 仍安全；未审计动态 HTML 插入点。
8. `robots.txt` 未动态生成，sitemap 链接硬编码。
9. `Dockerfile` 未用多阶段之外的 `node:20-alpine` 精简层。
10. `build.sh` 未校验 `pnpm build` 退出码（仅靠 `set -e`）。
11. `public/css/` 无 minify 步骤（依赖 Vite 构建产物已压缩，但旧 bundle 未清理）。

---

## 五、架构层面

- 单体架构对当前规模合理，瓶颈在 I/O（CDN/缓存层）和 SSR 渲染策略，不在数据库。
- 扩展路径清晰：HTTP 缓存 + SSR 降载 → Redis 做 session/rate-limit 共享 → PostgreSQL 支持水平扩展。

---

## 六、最重要的 3 条（建议本迭代优先）

1. **[C1] 加 HTTP 缓存头** — 一行配置让 CF 缓存 HTML 60s，回源频率降 90%+，TTFB 立即降到 ~50ms。
2. **[C2] 首页 SSR 降载** — 首屏只 SSR 30 张 + 客户端懒加载，HTML 从 232KB 降到 ~40KB，DOM 节点降 85%。
3. **[C3] favicon 请求风暴** — 服务端代理 + 本地缓存可完全消除首屏 favicon 外网请求。

---

## 七、各维度得分（粗估）

| 维度 | 得分 | 说明 |
|------|------|------|
| 安全性 | 中等偏上 | JWT/CSP/参数化 SQL 基本到位；CSP `unsafe-eval` 与 rate-limit 作用域需收紧 |
| 正确性 | 中等 | label 语义、空分类、精选集分类继承均已修；仍有边缘场景 |
| 性能 | 中 | 源站够快；CF 回源 + SSR 过重是主要瓶颈 |
| 可维护性 | 良好 | 结构清晰、命名统一；注释偏少 |
| 健壮性 | 中等 | 错误处理、内存泄漏、定时器清理需补 |

---

**报告目录**：`favshub-nuxt/docs/review-{security,api,database,frontend,performance}.md`（各 agent 原始报告）
