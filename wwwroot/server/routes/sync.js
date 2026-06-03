const { Router } = require('express');
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = Router();
router.use(authMiddleware);

// 共享的文件夹路径解析函数
// folderCache: Map 缓存，findFolder/createFolder: prepared statements
// userId: 用户 ID，now: 时间戳，onCreated: 创建文件夹时的回调
function resolveFolderPath(folderPath, { userId, findFolder, createFolder, folderCache, now, onCreated }) {
  if (!folderPath) return null;
  if (folderCache.has(folderPath)) return folderCache.get(folderPath);

  const segments = folderPath.split('/');
  let currentParentId = null;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const partialPath = segments.slice(0, i + 1).join('/');

    if (folderCache.has(partialPath)) {
      currentParentId = folderCache.get(partialPath);
      continue;
    }

    let folderRow = findFolder.get(userId, segment, currentParentId, currentParentId);
    if (!folderRow) {
      const result = createFolder.run(userId, segment, currentParentId, 0, now, now);
      currentParentId = result.lastInsertRowid;
      if (onCreated) onCreated();
    } else {
      currentParentId = folderRow.id;
    }
    folderCache.set(partialPath, currentParentId);
  }

  return currentParentId;
}

// 插件端上传 Chrome 书签（全量替换，支持文件夹层级）
router.post('/bookmarks', (req, res) => {
  try {
    const { bookmarks } = req.body;
    if (!Array.isArray(bookmarks)) return res.status(400).json({ error: 'bookmarks 必须是数组' });
    // 防止意外清空：拒绝空数组（客户端可传 force: true 确认清空）
    if (bookmarks.length === 0 && !req.body.force) {
      return res.status(400).json({ error: 'bookmarks 不能为空数组，如需清空所有书签请传 force: true' });
    }

    const now = Date.now();
    const insertBookmark = db.prepare('INSERT INTO bookmarks (user_id, title, url, folder_id, icon, sort_order, container, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const findFolder = db.prepare('SELECT id FROM folders WHERE user_id = ? AND name = ? AND (parent_id = ? OR (parent_id IS NULL AND ? IS NULL))');
    const createFolder = db.prepare('INSERT INTO folders (user_id, name, parent_id, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');

    // 文件夹路径缓存，避免重复查询
    const folderCache = new Map();
    const ensureFolderPath = (path) => resolveFolderPath(path, {
      userId: req.user.id, findFolder, createFolder, folderCache, now
    });

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
        insertBookmark.run(req.user.id, bm.title, bm.url, folderId, bm.icon || null, bm.sort_order || 0, container, 'browser', now, now);
      }
    });
    tx();

    res.json({ success: true, count: bookmarks.length });
  } catch (err) {
    console.error('[sync] POST /bookmarks error:', err.message);
    res.status(500).json({ error: '同步书签失败' });
  }
});

// 增量同步（按时间戳获取变更，支持 updated_at）
router.get('/bookmarks/since', (req, res) => {
  try {
    const timestamp = parseInt(req.query.timestamp) || 0;
    const bookmarks = db.prepare('SELECT * FROM bookmarks WHERE user_id = ? AND COALESCE(updated_at, created_at) > ? ORDER BY created_at').all(req.user.id, timestamp);
    const folders = db.prepare('SELECT * FROM folders WHERE user_id = ? AND COALESCE(updated_at, created_at) > ? ORDER BY created_at').all(req.user.id, timestamp);
    res.json({ bookmarks, folders });
  } catch (err) {
    console.error('[sync] GET /bookmarks/since error:', err.message);
    res.status(500).json({ error: '获取增量书签失败' });
  }
});

// 获取服务端完整书签状态（供下载合并使用）
router.get('/bookmarks/full', (req, res) => {
  try {
    const bookmarks = db.prepare('SELECT * FROM bookmarks WHERE user_id = ? ORDER BY sort_order, created_at').all(req.user.id);
    const folders = db.prepare('SELECT * FROM folders WHERE user_id = ? ORDER BY sort_order, created_at').all(req.user.id);
    res.json({ bookmarks, folders, timestamp: Date.now() });
  } catch (err) {
    console.error('[sync] GET /bookmarks/full error:', err.message);
    res.status(500).json({ error: '获取完整书签失败' });
  }
});

// 插件端上传 Chrome 书签（增量合并，不会删除其他来源的数据）
router.put('/bookmarks', (req, res) => {
  try {
    const { bookmarks } = req.body;
    if (!Array.isArray(bookmarks)) return res.status(400).json({ error: 'bookmarks 必须是数组' });
    if (bookmarks.length === 0 && !req.body.force) {
      return res.status(400).json({ error: 'bookmarks 不能为空数组，如需清空所有书签请传 force: true' });
    }

    const now = Date.now();
    const userId = req.user.id;

    const findFolder = db.prepare('SELECT id FROM folders WHERE user_id = ? AND name = ? AND (parent_id = ? OR (parent_id IS NULL AND ? IS NULL))');
    const createFolder = db.prepare('INSERT INTO folders (user_id, name, parent_id, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
    const upsertBookmark = db.prepare(`
      INSERT INTO bookmarks (user_id, title, url, folder_id, icon, sort_order, container, source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'browser', ?, ?)
      ON CONFLICT(user_id, url, COALESCE(folder_id, -1)) DO UPDATE SET
        title = excluded.title,
        icon = COALESCE(excluded.icon, bookmarks.icon),
        sort_order = excluded.sort_order,
        container = excluded.container,
        source = 'browser',
        updated_at = excluded.updated_at
    `);
    const checkExisting = db.prepare('SELECT id FROM bookmarks WHERE user_id = ? AND url = ? AND (folder_id = ? OR (folder_id IS NULL AND ? IS NULL))');

    const folderCache = new Map();
    let foldersCreated = 0;
    const ensureFolderPath = (path) => resolveFolderPath(path, {
      userId, findFolder, createFolder, folderCache, now,
      onCreated: () => { foldersCreated++; }
    });

    // 收集入站数据的容器集合
    const syncedContainers = new Set();
    for (const bm of bookmarks) {
      const c = bm.container || '';
      if (c) syncedContainers.add(c);
    }

    let added = 0;
    let updated = 0;
    let deleted = 0;

    const tx = db.transaction(() => {
      // 阶段 1 + 2：文件夹解析 + 书签 Upsert
      const incomingKeys = new Set();
      for (const bm of bookmarks) {
        const folderId = ensureFolderPath(bm.folder_path || bm.folder || null);
        const container = bm.container || '';
        const key = `${bm.url}::${folderId}`;
        incomingKeys.add(key);

        const existing = checkExisting.get(userId, bm.url, folderId, folderId);
        upsertBookmark.run(userId, bm.title, bm.url, folderId, bm.icon || null, bm.sort_order || 0, container, now, now);
        if (existing) updated++; else added++;
      }

      // 阶段 3：范围删除（仅删除本次同步涉及的容器中的多余书签）
      if (syncedContainers.size > 0) {
        const containerList = [...syncedContainers];
        const placeholders = containerList.map(() => '?').join(',');
        const serverBookmarks = db.prepare(
          `SELECT id, url, folder_id FROM bookmarks WHERE user_id = ? AND container IN (${placeholders})`
        ).all(userId, ...containerList);

        const deleteBookmark = db.prepare('DELETE FROM bookmarks WHERE id = ?');
        for (const sb of serverBookmarks) {
          const key = `${sb.url}::${sb.folder_id}`;
          if (!incomingKeys.has(key)) {
            deleteBookmark.run(sb.id);
            deleted++;
          }
        }
      }

      // 阶段 4：文件夹清理
      const protectedIds = new Set();
      const allRemainingBookmarks = db.prepare('SELECT DISTINCT folder_id FROM bookmarks WHERE user_id = ? AND folder_id IS NOT NULL').all(userId);
      for (const row of allRemainingBookmarks) {
        let fid = row.folder_id;
        while (fid && !protectedIds.has(fid)) {
          protectedIds.add(fid);
          const parent = db.prepare('SELECT parent_id FROM folders WHERE id = ?').get(fid);
          fid = parent ? parent.parent_id : null;
        }
      }

      // 找出同步容器范围内的顶级文件夹
      const containerFolderNames = new Set([
        '书签栏', '其他书签', '移动设备书签',
        'Bookmarks bar', 'Bookmarks Bar', 'Other bookmarks', 'Other Bookmarks',
        'Mobile bookmarks', 'Mobile Bookmarks',
        '书签工具栏', '书签菜单', 'Bookmarks Toolbar', 'Bookmarks Menu',
        '收藏夹栏', '其他收藏夹',
      ]);
      const scopeRootIds = new Set();
      const rootFolders = db.prepare('SELECT id, name FROM folders WHERE user_id = ? AND parent_id IS NULL').all(userId);
      for (const rf of rootFolders) {
        if (containerFolderNames.has(rf.name)) {
          scopeRootIds.add(rf.id);
        }
      }

      // 收集作用域内所有文件夹 ID
      const scopeIds = new Set();
      function collectDescendants(parentId) {
        scopeIds.add(parentId);
        const children = db.prepare('SELECT id FROM folders WHERE parent_id = ? AND user_id = ?').all(parentId, userId);
        for (const child of children) collectDescendants(child.id);
      }
      for (const rootId of scopeRootIds) collectDescendants(rootId);

      // 删除作用域内不受保护的文件夹
      const toDelete = [...scopeIds].filter(id => !protectedIds.has(id));
      if (toDelete.length > 0) {
        const deletePlaceholders = toDelete.map(() => '?').join(',');
        db.prepare(`UPDATE folders SET parent_id = NULL WHERE id IN (${deletePlaceholders})`).run(...toDelete);
        db.prepare(`DELETE FROM folders WHERE id IN (${deletePlaceholders})`).run(...toDelete);
      }
    });
    tx();

    res.json({ success: true, added, updated, deleted, foldersCreated, total: bookmarks.length });
  } catch (err) {
    console.error('[sync] PUT /bookmarks error:', err.message);
    res.status(500).json({ error: '增量同步书签失败' });
  }
});

// 接收扩展发送的 favicon base64 数据，保存到本地
router.post('/favicons', (req, res) => {
  try {
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
  } catch (err) {
    console.error('[sync] POST /favicons error:', err.message);
    res.status(500).json({ error: '保存图标失败' });
  }
});

module.exports = router;
