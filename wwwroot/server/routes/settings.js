const { Router } = require('express');
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = Router();
router.use(authMiddleware);

// 获取设置
router.get('/', (req, res) => {
  const row = db.prepare('SELECT data FROM settings WHERE user_id = ?').get(req.user.id);
  res.json({ data: row ? JSON.parse(row.data) : {} });
});

// 更新设置（合并更新，非完全替换）
router.put('/', (req, res) => {
  const { data } = req.body;
  if (!data || typeof data !== 'object') return res.status(400).json({ error: 'data 必须是对象' });

  // 读取现有设置，合并后再写入
  const row = db.prepare('SELECT data FROM settings WHERE user_id = ?').get(req.user.id);
  const existing = row ? JSON.parse(row.data) : {};
  const merged = { ...existing, ...data };

  db.prepare('INSERT OR REPLACE INTO settings (user_id, data) VALUES (?, ?)').run(req.user.id, JSON.stringify(merged));
  res.json({ data: merged });
});

module.exports = router;
