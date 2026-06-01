const { Router } = require('express');
const db = require('../db');
const { adminMiddleware, ADMIN_USERS } = require('../middleware/admin');
const path = require('path');
const fs = require('fs');
const https = require('https');

const router = Router();
router.use(adminMiddleware);

// 系统统计
router.get('/stats', (req, res) => {
  const users = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  const bookmarks = db.prepare('SELECT COUNT(*) as count FROM bookmarks').get().count;
  const folders = db.prepare('SELECT COUNT(*) as count FROM folders').get().count;
  const prompts = db.prepare('SELECT COUNT(*) as count FROM prompts').get().count;
  res.json({ users, bookmarks, folders, prompts });
});

// 用户列表（含书签/Prompt 数量）
router.get('/users', (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.username, u.email, u.created_at,
      (SELECT COUNT(*) FROM bookmarks WHERE user_id = u.id) as bookmark_count,
      (SELECT COUNT(*) FROM prompts WHERE user_id = u.id) as prompt_count
    FROM users u ORDER BY u.created_at DESC
  `).all();
  res.json({ users, adminUsers: ADMIN_USERS });
});

// 删除用户及其所有数据
router.delete('/users/:id', (req, res) => {
  const userId = parseInt(req.params.id);
  const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId);
  if (!user) return res.status(404).json({ error: '用户不存在' });

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM bookmarks WHERE user_id = ?').run(userId);
    // 先解除 FK 引用再删除文件夹
    db.prepare('UPDATE folders SET parent_id = NULL WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM folders WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM prompt_tags WHERE prompt_id IN (SELECT id FROM prompts WHERE user_id = ?)').run(userId);
    db.prepare('DELETE FROM prompt_versions WHERE prompt_id IN (SELECT id FROM prompts WHERE user_id = ?)').run(userId);
    db.prepare('DELETE FROM prompts WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM prompt_folders WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM tags WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM settings WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  });
  tx();

  res.json({ success: true, message: `已删除用户 ${user.username} 及其所有数据` });
});

// 查看指定用户的书签
router.get('/users/:id/bookmarks', (req, res) => {
  const userId = parseInt(req.params.id);
  const bookmarks = db.prepare(`
    SELECT b.*, f.name as folder_name FROM bookmarks b
    LEFT JOIN folders f ON b.folder_id = f.id
    WHERE b.user_id = ? ORDER BY b.folder_id, b.sort_order
  `).all(userId);
  res.json({ bookmarks });
});

// 查看指定用户的 Prompt
router.get('/users/:id/prompts', (req, res) => {
  const userId = parseInt(req.params.id);
  const prompts = db.prepare(`
    SELECT p.*, pf.name as folder_name FROM prompts p
    LEFT JOIN prompt_folders pf ON p.folder_id = pf.id
    WHERE p.user_id = ? ORDER BY p.updated_at DESC
  `).all(userId);
  res.json({ prompts });
});

// 读取系统配置
router.get('/config', (req, res) => {
  res.json({
    adminUsers: ADMIN_USERS,
    jwtSecret: process.env.JWT_SECRET ? '已设置（环境变量）' : '使用默认值',
    port: process.env.PORT || 3000,
    dbPath: path.join(__dirname, '..', 'data', 'favshub.db')
  });
});

// 获取所有书签（管理员）
router.get('/bookmarks', (req, res) => {
  const bookmarks = db.prepare(`
    SELECT b.*, f.name as folder_name, u.username
    FROM bookmarks b
    LEFT JOIN folders f ON b.folder_id = f.id
    LEFT JOIN users u ON b.user_id = u.id
    ORDER BY b.user_id, b.folder_id, b.sort_order
  `).all();
  res.json({ bookmarks });
});

// 删除书签（管理员）
router.delete('/bookmarks/:id', (req, res) => {
  const bookmarkId = parseInt(req.params.id);
  const bookmark = db.prepare('SELECT id FROM bookmarks WHERE id = ?').get(bookmarkId);
  if (!bookmark) return res.status(404).json({ error: '书签不存在' });

  db.prepare('DELETE FROM bookmarks WHERE id = ?').run(bookmarkId);
  res.json({ success: true, message: '已删除书签' });
});

// 更新书签（管理员）
router.put('/bookmarks/:id', (req, res) => {
  const bookmarkId = parseInt(req.params.id);
  const { title, url, folder_id } = req.body;
  const bookmark = db.prepare('SELECT id FROM bookmarks WHERE id = ?').get(bookmarkId);
  if (!bookmark) return res.status(404).json({ error: '书签不存在' });

  if (title !== undefined) db.prepare('UPDATE bookmarks SET title = ? WHERE id = ?').run(title, bookmarkId);
  if (url !== undefined) db.prepare('UPDATE bookmarks SET url = ? WHERE id = ?').run(url, bookmarkId);
  if (folder_id !== undefined) db.prepare('UPDATE bookmarks SET folder_id = ? WHERE id = ?').run(folder_id !== 0 ? folder_id : null, bookmarkId);

  const updated = db.prepare('SELECT b.*, f.name as folder_name, u.username FROM bookmarks b LEFT JOIN folders f ON b.folder_id = f.id LEFT JOIN users u ON b.user_id = u.id WHERE b.id = ?').get(bookmarkId);
  res.json({ bookmark: updated });
});

// 获取所有文件夹（管理员）
router.get('/folders', (req, res) => {
  const folders = db.prepare(`
    SELECT f.*, u.username,
      (SELECT COUNT(*) FROM bookmarks WHERE folder_id = f.id) as bookmark_count
    FROM folders f
    LEFT JOIN users u ON f.user_id = u.id
    ORDER BY f.user_id, f.parent_id, f.sort_order
  `).all();
  res.json({ folders });
});

// 创建文件夹（管理员）
router.post('/folders', (req, res) => {
  const { name, user_id, parent_id } = req.body;
  if (!name) return res.status(400).json({ error: '文件夹名称不能为空' });
  if (!user_id) return res.status(400).json({ error: '必须指定用户 ID' });

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(user_id);
  if (!user) return res.status(404).json({ error: '用户不存在' });

  if (parent_id) {
    const parent = db.prepare('SELECT id FROM folders WHERE id = ? AND user_id = ?').get(parent_id, user_id);
    if (!parent) return res.status(404).json({ error: '父文件夹不存在' });
  }

  const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM folders WHERE user_id = ?').get(user_id);
  const result = db.prepare('INSERT INTO folders (user_id, name, parent_id, sort_order) VALUES (?, ?, ?, ?)').run(user_id, name, parent_id || null, (maxOrder?.m || 0) + 1);

  const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(result.lastInsertRowid);
  res.json({ folder });
});

// 更新文件夹（管理员）
router.put('/folders/:id', (req, res) => {
  const folderId = parseInt(req.params.id);
  const { name, icon, parent_id } = req.body;
  const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(folderId);
  if (!folder) return res.status(404).json({ error: '文件夹不存在' });

  if (name !== undefined) db.prepare('UPDATE folders SET name = ? WHERE id = ?').run(name, folderId);
  if (icon !== undefined) db.prepare('UPDATE folders SET icon = ? WHERE id = ?').run(icon, folderId);
  if (parent_id !== undefined) {
    // 防止循环引用
    if (parent_id === folderId) return res.status(400).json({ error: '不能将文件夹设为自己的子文件夹' });
    db.prepare('UPDATE folders SET parent_id = ? WHERE id = ?').run(parent_id || null, folderId);
  }

  const updated = db.prepare('SELECT * FROM folders WHERE id = ?').get(folderId);
  res.json({ folder: updated });
});

// 删除文件夹（管理员）
router.delete('/folders/:id', (req, res) => {
  const folderId = parseInt(req.params.id);
  const folder = db.prepare('SELECT * FROM folders WHERE id = ?').get(folderId);
  if (!folder) return res.status(404).json({ error: '文件夹不存在' });

  const tx = db.transaction(() => {
    db.prepare('UPDATE bookmarks SET folder_id = NULL WHERE folder_id = ?').run(folderId);
    // 子文件夹挂载到被删除文件夹的父级
    db.prepare('UPDATE folders SET parent_id = ? WHERE parent_id = ?').run(folder.parent_id, folderId);
    db.prepare('DELETE FROM folders WHERE id = ?').run(folderId);
  });
  tx();
  res.json({ success: true, message: '已删除文件夹' });
});

// === 搜索引擎管理 ===

// 获取所有搜索引擎
router.get('/search-engines', (req, res) => {
  const engines = db.prepare('SELECT * FROM search_engines ORDER BY category, sort_order, id').all();
  res.json({ engines });
});

// 创建搜索引擎
router.post('/search-engines', (req, res) => {
  const { name, label, url, icon, category, is_default } = req.body;
  if (!name || !url) return res.status(400).json({ error: '名称和 URL 不能为空' });

  const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM search_engines').get();
  const result = db.prepare('INSERT INTO search_engines (name, label, url, icon, category, sort_order, is_default) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    name, label || name, url, icon || '', category || 'SEARCH', (maxOrder?.m || 0) + 1, is_default ? 1 : 0
  );

  const engine = db.prepare('SELECT * FROM search_engines WHERE id = ?').get(result.lastInsertRowid);
  res.json({ engine });
});

// 更新搜索引擎
router.put('/search-engines/:id', (req, res) => {
  const engineId = parseInt(req.params.id);
  const { name, label, url, icon, category, sort_order, is_default } = req.body;
  const engine = db.prepare('SELECT id FROM search_engines WHERE id = ?').get(engineId);
  if (!engine) return res.status(404).json({ error: '搜索引擎不存在' });

  if (name !== undefined) db.prepare('UPDATE search_engines SET name = ? WHERE id = ?').run(name, engineId);
  if (label !== undefined) db.prepare('UPDATE search_engines SET label = ? WHERE id = ?').run(label, engineId);
  if (url !== undefined) db.prepare('UPDATE search_engines SET url = ? WHERE id = ?').run(url, engineId);
  if (icon !== undefined) db.prepare('UPDATE search_engines SET icon = ? WHERE id = ?').run(icon, engineId);
  if (category !== undefined) db.prepare('UPDATE search_engines SET category = ? WHERE id = ?').run(category, engineId);
  if (sort_order !== undefined) db.prepare('UPDATE search_engines SET sort_order = ? WHERE id = ?').run(sort_order, engineId);
  if (is_default !== undefined) db.prepare('UPDATE search_engines SET is_default = ? WHERE id = ?').run(is_default ? 1 : 0, engineId);

  const updated = db.prepare('SELECT * FROM search_engines WHERE id = ?').get(engineId);
  res.json({ engine: updated });
});

// 删除搜索引擎
router.delete('/search-engines/:id', (req, res) => {
  const engineId = parseInt(req.params.id);
  const engine = db.prepare('SELECT id FROM search_engines WHERE id = ?').get(engineId);
  if (!engine) return res.status(404).json({ error: '搜索引擎不存在' });

  db.prepare('DELETE FROM search_engines WHERE id = ?').run(engineId);
  res.json({ success: true, message: '已删除搜索引擎' });
});

// === 提示词管理（管理员） ===
router.get('/prompts', (req, res) => {
  const prompts = db.prepare(`
    SELECT p.*, u.username, pf.name as folder_name
    FROM prompts p
    LEFT JOIN users u ON p.user_id = u.id
    LEFT JOIN prompt_folders pf ON p.folder_id = pf.id
    ORDER BY p.updated_at DESC
  `).all();

  // 附加标签
  const tagStmt = db.prepare(`
    SELECT t.name FROM tags t JOIN prompt_tags pt ON t.id = pt.tag_id WHERE pt.prompt_id = ?
  `);
  for (const p of prompts) {
    p.tags = tagStmt.all(p.id).map(t => t.name);
  }

  res.json({ prompts });
});

router.delete('/prompts/:id', (req, res) => {
  const promptId = req.params.id;
  const prompt = db.prepare('SELECT id FROM prompts WHERE id = ?').get(promptId);
  if (!prompt) return res.status(404).json({ error: '提示词不存在' });

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM prompt_tags WHERE prompt_id = ?').run(promptId);
    db.prepare('DELETE FROM prompt_versions WHERE prompt_id = ?').run(promptId);
    db.prepare('DELETE FROM prompts WHERE id = ?').run(promptId);
  });
  tx();
  res.json({ success: true, message: '已删除提示词' });
});

// 提示词版本历史（管理员）
router.get('/prompts/:id/versions', (req, res) => {
  const versions = db.prepare(`
    SELECT pv.* FROM prompt_versions pv
    WHERE pv.prompt_id = ? ORDER BY pv.created_at DESC
  `).all(req.params.id);
  res.json({ versions });
});

// 提示词文件夹管理（管理员）
router.get('/prompt-folders', (req, res) => {
  const folders = db.prepare(`
    SELECT pf.*, u.username,
      (SELECT COUNT(*) FROM prompts WHERE folder_id = pf.id) as prompt_count
    FROM prompt_folders pf
    LEFT JOIN users u ON pf.user_id = u.id
    ORDER BY pf.user_id, pf.name
  `).all();
  res.json({ folders });
});

router.delete('/prompt-folders/:id', (req, res) => {
  const folderId = req.params.id;
  const folder = db.prepare('SELECT id FROM prompt_folders WHERE id = ?').get(folderId);
  if (!folder) return res.status(404).json({ error: '提示词文件夹不存在' });

  const tx = db.transaction(() => {
    db.prepare('UPDATE prompts SET folder_id = NULL WHERE folder_id = ?').run(folderId);
    db.prepare('DELETE FROM prompt_folders WHERE id = ?').run(folderId);
  });
  tx();
  res.json({ success: true, message: '已删除提示词文件夹' });
});

// === 百度网盘全库备份 ===
router.post('/backup-to-baidu', (req, res) => {
  const dbPath = path.join(__dirname, '..', 'data', 'favshub.db');

  if (!fs.existsSync(dbPath)) {
    return res.status(404).json({ error: '数据库文件不存在' });
  }

  // 先执行 checkpoint 确保数据一致性
  db.pragma('wal_checkpoint(TRUNCATE)');

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `favshub-full-backup-${timestamp}.db`;

  try {
    const stat = fs.statSync(dbPath);
    // 返回备份元信息，客户端通过 GET /api/admin/backup 下载实际数据
    res.json({
      success: true,
      message: `数据库备份已就绪 (${(stat.size / 1024).toFixed(1)} KB)，请通过备份下载接口获取`,
      filename,
      size: stat.size,
      downloadUrl: '/api/admin/backup'
    });
  } catch (err) {
    res.status(500).json({ error: '备份失败' });
  }
});

// === 数据库备份 ===
router.get('/backup', (req, res) => {
  const dbPath = path.join(__dirname, '..', 'data', 'favshub.db');

  if (!fs.existsSync(dbPath)) {
    return res.status(404).json({ error: '数据库文件不存在' });
  }

  // WAL 模式下确保数据写入主文件
  db.pragma('wal_checkpoint(TRUNCATE)');

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `favshub-backup-${timestamp}.db`;

  res.setHeader('Content-Type', 'application/x-sqlite3');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const stream = fs.createReadStream(dbPath);
  stream.on('error', (err) => {
    if (!res.headersSent) {
      res.status(500).json({ error: '读取数据库文件失败' });
    }
  });
  stream.pipe(res);
});

// 获取备份状态信息
router.get('/backup/info', (req, res) => {
  const dbPath = path.join(__dirname, '..', 'data', 'favshub.db');

  let dbSize = 0;
  let lastModified = null;
  try {
    const stat = fs.statSync(dbPath);
    dbSize = stat.size;
    lastModified = stat.mtime.toISOString();
  } catch {}

  const stats = {
    users: db.prepare('SELECT COUNT(*) as c FROM users').get().c,
    bookmarks: db.prepare('SELECT COUNT(*) as c FROM bookmarks').get().c,
    folders: db.prepare('SELECT COUNT(*) as c FROM folders').get().c,
    prompts: db.prepare('SELECT COUNT(*) as c FROM prompts').get().c,
    search_engines: db.prepare('SELECT COUNT(*) as c FROM search_engines').get().c,
  };

  res.json({
    dbPath,
    dbSize,
    dbSizeFormatted: dbSize > 1024 * 1024 ? (dbSize / 1024 / 1024).toFixed(2) + ' MB' : (dbSize / 1024).toFixed(2) + ' KB',
    lastModified,
    stats
  });
});

// === Favicon 本地化 ===

// 检查 IP 是否为内网/保留地址（防止 SSRF）
function isPrivateIP(hostname) {
  // IPv4 内网地址
  const privateIPv4 = /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.|169\.254\.)/;
  if (privateIPv4.test(hostname)) return true;
  // IPv6 本地地址
  if (hostname === '::1' || hostname === '::' || hostname.startsWith('fe80:') || hostname.startsWith('fc') || hostname.startsWith('fd')) return true;
  // 常见云元数据地址
  if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal') return true;
  return false;
}

function downloadFavicon(url, destPath) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(url);
      // 仅允许 HTTPS，阻止内网地址
      if (u.protocol !== 'https:') {
        return reject(new Error('仅支持 HTTPS 协议'));
      }
      if (isPrivateIP(u.hostname)) {
        return reject(new Error('不允许访问内网地址'));
      }
      const req = https.get(url, { timeout: 10000 }, (response) => {
        // 处理重定向
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          const redirectUrl = response.headers.location.startsWith('http')
            ? response.headers.location
            : new URL(response.headers.location, u.origin).href;
          return downloadFavicon(redirectUrl, destPath).then(resolve).catch(reject);
        }
        if (response.statusCode !== 200) {
          return reject(new Error('HTTP ' + response.statusCode));
        }
        const file = fs.createWriteStream(destPath);
        file.on('finish', () => { file.close(); resolve(); });
        file.on('error', reject);
        response.pipe(file);
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    } catch (e) {
      reject(e);
    }
  });
}

// 批量下载未本地化的 favicon
router.post('/download-favicons', (req, res) => {
  const faviconDir = path.join(__dirname, '..', '..', 'images', 'favicons');
  if (!fs.existsSync(faviconDir)) fs.mkdirSync(faviconDir, { recursive: true });

  const bookmarks = db.prepare("SELECT id, url, icon FROM bookmarks WHERE icon NOT LIKE '/images/favicons/%' OR icon IS NULL").all();
  if (!bookmarks.length) return res.json({ success: true, message: '所有书签图标已本地化', count: 0 });

  let processed = 0;
  let errors = 0;
  const updateStmt = db.prepare('UPDATE bookmarks SET icon = ? WHERE id = ?');

  const processNext = () => {
    if (processed >= bookmarks.length) {
      return res.json({ success: true, message: `处理完成`, total: bookmarks.length, errors });
    }

    const bm = bookmarks[processed];
    processed++;
    try {
      const hostname = new URL(bm.url).hostname;
      const localPath = `/images/favicons/${hostname}.png`;
      const destPath = path.join(faviconDir, hostname + '.png');

      if (fs.existsSync(destPath)) {
        updateStmt.run(localPath, bm.id);
        processNext();
        return;
      }

      const faviconUrl = `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`;
      downloadFavicon(faviconUrl, destPath)
        .then(() => { updateStmt.run(localPath, bm.id); processNext(); })
        .catch(() => { errors++; processNext(); });
    } catch {
      errors++;
      processNext();
    }
  };

  processNext();
});

// 单个书签 favicon 下载
router.post('/download-favicon/:id', (req, res) => {
  const bookmark = db.prepare('SELECT id, url FROM bookmarks WHERE id = ?').get(parseInt(req.params.id));
  if (!bookmark) return res.status(404).json({ error: '书签不存在' });

  const faviconDir = path.join(__dirname, '..', '..', 'images', 'favicons');
  if (!fs.existsSync(faviconDir)) fs.mkdirSync(faviconDir, { recursive: true });

  try {
    const hostname = new URL(bookmark.url).hostname;
    const localPath = `/images/favicons/${hostname}.png`;
    const destPath = path.join(faviconDir, hostname + '.png');

    const faviconUrl = `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`;
    downloadFavicon(faviconUrl, destPath)
      .then(() => {
        db.prepare('UPDATE bookmarks SET icon = ? WHERE id = ?').run(localPath, bookmark.id);
        res.json({ success: true, icon: localPath });
      })
      .catch(err => res.status(500).json({ error: '下载失败: ' + err.message }));
  } catch (err) {
    res.status(400).json({ error: 'URL 解析失败' });
  }
});

// === 定时备份 ===
const BACKUP_CONFIG_FILE = path.join(__dirname, '..', 'data', '.backup-config.json');
let backupSchedule = { enabled: false, hour: 3, minute: 0, keepCopies: 7 };
let backupTimer = null;
let lastBackupDate = null; // 防止同一天重复备份

// 从系统配置文件读取备份配置（不再绑定到某个管理员用户）
function loadBackupSchedule() {
  try {
    if (fs.existsSync(BACKUP_CONFIG_FILE)) {
      const saved = JSON.parse(fs.readFileSync(BACKUP_CONFIG_FILE, 'utf8'));
      backupSchedule = { ...backupSchedule, ...saved };
    }
  } catch { /* 首次启动可能没有配置文件 */ }
}

// 保存备份配置到系统配置文件
function saveBackupSchedule() {
  try {
    fs.writeFileSync(BACKUP_CONFIG_FILE, JSON.stringify(backupSchedule, null, 2), 'utf8');
  } catch (err) { console.error('[备份] 保存配置失败:', err.message); }
}

function startBackupScheduler() {
  if (backupTimer) clearInterval(backupTimer);
  if (!backupSchedule.enabled) return;

  backupTimer = setInterval(() => {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    // 用 >= 比较防止 timer 跳秒，并检查是否今日已备份过
    const targetMinutes = backupSchedule.hour * 60 + backupSchedule.minute;
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    if (currentMinutes >= targetMinutes && lastBackupDate !== todayStr) {
      const dbPath = path.join(__dirname, '..', 'data', 'favshub.db');
      if (!fs.existsSync(dbPath)) return;
      db.pragma('wal_checkpoint(TRUNCATE)');

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const backupDir = path.join(__dirname, '..', 'data', 'backups');
      if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

      const backupPath = path.join(backupDir, `auto-backup-${timestamp}.db`);
      try {
        fs.copyFileSync(dbPath, backupPath);
        lastBackupDate = todayStr;
        // 清理旧备份
        const files = fs.readdirSync(backupDir).filter(f => f.startsWith('auto-backup-')).sort();
        while (files.length > backupSchedule.keepCopies) {
          fs.unlinkSync(path.join(backupDir, files.shift()));
        }
      } catch (e) { console.error('[备份] 失败:', e.message); }
    }
  }, 60000); // 每分钟检查一次
}

// 获取备份配置
router.get('/backup-schedule', (req, res) => {
  res.json(backupSchedule);
});

// 更新备份配置
router.put('/backup-schedule', (req, res) => {
  const { enabled, hour, minute, keepCopies } = req.body;
  if (enabled !== undefined) backupSchedule.enabled = !!enabled;
  if (hour !== undefined) backupSchedule.hour = Math.max(0, Math.min(23, parseInt(hour) || 0));
  if (minute !== undefined) backupSchedule.minute = Math.max(0, Math.min(59, parseInt(minute) || 0));
  if (keepCopies !== undefined) backupSchedule.keepCopies = Math.max(1, Math.min(30, parseInt(keepCopies) || 7));
  saveBackupSchedule();
  startBackupScheduler();
  res.json({ success: true, schedule: backupSchedule });
});

// 获取备份文件列表
router.get('/backup-files', (req, res) => {
  const backupDir = path.join(__dirname, '..', 'data', 'backups');
  if (!fs.existsSync(backupDir)) return res.json({ files: [] });

  const files = fs.readdirSync(backupDir).filter(f => f.startsWith('auto-backup-')).sort().reverse().map(f => {
    const stat = fs.statSync(path.join(backupDir, f));
    return { name: f, size: stat.size, sizeFormatted: (stat.size / 1024).toFixed(1) + ' KB', time: stat.mtime.toISOString() };
  });
  res.json({ files });
});

// 下载指定备份文件
router.get('/backup-files/:name', (req, res) => {
  const backupDir = path.join(__dirname, '..', 'data', 'backups');
  // 安全：提取文件名并防止路径遍历
  const safeName = path.basename(req.params.name).replace(/[^a-zA-Z0-9._-]/g, '');
  if (!safeName || !safeName.startsWith('auto-backup-')) {
    return res.status(400).json({ error: '无效的备份文件名' });
  }
  const filePath = path.join(backupDir, safeName);
  if (!filePath.startsWith(backupDir)) {
    return res.status(400).json({ error: '无效的备份文件名' });
  }
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '备份文件不存在' });

  res.setHeader('Content-Type', 'application/x-sqlite3');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
  fs.createReadStream(filePath).pipe(res);
});

// 服务器启动时加载备份配置并启动定时备份
loadBackupSchedule();
startBackupScheduler();

// === 浏览器 IndexedDB 提示词同步 ===
router.post('/sync-prompts', (req, res) => {
  const { userId, prompts, folders, tags, tagRelations, versions } = req.body;
  if (!userId) return res.status(400).json({ error: '缺少 userId' });
  if (!Array.isArray(prompts)) return res.status(400).json({ error: 'prompts 必须是数组' });

  const now = Date.now();
  let importedCount = 0;

  const tx = db.transaction(() => {
    // 0. 先清空该用户的提示词相关数据
    db.prepare('DELETE FROM prompt_tags WHERE prompt_id IN (SELECT id FROM prompts WHERE user_id = ?)').run(userId);
    db.prepare('DELETE FROM prompt_versions WHERE prompt_id IN (SELECT id FROM prompts WHERE user_id = ?)').run(userId);
    db.prepare('DELETE FROM prompts WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM prompt_folders WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM tags WHERE user_id = ?').run(userId);

    // 1. 先插入文件夹(IndexedDB 字段 folder_name→name, folder_id→id)
    if (Array.isArray(folders)) {
      const insertFolder = db.prepare('INSERT OR REPLACE INTO prompt_folders (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
      for (const f of folders) {
        insertFolder.run(f.folder_id || f.id, userId, f.folder_name || f.name || '', f.created_at || now, f.updated_at || now);
      }
    }
    // 2. 插入标签(IndexedDB 字段 tag_name→name, tag_id→id)
    if (Array.isArray(tags)) {
      const insertTag = db.prepare('INSERT OR REPLACE INTO tags (id, user_id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
      for (const t of tags) {
        insertTag.run(t.tag_id || t.id, userId, t.tag_name || t.name || '', t.color || '', t.created_at || now, t.updated_at || now);
      }
    }
    // 3. 插入提示词（含所有字段: avatar）
    const insertPrompt = db.prepare('INSERT OR REPLACE INTO prompts (id, user_id, title, description, content, folder_id, is_favorite, version_count, current_version, avatar, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const p of prompts) {
      insertPrompt.run(p.prompt_id, userId, p.title || '', p.description || '', p.content || '', p.folder_id || null, p.is_favorite ? 1 : 0, p.version_count || 1, p.current_version || '1.0.0', p.avatar || '', p.created_at || now, p.updated_at || now);
      importedCount++;
    }
    // 4. 插入标签关联（依赖 prompts）
    if (Array.isArray(tagRelations)) {
      const promptIds = prompts.map(p => p.prompt_id);
      if (promptIds.length > 0) {
        const placeholders = promptIds.map(() => '?').join(',');
        db.prepare(`DELETE FROM prompt_tags WHERE prompt_id IN (${placeholders})`).run(...promptIds);
      }
      const insertRelation = db.prepare('INSERT INTO prompt_tags (prompt_id, tag_id, created_at) VALUES (?, ?, ?)');
      for (const tr of tagRelations) {
        insertRelation.run(tr.prompt_id, tr.tag_id, tr.created_at || now);
      }
    }
    // 5. 插入版本历史（含 variables）
    if (Array.isArray(versions)) {
      const insertVersion = db.prepare('INSERT OR REPLACE INTO prompt_versions (id, prompt_id, content, version_number, variables, created_at) VALUES (?, ?, ?, ?, ?, ?)');
      for (const v of versions) {
        insertVersion.run(v.version_id, v.prompt_id, v.content || '', v.version_number || '1.0.0', v.variables || '', v.created_at || now);
      }
    }
  });

  try {
    // 仅在事务期间关闭外键检查，finally 确保恢复
    db.pragma('foreign_keys = OFF');
    tx();
    res.json({ success: true, message: `已导入 ${importedCount} 条提示词`, count: importedCount });
  } catch (err) {
    res.status(500).json({ error: '导入失败: ' + err.message });
  } finally {
    db.pragma('foreign_keys = ON');
  }
});

module.exports = router;
