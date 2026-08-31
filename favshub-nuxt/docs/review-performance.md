# 性能与架构审查报告

> ⚠️ **历史归档**：本报告生成于 2026-07-28，反映当时代码状态。部分问题已在后续迭代中修复，部分结论可能已过时。请结合最新代码交叉验证，勿直接当作当前待办清单。
>
> **修复状态复核（2026-08-31）**：P1 ✅（首屏 SSR 30 条 + 挂载后补齐，API 支持 `?limit=`）· P2 ✅（`routeRules` 分级 + `server/middleware/cache-control.ts` 公开页升级 `public + s-maxage`）· P3 ✅（`GET /api/favicon?domain=` 服务端代理 + 本地缓存 + 并发去重 + 失败域名短期记忆）· P4 ✅（`idx_bookmarks_user_label_created` + 查询简化为 `b.label != ''`）· P5 ✅（分页参数，默认值取系统配置）· P6 ✅（按 folder_id 建 Map）· P7 ✅（`server/utils/settings-cache.ts` 解析缓存 + PUT 失效）· P8 ✅（轮询改 60s）· P9 ✅（CSP 区分 dev/prod，生产无 `unsafe-eval`）· P10 ✅（合并单 key `bookmark-colors:{userId}`，`utils/bookmark-colors.ts`）· P11 ✅（`server/plugins/rate-limit-cleanup.ts` 插件作用域 + SIGTERM 清理）· P12 ✅（timeout ID 收集，卸载统一 `clearTimeout`）

## [CRITICAL]

### P1. 首页全量 SSR 245 张书签卡片，HTML 体积 232KB
- 文件：`pages/index.vue`、`components/bookmark/BookmarkGrid.vue`、`BookmarkCard.vue`
- 首屏 232KB HTML ≈ 3670+ DOM 节点，首屏解析慢。
- 修复：首屏 SSR ≤30 张卡片，其余客户端懒加载；API 加 `?limit=` 默认 50。

### P2. 完全缺失 `Cache-Control` HTTP 缓存头
- 文件：`nuxt.config.ts:39-54`
- `routeRules` 只有安全头，没有 `Cache-Control`。CF 对 HTML 不缓存，每次都回源渲染 232KB HTML，TTFB 1.4–2s。
- 修复：给动态页加 `public, max-age=60, s-maxage=120, stale-while-revalidate=300`；API 加 `max-age=30`。

### P3. 客户端 favicon 请求风暴（200+ 并发）
- 文件：`utils/favicon.ts:32-42`、`BookmarkCard.vue:13-22`
- 无本地 icon 的书签走 `google.com/s2/favicons`，国内被墙 → 请求阻塞 5–10s。
- 修复：服务端代理 + 本地缓存；首屏 favicon `fetchpriority="high"`，其余 `loading="lazy"`。

### P4. `bookmarks` 表缺失关键复合索引
- 文件：`server/database/schema.ts:36-56`、`server/api/bookmarks/index.get.ts:95`
- `WHERE COALESCE(b.label,'')!=''` 和 `ORDER BY created_at DESC` 无索引。
- 修复：
  ```sql
  CREATE INDEX idx_bookmarks_user_label_created
    ON bookmarks(user_id, login_required, label, created_at DESC);
  ```
- 附加：`COALESCE(b.label,'')` 让索引失效。建议列约束改为 `DEFAULT '' NOT NULL`，查询简化为 `b.label != ''`。

## [MAJOR]

### P5. `/api/bookmarks` 无分页，单次可返回 500 条
- 文件：`server/api/bookmarks/index.get.ts:134-135`
- 响应体积随数据量线性增长，前端也无虚拟滚动。
- 修复：API 加 `?page=&limit=` 默认 50；客户端做无限滚动或分页器。

### P6. `folderGroups` computed 对每个文件夹过滤全量书签
- 文件：`components/bookmark/BookmarkGrid.vue:150-184`
- F 个文件夹 × N 张书签 = O(F×N)。
- 修复：先按 `folder_id` 建 `Map`，O(N) 构建 + O(1) 取。

### P7. `search-engines` 端点高频做 JSON 反序列化
- 文件：`server/api/search-engines.ts`
- 每次请求 `JSON.parse(settingsRow.data)` 后排序。
- 修复：排序字段独立存储为列。

### P8. 备份调度每 30 秒轮询一次
- 文件：`server/plugins/backup-scheduler.ts:98-100`
- 按天执行的任务，30 秒检查过于频繁。
- 修复：改为每分钟，或用 `node-cron` 精确到分钟触发。

### P9. CSP 包含 `unsafe-eval` 且生产未移除
- 文件：`nuxt.config.ts:50`
- Nuxt 3.15+ 生产已不需要 `unsafe-eval`。
- 修复：区分 dev/prod CSP，生产去掉 `unsafe-eval`。

## [MINOR]

### P10. `BookmarkCard` 每个卡片写 localStorage（245 key）
- 文件：`BookmarkCard.vue:131`
- 合并为单 key `bookmark-colors:{userId}`。

### P11. Rate limiter 清理定时器无插件作用域保护
- 文件：`server/utils/rate-limit.ts:20-26`
- 移入 `defineNitroPlugin`，`SIGTERM` 时清除。

### P12. `pages/index.vue` 的 `setTimeout` 泄漏
- 文件：`pages/index.vue:294-307`
- 存 timeout ID，`onBeforeUnmount` 清理。

---

**总结：严重 4 | 重要 5 | 轻微 4 | 合计 13**
