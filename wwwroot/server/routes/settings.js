const { Router } = require('express');
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = Router();
router.use(authMiddleware);

// 获取设置（仅返回管理员设定的系统默认值，不再有用户个人设置）
router.get('/', (req, res) => {
  try {
    const sysRow = db.prepare('SELECT data FROM settings WHERE user_id = 0').get();
    let sysData = {};
    if (sysRow && sysRow.data) {
      try { sysData = JSON.parse(sysRow.data); } catch (e) {
        console.warn('[Settings] 系统默认设置 JSON 解析失败:', e.message);
      }
    }
    res.json({ data: sysData });
  } catch (err) {
    console.error('[Settings] 获取设置失败:', err);
    res.status(500).json({ error: '获取设置失败' });
  }
});

// 更新设置（前端写入用户设置，合并到 user_id=0 的系统默认设置）
router.put('/', (req, res) => {
  try {
    const { data } = req.body;
    if (!data || typeof data !== 'object') {
      return res.status(400).json({ error: 'data 必须是对象' });
    }

    const row = db.prepare('SELECT data FROM settings WHERE user_id = 0').get();
    const existing = row ? JSON.parse(row.data) : {};
    const merged = { ...existing, ...data };

    db.prepare('INSERT OR IGNORE INTO settings (user_id, data) VALUES (0, ?)').run('{}');
    db.prepare('UPDATE settings SET data = ? WHERE user_id = 0').run(JSON.stringify(merged));

    res.json({ data: merged });
  } catch (err) {
    console.error('[Settings] 更新设置失败:', err);
    res.status(500).json({ error: '更新设置失败' });
  }
});

module.exports = router;
