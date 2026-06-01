/**
 * 从备份 JSON 文件直接导入提示词数据到数据库
 * 用法: node import-prompts.js
 */
const db = require('./db');
const fs = require('fs');
const path = require('path');

const backupFile = path.join(__dirname, 'data', 'promptpro-backup-2026-05-26-152917.json');
if (!fs.existsSync(backupFile)) {
  console.error('备份文件不存在:', backupFile);
  process.exit(1);
}

const backup = JSON.parse(fs.readFileSync(backupFile, 'utf-8'));
const { prompts = [], folders = [], tags = [], tag_relations = [], versions = [] } = backup.data;
const userId = 1;
const now = Date.now();

db.pragma('foreign_keys = OFF');

const tx = db.transaction(() => {
  // 清空
  db.prepare('DELETE FROM prompt_tags').run();
  db.prepare('DELETE FROM prompt_versions').run();
  db.prepare('DELETE FROM prompts').run();
  db.prepare('DELETE FROM prompt_folders').run();
  db.prepare('DELETE FROM tags').run();

  // 文件夹
  const insFolder = db.prepare('INSERT INTO prompt_folders (id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
  for (const f of folders) {
    insFolder.run(f.folder_id, userId, f.folder_name || '', f.created_at || now, f.updated_at || now);
  }
  console.log(`folders: ${folders.length}`);

  // 标签
  const insTag = db.prepare('INSERT INTO tags (id, user_id, name, color, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
  for (const t of tags) {
    insTag.run(t.tag_id, userId, t.tag_name || '', t.color || '', t.created_at || now, t.updated_at || now);
  }
  console.log(`tags: ${tags.length}`);

  // 提示词
  const insPrompt = db.prepare('INSERT INTO prompts (id, user_id, title, description, content, folder_id, is_favorite, version_count, current_version, avatar, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const p of prompts) {
    insPrompt.run(p.prompt_id, userId, p.title || '', p.description || '', p.content || '', p.folder_id || null, p.is_favorite ? 1 : 0, p.version_count || 1, p.current_version || '1.0.0', p.avatar || '', p.created_at || now, p.updated_at || now);
  }
  console.log(`prompts: ${prompts.length}`);

  // 标签关联
  const insRelation = db.prepare('INSERT INTO prompt_tags (prompt_id, tag_id, created_at) VALUES (?, ?, ?)');
  for (const tr of tag_relations) {
    insRelation.run(tr.prompt_id, tr.tag_id, tr.created_at || now);
  }
  console.log(`tag_relations: ${tag_relations.length}`);

  // 版本历史
  const insVersion = db.prepare('INSERT INTO prompt_versions (id, prompt_id, content, version_number, variables, created_at) VALUES (?, ?, ?, ?, ?, ?)');
  for (const v of versions) {
    insVersion.run(v.version_id, v.prompt_id, v.content || '', v.version_number || '1.0.0', v.variables || '', v.created_at || now);
  }
  console.log(`versions: ${versions.length}`);
});

tx();
db.pragma('foreign_keys = ON');

console.log('\n=== 验证 ===');
console.log('prompts:', db.prepare('SELECT COUNT(*) as c FROM prompts').get().c);
console.log('prompt_folders:', db.prepare('SELECT COUNT(*) as c FROM prompt_folders').get().c);
console.log('tags:', db.prepare('SELECT COUNT(*) as c FROM tags').get().c);
const sample = db.prepare('SELECT id, name FROM tags LIMIT 3').all();
console.log('tags sample:', JSON.stringify(sample));
console.log('prompt_tags:', db.prepare('SELECT COUNT(*) as c FROM prompt_tags').get().c);
console.log('prompt_versions:', db.prepare('SELECT COUNT(*) as c FROM prompt_versions').get().c);
console.log('\n导入完成!');
