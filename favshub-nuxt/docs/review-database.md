# 数据库与迁移审查报告

> ⚠️ **历史归档**：本报告生成于 2026-07-28，反映当时代码状态。部分问题已在后续迭代中修复，部分结论可能已过时。请结合最新代码交叉验证，勿直接当作当前待办清单。
>
> **修复状态复核（2026-08-31）**：D1 ✅（`folders`/`prompt_folders` 等 user_id 外键已加 `ON DELETE CASCADE`，存量库由 `delete-user.ts` 显式兜底）· D2 ✅（`idx_search_engines_category (status, category, sort_order)`）· D3 ✅（`idx_bookmarks_user_id` 已建）· D4 ⏳（`has_sync` 虚拟列 LIKE 模式保留，JSON 写法可控）· D5 ✅（stats 改 JOIN）· D6 ✅（删文件夹时清空书签 `folder_id`）· D7 ✅（集中清理 `server/utils/delete-user.ts`）· D8 ⏳（`bookmark_count` 冗余字段增删两侧同步维护，未见触发器/定期校验）· D9 ✅（迁移清理重复关联后建 UNIQUE 索引）· D10 ✅（`idx_bookmarks_updated_at`）

## [CRITICAL]

### D1. `folders` / `prompt_folders` 外键无 `ON DELETE CASCADE`
- 文件：`server/database/migrate.ts:27-36, 51-58`
- `folders.user_id` 和 `prompt_folders.user_id` 外键无 CASCADE。`admin/users/[id].delete.ts` 手动清理，但任何直接 DELETE 路径会因 FK 约束失败或留下孤儿记录。
- 修复：加 `ON DELETE CASCADE` 或 `ON DELETE SET NULL`。

### D2. 普通用户查询 `search_engines` 全表扫描
- 文件：`server/api/admin/search-engines/index.get.ts:31-42`
- 无索引覆盖 `WHERE category = ?` 查询。
- 修复：加 `idx_search_engines_category`。

## [MAJOR]

### D3. `bookmarks` 全量同步 DELETE 全表扫描
- 文件：`server/api/sync/bookmarks/index.post.ts:90`
- 同步时 `DELETE FROM bookmarks WHERE user_id = ?` 无索引覆盖。
- 修复：确认 `idx_bookmarks_user_id` 存在且被使用。

### D4. `has_sync` 虚拟列的 LIKE 模式误匹配风险
- 文件：`server/database/migrate.ts:290-292`、`server/utils/bookmark-labels.ts:52`
- `source LIKE '%"sync"%'` 可能误匹配非 sync 来源。
- 修复：用 JSON 解析或独立字段标记。

### D5. `prompt_versions` 统计用子查询而非 JOIN
- 文件：`server/api/user/stats.get.ts:17`
- `SELECT COUNT(*) FROM prompt_versions WHERE prompt_id = ?` 每行一次子查询。
- 修复：用 JOIN + GROUP BY 一次性统计。

### D6. 删除文件夹不会级联清空书签 `folder_id`
- 文件：`server/api/folders/[id].delete.ts:27-31`
- 删除文件夹后，书签 `folder_id` 仍指向已删除文件夹，成为孤儿。
- 修复：删除时 `UPDATE bookmarks SET folder_id = NULL WHERE folder_id = ?`。

### D7. 删除用户时手写 10+ 条 DELETE，遗漏风险高
- 文件：`server/api/admin/users/[id].delete.ts:27-39`
- 手动清理各表，易遗漏新表。
- 修复：用 FK CASCADE 或集中清理函数。

## [MINOR]

### D8. `collections.bookmark_count` 冗余字段不一致
- 文件：`server/database/schema.ts:165`、`server/api/collections/[id]/bookmarks/[bookmarkId].delete.ts:38`
- 冗余字段可能与实际 COUNT 不一致。
- 修复：用触发器或定期校验。

### D9. `prompt_tags` 表缺 `UNIQUE(prompt_id, tag_id)` 约束
- 文件：`server/database/migrate.ts`
- 写入侧无保护，可能产生重复关联。
- 修复：加 UNIQUE 约束。

### D10. `sync/bookmarks/since.get.ts` 时间范围查询无法使用现有索引
- 文件：`server/api/sync/bookmarks/since.get.ts`
- `WHERE updated_at > ?` 无索引。
- 修复：加 `idx_bookmarks_updated_at`。

---

**总结：严重 2 | 重要 5 | 轻微 3 | 合计 10**
