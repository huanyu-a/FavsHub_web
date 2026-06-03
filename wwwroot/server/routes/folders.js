const { Router } = require('express');
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = Router();
router.use(authMiddleware);

// 获取文件夹列表
router.get('/', (req, res) => {
  try {
    const folders = db.prepare('SELECT * FROM folders WHERE user_id = ? ORDER BY sort_order, created_at').all(req.user.id);
    res.json({ folders });
  } catch (err) {
    console.error('[folders] GET / error:', err.message);
    res.status(500).json({ error: '获取文件夹失败' });
  }
});

// 创建文件夹
router.post('/', (req, res) => {
  try {
    const { name, parent_id } = req.body;
    if (!name) return res.status(400).json({ error: '文件夹名称不能为空' });

    const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM folders WHERE user_id = ?').get(req.user.id);
    const result = db.prepare('INSERT INTO folders (user_id, name, parent_id, sort_order) VALUES (?, ?, ?, ?)').run(req.user.id, name, parent_id || null, (maxOrder?.m || 0) + 1);

    const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(result.lastInsertRowid);
    res.json({ folder });
  } catch (err) {
    console.error('[folders] POST / error:', err.message);
    res.status(500).json({ error: '创建文件夹失败' });
  }
});

// 更新文件夹
router.put('/:id', (req, res) => {
  try {
    const { name, sort_order } = req.body;
    const folder = db.prepare('SELECT * FROM folders WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!folder) return res.status(404).json({ error: '文件夹不存在' });

    const tx = db.transaction(() => {
      if (name !== undefined) db.prepare('UPDATE folders SET name = ? WHERE id = ? AND user_id = ?').run(name, folder.id, req.user.id);
      if (sort_order !== undefined) db.prepare('UPDATE folders SET sort_order = ? WHERE id = ? AND user_id = ?').run(sort_order, folder.id, req.user.id);
    });
    tx();

    const updated = db.prepare('SELECT * FROM folders WHERE id = ?').get(folder.id);
    res.json({ folder: updated });
  } catch (err) {
    console.error('[folders] PUT /:id error:', err.message);
    res.status(500).json({ error: '更新文件夹失败' });
  }
});

// 删除文件夹（子文件夹和书签的 folder_id 置空）
router.delete('/:id', (req, res) => {
  try {
    const folder = db.prepare('SELECT * FROM folders WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!folder) return res.status(404).json({ error: '文件夹不存在' });

    const tx = db.transaction(() => {
      db.prepare('UPDATE bookmarks SET folder_id = NULL WHERE folder_id = ? AND user_id = ?').run(folder.id, req.user.id);
      db.prepare('UPDATE folders SET parent_id = ? WHERE parent_id = ? AND user_id = ?').run(folder.parent_id, folder.id, req.user.id);
      db.prepare('DELETE FROM folders WHERE id = ?').run(folder.id);
    });
    tx();

    res.json({ success: true });
  } catch (err) {
    console.error('[folders] DELETE /:id error:', err.message);
    res.status(500).json({ error: '删除文件夹失败' });
  }
});

module.exports = router;
