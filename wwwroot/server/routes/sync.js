const { Router } = require('express');
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = Router();
router.use(authMiddleware);

// 插件端上传 Chrome 书签（全量替换，支持文件夹层级）
router.post('/bookmarks', (req, res) => {
  const { bookmarks } = req.body;
  if (!Array.isArray(bookmarks)) return res.status(400).json({ error: 'bookmarks 必须是数组' });
  // 防止意外清空：拒绝空数组（客户端可传 force: true 确认清空）
  if (bookmarks.length === 0 && !req.body.force) {
    return res.status(400).json({ error: 'bookmarks 不能为空数组，如需清空所有书签请传 force: true' });
  }

  const now = Date.now();
  const insertBookmark = db.prepare('INSERT INTO bookmarks (user_id, title, url, folder_id, icon, sort_order, container, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const findFolder = db.prepare('SELECT id FROM folders WHERE user_id = ? AND name = ? AND (parent_id = ? OR (parent_id IS NULL AND ? IS NULL))');
  const createFolder = db.prepare('INSERT INTO folders (user_id, name, parent_id, sort_order, created_at) VALUES (?, ?, ?, ?, ?)');

  // 文件夹路径缓存，避免重复查询
  const folderCache = new Map();

  function ensureFolderPath(path) {
    if (!path) return null;
    if (folderCache.has(path)) return folderCache.get(path);

    const segments = path.split('/');
    let currentParentId = null;

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const partialPath = segments.slice(0, i + 1).join('/');

      if (folderCache.has(partialPath)) {
        currentParentId = folderCache.get(partialPath);
        continue;
      }

      let folderRow = findFolder.get(req.user.id, segment, currentParentId, currentParentId);
      if (!folderRow) {
        const result = createFolder.run(req.user.id, segment, currentParentId, 0, now);
        currentParentId = result.lastInsertRowid;
      } else {
        currentParentId = folderRow.id;
      }
      folderCache.set(partialPath, currentParentId);
    }

    return currentParentId;
  }

  const tx = db.transaction(() => {
    // 全量替换：先删除该用户所有书签
    db.prepare('DELETE FROM bookmarks WHERE user_id = ?').run(req.user.id);
    // 清理该用户所有文件夹（先解除 FK 引用）
    db.prepare('UPDATE folders SET parent_id = NULL WHERE user_id = ?').run(req.user.id);
    db.prepare('DELETE FROM folders WHERE user_id = ?').run(req.user.id);

    for (const bm of bookmarks) {
      // folder_path 纯粹表达文件夹层级（不含容器名）
      const folderId = ensureFolderPath(bm.folder_path || bm.folder || null);
      // container 独立字段：bar / other / mobile
      const container = bm.container || '';
      insertBookmark.run(req.user.id, bm.title, bm.url, folderId, bm.icon || null, bm.sort_order || 0, container, now);
    }
  });
  tx();

  res.json({ success: true, count: bookmarks.length });
});

// 增量同步（按时间戳获取变更）
router.get('/bookmarks/since', (req, res) => {
  const timestamp = parseInt(req.query.timestamp) || 0;
  const bookmarks = db.prepare('SELECT * FROM bookmarks WHERE user_id = ? AND created_at > ? ORDER BY created_at').all(req.user.id, timestamp);
  const folders = db.prepare('SELECT * FROM folders WHERE user_id = ? AND created_at > ? ORDER BY created_at').all(req.user.id, timestamp);
  res.json({ bookmarks, folders });
});

// 接收扩展发送的 favicon base64 数据，保存到本地
router.post('/favicons', (req, res) => {
  const { favicons } = req.body;
  if (!Array.isArray(favicons)) return res.status(400).json({ error: 'favicons 必须是数组' });

  const path = require('path');
  const fs = require('fs');
  const faviconDir = path.join(__dirname, '..', '..', 'images', 'favicons');
  if (!fs.existsSync(faviconDir)) fs.mkdirSync(faviconDir, { recursive: true });

  const updateStmt = db.prepare("UPDATE bookmarks SET icon = ? WHERE user_id = ? AND url = ?");
  let saved = 0;

  for (const item of favicons) {
    try {
      const hostname = new URL(item.url).hostname;
      const filename = hostname + '.png';
      const filepath = path.join(faviconDir, filename);
      const localPath = `/images/favicons/${filename}`;

      // 解码 base64 并写入文件
      const base64Data = item.base64.replace(/^data:image\/\w+;base64,/, '');
      fs.writeFileSync(filepath, Buffer.from(base64Data, 'base64'));

      // 更新数据库（仅更新当前用户的图标，防止跨用户污染）
      updateStmt.run(localPath, req.user.id, item.url);
      saved++;
    } catch (e) {
      console.warn('[favicon] 保存失败:', item.url, e.message);
    }
  }

  res.json({ success: true, message: `已保存 ${saved} 个图标`, count: saved });
});

module.exports = router;
