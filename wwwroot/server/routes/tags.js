const { Router } = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = Router();
router.use(authMiddleware);

// 获取标签列表（兼容前端 tag_id, tag_name 字段）
router.get('/', (req, res) => {
  const tags = db.prepare('SELECT * FROM tags WHERE user_id = ? ORDER BY name').all(req.user.id);
  res.json({ tags: tags.map(t => ({ ...t, tag_id: t.id, tag_name: t.name })) });
});

// 创建标签
router.post('/', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: '标签名不能为空' });

  const existing = db.prepare('SELECT * FROM tags WHERE user_id = ? AND name = ?').get(req.user.id, name);
  if (existing) return res.json({ tag: existing });

  const id = uuidv4();
  db.prepare('INSERT INTO tags (id, user_id, name, created_at) VALUES (?, ?, ?, ?)').run(id, req.user.id, name, Date.now());

  const tag = db.prepare('SELECT * FROM tags WHERE id = ?').get(id);
  res.json({ tag });
});

// 更新标签
router.put('/:id', (req, res) => {
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
});

// 删除标签
router.delete('/:id', (req, res) => {
  const tag = db.prepare('SELECT * FROM tags WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!tag) return res.status(404).json({ error: '标签不存在' });

  db.prepare('DELETE FROM tags WHERE id = ?').run(tag.id);
  res.json({ success: true });
});

module.exports = router;
