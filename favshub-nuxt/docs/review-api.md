# API 正确性审查报告

> reviewer: API 正确性 · 2026-07-28

## [CRITICAL]

### A1. `/api/bookmarks` 无分页，单次可返回 500 条
- 文件：`server/api/bookmarks/index.get.ts:134-135`
- 响应体积随数据量线性增长。
- 修复：API 加 `?page=&limit=` 默认 50。

### A2. `getLockedFolders` + `filterByInheritance` 双重 O(n²)
- 文件：`server/api/bookmarks/index.get.ts:18-58`
- 两处都用 `folders.find(p => p.id === f.parent_id)`。
- 修复：用 `Map` 替换 `find`，合并为单次遍历。

## [MAJOR]

### A3. `search-engines` 端点高频做 JSON 反序列化
- 文件：`server/api/search-engines.ts`
- 每次请求 `JSON.parse(settingsRow.data)` 后排序。
- 修复：排序字段独立存储为列。

### A4. `folderGroups` computed 对每个文件夹过滤全量书签
- 文件：`components/bookmark/BookmarkGrid.vue:150-184`
- O(F×N)。
- 修复：先按 `folder_id` 建 `Map`。

### A5. `COALESCE(b.label, '') != ''` 使索引不可用
- 文件：`server/api/bookmarks/index.get.ts:95`
- 函数包装导致 B-tree 索引无法用于过滤。
- 修复：列约束改为 `DEFAULT '' NOT NULL`，查询简化为 `b.label != ''`。

### A6. 删除文件夹不会级联清空书签 `folder_id`
- 文件：`server/api/folders/[id].delete.ts:27-31`
- 修复：删除时 `UPDATE bookmarks SET folder_id = NULL`。

### A7. 删除用户时手写 10+ 条 DELETE
- 文件：`server/api/admin/users/[id].delete.ts:27-39`
- 修复：用 FK CASCADE 或集中清理函数。

## [MINOR]

### A8. `prompt_versions` 统计用子查询
- 文件：`server/api/user/stats.get.ts:17`
- 修复：用 JOIN + GROUP BY。

### A9. `sync/bookmarks/since.get.ts` 时间范围查询无索引
- 文件：`server/api/sync/bookmarks/since.get.ts`
- 修复：加 `idx_bookmarks_updated_at`。

### A10. `collections.bookmark_count` 冗余字段不一致
- 文件：`server/database/schema.ts:165`
- 修复：用触发器或定期校验。

---

**总结：严重 2 | 重要 5 | 轻微 3 | 合计 10**
