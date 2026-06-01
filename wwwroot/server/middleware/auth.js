const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// JWT 密钥：优先使用环境变量，否则从文件读取持久化密钥，最后自动生成
const SECRET_FILE = path.join(__dirname, '..', 'data', '.jwt-secret');

function loadOrCreateSecret() {
  // 1. 环境变量优先（生产部署推荐方式）
  if (process.env.JWT_SECRET) {
    return process.env.JWT_SECRET;
  }
  // 2. 从持久化文件读取（开发/自托管场景自动管理）
  try {
    if (fs.existsSync(SECRET_FILE)) {
      const saved = fs.readFileSync(SECRET_FILE, 'utf8').trim();
      if (saved.length >= 32) return saved;
    }
  } catch { /* 文件读取失败则重新生成 */ }
  // 3. 生成新密钥并持久化
  const newSecret = crypto.randomBytes(48).toString('base64');
  try {
    const dir = path.dirname(SECRET_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SECRET_FILE, newSecret, { mode: 0o600 });
    console.log('[Auth] 已自动生成 JWT 密钥，存储于 ' + SECRET_FILE);
  } catch (err) {
    console.warn('[Auth] 无法持久化 JWT 密钥到文件，密钥仅在本次进程有效:', err.message);
  }
  return newSecret;
}

const JWT_SECRET = loadOrCreateSecret();

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未登录' });
  }

  const token = header.slice(7);
  if (!token) {
    return res.status(401).json({ error: 'Token 不能为空' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.id, username: payload.username };
    next();
  } catch (err) {
    // 记录详细错误用于调试，但只向客户端返回通用消息
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token 已过期，请重新登录' });
    }
    console.warn('[Auth] Token 验证失败:', err.name);
    return res.status(401).json({ error: 'Token 无效或已过期' });
  }
}

module.exports = { authMiddleware, JWT_SECRET };
