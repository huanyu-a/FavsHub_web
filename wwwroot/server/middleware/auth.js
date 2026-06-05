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
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token 已过期，请重新登录' });
    }
    console.warn('[Auth] Token 验证失败:', err.name);
    return res.status(401).json({ error: 'Token 无效或已过期' });
  }
}

// 可选认证：有 token 则解析，无 token 则 req.user = null 继续执行
function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    req.user = null;
    return next();
  }
  const token = header.slice(7);
  if (!token) {
    req.user = null;
    return next();
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.id, username: payload.username };
  } catch {
    req.user = null;
  }
  next();
}

/**
 * 签发 JWT token
 * @param {object} payload - 令牌载荷（如 { id, username }）
 * @param {string} [expiresIn='30d'] - 过期时间
 * @returns {string} JWT token
 */
function signToken(payload, expiresIn = '30d') {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

// 验证 Token：成功返回 payload，失败返回 null
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

module.exports = { authMiddleware, optionalAuth, signToken, verifyToken };
