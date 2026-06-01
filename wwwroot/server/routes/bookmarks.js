const { Router } = require('express');
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = Router();
router.use(authMiddleware);

// 获取书签 + 文件夹列表
router.get('/', (req, res) => {
  const { folder_id } = req.query;
  let bookmarks;
  if (folder_id) {
    bookmarks = db.prepare('SELECT * FROM bookmarks WHERE user_id = ? AND folder_id = ? ORDER BY sort_order, created_at').all(req.user.id, folder_id);
  } else {
    bookmarks = db.prepare('SELECT * FROM bookmarks WHERE user_id = ? ORDER BY sort_order, created_at').all(req.user.id);
  }
  const folders = db.prepare('SELECT * FROM folders WHERE user_id = ? ORDER BY sort_order, created_at').all(req.user.id);
  res.json({ bookmarks, folders });
});

// 创建书签
router.post('/', (req, res) => {
  const { title, url, folder_id, icon } = req.body;
  if (!title || !url) return res.status(400).json({ error: '标题和 URL 不能为空' });

  const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM bookmarks WHERE user_id = ?').get(req.user.id);
  const result = db.prepare('INSERT INTO bookmarks (user_id, title, url, folder_id, icon, sort_order) VALUES (?, ?, ?, ?, ?, ?)').run(req.user.id, title, url, folder_id || null, icon || null, (maxOrder?.m || 0) + 1);

  const bookmark = db.prepare('SELECT * FROM bookmarks WHERE id = ?').get(result.lastInsertRowid);
  res.json({ bookmark });
});

// 批量重排序（必须在 /:id 之前）
router.put('/reorder', (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'items 必须是数组' });

  const update = db.prepare('UPDATE bookmarks SET sort_order = ?, folder_id = ? WHERE id = ? AND user_id = ?');
  const tx = db.transaction(() => {
    for (const item of items) {
      update.run(item.sort_order, item.folder_id ?? null, item.id, req.user.id);
    }
  });
  tx();

  res.json({ success: true });
});

// 更新书签
router.put('/:id', (req, res) => {
  const { title, url, folder_id, sort_order, icon } = req.body;
  const bookmark = db.prepare('SELECT * FROM bookmarks WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!bookmark) return res.status(404).json({ error: '书签不存在' });

  if (title !== undefined) db.prepare('UPDATE bookmarks SET title = ? WHERE id = ?').run(title, bookmark.id);
  if (url !== undefined) db.prepare('UPDATE bookmarks SET url = ? WHERE id = ?').run(url, bookmark.id);
  if (folder_id !== undefined) db.prepare('UPDATE bookmarks SET folder_id = ? WHERE id = ?').run(folder_id, bookmark.id);
  if (sort_order !== undefined) db.prepare('UPDATE bookmarks SET sort_order = ? WHERE id = ?').run(sort_order, bookmark.id);
  if (icon !== undefined) db.prepare('UPDATE bookmarks SET icon = ? WHERE id = ?').run(icon, bookmark.id);

  const updated = db.prepare('SELECT * FROM bookmarks WHERE id = ?').get(bookmark.id);
  res.json({ bookmark: updated });
});

// 删除书签
router.delete('/:id', (req, res) => {
  const bookmark = db.prepare('SELECT * FROM bookmarks WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!bookmark) return res.status(404).json({ error: '书签不存在' });

  db.prepare('DELETE FROM bookmarks WHERE id = ?').run(bookmark.id);
  res.json({ success: true });
});

module.exports = router;
