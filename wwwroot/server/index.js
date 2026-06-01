const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
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

// 公开接口：获取百度 OAuth AppKey（不暴露在源码中）
app.get('/api/config/baidu-app-key', (req, res) => {
  const appKey = process.env.BAIDU_APP_KEY;
  if (!appKey) {
    return res.status(404).json({ error: '百度网盘功能未配置' });
  }
  res.json({ appKey });
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
  const engines = db.prepare('SELECT * FROM search_engines ORDER BY category, sort_order, id').all();
  res.json({ engines });
});

// 静态文件：网页端 + 资源目录
app.use(express.static(path.join(__dirname, '..', 'web')));
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
