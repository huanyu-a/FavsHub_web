const { Router } = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = Router();
router.use(authMiddleware);

// 获取标签列表（兼容前端 tag_id, tag_name 字段）
router.get('/', (req, res) => {
  try {
    const tags = db.prepare('SELECT * FROM tags WHERE user_id = ? ORDER BY name').all(req.user.id);
    res.json({ tags: tags.map(t => ({ ...t, tag_id: t.id, tag_name: t.name })) });
  } catch (err) {
    console.error('[tags] GET / error:', err.message);
    res.status(500).json({ error: '获取标签失败' });
  }
});

// 创建标签
router.post('/', (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: '标签名不能为空' });

    const existing = db.prepare('SELECT * FROM tags WHERE user_id = ? AND name = ?').get(req.user.id, name);
    if (existing) return res.json({ tag: existing });

    const id = uuidv4();
    db.prepare('INSERT INTO tags (id, user_id, name, created_at) VALUES (?, ?, ?, ?)').run(id, req.user.id, name, Date.now());

    const tag = db.prepare('SELECT * FROM tags WHERE id = ?').get(id);
    res.json({ tag });
  } catch (err) {
    console.error('[tags] POST / error:', err.message);
    res.status(500).json({ error: '创建标签失败' });
  }
});

// 更新标签
router.put('/:id', (req, res) => {
  try {
    const { name, color } = req.body;
    const tag = db.prepare('SELECT * FROM tags WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!tag) return res.status(404).json({ error: '标签不存在' });
    if (!name && !color) return res.status(400).json({ error: '没有要更新的字段' });

    if (name !== undefined) {
      if (!name.trim()) return res.status(400).json({ error: '标签名不能为空' });
      const existing = db.prepare('SELECT * FROM tags WHERE user_id = ? AND name = ? AND id != ?').get(req.user.id, name.trim(), tag.id);
      if (existing) return res.status(409).json({ error: '标签名已存在' });
      db.prepare('UPDATE tags SET name = ?, updated_at = ? WHERE id = ?').run(name.trim(), Date.now(), tag.id);
    }
    if (color !== undefined) {
      db.prepare('UPDATE tags SET color = ?, updated_at = ? WHERE id = ?').run(color, Date.now(), tag.id);
    }

    const updated = db.prepare('SELECT * FROM tags WHERE id = ?').get(tag.id);
    res.json({ tag: { ...updated, tag_id: updated.id, tag_name: updated.name } });
  } catch (err) {
    console.error('[tags] PUT /:id error:', err.message);
    res.status(500).json({ error: '更新标签失败' });
  }
});

// 删除标签
router.delete('/:id', (req, res) => {
  try {
    const tag = db.prepare('SELECT * FROM tags WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
    if (!tag) return res.status(404).json({ error: '标签不存在' });

    db.prepare('DELETE FROM tags WHERE id = ?').run(tag.id);
    res.json({ success: true });
  } catch (err) {
    console.error('[tags] DELETE /:id error:', err.message);
    res.status(500).json({ error: '删除标签失败' });
  }
});

module.exports = router;
