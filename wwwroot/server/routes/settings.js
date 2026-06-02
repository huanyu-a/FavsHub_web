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

// 更新设置（前端可能调用，静默忽略，不写入数据库。所有设置由管理员后台管理）
router.put('/', (req, res) => {
  // 直接返回成功，不做任何数据库操作
  res.json({ data: req.body.data || {} });
});

module.exports = router;
