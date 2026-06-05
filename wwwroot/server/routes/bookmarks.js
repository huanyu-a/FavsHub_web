const { Router } = require('express');
const db = require('../db');
const { authMiddleware, optionalAuth } = require('../middleware/auth');

const router = Router();

// 获取书签 + 文件夹列表（支持 search 参数搜索）
// 游客：只看管理员的公开书签
// 登录用户：自己的全部 + 管理员的公开
router.get('/', optionalAuth, (req, res) => {
  try {
    const { folder_id, search } = req.query;
    const userId = req.user ? req.user.id : null;

    // 构建可见性条件
    let visibilityClause;
    const visParams = [];
    if (userId) {
      // 登录用户：自己的全部 + 管理员的公开
      visibilityClause = '(b.user_id = ? OR (b.login_required = 0 AND b.user_id IN (SELECT id FROM users WHERE is_admin = 1)))';
      visParams.push(userId);
    } else {
      // 游客：只看管理员的公开
      visibilityClause = '(b.login_required = 0 AND b.user_id IN (SELECT id FROM users WHERE is_admin = 1))';
    }

    let sql = `SELECT b.*, f.name as folder_name FROM bookmarks b LEFT JOIN folders f ON b.folder_id = f.id WHERE ${visibilityClause}`;
    const params = [...visParams];

    if (search) {
      const keywords = search.split(/\s+/).filter(k => k.length > 0);
      const conditions = keywords.map(kw => {
        let domainQ = `%${kw}%`;
        try {
          const match = kw.match(/^[\w.-]+\.[\w]{2,}/);
          if (match) domainQ = `%${match[0]}%`;
        } catch (e) {}
        return '(b.title LIKE ? OR b.url LIKE ? OR b.url LIKE ?)';
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
      sql += ' AND b.folder_id = ?';
      params.push(folder_id);
    }

    sql += ' ORDER BY b.sort_order, b.created_at';
    const bookmarks = db.prepare(sql).all(...params);

    // 文件夹：同样的可见性逻辑
    let folderSql;
    let folderParams = [];
    if (userId) {
      folderSql = `SELECT DISTINCT fo.* FROM folders fo WHERE (fo.user_id = ? OR (fo.user_id IN (SELECT id FROM users WHERE is_admin = 1) AND fo.id IN (SELECT folder_id FROM bookmarks WHERE login_required = 0 AND user_id IN (SELECT id FROM users WHERE is_admin = 1)))) ORDER BY fo.sort_order, fo.created_at`;
      folderParams = [userId];
    } else {
      folderSql = `SELECT DISTINCT fo.* FROM folders fo WHERE fo.user_id IN (SELECT id FROM users WHERE is_admin = 1) AND fo.id IN (SELECT folder_id FROM bookmarks WHERE login_required = 0 AND user_id IN (SELECT id FROM users WHERE is_admin = 1)) ORDER BY fo.sort_order, fo.created_at`;
    }
    const folders = db.prepare(folderSql).all(...folderParams);
    res.json({ bookmarks, folders });
  } catch (err) {
    console.error('[bookmarks] GET / error:', err.message);
    res.status(500).json({ error: '获取书签失败' });
  }
});

// 创建书签
router.post('/', authMiddleware, (req, res) => {
  try {
    const { title, url, folder_id, icon, login_required } = req.body;
    if (!title || !url) return res.status(400).json({ error: '标题和 URL 不能为空' });

    // 只有管理员可设置 login_required
    const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.user.id);
    const lr = (user && user.is_admin && login_required) ? 1 : 0;

    const now = Date.now();
    const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM bookmarks WHERE user_id = ?').get(req.user.id);
    const result = db.prepare('INSERT INTO bookmarks (user_id, title, url, folder_id, icon, sort_order, source, login_required, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(req.user.id, title, url, folder_id || null, icon || null, (maxOrder?.m || 0) + 1, 'web', lr, now, now);

    const bookmark = db.prepare('SELECT * FROM bookmarks WHERE id = ?').get(result.lastInsertRowid);
    res.json({ bookmark });
  } catch (err) {
    console.error('[bookmarks] POST / error:', err.message);
    res.status(500).json({ error: '创建书签失败' });
  }
});

// 批量重排序（必须在 /:id 之前）
router.put('/reorder', authMiddleware, (req, res) => {
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
router.put('/:id', authMiddleware, (req, res) => {
  try {
    const { title, url, folder_id, sort_order, icon, login_required } = req.body;
    const bookmark = db.prepare('SELECT * FROM bookmarks WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!bookmark) return res.status(404).json({ error: '书签不存在' });

    const now = Date.now();
    if (title !== undefined) db.prepare('UPDATE bookmarks SET title = ?, updated_at = ? WHERE id = ?').run(title, now, bookmark.id);
    if (url !== undefined) db.prepare('UPDATE bookmarks SET url = ?, updated_at = ? WHERE id = ?').run(url, now, bookmark.id);
    if (folder_id !== undefined) db.prepare('UPDATE bookmarks SET folder_id = ?, updated_at = ? WHERE id = ?').run(folder_id, now, bookmark.id);
    if (sort_order !== undefined) db.prepare('UPDATE bookmarks SET sort_order = ?, updated_at = ? WHERE id = ?').run(sort_order, now, bookmark.id);
    if (icon !== undefined) db.prepare('UPDATE bookmarks SET icon = ?, updated_at = ? WHERE id = ?').run(icon, now, bookmark.id);
    // 只有管理员可修改 login_required
    if (login_required !== undefined) {
      const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.user.id);
      if (user && user.is_admin) {
        db.prepare('UPDATE bookmarks SET login_required = ?, updated_at = ? WHERE id = ?').run(login_required ? 1 : 0, now, bookmark.id);
      }
    }

    const updated = db.prepare('SELECT * FROM bookmarks WHERE id = ?').get(bookmark.id);
    res.json({ bookmark: updated });
  } catch (err) {
    console.error('[bookmarks] PUT /:id error:', err.message);
    res.status(500).json({ error: '更新书签失败' });
  }
});

// 删除书签
router.delete('/:id', authMiddleware, (req, res) => {
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
