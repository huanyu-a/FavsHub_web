const { Router } = require('express');
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = Router();
router.use(authMiddleware);

// 获取书签 + 文件夹列表（支持 search 参数搜索）
router.get('/', (req, res) => {
  try {
    const { folder_id, search } = req.query;
    let sql = 'SELECT * FROM bookmarks WHERE user_id = ?';
    const params = [req.user.id];

    if (search) {
      // 多关键词全文搜索：匹配任一关键词即返回（OR 逻辑），前端按 calculateRelevance 评分排序
      const keywords = search.split(/\s+/).filter(k => k.length > 0);
      const conditions = keywords.map(kw => {
        let domainQ = `%${kw}%`;
        try {
          const match = kw.match(/^[\w.-]+\.[\w]{2,}/);
          if (match) domainQ = `%${match[0]}%`;
        } catch (e) {}
        return '(title LIKE ? OR url LIKE ? OR url LIKE ?)';
      });
      sql += ' AND (' + conditions.join(' OR ') + ')';
      for (const kw of keywords) {
        const q = `%${kw}%`;
        let domainQ = q;
        try {
          const match = kw.match(/^[\w.-]+\.[\w]{2,}/);
          if (match) domainQ = `%${match[0]}%`;
        } catch (e) {}
        params.push(q, q, domainQ);
      }
    }

    if (folder_id) {
      sql += ' AND folder_id = ?';
      params.push(folder_id);
    }

    sql += ' ORDER BY sort_order, created_at';
    const bookmarks = db.prepare(sql).all(...params);
    const folders = db.prepare('SELECT * FROM folders WHERE user_id = ? ORDER BY sort_order, created_at').all(req.user.id);
    res.json({ bookmarks, folders });
  } catch (err) {
    console.error('[bookmarks] GET / error:', err.message);
    res.status(500).json({ error: '获取书签失败' });
  }
});

// 创建书签
router.post('/', (req, res) => {
  try {
    const { title, url, folder_id, icon } = req.body;
    if (!title || !url) return res.status(400).json({ error: '标题和 URL 不能为空' });

    const now = Date.now();
    const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM bookmarks WHERE user_id = ?').get(req.user.id);
    const result = db.prepare('INSERT INTO bookmarks (user_id, title, url, folder_id, icon, sort_order, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(req.user.id, title, url, folder_id || null, icon || null, (maxOrder?.m || 0) + 1, 'web', now, now);

    const bookmark = db.prepare('SELECT * FROM bookmarks WHERE id = ?').get(result.lastInsertRowid);
    res.json({ bookmark });
  } catch (err) {
    console.error('[bookmarks] POST / error:', err.message);
    res.status(500).json({ error: '创建书签失败' });
  }
});

// 批量重排序（必须在 /:id 之前）
router.put('/reorder', (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items)) return res.status(400).json({ error: 'items 必须是数组' });

    const now = Date.now();
    const update = db.prepare('UPDATE bookmarks SET sort_order = ?, folder_id = ?, updated_at = ? WHERE id = ? AND user_id = ?');
    const tx = db.transaction(() => {
      for (const item of items) {
        update.run(item.sort_order, item.folder_id ?? null, now, item.id, req.user.id);
      }
    });
    tx();

    res.json({ success: true });
  } catch (err) {
    console.error('[bookmarks] PUT /reorder error:', err.message);
    res.status(500).json({ error: '重排序失败' });
  }
});

// 更新书签
router.put('/:id', (req, res) => {
  try {
    const { title, url, folder_id, sort_order, icon } = req.body;
    const bookmark = db.prepare('SELECT * FROM bookmarks WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!bookmark) return res.status(404).json({ error: '书签不存在' });

    const now = Date.now();
    if (title !== undefined) db.prepare('UPDATE bookmarks SET title = ?, updated_at = ? WHERE id = ?').run(title, now, bookmark.id);
    if (url !== undefined) db.prepare('UPDATE bookmarks SET url = ?, updated_at = ? WHERE id = ?').run(url, now, bookmark.id);
    if (folder_id !== undefined) db.prepare('UPDATE bookmarks SET folder_id = ?, updated_at = ? WHERE id = ?').run(folder_id, now, bookmark.id);
    if (sort_order !== undefined) db.prepare('UPDATE bookmarks SET sort_order = ?, updated_at = ? WHERE id = ?').run(sort_order, now, bookmark.id);
    if (icon !== undefined) db.prepare('UPDATE bookmarks SET icon = ?, updated_at = ? WHERE id = ?').run(icon, now, bookmark.id);

    const updated = db.prepare('SELECT * FROM bookmarks WHERE id = ?').get(bookmark.id);
    res.json({ bookmark: updated });
  } catch (err) {
    console.error('[bookmarks] PUT /:id error:', err.message);
    res.status(500).json({ error: '更新书签失败' });
  }
});

// 删除书签
router.delete('/:id', (req, res) => {
  try {
    const bookmark = db.prepare('SELECT * FROM bookmarks WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!bookmark) return res.status(404).json({ error: '书签不存在' });

    db.prepare('DELETE FROM bookmarks WHERE id = ?').run(bookmark.id);
    res.json({ success: true });
  } catch (err) {
    console.error('[bookmarks] DELETE /:id error:', err.message);
    res.status(500).json({ error: '删除书签失败' });
  }
});

module.exports = router;
