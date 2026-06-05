const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// 安全头（CSP, X-Content-Type-Options, X-Frame-Options 等）
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "cdn.jsdelivr.net"],
      imgSrc: ["'self'", "data:", "https:"],
      fontSrc: ["'self'", "cdn.jsdelivr.net"],
      connectSrc: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// CORS：仅允许可信来源
const allowedOrigin = process.env.CORS_ORIGIN || 'http://localhost:3000';
app.use(cors({
  origin: allowedOrigin.split(',').map(o => o.trim()),
  credentials: true,
}));

app.use(express.json({ limit: '10mb' }));

// HTML 实体转义：防止 TDK 注入 XSS
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// 内存速率限制器（轻量实现）
function createRateLimit({ windowMs = 60000, max = 10 } = {}) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [key, list] of hits) {
      const fresh = list.filter(t => now - t < windowMs);
      fresh.length ? hits.set(key, fresh) : hits.delete(key);
    }
  }, windowMs * 2).unref();
  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    const list = (hits.get(key) || []).filter(t => now - t < windowMs);
    if (list.length >= max) {
      return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
    }
    list.push(now);
    hits.set(key, list);
    next();
  };
}

// API 路由
app.use('/api/auth', createRateLimit({ windowMs: 60000, max: 20 }), require('./routes/auth'));
app.use('/api/bookmarks', require('./routes/bookmarks'));
app.use('/api/folders', require('./routes/folders'));
app.use('/api/prompts', require('./routes/prompts'));
app.use('/api/tags', require('./routes/tags'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/sync', require('./routes/sync'));
app.use('/api/admin', require('./routes/admin'));

// 获取百度 OAuth AppKey（需登录，从数据库 settings 读取）
app.get('/api/config/baidu-app-key', (req, res) => {
  const { authMiddleware } = require('./middleware/auth');
  authMiddleware(req, res, () => {
    const db = require('./db');
    const row = db.prepare("SELECT data FROM settings WHERE user_id = 0").get();
    let appKey = '';
    if (row && row.data) {
      try { appKey = JSON.parse(row.data).baiduAppKey || ''; } catch {}
    }
    if (!appKey) return res.status(404).json({ error: '百度网盘功能未配置' });
    res.json({ appKey });
  });
});

// 管理员：保存百度 AppKey
app.put('/api/config/baidu-app-key', (req, res) => {
  const { authMiddleware } = require('./middleware/auth');
  authMiddleware(req, res, () => {
    const db = require('./db');
    const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.user.id);
    if (!user || !user.is_admin) return res.status(403).json({ error: '需要管理员权限' });
    const { appKey } = req.body;
    const row = db.prepare("SELECT data FROM settings WHERE user_id = 0").get();
    let data = {};
    if (row && row.data) { try { data = JSON.parse(row.data); } catch {} }
    data.baiduAppKey = appKey || '';
    db.prepare("INSERT OR REPLACE INTO settings (user_id, data) VALUES (0, ?)").run(JSON.stringify(data));
    res.json({ success: true });
  });
});

// Bing 壁纸代理（绕过浏览器 CORS 限制）
app.get('/api/bing-wallpaper', (req, res) => {
  const https = require('https');
  const url = 'https://cn.bing.com/HPImageArchive.aspx?format=js&idx=0&n=4&mkt=zh-CN&uhd=1&uhdwidth=3840&uhdheight=2160';
  https.get(url, (bingRes) => {
    let data = '';
    bingRes.on('data', chunk => data += chunk);
    bingRes.on('end', () => {
      try {
        res.json(JSON.parse(data));
      } catch {
        res.status(502).json({ error: 'Bing API 返回异常' });
      }
    });
  }).on('error', (err) => {
    res.status(502).json({ error: 'Bing API 请求失败' });
  });
});

// 公开接口：获取搜索引擎列表
app.get('/api/search-engines', (req, res) => {
  const db = require('./db');
  const engines = db.prepare("SELECT * FROM search_engines ORDER BY CASE category WHEN 'SEARCH' THEN 1 WHEN 'AI' THEN 2 WHEN 'SOCIAL' THEN 3 ELSE 4 END, sort_order, id").all();
  res.json({ engines });
});

// TDK 配置：每组页面的 TDK 字段定义，站点级与提示词级独立
const TDK_GROUPS = {
  _default: { title: 'siteTitle', description: 'siteDescription', keywords: 'siteKeywords' },
  promptpro: { title: 'promptproTitle', description: 'promptproDescription', keywords: 'promptproKeywords' },
};

// 解析指定页面组的 TDK 值（各组独立，不互相回退）
function resolveTDK(data, group) {
  const page = group || TDK_GROUPS._default;
  return {
    title: data[page.title] || '',
    description: data[page.description] || '',
    keywords: data[page.keywords] || '',
  };
}

// TDK 注入中间件：从 settings 读取 TDK 并注入到 HTML 页面
app.use((req, res, next) => {
  const isHtml = req.path.endsWith('.html');
  const isRoot = req.path === '/';
  const isDirIndex = !isHtml && !isRoot && req.path.endsWith('/');
  if (!isHtml && !isRoot && !isDirIndex) return next();

  const fs = require('fs');
  let relativePath = req.path;
  if (isRoot) relativePath = '/index.html';
  else if (isDirIndex) relativePath = req.path + 'index.html';
  const filePath = path.join(__dirname, '..', 'web', relativePath);
  if (!fs.existsSync(filePath)) return next();

  // Admin 页面服务端拦截：未登录直接跳转登录页
  if (req.path.startsWith('/admin')) {
    const { verifyToken } = require('./middleware/auth');
    const authHeader = req.headers.authorization;
    let token = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    }
    if (!token || !verifyToken(token)) {
      return res.redirect(302, '/login.html?redirect=/admin/');
    }
  }

  let html = fs.readFileSync(filePath, 'utf8');
  try {
    const db = require('./db');
    const row = db.prepare("SELECT data FROM settings WHERE user_id = 0").get();
    if (row && row.data) {
      const data = JSON.parse(row.data);
      // 根据路径匹配 TDK 组（/promptpro/ → promptpro，其他 → 站点级）
      const groupKey = Object.keys(TDK_GROUPS).find(k => k !== '_default' && req.path.startsWith('/' + k));
      const { title, description, keywords } = resolveTDK(data, groupKey ? TDK_GROUPS[groupKey] : null);

      if (title) html = html.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`);
      let metaTags = '';
      if (description) {
        html = html.replace(/<meta\s+name="description"[^>]*>\s*\n?/gi, '');
        metaTags += `\n  <meta name="description" content="${escapeHtml(description)}">`;
      }
      if (keywords) {
        html = html.replace(/<meta\s+name="keywords"[^>]*>\s*\n?/gi, '');
        metaTags += `\n  <meta name="keywords" content="${escapeHtml(keywords)}">`;
      }
      if (metaTags) {
        html = html.replace('</title>', `</title>${metaTags}`);
      }
    }
  } catch {}
  res.type('html').send(html);
});

// 静态文件：网页端 + 资源目录（JS/CSS 禁用浏览器缓存，确保始终加载最新版）
app.use(express.static(path.join(__dirname, '..', 'web'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));
app.use('/images', express.static(path.join(__dirname, '..', 'images')));

// SPA fallback
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: '接口不存在' });
  }
  res.sendFile(path.join(__dirname, '..', 'web', 'index.html'));
});

// 错误处理
app.use((err, req, res, next) => {
  console.error('[Error]', err.message);
  res.status(500).json({ error: '服务器内部错误' });
});

const server = app.listen(PORT, () => {
  console.log(`FavsHub server running at http://localhost:${PORT}`);
});

// 优雅关闭：checkpoint WAL 并关闭数据库连接，防止数据丢失
function gracefulShutdown(signal) {
  console.log(`[Server] 收到 ${signal}，正在关闭...`);
  server.close(() => {
    try {
      const db = require('./db');
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.close();
      console.log('[Server] 数据库已安全关闭');
    } catch (e) { console.error('[Server] 关闭数据库失败:', e.message); }
    process.exit(0);
  });
  // 5秒后强制退出
  setTimeout(() => { console.log('[Server] 强制退出'); process.exit(1); }, 5000);
}
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
