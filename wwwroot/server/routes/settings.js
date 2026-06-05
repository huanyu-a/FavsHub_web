const { Router } = require('express');
const db = require('../db');
const { authMiddleware, optionalAuth } = require('../middleware/auth');

const router = Router();

// 敏感字段黑名单：不应暴露给非管理员用户
const SENSITIVE_KEYS = ['baiduAppKey'];
function filterSensitiveKeys(data) {
  const filtered = { ...data };
  SENSITIVE_KEYS.forEach(key => delete filtered[key]);
  return filtered;
}

// 获取设置（系统默认 + 用户偏好合并，用户偏好优先）
// 游客：只返回系统默认设置
// 登录用户：系统默认 + 用户偏好合并
router.get('/', optionalAuth, (req, res) => {
  try {
    // 系统默认设置（user_id=0，管理员设定）
    const sysRow = db.prepare('SELECT data FROM settings WHERE user_id = 0').get();
    let sysData = {};
    if (sysRow && sysRow.data) {
      try { sysData = JSON.parse(sysRow.data); } catch (e) {
        console.warn('[Settings] 系统默认设置 JSON 解析失败:', e.message);
      }
    }

    // 游客只返回系统默认（过滤敏感字段）
    if (!req.user) {
      return res.json({ data: filterSensitiveKeys(sysData) });
    }

    // 用户个人偏好（per-user，仅该用户可见）
    const userRow = db.prepare('SELECT data FROM settings WHERE user_id = ?').get(req.user.id);
    let userData = {};
    if (userRow && userRow.data) {
      try { userData = JSON.parse(userRow.data); } catch (e) {
        console.warn('[Settings] 用户设置 JSON 解析失败:', e.message);
      }
    }

    // 合并：系统默认 + 用户偏好（用户偏好覆盖系统默认，过滤敏感字段）
    const merged = { ...filterSensitiveKeys(sysData), ...userData };
    res.json({ data: merged });
  } catch (err) {
    console.error('[Settings] 获取设置失败:', err);
    res.status(500).json({ error: '获取设置失败' });
  }
});

// 更新设置（仅写入当前用户的偏好行，不影响系统默认值）
router.put('/', authMiddleware, (req, res) => {
  try {
    const { data } = req.body;
    if (!data || typeof data !== 'object') {
      return res.status(400).json({ error: 'data 必须是对象' });
    }

    // 读取该用户已有的设置并合并
    const row = db.prepare('SELECT data FROM settings WHERE user_id = ?').get(req.user.id);
    const existing = row ? JSON.parse(row.data) : {};
    const merged = { ...existing, ...data };

    db.prepare('INSERT OR IGNORE INTO settings (user_id, data) VALUES (?, ?)').run(req.user.id, '{}');
    db.prepare('UPDATE settings SET data = ? WHERE user_id = ?').run(JSON.stringify(merged), req.user.id);

    res.json({ data: merged });
  } catch (err) {
    console.error('[Settings] 更新设置失败:', err);
    res.status(500).json({ error: '更新设置失败' });
  }
});

module.exports = router;
