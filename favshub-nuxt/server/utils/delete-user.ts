/**
 * 集中删除用户全部数据（D7/A7）
 * 按外键依赖顺序显式清理各表，避免手写多条 DELETE 时遗漏新表。
 * 依赖：collections/collection_* 的 user_id 外键带 ON DELETE CASCADE，
 * 但 bookmarks/prompts/folders 等表在存量库中可能无 CASCADE，故仍显式删除。
 */
import type Database from 'better-sqlite3'

export function deleteUserData(db: Database.Database, userId: number) {
  const tx = db.transaction(() => {
    // 精选集相关（collection_bookmarks 引用 bookmarks，须先于 bookmarks 删除）
    db.prepare('DELETE FROM collection_bookmarks WHERE collection_id IN (SELECT id FROM collections WHERE user_id = ?)').run(userId)
    db.prepare('DELETE FROM collections WHERE user_id = ?').run(userId)

    // 提示词相关（prompt_tags / prompt_versions / prompt_review_requests 引用 prompts）
    db.prepare('DELETE FROM prompt_review_requests WHERE prompt_id IN (SELECT id FROM prompts WHERE user_id = ?)').run(userId)
    db.prepare('DELETE FROM prompt_tags WHERE prompt_id IN (SELECT id FROM prompts WHERE user_id = ?)').run(userId)
    db.prepare('DELETE FROM prompt_versions WHERE prompt_id IN (SELECT id FROM prompts WHERE user_id = ?)').run(userId)
    db.prepare('DELETE FROM prompts WHERE user_id = ?').run(userId)
    db.prepare('DELETE FROM prompt_folders WHERE user_id = ?').run(userId)
    db.prepare('DELETE FROM tags WHERE user_id = ?').run(userId)

    // 书签 / 文件夹（collection_imports.bookmark_id、collection_bookmarks.bookmark_id 均 ON DELETE CASCADE）
    db.prepare('DELETE FROM bookmarks WHERE user_id = ?').run(userId)
    db.prepare('UPDATE folders SET parent_id = NULL WHERE user_id = ?').run(userId)
    db.prepare('DELETE FROM folders WHERE user_id = ?').run(userId)

    // 用户提交的搜索引擎（search_engines.user_id 无外键，须显式删除，避免孤儿数据）
    db.prepare('DELETE FROM search_engines WHERE user_id = ?').run(userId)

    // 提示词审核申请（引用 user_id / reviewed_by）
    db.prepare('DELETE FROM prompt_review_requests WHERE user_id = ? OR reviewed_by = ?').run(userId, userId)

    // 设置
    db.prepare('DELETE FROM settings WHERE user_id = ?').run(userId)

    // 用户本体
    db.prepare('DELETE FROM users WHERE id = ?').run(userId)
  })
  tx()
}
