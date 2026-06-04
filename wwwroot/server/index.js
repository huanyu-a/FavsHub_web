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

// API 路由
app.use('/api/auth', require('./routes/auth'));
app.use('/api/bookmarks', require('./routes/bookmarks'));
app.use('/api/folders', require('./routes/folders'));
app.use('/api/prompts', require('./routes/prompts'));
app.use('/api/tags', require('./routes/tags'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/sync', require('./routes/sync'));
app.use('/api/admin', require('./routes/admin'));

// 公开接口：获取百度 OAuth AppKey（从数据库 settings 读取）
app.get('/api/config/baidu-app-key', (req, res) => {
  const db = require('./db');
  const row = db.prepare("SELECT data FROM settings WHERE user_id = 0").get();
  let appKey = '';
  if (row && row.data) {
    try { appKey = JSON.parse(row.data).baiduAppKey || ''; } catch {}
  }
  if (!appKey) return res.status(404).json({ error: '百度网盘功能未配置' });
  res.json({ appKey });
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

// TDK 配置：每组页面的 TDK 字段定义（field = settings 表中的 key，fallback = 回退到站点级字段）
const TDK_GROUPS = {
  _default: { title: 'siteTitle', description: 'siteDescription', keywords: 'siteKeywords' },
  promptpro: { title: 'promptproTitle', description: 'promptproDescription', keywords: 'promptproKeywords' },
};

// 解析指定页面组的 TDK 值（页面级优先，回退到站点级）
function resolveTDK(data, group) {
  const site = TDK_GROUPS._default;
  const page = group || site;
  return {
    title: (page === site ? null : data[page.title]) || data[site.title] || '',
    description: (page === site ? null : data[page.description]) || data[site.description] || '',
    keywords: (page === site ? null : data[page.keywords]) || data[site.keywords] || '',
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
  let html = fs.readFileSync(filePath, 'utf8');
  try {
    const db = require('./db');
    const row = db.prepare("SELECT data FROM settings WHERE user_id = 0").get();
    if (row && row.data) {
      const data = JSON.parse(row.data);
      // 根据路径匹配 TDK 组（/promptpro/ → promptpro，其他 → 站点级）
      const groupKey = Object.keys(TDK_GROUPS).find(k => k !== '_default' && req.path.startsWith('/' + k));
      const { title, description, keywords } = resolveTDK(data, groupKey ? TDK_GROUPS[groupKey] : null);

      if (title) html = html.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`);
      let metaTags = '';
      if (description) {
        html = html.replace(/<meta\s+name="description"[^>]*>\s*\n?/gi, '');
        metaTags += `\n  <meta name="description" content="${description}">`;
      }
      if (keywords) {
        html = html.replace(/<meta\s+name="keywords"[^>]*>\s*\n?/gi, '');
        metaTags += `\n  <meta name="keywords" content="${keywords}">`;
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

app.listen(PORT, () => {
  console.log(`FavsHub server running at http://localhost:${PORT}`);
});
