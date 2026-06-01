const { Router } = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');

const router = Router();
router.use(authMiddleware);

// 获取提示词列表
router.get('/', (req, res) => {
  const { folder_id, tag_ids, search, favorites } = req.query;
  let sql = 'SELECT p.* FROM prompts p WHERE p.user_id = ?';
  const params = [req.user.id];

  if (folder_id) {
    sql += ' AND p.folder_id = ?';
    params.push(folder_id);
  }
  if (favorites === '1') {
    sql += ' AND p.is_favorite = 1';
  }
  if (tag_ids) {
    const ids = tag_ids.split(',');
    sql += ` AND p.id IN (SELECT prompt_id FROM prompt_tags WHERE tag_id IN (${ids.map(() => '?').join(',')}) GROUP BY prompt_id HAVING COUNT(DISTINCT tag_id) = ?)`;
    params.push(...ids, ids.length);
  }
  if (search) {
    sql += ' AND (p.title LIKE ? OR p.description LIKE ? OR p.content LIKE ?)';
    const q = `%${search}%`;
    params.push(q, q, q);
  }

  sql += ' ORDER BY p.updated_at DESC';
  const prompts = db.prepare(sql).all(...params);

  // 附加标签（兼容前端 tag_name 字段）
  const tagStmt = db.prepare(`
    SELECT t.* FROM tags t JOIN prompt_tags pt ON t.id = pt.tag_id WHERE pt.prompt_id = ?
  `);
  for (const p of prompts) {
    p.tags = tagStmt.all(p.id).map(t => ({ ...t, tag_id: t.id, tag_name: t.name }));
    p.prompt_id = p.id;
  }

  res.json({ prompts });
});

// 获取单个提示词（含版本历史）
// 获取/保存提示词的版本历史
router.get('/versions/:promptId', (req, res) => {
  // 验证所有权：通过 prompts 表确保当前用户拥有该提示词
  const prompt = db.prepare('SELECT id FROM prompts WHERE id = ? AND user_id = ?').get(req.params.promptId, req.user.id);
  if (!prompt) return res.status(404).json({ error: '提示词不存在' });

  const versions = db.prepare('SELECT * FROM prompt_versions WHERE prompt_id = ? ORDER BY created_at DESC').all(req.params.promptId);
  res.json({ versions });
});

router.post('/versions/:promptId', (req, res) => {
  // 验证所有权
  const prompt = db.prepare('SELECT id FROM prompts WHERE id = ? AND user_id = ?').get(req.params.promptId, req.user.id);
  if (!prompt) return res.status(404).json({ error: '提示词不存在' });

  const { v4: uuidv4 } = require('uuid');
  const { content, version_number, variables, created_at } = req.body;
  const id = uuidv4();
  db.prepare('INSERT INTO prompt_versions (id, prompt_id, content, version_number, variables, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, req.params.promptId, content || '', version_number || '1.0.0', variables ? JSON.stringify(variables) : '', created_at || Date.now());
  db.prepare('UPDATE prompts SET version_count = version_count + 1 WHERE id = ?').run(req.params.promptId);
  res.json({ version: { id, prompt_id: req.params.promptId, content, version_number, variables, created_at } });
});

// 标签关联列表（必须在 /:id 之前）
router.get('/tag-relations', (req, res) => {
  const relations = db.prepare(`
    SELECT pt.* FROM prompt_tags pt
    JOIN prompts p ON pt.prompt_id = p.id
    WHERE p.user_id = ?
  `).all(req.user.id);
  res.json({ relations });
});

router.get('/:id', (req, res) => {
  const prompt = db.prepare('SELECT * FROM prompts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!prompt) return res.status(404).json({ error: '提示词不存在' });

  prompt.tags = db.prepare('SELECT t.* FROM tags t JOIN prompt_tags pt ON t.id = pt.tag_id WHERE pt.prompt_id = ?').all(prompt.id).map(t => ({ ...t, tag_id: t.id, tag_name: t.name }));
  prompt.versions = db.prepare('SELECT * FROM prompt_versions WHERE prompt_id = ? ORDER BY created_at DESC').all(prompt.id);
  prompt.prompt_id = prompt.id;

  res.json({ prompt });
});

// 创建提示词
router.post('/', (req, res) => {
  const { title, description, content, folder_id, tags } = req.body;
  if (!title || !content) return res.status(400).json({ error: '标题和内容不能为空' });

  const id = uuidv4();
  const now = Date.now();

  db.prepare(`INSERT INTO prompts (id, user_id, title, description, content, folder_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, req.user.id, title, description || '', content, folder_id || null, now, now);

  // 创建初始版本
  const versionId = uuidv4();
  db.prepare('INSERT INTO prompt_versions (id, prompt_id, content, version_number, created_at) VALUES (?, ?, ?, ?, ?)').run(versionId, id, content, '1.0.0', now);
  db.prepare('UPDATE prompts SET version_count = 1 WHERE id = ?').run(id);

  // 处理标签
  if (tags && tags.length) {
    const linkTag = db.prepare('INSERT OR IGNORE INTO prompt_tags (prompt_id, tag_id) VALUES (?, ?)');
    for (const tagId of tags) {
      linkTag.run(id, tagId);
    }
  }

  const prompt = db.prepare('SELECT * FROM prompts WHERE id = ?').get(id);
  prompt.tags = db.prepare('SELECT t.* FROM tags t JOIN prompt_tags pt ON t.id = pt.tag_id WHERE pt.prompt_id = ?').all(id);
  res.json({ prompt });
});

// 更新提示词
router.put('/:id', (req, res) => {
  const { title, description, content, folder_id, tags, is_favorite } = req.body;
  const prompt = db.prepare('SELECT * FROM prompts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!prompt) return res.status(404).json({ error: '提示词不存在' });

  const now = Date.now();
  if (title !== undefined) db.prepare('UPDATE prompts SET title = ? WHERE id = ?').run(title, prompt.id);
  if (description !== undefined) db.prepare('UPDATE prompts SET description = ? WHERE id = ?').run(description, prompt.id);
  if (folder_id !== undefined) db.prepare('UPDATE prompts SET folder_id = ? WHERE id = ?').run(folder_id, prompt.id);
  if (is_favorite !== undefined) db.prepare('UPDATE prompts SET is_favorite = ? WHERE id = ?').run(is_favorite ? 1 : 0, prompt.id);

  // 内容变更时自动创建版本
  if (content !== undefined && content !== prompt.content) {
    const parts = (prompt.current_version || '1.0.0').split('.').map(Number);
    parts[2] = (parts[2] || 0) + 1;
    const newVersion = parts.join('.');

    const versionId = uuidv4();
    db.prepare('INSERT INTO prompt_versions (id, prompt_id, content, version_number, created_at) VALUES (?, ?, ?, ?, ?)').run(versionId, prompt.id, content, newVersion, now);
    db.prepare('UPDATE prompts SET content = ?, current_version = ?, version_count = version_count + 1 WHERE id = ?').run(content, newVersion, prompt.id);
  }

  db.prepare('UPDATE prompts SET updated_at = ? WHERE id = ?').run(now, prompt.id);

  // 更新标签
  if (tags !== undefined) {
    db.prepare('DELETE FROM prompt_tags WHERE prompt_id = ?').run(prompt.id);
    const linkTag = db.prepare('INSERT OR IGNORE INTO prompt_tags (prompt_id, tag_id) VALUES (?, ?)');
    for (const tagId of tags) {
      linkTag.run(prompt.id, tagId);
    }
  }

  const updated = db.prepare('SELECT * FROM prompts WHERE id = ?').get(prompt.id);
  updated.tags = db.prepare('SELECT t.* FROM tags t JOIN prompt_tags pt ON t.id = pt.tag_id WHERE pt.prompt_id = ?').all(prompt.id);
  res.json({ prompt: updated });
});

// 删除提示词
router.delete('/:id', (req, res) => {
  const prompt = db.prepare('SELECT * FROM prompts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!prompt) return res.status(404).json({ error: '提示词不存在' });

  db.prepare('DELETE FROM prompts WHERE id = ?').run(prompt.id);
  res.json({ success: true });
});

// 恢复版本
router.post('/:id/restore', (req, res) => {
  const { version_id } = req.body;
  const prompt = db.prepare('SELECT * FROM prompts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!prompt) return res.status(404).json({ error: '提示词不存在' });

  const version = db.prepare('SELECT * FROM prompt_versions WHERE id = ? AND prompt_id = ?').get(version_id, prompt.id);
  if (!version) return res.status(404).json({ error: '版本不存在' });

  const now = Date.now();
  const parts = (prompt.current_version || '1.0.0').split('.').map(Number);
  parts[2] = (parts[2] || 0) + 1;
  const newVersion = parts.join('.');

  const newVersionId = uuidv4();
  db.prepare('INSERT INTO prompt_versions (id, prompt_id, content, version_number, variables, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(newVersionId, prompt.id, version.content, newVersion, version.variables || '', now);
  db.prepare('UPDATE prompts SET content = ?, current_version = ?, version_count = version_count + 1, updated_at = ? WHERE id = ?').run(version.content, newVersion, now, prompt.id);

  const updated = db.prepare('SELECT * FROM prompts WHERE id = ?').get(prompt.id);
  res.json({ prompt: updated });
});

// ===== Prompt 文件夹 =====

router.get('/folders/all', (req, res) => {
  const folders = db.prepare(`
    SELECT pf.*, (SELECT COUNT(*) FROM prompts WHERE folder_id = pf.id) as prompt_count
    FROM prompt_folders pf WHERE pf.user_id = ? ORDER BY pf.created_at
  `).all(req.user.id);
  // 兼容前端期望的 folder_id 字段
  res.json({ folders: folders.map(f => ({ ...f, folder_id: f.id, folder_name: f.name })) });
});

// 创建文件夹
router.post('/folders', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: '名称不能为空' });

  const id = uuidv4();
  const now = Date.now();
  db.prepare('INSERT INTO prompt_folders (id, user_id, name, parent_id, icon, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, req.user.id, name, req.body.parent_id || null, req.body.icon || '', now, now);

  const folder = db.prepare('SELECT * FROM prompt_folders WHERE id = ?').get(id);
  res.json({ folder });
});

// 更新文件夹
router.put('/folders/:id', (req, res) => {
  const { name, parent_id, icon } = req.body;
  const folder = db.prepare('SELECT * FROM prompt_folders WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!folder) return res.status(404).json({ error: '文件夹不存在' });

  if (name !== undefined) db.prepare('UPDATE prompt_folders SET name = ? WHERE id = ?').run(name, folder.id);
  if (parent_id !== undefined) db.prepare('UPDATE prompt_folders SET parent_id = ? WHERE id = ?').run(parent_id || null, folder.id);
  if (icon !== undefined) db.prepare('UPDATE prompt_folders SET icon = ? WHERE id = ?').run(icon, folder.id);
  db.prepare('UPDATE prompt_folders SET updated_at = ? WHERE id = ?').run(Date.now(), folder.id);
  const updated = db.prepare('SELECT * FROM prompt_folders WHERE id = ?').get(folder.id);
  res.json({ folder: updated });
});

// 删除文件夹（提示词 folder_id 置空）
router.delete('/folders/:id', (req, res) => {
  const folder = db.prepare('SELECT * FROM prompt_folders WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!folder) return res.status(404).json({ error: '文件夹不存在' });

  db.prepare('UPDATE prompts SET folder_id = NULL WHERE folder_id = ? AND user_id = ?').run(folder.id, req.user.id);
  db.prepare('DELETE FROM prompt_folders WHERE id = ?').run(folder.id);
  res.json({ success: true });
});

module.exports = router;
