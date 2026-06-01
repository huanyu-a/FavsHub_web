const { authMiddleware } = require('./auth');
const db = require('../db');

const ADMIN_USERS = (process.env.ADMIN_USERS || '').split(',').map(u => u.trim()).filter(Boolean);

function adminMiddleware(req, res, next) {
  authMiddleware(req, res, () => {
    // 环境变量配置的管理员
    if (ADMIN_USERS.includes(req.user.username)) {
      return next();
    }
    // 数据库 is_admin 字段标记的管理员
    const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.user.id);
    if (user && user.is_admin) {
      return next();
    }
    if (ADMIN_USERS.length === 0 && (!user || !user.is_admin)) {
      return res.status(403).json({ error: '当前账号无管理员权限。请使用首个注册的账号登录，或设置 ADMIN_USERS 环境变量。' });
    }
    return res.status(403).json({ error: '无管理员权限' });
  });
}

module.exports = { adminMiddleware, ADMIN_USERS };
