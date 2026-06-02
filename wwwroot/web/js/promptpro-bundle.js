/**
 * PromptPro 提示词管理系统 - 核心功能模块
 * 功能：业务逻辑处理 | 全文检索过滤
 */

const STORAGE_KEYS = {
  PROMPTS: 'prompts',
  FOLDERS: 'folders',
  TAGS: 'tags',
  TAG_RELATIONS: 'tag_relations',
  VERSIONS: 'versions'
};

class PromptProDB {
  static _initialized = false;

  // 直接调 API
  static async _fetch(path, options = {}) {
    const token = localStorage.getItem('favshub_token') || localStorage.getItem('fh_local_favshub_token') || '';
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch('/api' + path, { ...options, headers });
    if (res.status === 401) return {};  // 未登录返回空对象
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'HTTP ' + res.status); }
    return res.json();
  }

  static async init() {
    if (this._initialized) return;
    this._initialized = true;
  }

  static async getBackupConfig(key) {
    try { return JSON.parse(localStorage.getItem('prompt_backup_' + key) || 'null'); } catch { return null; }
  }
  static async setBackupConfig(key, value) {
    localStorage.setItem('prompt_backup_' + key, JSON.stringify(value));
  }

  static async getAll(storeName) {
    try {
      if (storeName === 'folders') {
        const data = await this._fetch('/prompts/folders/all');
        return data.folders || [];
      }
      if (storeName === 'tags') {
        const data = await this._fetch('/tags');
        return data.tags || [];
      }
      if (storeName === 'tag_relations') {
        const data = await this._fetch('/prompts/tag-relations');
        return data.relations || [];
      }
      if (storeName === 'versions') {
        return []; // versions 按需加载
      }
      const data = await this._fetch('/prompts');
      return data.prompts || [];
    } catch (e) { console.warn('[PromptDB] getAll:', storeName, e.message); return []; }
  }

  static _isNew = new Set(); // 跟踪新建对象ID

  static async put(storeName, data) {
    try {
      if (storeName === 'prompts') {
        const id = data.prompt_id || data.id;
        // 新建的或者标记为新建的用 POST，已有提示词用 PUT
        if (this._isNew.has(id)) {
          this._isNew.delete(id);
          return this._fetch('/prompts', { method: 'POST', body: JSON.stringify({ ...data, prompt_id: id }) });
        }
        return this._fetch('/prompts/' + id, { method: 'PUT', body: JSON.stringify(data) });
      }
      if (storeName === 'folders') {
        const id = data.folder_id || data.id;
        if (this._isNew.has(id)) {
          this._isNew.delete(id);
          return this._fetch('/prompts/folders', { method: 'POST', body: JSON.stringify({ name: data.folder_name || data.name }) });
        }
        return this._fetch('/prompts/folders/' + id, { method: 'PUT', body: JSON.stringify({ name: data.folder_name || data.name }) });
      }
      if (storeName === 'tags') {
        const id = data.tag_id || data.id;
        if (this._isNew.has(id)) {
          this._isNew.delete(id);
          return this._fetch('/tags', { method: 'POST', body: JSON.stringify({ name: data.tag_name || data.name }) });
        }
        return null;
      }
      return null;
    } catch (e) { console.warn('[PromptDB] put:', e.message); throw e; }
  }

  static async get(storeName, key) {
    try {
      if (storeName === 'prompts') {
        const data = await this._fetch('/prompts/' + key);
        return data.prompt ? { ...data.prompt, prompt_id: data.prompt.id } : (data.prompts ? data.prompts[0] : null);
      }
      const all = await this.getAll(storeName);
      return all.find ? all.find(i => (i.id || i.prompt_id || i.folder_id || i.tag_id) === key) : null;
    } catch (e) { return null; }
  }

  static async delete(storeName, key) {
    try {
      if (storeName === 'prompts') return this._fetch('/prompts/' + key, { method: 'DELETE' });
      if (storeName === 'folders') return this._fetch('/prompts/folders/' + key, { method: 'DELETE' });
      if (storeName === 'tags') return this._fetch('/tags/' + key, { method: 'DELETE' });
      return null;
    } catch (e) { console.warn('[PromptDB] delete:', e.message); throw e; }
  }

  static async getByIndex(storeName, indexName, value) {
    const all = await this.getAll(storeName);
    const key = indexName === 'folder_id' ? 'folder_id' : indexName;
    return all.filter ? all.filter(i => i[key] === value) : [];
  }

  static async clear(storeName) {
    const all = await this.getAll(storeName);
    for (const item of all) {
      const id = item.id || item.prompt_id || item.folder_id || item.tag_id;
      if (id) await this.delete(storeName, id);
    }
  }

  static generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  static async getPrompts(filters = {}) {
    let prompts = await this.getAll(STORAGE_KEYS.PROMPTS);
    const folders = await this.getAll(STORAGE_KEYS.FOLDERS);
    const tagRelations = await this.getAll(STORAGE_KEYS.TAG_RELATIONS);
    const tags = await this.getAll(STORAGE_KEYS.TAGS);
    prompts = prompts.map(p => {
      const folder = folders.find(f => f.folder_id === p.folder_id);
      const relations = tagRelations.filter(r => r.prompt_id === p.prompt_id);
      const promptTags = relations.map(r => tags.find(t => t.tag_id === r.tag_id)).filter(Boolean);
      return { ...p, folder_name: folder ? folder.folder_name : '', tags: promptTags, tagIds: promptTags.map(t => t.tag_id) };
    });
    if (filters.folder_id) prompts = prompts.filter(p => p.folder_id === filters.folder_id);
    if (filters.tag_id) prompts = prompts.filter(p => p.tagIds && p.tagIds.includes(filters.tag_id));
    if (filters.is_favorite) prompts = prompts.filter(p => p.is_favorite === 1);
    if (filters.keyword) prompts = this.searchWithScoring(prompts, filters.keyword);
    else prompts.sort((a, b) => b.updated_at - a.updated_at);
    return prompts;
  }

  static searchWithScoring(prompts, query) {
    const keywords = query.trim().split(/[\s\u3000\u2000-\u206f\u3000-\u303f\uff00-\uffef,.!?;:]+/).filter(k => k.length > 0);
    if (keywords.length === 0) return prompts;
    return prompts.map(p => ({ ...p, _score: this.calculateSearchScore(p, keywords) })).filter(p => p._score > 0).sort((a, b) => b._score - a._score);
  }

  static calculateSearchScore(prompt, keywords) {
    const title = (prompt.title || '').toLowerCase();
    const desc = (prompt.description || '').toLowerCase();
    const content = (prompt.content || '').toLowerCase();
    const folder = (prompt.folder_name || '').toLowerCase();
    const tagNames = (prompt.tags || []).map(t => (t.tag_name || '').toLowerCase());
    let totalScore = 0, titleMatchedCount = 0, tagMatchedCount = 0, descMatchedCount = 0, folderMatchedCount = 0;
    for (const keyword of keywords) {
      if (title.includes(keyword)) { totalScore += title === keyword ? 10000 : title.startsWith(keyword) ? 8000 : 5000; titleMatchedCount++; }
      if (tagNames.some(tag => tag.includes(keyword))) { totalScore += 2000; tagMatchedCount++; }
      if (desc.includes(keyword)) { totalScore += desc.startsWith(keyword) ? 1500 : 1000; descMatchedCount++; }
      if (folder.includes(keyword)) { totalScore += 800; folderMatchedCount++; }
      if (content.includes(keyword)) totalScore += 300;
    }
    if (titleMatchedCount === keywords.length && keywords.length > 0) totalScore += keywords.length * 5000;
    if (tagMatchedCount === keywords.length && keywords.length > 0) totalScore += keywords.length * 3000;
    if (descMatchedCount === keywords.length && keywords.length > 0) totalScore += keywords.length * 1500;
    const fieldsMatched = [titleMatchedCount > 0, tagMatchedCount > 0, descMatchedCount > 0, folderMatchedCount > 0].filter(Boolean).length;
    if (fieldsMatched >= 2 && keywords.length > 1) totalScore += fieldsMatched * 1000;
    return totalScore;
  }

  static async getPrompt(promptId) {
    const prompt = await this.get(STORAGE_KEYS.PROMPTS, promptId);
    if (!prompt) return null;
    const folders = await this.getAll(STORAGE_KEYS.FOLDERS);
    const tagRelations = await this.getAll(STORAGE_KEYS.TAG_RELATIONS);
    const tags = await this.getAll(STORAGE_KEYS.TAGS);
    const versions = await this.getVersions(promptId);
    const folder = folders.find(f => f.folder_id === prompt.folder_id);
    const relations = tagRelations.filter(r => r.prompt_id === promptId);
    const promptTags = relations.map(r => tags.find(t => t.tag_id === r.tag_id)).filter(Boolean);
    return { ...prompt, folder_name: folder ? folder.folder_name : '', tags: promptTags, versions };
  }

  static async createPrompt(data) {
    const promptId = this.generateUUID();
    this._isNew.add(promptId);
    const prompt = { prompt_id: promptId, title: data.title || '', description: data.description || '', content: data.content || '', folder_id: data.folder_id || null, is_favorite: data.is_favorite || 0, version_count: 0, current_version: '1.0.0', created_at: Date.now(), updated_at: Date.now() };
    await this.put(STORAGE_KEYS.PROMPTS, prompt);
    if (data.tags && data.tags.length > 0) await this.updatePromptTags(promptId, data.tags);
    return { prompt_id: promptId };
  }

  static async updatePrompt(promptId, data) {
    const prompt = await this.get(STORAGE_KEYS.PROMPTS, promptId);
    if (!prompt) return false;
    const now = Date.now();
    const contentChanged = prompt.content !== data.content;
    if (contentChanged && prompt.content) {
      await this.saveVersion(promptId, prompt.content, prompt.current_version, prompt.created_at);
      const versionParts = prompt.current_version.split('.');
      if (versionParts.length === 3) { versionParts[2] = parseInt(versionParts[2]) + 1; prompt.current_version = versionParts.join('.'); }
      prompt.version_count = (prompt.version_count || 0) + 1;
    }
    Object.assign(prompt, { title: data.title !== undefined ? data.title : prompt.title, description: data.description !== undefined ? data.description : prompt.description, content: data.content !== undefined ? data.content : prompt.content, folder_id: data.folder_id !== undefined ? data.folder_id : prompt.folder_id, is_favorite: data.is_favorite !== undefined ? data.is_favorite : prompt.is_favorite, current_version: data.current_version || prompt.current_version, updated_at: now });
    await this.put(STORAGE_KEYS.PROMPTS, prompt);
    if (data.tags !== undefined) await this.updatePromptTags(promptId, data.tags);
    return true;
  }

  static async deletePrompt(promptId) {
    await this.delete(STORAGE_KEYS.PROMPTS, promptId);
    const relations = await this.getByIndex(STORAGE_KEYS.TAG_RELATIONS, 'prompt_id', promptId);
    for (const r of relations) await this.delete(STORAGE_KEYS.TAG_RELATIONS, r.id);
    const versions = await this.getByIndex(STORAGE_KEYS.VERSIONS, 'prompt_id', promptId);
    for (const v of versions) await this.delete(STORAGE_KEYS.VERSIONS, v.version_id);
    return true;
  }

  static async toggleFavorite(promptId) {
    const prompt = await this.get(STORAGE_KEYS.PROMPTS, promptId);
    if (!prompt) return null;
    prompt.is_favorite = prompt.is_favorite === 1 ? 0 : 1;
    await this.put(STORAGE_KEYS.PROMPTS, prompt);
    return { is_favorite: prompt.is_favorite };
  }

  static async saveVersion(promptId, content, versionNumber, createdAt) {
    await this._fetch('/prompts/versions/' + promptId, {
      method: 'POST', body: JSON.stringify({ content, version_number: versionNumber, created_at: createdAt || Date.now() })
    }).catch(() => {});
  }

  static async getVersions(promptId) {
    try { const d = await this._fetch('/prompts/versions/' + promptId); return (d.versions || []); }
    catch { return []; }
  }

  static async restoreVersion(promptId, versionId) {
    const version = await this.get(STORAGE_KEYS.VERSIONS, versionId);
    if (!version) return false;
    const prompt = await this.get(STORAGE_KEYS.PROMPTS, promptId);
    if (!prompt) return false;
    const existing = await this.getByIndex(STORAGE_KEYS.VERSIONS, 'prompt_id', promptId);
    if (!existing.some(v => v.version_number === prompt.current_version && v.content === prompt.content) && prompt.content) {
      await this.saveVersion(promptId, prompt.content, prompt.current_version, prompt.created_at);
    }
    prompt.content = version.content;
    prompt.current_version = version.version_number;
    prompt.updated_at = Date.now();
    await this.put(STORAGE_KEYS.PROMPTS, prompt);
    return true;
  }

  static async getFolders() {
    const folders = await this.getAll(STORAGE_KEYS.FOLDERS);
    const prompts = await this.getAll(STORAGE_KEYS.PROMPTS);
    return folders.map(f => ({ ...f, prompt_count: prompts.filter(p => p.folder_id === f.folder_id).length }));
  }

  static async createFolder(data) {
    const id = this.generateUUID();
    this._isNew.add(id);
    await this.put(STORAGE_KEYS.FOLDERS, { folder_id: id, folder_name: data.folder_name, created_at: Date.now(), updated_at: Date.now() });
    return { folder_id: id };
  }

  static async deleteFolder(folderId) {
    await this.delete(STORAGE_KEYS.FOLDERS, folderId);
    const prompts = await this.getByIndex(STORAGE_KEYS.PROMPTS, 'folder_id', folderId);
    for (const p of prompts) { p.folder_id = null; p.updated_at = Date.now(); await this.put(STORAGE_KEYS.PROMPTS, p); }
    return true;
  }

  static async getTags() {
    const tags = await this.getAll(STORAGE_KEYS.TAGS);
    const relations = await this.getAll(STORAGE_KEYS.TAG_RELATIONS);
    return tags.map(t => ({ ...t, use_count: relations.filter(r => r.tag_id === t.tag_id).length }));
  }

  static async createTag(data) {
    const id = this.generateUUID();
    this._isNew.add(id);
    await this.put(STORAGE_KEYS.TAGS, { tag_id: id, tag_name: data.tag_name, created_at: Date.now() });
    return { tag_id: id };
  }

  static async deleteTag(tagId) {
    await this.delete(STORAGE_KEYS.TAGS, tagId);
    const relations = await this.getByIndex(STORAGE_KEYS.TAG_RELATIONS, 'tag_id', tagId);
    for (const r of relations) await this.delete(STORAGE_KEYS.TAG_RELATIONS, r.id);
    return true;
  }

  static async updatePromptTags(promptId, tags) {
    const oldRelations = await this.getByIndex(STORAGE_KEYS.TAG_RELATIONS, 'prompt_id', promptId);
    for (const r of oldRelations) await this.delete(STORAGE_KEYS.TAG_RELATIONS, r.id);
    for (const tag of tags) {
      if (tag.tag_id) await this.put(STORAGE_KEYS.TAG_RELATIONS, { prompt_id: promptId, tag_id: tag.tag_id });
      else if (tag.tag_name && tag.is_new) {
        const newTag = await this.createTag({ tag_name: tag.tag_name });
        await this.put(STORAGE_KEYS.TAG_RELATIONS, { prompt_id: promptId, tag_id: newTag.tag_id });
      }
    }
  }

  static async getStats() {
    const prompts = await this.getAll(STORAGE_KEYS.PROMPTS);
    const folders = await this.getAll(STORAGE_KEYS.FOLDERS);
    const tags = await this.getAll(STORAGE_KEYS.TAGS);
    const versions = await this.getAll(STORAGE_KEYS.VERSIONS);
    return { total_prompts: prompts.length, favorite_prompts: prompts.filter(p => p.is_favorite === 1).length, total_folders: folders.length, total_tags: tags.length, total_versions: versions.length };
  }

  static async exportData() {
    return { prompts: await this.getAll(STORAGE_KEYS.PROMPTS), folders: await this.getAll(STORAGE_KEYS.FOLDERS), tags: await this.getAll(STORAGE_KEYS.TAGS), tag_relations: await this.getAll(STORAGE_KEYS.TAG_RELATIONS), versions: await this.getAll(STORAGE_KEYS.VERSIONS) };
  }

  static async importData(data) {
    try {
      // 兼容新旧两种格式
      const payload = (data.type === 'promptpro' && data.data) ? data.data : data;
      for (const store of Object.values(STORAGE_KEYS)) await this.clear(store);
      if (payload.prompts) for (const p of payload.prompts) await this.put(STORAGE_KEYS.PROMPTS, p);
      if (payload.folders) for (const f of payload.folders) await this.put(STORAGE_KEYS.FOLDERS, f);
      if (payload.tags) for (const t of payload.tags) await this.put(STORAGE_KEYS.TAGS, t);
      if (payload.tag_relations) for (const r of payload.tag_relations) await this.put(STORAGE_KEYS.TAG_RELATIONS, r);
      if (payload.versions) for (const v of payload.versions) await this.put(STORAGE_KEYS.VERSIONS, v);
      return true;
    } catch (error) { console.error('[PromptPro] ✗ 导入操作失败 | 错误信息:', error); return false; }
  }

  static async initSampleData() {
    const prompts = await this.getAll(STORAGE_KEYS.PROMPTS);
    if (prompts.length > 0) return;
    const folders = [
      { folder_id: 'folder-1', folder_name: '写作助手', created_at: Date.now(), updated_at: Date.now() },
      { folder_id: 'folder-2', folder_name: '翻译助手', created_at: Date.now(), updated_at: Date.now() },
      { folder_id: 'folder-3', folder_name: '智能助手', created_at: Date.now(), updated_at: Date.now() }
    ];
    for (const f of folders) await this.put(STORAGE_KEYS.FOLDERS, f);
    const tags = [
      { tag_id: 'tag-1', tag_name: 'GPT-4', created_at: Date.now() },
      { tag_id: 'tag-2', tag_name: 'Markdown', created_at: Date.now() },
      { tag_id: 'tag-3', tag_name: '编程', created_at: Date.now() }
    ];
    for (const t of tags) await this.put(STORAGE_KEYS.TAGS, t);
    const now = Date.now();
    const samplePrompts = [
      { prompt_id: this.generateUUID(), title: 'AI智能写作助手', description: '智能写作助手辅助写作', content: '一位专业编辑...', folder_id: 'folder-1', is_favorite: 1, version_count: 0, current_version: '1.0.0', created_at: now, updated_at: now },
      { prompt_id: this.generateUUID(), title: '智能翻译助手', description: '', content: '一位老师...', folder_id: 'folder-2', is_favorite: 0, version_count: 0, current_version: '1.0.0', created_at: now, updated_at: now },
      { prompt_id: this.generateUUID(), title: '中英翻译助手', description: '', content: '你是一位资深的编程专家...', folder_id: 'folder-3', is_favorite: 1, version_count: 0, current_version: '1.0.0', created_at: now, updated_at: now }
    ];
    for (const p of samplePrompts) await this.put(STORAGE_KEYS.PROMPTS, p);
    const tagRelations = [
      { prompt_id: samplePrompts[0].prompt_id, tag_id: 'tag-1' },
      { prompt_id: samplePrompts[0].prompt_id, tag_id: 'tag-2' },
      { prompt_id: samplePrompts[1].prompt_id, tag_id: 'tag-1' },
      { prompt_id: samplePrompts[2].prompt_id, tag_id: 'tag-3' }
    ];
    for (const r of tagRelations) await this.put(STORAGE_KEYS.TAG_RELATIONS, r);
  }
}

window.PromptProDB = PromptProDB;

// ==========================================
// PromptPro 应用逻辑控制器
// ==========================================

(function() {
  'use strict';

  const state = { prompts: [], folders: [], tags: [], stats: {}, currentView: 'prompts', currentPrompt: null, selectedFolder: '', selectedTags: [], keyword: '', formTags: [], editingPromptId: null, foldersExpanded: true };

  function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<i class="${type === 'success' ? 'ri-check-line' : 'ri-error-warning-line'}"></i><span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => { 
      toast.style.transition = 'opacity 0.3s ease';
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300); 
    }, 3000);
  }

  function formatTimestamp(ts) { if (!ts) return '未知'; return new Date(ts).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); }
  function escapeHtml(text) { if (!text) return ''; const div = document.createElement('div'); div.textContent = text; return div.innerHTML; }
  async function loadAll() {
    // 先加载统计数据，确保渲染时数据已就绪
    await loadStats();
    // 然后并行加载其他数据
    await Promise.all([loadFolders(), loadTags(), loadPrompts()]);
  }

  async function loadPrompts() {
    const filters = {};
    if (state.selectedFolder) filters.folder_id = state.selectedFolder;
    if (state.keyword) filters.keyword = state.keyword;
    if (state.currentView === 'favorites') filters.is_favorite = 1;
    state.prompts = await PromptProDB.getPrompts(filters);
    applyLocalFilters();
  }

  function applyLocalFilters() {
    let filtered = [...state.prompts];
    if (state.selectedTags.length > 0) filtered = filtered.filter(p => p.tagIds && p.tagIds.some(id => state.selectedTags.includes(id)));
    renderPromptGrid(filtered);
  }

  async function loadFolders() { state.folders = await PromptProDB.getFolders(); renderFolders(); }
  async function loadTags() { state.tags = await PromptProDB.getTags(); renderTags(); }
  async function loadStats() { state.stats = await PromptProDB.getStats(); }

  function renderFolders() {
    const list = document.getElementById('categories-list');
    if (!list) return;

    const arrowIcon = state.foldersExpanded ? ICONS.expand_less : ICONS.chevron_right;
    const folderClass = state.foldersExpanded ? 'folder-item' : 'folder-item folder-collapsed';

    let html = '';
    // "全部" item - 带折叠展开功能
    html += `<li class="folder-item ${!state.selectedFolder ? 'bg-emerald-500' : ''}" data-folder="" data-toggle="folders">
      <span class="material-icons mr-2">${ICONS.apps}</span>
      <span>全部</span>
      <span class="item-count">${state.stats.total_prompts || 0}</span>
      <span class="material-icons ml-auto folder-arrow">${arrowIcon}</span>
    </li>`;

    // Folder items - 根据折叠状态显示/隐藏
    state.folders.forEach(folder => {
      html += `<li class="${state.selectedFolder === folder.folder_id ? folderClass + ' bg-emerald-500' : folderClass}" data-folder="${folder.folder_id}">
        <span class="material-icons mr-2">${ICONS.folder}</span>
        <span>${escapeHtml(folder.folder_name)}</span>
        <span class="item-count">${folder.prompt_count || 0}</span>
        <button class="item-delete" data-folder-id="${folder.folder_id}" title="删除文件夹"><i class="ri-close-line"></i></button>
      </li>`;
    });

    list.innerHTML = html;

    // Bind "全部" toggle click
    const allItem = list.querySelector('.folder-item[data-toggle="folders"]');
    if (allItem) {
      allItem.addEventListener('click', (e) => {
        if (!e.target.closest('.item-delete')) {
          state.foldersExpanded = !state.foldersExpanded;
          renderFolders();
        }
      });
    }

    // Bind folder click events
    list.querySelectorAll('.folder-item[data-folder]:not([data-toggle])').forEach(item => {
      item.addEventListener('click', (e) => {
        if (!e.target.closest('.item-delete')) selectFolder(item.dataset.folder);
      });
    });

    // Folder delete button events
    list.querySelectorAll('.item-delete[data-folder-id]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const folder = state.folders.find(f => f.folder_id === btn.dataset.folderId);
        if (folder && confirm(`确定要删除文件夹"${folder.folder_name}"吗？`)) {
          await PromptProDB.deleteFolder(folder.folder_id);
          showToast('文件夹已删除');
          if (state.selectedFolder === folder.folder_id) state.selectedFolder = '';
          await loadAll();
        }
      });
    });

    // Also render tags grid
    renderTagsGrid();
  }

  function renderTagsGrid() {
    const grid = document.getElementById('sidebar-tags-grid');
    if (!grid) return;

    const activeTags = state.tags.filter(t => t.use_count > 0);
    const label = grid.previousElementSibling; // .tags-section-label

    if (activeTags.length === 0) {
      grid.innerHTML = '';
      if (label) label.style.display = 'none';
      return;
    }

    if (label) label.style.display = '';

    let html = '';
    activeTags.forEach(tag => {
      const isActive = state.selectedTags.includes(tag.tag_id);
      html += `<span class="sidebar-tag-chip ${isActive ? 'active' : ''}" data-tag="${tag.tag_id}">
        ${isActive ? '<i class="ri-check-line"></i>' : ''}
        <span class="tag-chip-name">${escapeHtml(tag.tag_name)}</span>
        <button class="tag-chip-delete" data-tag-id="${tag.tag_id}" title="删除标签"><i class="ri-close-line"></i></button>
      </span>`;
    });

    grid.innerHTML = html;

    // Bind tag click events
    grid.querySelectorAll('.sidebar-tag-chip').forEach(chip => {
      chip.addEventListener('click', (e) => {
        if (!e.target.closest('.tag-chip-delete')) toggleTag(chip.dataset.tag);
      });
    });

    // Tag delete button events
    grid.querySelectorAll('.tag-chip-delete').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const tag = state.tags.find(t => t.tag_id === btn.dataset.tagId);
        if (tag && confirm(`确定要删除标签"${tag.tag_name}"吗？`)) {
          await PromptProDB.deleteTag(tag.tag_id);
          showToast('标签已删除');
          const idx = state.selectedTags.indexOf(tag.tag_id);
          if (idx > -1) state.selectedTags.splice(idx, 1);
          await loadAll();
        }
      });
    });
  }

  function renderTags() {
    renderTagsGrid();
    // Also update folders for counts
    const list = document.getElementById('categories-list');
    if (list) {
      const allItem = list.querySelector('.folder-item[data-folder=""] .item-count');
      if (allItem) allItem.textContent = state.stats.total_prompts || 0;
    }
  }

  function selectFolder(folderId) { state.selectedFolder = state.selectedFolder === folderId ? '' : folderId; renderFolders(); updateFilterBar(); loadPrompts(); }
  function toggleTag(tagId) { const index = state.selectedTags.indexOf(tagId); if (index > -1) state.selectedTags.splice(index, 1); else state.selectedTags.push(tagId); renderTags(); updateFilterBar(); loadPrompts(); }

  function updateFilterBar() {
    const filterBar = document.getElementById('filterBar');
    const filterInfo = document.getElementById('filterInfo');
    if (!filterBar) return;
    const hasFilter = state.selectedFolder || state.selectedTags.length > 0 || state.keyword;
    if (!hasFilter) { filterBar.style.display = 'none'; return; }
    filterBar.style.display = 'flex';
    let parts = [];
    if (state.keyword) parts.push(`关键词: ${state.keyword}`);
    if (state.selectedFolder) { const folder = state.folders.find(f => f.folder_id === state.selectedFolder); if (folder) parts.push(`文件夹: ${folder.folder_name}`); }
    if (state.selectedTags.length > 0) parts.push(`标签: ${state.selectedTags.map(id => { const tag = state.tags.find(t => t.tag_id === id); return tag ? tag.tag_name : id; }).join(', ')}`);
    filterInfo.textContent = parts.join(' | ');
  }

  function clearFilters() { state.selectedFolder = ''; state.selectedTags = []; state.keyword = ''; const searchInput = document.getElementById('searchInput'); if (searchInput) searchInput.value = ''; renderFolders(); renderTags(); updateFilterBar(); loadPrompts(); }

  function renderPromptGrid(promptsToRender) {
    const grid = document.getElementById('promptsGrid');
    const loading = document.getElementById('loading');
    const emptyState = document.getElementById('emptyState');
    if (!grid) return;
    if (loading) loading.style.display = 'none';
    if (!promptsToRender || promptsToRender.length === 0) { grid.innerHTML = ''; if (emptyState) emptyState.style.display = 'flex'; return; }
    if (emptyState) emptyState.style.display = 'none';

    grid.innerHTML = promptsToRender.map(prompt => {
      // Tags
      const tagsHtml = (prompt.tags || []).slice(0, 3).map(tag => `<span class="tag"><i class="ri-price-tag-3-line"></i>${escapeHtml(tag.tag_name)}</span>`).join('');
      
      // Description
      const displayText = prompt.description ? escapeHtml(prompt.description) : (prompt.content ? escapeHtml(prompt.content.slice(0, 110)) + '...' : '');
      const descHtml = displayText ? `<div class="prompt-desc">${displayText}</div>` : '';

      // Footer: Folder + Date | Version
      const footerHtml = `
        <div class="prompt-meta-footer">
            <div class="meta-left">
                ${prompt.folder_name ? `<span class="prompt-folder-tag"><i class="ri-folder-fill"></i> ${escapeHtml(prompt.folder_name)}</span>` : ''}
                <span class="meta-item date-item"><i class="ri-calendar-line"></i> ${prompt.updated_at ? new Date(prompt.updated_at).toLocaleDateString('zh-CN').replace(/\//g, '-') : '未知'}</span>
            </div>
            <div class="meta-right">
                ${prompt.current_version ? `<span class="version-badge">v${prompt.current_version}</span>` : ''}
            </div>
        </div>
      `;

      return `
        <div class="prompt-card" data-id="${prompt.prompt_id}">
          <div class="prompt-card-header">
            <h3 class="prompt-title">${escapeHtml(prompt.title)}</h3>
            <div class="prompt-actions">
              <button class="prompt-btn copy-btn" title=""><i class="ri-file-copy-line"></i></button>
              <button class="prompt-btn edit-btn" title="编辑"><i class="ri-edit-line"></i></button>
              <button class="prompt-btn fav-btn ${prompt.is_favorite === 1 ? 'active' : ''}" title="收藏"><i class="${prompt.is_favorite === 1 ? 'ri-star-fill' : 'ri-star-line'}"></i></button>
            </div>
          </div>
          ${descHtml}
          ${tagsHtml ? `<div class="prompt-tags">${tagsHtml}</div>` : ''}
          ${footerHtml}
        </div>
      `;
    }).join('');
    bindPromptCardEvents(grid);
  }

  function bindPromptCardEvents(grid) {
    grid.querySelectorAll('.prompt-card').forEach(card => { card.addEventListener('click', (e) => { if (!e.target.closest('.btn-icon')) showPromptDetail(card.dataset.id); }); });
    grid.querySelectorAll('.copy-btn').forEach(btn => { btn.addEventListener('click', async (e) => { 
      e.stopPropagation(); 
      const promptId = btn.closest('.prompt-card').dataset.id;
      const prompt = await PromptProDB.getPrompt(promptId); 
      if (prompt && prompt.content) { 
        try { 
          await navigator.clipboard.writeText(prompt.content); 
          showToast('内容已复制到剪贴板'); 
        } catch (error) { 
          showToast('操作失败: ' + error.message, 'error'); 
        } 
      } else {
        showToast('没有可复制的内容', 'warning');
      }
    }); });
    grid.querySelectorAll('.edit-btn').forEach(btn => { btn.addEventListener('click', async (e) => { e.stopPropagation(); const prompt = await PromptProDB.getPrompt(btn.closest('.prompt-card').dataset.id); if (prompt) openEditModal(prompt); }); });
    grid.querySelectorAll('.fav-btn').forEach(btn => { btn.addEventListener('click', async (e) => { e.stopPropagation(); const result = await PromptProDB.toggleFavorite(btn.closest('.prompt-card').dataset.id); if (result) { showToast(result.is_favorite === 1 ? '已收藏' : '取消收藏'); await loadAll(); } }); });
  }

  async function showPromptDetail(promptId) {
    const prompt = await PromptProDB.getPrompt(promptId);
    if (!prompt) return;
    state.currentPrompt = prompt;
    const modalTitle = document.getElementById('modalTitle');
    if (modalTitle) modalTitle.textContent = prompt.title;
    const folderEl = document.getElementById('detailFolder');
    if (folderEl) { if (prompt.folder_name) { folderEl.style.display = 'flex'; folderEl.querySelector('span:last-child').textContent = prompt.folder_name; } else folderEl.style.display = 'none'; }
    const tagsEl = document.getElementById('detailTags');
    if (tagsEl) { if (prompt.tags && prompt.tags.length > 0) { tagsEl.style.display = 'flex'; tagsEl.querySelector('span:last-child').innerHTML = prompt.tags.map(tag => `<span class="detail-tag">${escapeHtml(tag.tag_name)}</span>`).join(''); } else tagsEl.style.display = 'none'; }
    const timeEl = document.getElementById('detailTime');
    if (timeEl) timeEl.querySelector('span:last-child').textContent = formatTimestamp(prompt.updated_at);
    const descEl = document.getElementById('detailDescription');
    if (descEl) descEl.textContent = prompt.description || '';
    const contentEl = document.getElementById('detailContent');
    if (contentEl) contentEl.textContent = prompt.content;
    renderVersionHistory(prompt);
    const modal = document.getElementById('promptModal');
    if (modal) modal.classList.add('active');
  }

  function closePromptDetail() { const modal = document.getElementById('promptModal'); if (modal) modal.classList.remove('active'); state.currentPrompt = null; }

  function renderVersionHistory(prompt) {
    const versionsList = document.getElementById('versionsList');
    if (!versionsList) return;
    if (!prompt.versions || prompt.versions.length === 0) { versionsList.innerHTML = '<p style="color: var(--text-secondary); padding: 0.5rem 0; font-size: 0.8125rem;"><i class="ri-file-warning-line"></i> 无版本记录</p>'; return; }
    const allVersions = [...prompt.versions];
    const currentVersionExists = allVersions.some(v => v.version_number === prompt.current_version);
    if (!currentVersionExists && prompt.content) allVersions.unshift({ version_id: 'current', prompt_id: prompt.prompt_id, version_number: prompt.current_version || 'current', content: prompt.content, created_at: prompt.updated_at, is_current: true });
    else if (currentVersionExists) { const cv = allVersions.find(v => v.version_number === prompt.current_version); if (cv) cv.is_current = true; }
    let html = `<div class="version-collapse"><div class="vcol-header" id="vcolHeader"><div class="vcol-left"><i class="ri-git-commit-line"></i><span>版本历史</span><span class="vcol-badge">${allVersions.length}</span></div><div class="vcol-right"><button class="btn vcol-compare-btn" id="compareBtn" disabled><i class="ri-git-repository-commits-line"></i>版本差异对比</button><i class="ri-arrow-down-s-line vcol-arrow"></i></div></div><div class="vcol-body" id="vcolBody"><div class="vcol-grid">`;
    allVersions.forEach((v, i) => {
      const timeStr = formatTimestamp(v.created_at).replace(/\//g, '-');
      const sizeKB = (v.content ? (v.content.length / 1024).toFixed(1) : '0');
      const isCurrent = v.is_current;
      html += `<div class="vcol-item ${isCurrent ? 'is-cur' : ''}" data-version-index="${i}" data-version-id="${v.version_id}"><input type="checkbox" class="vcol-cb" data-index="${i}" id="ver_${i}"><label for="ver_${i}" class="vcol-label"><span class="vcol-ver"><span class="vtag ${isCurrent ? 'cur' : ''}">v${v.version_number}</span>${isCurrent ? '<span class="vtag-cur">当前</span>' : ''}</span><span class="vcol-time">${timeStr}</span><span class="vcol-size">${sizeKB} KB</span></label><div class="vcol-actions"><button class="btn-icon vcol-view" title="查看" data-version-index="${i}"><i class="ri-eye-line"></i></button>${!isCurrent ? `<button class="btn-icon vcol-restore" title="还原到此版本" data-version-index="${i}"><i class="ri-history-line"></i></button>` : ''}</div></div>`;
    });
    html += '</div></div></div>';
    versionsList.innerHTML = html;
    const header = document.getElementById('vcolHeader');
    const body = document.getElementById('vcolBody');
    const arrow = header.querySelector('.vcol-arrow');
    let expanded = false;
    if (header) header.onclick = (e) => { if (e.target.closest('.vcol-compare-btn')) return; expanded = !expanded; body.classList.toggle('open', expanded); if (arrow) arrow.style.transform = expanded ? 'rotate(180deg)' : ''; };
    versionsList.onclick = (e) => {
      const viewBtn = e.target.closest('.vcol-view');
      const restoreBtn = e.target.closest('.vcol-restore');
      const item = e.target.closest('.vcol-item');
      if (viewBtn && item) { e.stopPropagation(); e.preventDefault(); showVersionDetail(allVersions[parseInt(item.dataset.versionIndex)]); return; }
      if (restoreBtn && item && !restoreBtn.disabled) { e.stopPropagation(); e.preventDefault(); restoreBtn.disabled = true; restoreBtn.style.opacity = '0.5'; restoreBtn.style.cursor = 'not-allowed'; restoreVersion(allVersions[parseInt(item.dataset.versionIndex)]).finally(() => { restoreBtn.disabled = false; restoreBtn.style.opacity = ''; restoreBtn.style.cursor = ''; }); return; }
    };
    versionsList.onchange = (e) => { if (e.target.classList.contains('vcol-cb')) { const checked = versionsList.querySelectorAll('.vcol-cb:checked'); const btn = document.getElementById('compareBtn'); if (btn) { const can = checked.length === 2; btn.disabled = !can; btn.classList.toggle('active', can); } } };
    const compareBtn = document.getElementById('compareBtn');
    if (compareBtn) compareBtn.onclick = (e) => { e.stopPropagation(); if (!expanded) { expanded = true; body.classList.add('open'); if (arrow) arrow.style.transform = 'rotate(180deg)'; } const checked = versionsList.querySelectorAll('.vcol-cb:checked'); if (checked.length !== 2) return; const i1 = parseInt(checked[0].dataset.index), i2 = parseInt(checked[1].dataset.index); const v1 = allVersions[i1], v2 = allVersions[i2]; showCompareModal(v1.created_at < v2.created_at ? v1 : v2, v1.created_at < v2.created_at ? v2 : v1, computeDiff((v1.created_at < v2.created_at ? v1 : v2).content, (v1.created_at < v2.created_at ? v2 : v1).content)); };
  }

  function showVersionDetail(version) {
    const modal = document.createElement('div');
    modal.className = 'modal version-modal active';
    modal.innerHTML = `
      <div class="modal-content modal-large">
        <div class="modal-header">
          <h2>版本</h2>
          <button class="modal-close"><i class="ri-close-line"></i></button>
        </div>
        <div class="modal-body">
          <div class="version-detail">
            <div class="version-header">
              <h3>版本 ${version.version_number}</h3>
              <span class="version-time">${formatTimestamp(version.created_at)}</span>
            </div>
            <pre class="version-content">${escapeHtml(version.content)}</pre>
          </div>
        </div>
        <div class="modal-footer version-footer">
          <button class="btn btn-secondary" id="copyVersionBtn">
            <i class="ri-file-copy-line"></i>
            
          </button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    
    // 版本详情弹窗复制按钮点击事件
    const closeBtn = modal.querySelector('.modal-close');
    if (closeBtn) closeBtn.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    
    // 版本详情弹窗复制按钮点击事件
    const copyBtn = document.getElementById('copyVersionBtn');
    if (copyBtn) {
      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(version.content);
          showToast('内容已复制到剪贴板');
        } catch (err) {
          // 
          const textarea = document.createElement('textarea');
          textarea.value = version.content;
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand('copy');
          document.body.removeChild(textarea);
          showToast('内容已复制到剪贴板');
        }
      });
    }
  }

  function restoreVersion(version) {
    return new Promise(async (resolve) => {
      if (!state.currentPrompt) return resolve();
      const confirmModal = document.createElement('div');
      confirmModal.className = 'modal active';
      confirmModal.innerHTML = `<div class="modal-content"><div class="modal-header"><h2>确认还原</h2><button class="modal-close"><i class="ri-close-line"></i></button></div><div class="modal-body"><p style="margin-bottom: 1rem; color: var(--text-secondary);">确定要还原到版本 <strong>v${version.version_number}</strong> 吗？</p><p style="color: var(--text-secondary); font-size: 0.875rem;">还原后，当前内容将被替换为该版本的内容，当前版本将作为历史版本保留。</p></div><div class="modal-footer"><button class="btn btn-secondary" id="cancelRestoreBtn">取消</button><button class="btn btn-primary" id="confirmRestoreBtn">确认还原</button></div></div>`;
      document.body.appendChild(confirmModal);
      const closeBtn = confirmModal.querySelector('.modal-close');
      if (closeBtn) closeBtn.addEventListener('click', () => confirmModal.remove());
      document.getElementById('cancelRestoreBtn').addEventListener('click', () => confirmModal.remove());
      document.getElementById('confirmRestoreBtn').addEventListener('click', async () => {
        confirmModal.remove(); showToast('正在还原...');
        const success = await PromptProDB.restoreVersion(state.currentPrompt.prompt_id, version.version_id);
        if (success) { showToast('已成功还原到版本 ' + version.version_number); const modal = document.getElementById('promptModal'); if (modal) modal.classList.remove('active'); state.currentPrompt = null; await loadAll(); }
        else showToast('保存失败，请重试', 'error');
        resolve();
      });
      confirmModal.addEventListener('click', (e) => { if (e.target === confirmModal) confirmModal.remove(); });
    });
  }

  function computeDiff(oldText, newText) {
    const oldLines = oldText ? oldText.split('\n') : [], newLines = newText ? newText.split('\n') : [];
    const diff = []; let i = 0, j = 0;
    while (i < oldLines.length || j < newLines.length) {
      if (i >= oldLines.length) { diff.push({ type: 'added', line: newLines[j], lineNum: j + 1 }); j++; }
      else if (j >= newLines.length) { diff.push({ type: 'removed', line: oldLines[i], lineNum: i + 1 }); i++; }
      else if (oldLines[i] === newLines[j]) { diff.push({ type: 'same', line: oldLines[i], lineNum: i + 1 }); i++; j++; }
      else { let found = false; for (let k = 1; k <= 3 && j + k < newLines.length; k++) { if (oldLines[i] === newLines[j + k]) { for (let m = 0; m < k; m++) diff.push({ type: 'added', line: newLines[j + m], lineNum: j + m + 1 }); j += k; found = true; break; } } if (!found) { diff.push({ type: 'removed', line: oldLines[i], lineNum: i + 1 }); i++; } }
    }
    return diff;
  }

  function showCompareModal(oldVer, newVer, diff) {
    const stats = { added: diff.filter(d => d.type === 'added').length, removed: diff.filter(d => d.type === 'removed').length, same: diff.filter(d => d.type === 'same').length };
    const diffHtml = diff.map(d => { const line = escapeHtml(d.line); if (d.type === 'added') return `<div class="diff-line added"><span class="diff-line-num">${d.lineNum || ''}</span><span class="diff-line-content">+ ${line}</span></div>`; else if (d.type === 'removed') return `<div class="diff-line removed"><span class="diff-line-num">${d.lineNum || ''}</span><span class="diff-line-content">- ${line}</span></div>`; else return `<div class="diff-line same"><span class="diff-line-num">${d.lineNum || ''}</span><span class="diff-line-content">  ${line}</span></div>`; }).join('');
    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.innerHTML = `<div class="modal-content modal-xlarge"><div class="modal-header"><h2>版本差异对比</h2><button class="modal-close"><i class="ri-close-line"></i></button></div><div class="modal-body"><div class="compare-info"><div class="compare-version"><span class="label">较早版本</span><span class="value">v${oldVer.version_number}</span><span class="time">${formatTimestamp(oldVer.created_at)}</span></div><div class="compare-arrow"><i class="ri-arrow-right-line"></i></div><div class="compare-version"><span class="label">较新版本</span><span class="value">v${newVer.version_number}</span><span class="time">${formatTimestamp(newVer.created_at)}</span></div></div><div class="compare-stats"><span class="stat added">+${stats.added} 行新增</span><span class="stat removed">-${stats.removed} 行删除</span><span class="stat same">${stats.same} 行未变更</span></div><div class="compare-diff">${diffHtml}</div></div></div>`;
    document.body.appendChild(modal);
    const closeBtn = modal.querySelector('.modal-close');
    if (closeBtn) closeBtn.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
  }

  async function openEditModal(prompt = null) {
    state.editingPromptId = prompt ? prompt.prompt_id : null;
    state.formTags = [];
    state.currentPrompt = prompt;
    const form = document.getElementById('promptForm');
    if (form) form.reset();
    const editModalTitle = document.getElementById('editModalTitle');
    const editPromptId = document.getElementById('editPromptId');
    const formTitle = document.getElementById('formTitle');
    const formDescription = document.getElementById('formDescription');
    const formContent = document.getElementById('formContent');
    const formCurrentVersion = document.getElementById('formCurrentVersion');
    if (prompt) {
      if (editModalTitle) editModalTitle.textContent = '编辑提示词';
      if (editPromptId) editPromptId.value = prompt.prompt_id;
      if (formTitle) formTitle.value = prompt.title;
      if (formDescription) formDescription.value = prompt.description || '';
      if (formContent) formContent.value = prompt.content;
      if (formCurrentVersion) formCurrentVersion.value = prompt.current_version;
      state.formTags = prompt.tags ? [...prompt.tags] : [];
    } else {
      if (editModalTitle) editModalTitle.textContent = '编辑提示词';
      if (editPromptId) editPromptId.value = '';
      if (formCurrentVersion) formCurrentVersion.value = '1.0.0';
    }
    loadFolderOptions(); renderFormTags();
    const modal = document.getElementById('editModal');
    if (modal) modal.classList.add('active');
  }

  function closeEditModal() { const modal = document.getElementById('editModal'); if (modal) modal.classList.remove('active'); state.editingPromptId = null; state.formTags = []; }

  function loadFolderOptions() {
    const dropdown = document.querySelector('#folderSelect .custom-select-dropdown');
    if (!dropdown) return;
    let html = '<div class="custom-select-option" data-value=""><i class="ri-folder-line folder-icon"></i>未选择文件夹</div>';
    state.folders.forEach(folder => { 
      html += `<div class="custom-select-option" data-value="${folder.folder_id}"><i class="ri-folder-line folder-icon"></i>${escapeHtml(folder.folder_name)}</div>`; 
    });
    dropdown.innerHTML = html;
    dropdown.querySelectorAll('.custom-select-option').forEach(option => {
      option.addEventListener('click', () => {
        const value = option.dataset.value, text = option.textContent.trim();
        const trigger = document.querySelector('#folderSelect .custom-select-trigger');
        const hiddenInput = document.getElementById('formFolder');
        dropdown.querySelectorAll('.custom-select-option').forEach(opt => opt.classList.remove('selected'));
        option.classList.add('selected');
        if (trigger) { 
          const selectedText = trigger.querySelector('.selected-text'); 
          if (selectedText) { 
            selectedText.textContent = text; 
            selectedText.classList.toggle('placeholder', !value); 
          } 
          trigger.classList.remove('open'); 
        }
        if (hiddenInput) hiddenInput.value = value;
        document.getElementById('folderSelect')?.classList.remove('open'); 
        dropdown.classList.remove('open');
      });
    });
    if (state.currentPrompt && state.currentPrompt.folder_id) {
      const hiddenInput = document.getElementById('formFolder');
      if (hiddenInput) {
        hiddenInput.value = state.currentPrompt.folder_id;
        const trigger = document.querySelector('#folderSelect .custom-select-trigger');
        const selectedOption = dropdown.querySelector(`[data-value="${state.currentPrompt.folder_id}"]`);
        if (trigger && selectedOption) { 
          const selectedText = trigger.querySelector('.selected-text'); 
          if (selectedText) { 
            selectedText.textContent = selectedOption.textContent.trim(); 
            selectedText.classList.remove('placeholder'); 
          } 
          selectedOption.classList.add('selected'); 
        }
      }
    }
  }

  function renderFormTags() {
    const tagList = document.getElementById('formTagList');
    if (!tagList) return;
    tagList.innerHTML = state.formTags.map((tag, i) => `<span class="tag-item">${escapeHtml(tag.tag_name)}<span class="tag-remove" data-index="${i}"><i class="ri-close-line"></i></span></span>`).join('');
    tagList.querySelectorAll('.tag-remove').forEach(btn => { btn.addEventListener('click', () => { state.formTags.splice(parseInt(btn.dataset.index), 1); renderFormTags(); }); });
  }

  function addFormTag(tagName) {
    if (!tagName.trim()) return;
    const exists = state.formTags.find(t => t.tag_name.toLowerCase() === tagName.toLowerCase());
    if (exists) { showToast('标签已存在', 'error'); return; }
    const existingTag = state.tags.find(t => t.tag_name.toLowerCase() === tagName.toLowerCase());
    state.formTags.push(existingTag || { tag_name: tagName, is_new: true });
    renderFormTags();
  }

  function debounce(func, wait) { let timeout; return function executedFunction(...args) { const later = () => { clearTimeout(timeout); func(...args); }; clearTimeout(timeout); timeout = setTimeout(later, wait); }; }

  function renderTagSuggestions() {
    const input = document.getElementById('formTagInput');
    if (!input) return;
    const value = input.value.trim().toLowerCase();
    if (!value) { const suggestions = document.getElementById('tagSuggestions'); if (suggestions) suggestions.style.display = 'none'; return; }
    const matched = state.tags.filter(t => t.tag_name.toLowerCase().includes(value) && !state.formTags.find(ft => ft.tag_id === t.tag_id || ft.tag_name.toLowerCase() === t.tag_name.toLowerCase())).slice(0, 5);
    const container = document.getElementById('tagSuggestions');
    if (!container) return;
    if (matched.length === 0) { container.style.display = 'none'; return; }
    container.style.display = 'flex';
    container.innerHTML = matched.map(tag => `<div class="tag-suggestion" data-tag-id="${tag.tag_id}" data-tag-name="${escapeHtml(tag.tag_name)}"><i class="ri-price-tag-3-line"></i><span>${escapeHtml(tag.tag_name)}</span></div>`).join('');
    container.querySelectorAll('.tag-suggestion').forEach(suggestion => { suggestion.addEventListener('click', () => { state.formTags.push({ tag_id: suggestion.dataset.tagId, tag_name: suggestion.dataset.tagName }); renderFormTags(); input.value = ''; container.style.display = 'none'; }); });
  }

  function initFormTagSelector() {
    const input = document.getElementById('formTagInput');
    if (!input) return;
    input.addEventListener('input', debounce(() => renderTagSuggestions(), 300));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const value = input.value.trim(); if (value) { addFormTag(value); input.value = ''; renderTagSuggestions(); } } });
  }

  function initCustomSelects() {
    document.querySelectorAll('.custom-select').forEach(selectEl => {
      const trigger = selectEl.querySelector('.custom-select-trigger');
      const dropdown = selectEl.querySelector('.custom-select-dropdown');
      if (!trigger || !dropdown) return;
      trigger.addEventListener('click', () => {
        const isOpen = selectEl.classList.contains('open');
        document.querySelectorAll('.custom-select.open').forEach(el => { if (el !== selectEl) { el.classList.remove('open'); el.querySelector('.custom-select-trigger')?.classList.remove('open'); el.querySelector('.custom-select-dropdown')?.classList.remove('open'); } });
        selectEl.classList.toggle('open', !isOpen); trigger.classList.toggle('open', !isOpen); dropdown.classList.toggle('open', !isOpen);
      });
      dropdown.querySelectorAll('.custom-select-option').forEach(option => {
        option.addEventListener('click', () => {
          const value = option.dataset.value, text = option.textContent;
          dropdown.querySelectorAll('.custom-select-option').forEach(opt => opt.classList.remove('selected'));
          option.classList.add('selected');
          const selectedText = trigger.querySelector('.selected-text');
          if (selectedText) { selectedText.textContent = text; selectedText.classList.toggle('placeholder', !value); }
          selectEl.classList.remove('open'); trigger.classList.remove('open'); dropdown.classList.remove('open');
        });
      });
      document.addEventListener('click', (e) => { if (!selectEl.contains(e.target)) { selectEl.classList.remove('open'); trigger.classList.remove('open'); dropdown.classList.remove('open'); } });
    });
  }

  function openFolderModal() { const modal = document.getElementById('folderModal'); if (modal) { document.getElementById('folderModalTitle').textContent = '编辑文件夹'; document.getElementById('folderNameInput').value = ''; modal.classList.add('active'); } }
  function closeFolderModal() { const modal = document.getElementById('folderModal'); if (modal) modal.classList.remove('active'); }
  function openTagModal() { const modal = document.getElementById('tagModal'); if (modal) { document.getElementById('tagModalTitle').textContent = '新建标签'; document.getElementById('tagNameInput').value = ''; modal.classList.add('active'); } }
  function closeTagModal() { const modal = document.getElementById('tagModal'); if (modal) modal.classList.remove('active'); }
  function openDeleteModal() { const modal = document.getElementById('deleteModal'); if (modal) modal.classList.add('active'); }
  function closeDeleteModal() { const modal = document.getElementById('deleteModal'); if (modal) modal.classList.remove('active'); }

  function bindEvents() {
    const btnFavorites = document.getElementById('btnFavorites');
    if (btnFavorites) { btnFavorites.addEventListener('click', () => { const isActive = btnFavorites.classList.toggle('active'); state.currentView = isActive ? 'favorites' : 'prompts'; loadPrompts(); }); }
    const searchInput = document.getElementById('searchInput');
    if (searchInput) { const debouncedSearch = debounce(() => { state.keyword = searchInput.value.trim(); updateFilterBar(); loadPrompts(); }, 500); searchInput.addEventListener('input', debouncedSearch); }
    const createBtn = document.getElementById('createPromptBtn');
    if (createBtn) createBtn.addEventListener('click', () => openEditModal());
    const addFolderBtn = document.getElementById('addFolderBtn');
    if (addFolderBtn) addFolderBtn.addEventListener('click', () => openFolderModal());
    const saveFolderBtn = document.getElementById('saveFolderBtn');
    if (saveFolderBtn) { saveFolderBtn.addEventListener('click', async () => { const name = document.getElementById('folderNameInput')?.value.trim(); if (!name) { showToast('请输入文件夹名称', 'error'); return; } await PromptProDB.createFolder({ folder_name: name }); showToast('文件夹创建成功'); closeFolderModal(); await loadAll(); }); }
    const closeFolderModalBtn = document.getElementById('closeFolderModal');
    if (closeFolderModalBtn) closeFolderModalBtn.addEventListener('click', closeFolderModal);
    const cancelFolderBtn = document.getElementById('cancelFolderBtn');
    if (cancelFolderBtn) cancelFolderBtn.addEventListener('click', closeFolderModal);
    const addTagBtn = document.getElementById('addTagBtn');
    if (addTagBtn) addTagBtn.addEventListener('click', () => openTagModal());
    const saveTagBtn = document.getElementById('saveTagBtn');
    if (saveTagBtn) { saveTagBtn.addEventListener('click', async () => { const name = document.getElementById('tagNameInput')?.value.trim(); if (!name) { showToast('请输入标签名称', 'error'); return; } await PromptProDB.createTag({ tag_name: name }); showToast('标签创建成功'); closeTagModal(); await loadAll(); }); }
    const closeTagModalBtn = document.getElementById('closeTagModal');
    if (closeTagModalBtn) closeTagModalBtn.addEventListener('click', closeTagModal);
    const cancelTagBtn = document.getElementById('cancelTagBtn');
    if (cancelTagBtn) cancelTagBtn.addEventListener('click', closeTagModal);
    const clearFilter = document.getElementById('clearFilter');
    if (clearFilter) clearFilter.addEventListener('click', clearFilters);
    const closeModal = document.getElementById('closeModal');
    if (closeModal) closeModal.addEventListener('click', closePromptDetail);
    const closeEditModalBtn = document.getElementById('closeEditModal');
    if (closeEditModalBtn) closeEditModalBtn.addEventListener('click', closeEditModal);
    const cancelEditBtn = document.getElementById('cancelEditBtn');
    if (cancelEditBtn) cancelEditBtn.addEventListener('click', closeEditModal);
    const copyContentBtn = document.getElementById('copyContentBtn');
    if (copyContentBtn) { copyContentBtn.addEventListener('click', () => { if (state.currentPrompt && state.currentPrompt.content) { navigator.clipboard.writeText(state.currentPrompt.content).then(() => showToast('内容已复制到剪贴板')).catch(() => showToast('复制失败，请重试', 'error')); } }); }
    const editPromptBtn = document.getElementById('editPromptBtn');
    if (editPromptBtn) { editPromptBtn.addEventListener('click', () => { if (state.currentPrompt) { const promptData = state.currentPrompt; const modal = document.getElementById('promptModal'); if (modal) modal.classList.remove('active'); setTimeout(() => openEditModal(promptData), 200); } }); }
    const deletePromptBtn = document.getElementById('deletePromptBtn');
    if (deletePromptBtn) { deletePromptBtn.addEventListener('click', () => { if (state.currentPrompt) openDeleteModal(); }); }
    const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
    if (confirmDeleteBtn) { confirmDeleteBtn.addEventListener('click', async () => { if (state.currentPrompt) { const promptId = state.currentPrompt.prompt_id; await PromptProDB.deletePrompt(promptId); showToast('提示词已删除'); closeDeleteModal(); setTimeout(() => { closePromptDetail(); setTimeout(async () => { await loadAll(); }, 100); }, 200); } }); }
    const closeDeleteModalBtn = document.getElementById('closeDeleteModal');
    if (closeDeleteModalBtn) closeDeleteModalBtn.addEventListener('click', closeDeleteModal);
    const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
    if (cancelDeleteBtn) cancelDeleteBtn.addEventListener('click', closeDeleteModal);
    const savePromptBtn = document.getElementById('savePromptBtn');
    if (savePromptBtn) { savePromptBtn.addEventListener('click', async () => { const title = document.getElementById('formTitle')?.value.trim(); const description = document.getElementById('formDescription')?.value.trim(); const content = document.getElementById('formContent')?.value.trim(); const folderId = document.getElementById('formFolder')?.value || null; if (!title) { showToast('请输入标题', 'error'); return; } if (!content) { showToast('请输入内容', 'error'); return; } const data = { title, description, content, folder_id: folderId, tags: state.formTags }; let success; if (state.editingPromptId) success = await PromptProDB.updatePrompt(state.editingPromptId, data); else success = await PromptProDB.createPrompt(data); if (success) { showToast(state.editingPromptId ? '已保存' : '创建成功'); closeEditModal(); await loadAll(); } else showToast('保存失败，请重试', 'error'); }); }
    initFormTagSelector();
    document.querySelectorAll('.modal').forEach(modal => { modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('active'); }); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.querySelectorAll('.modal.active').forEach(modal => modal.classList.remove('active')); });
  }

  function isPromptProPage() {
    return document.querySelector('meta[name="page-id"][content="promptpro"]') !== null;
  }

  async function init() {
    // 仅在 promptpro 页面执行，避免覆盖主页导航
    if (!isPromptProPage()) return;

    const loading = document.getElementById('loading');
    if (loading) loading.style.display = 'flex';
    try {
      await PromptProDB.init();
      await PromptProDB.initSampleData();
      await loadAll();
      bindEvents();
      initCustomSelects();
      if (loading) loading.style.display = 'none';
      initBackToTop();
      checkUrlParams();
    } catch (error) { console.error('[PromptPro] 初始化失败:', error); if (loading) loading.innerHTML = `<div style="color: #EF4444;"><i class="ri-error-warning-line" style="font-size: 2rem;"></i><p>初始化失败</p><p style="font-size: 12px;">${error.message}</p></div>`; }
  }

  // 返回顶部按钮 (同时显示百分比和箭头)
  function initBackToTop() {
    const backToTopBtn = document.getElementById('back-to-top');
    const scrollPercentElement = document.getElementById('scroll-percent');

    if (!backToTopBtn) {
        return;
    }

    // 获取实际滚动的容器
    const scrollContainer = document.querySelector('.main-content') || document.scrollingElement || document.documentElement;

    let scrollTimeout;
    const SHOW_ARROW_DELAY = 3000;

    function handleScroll() {
      const el = scrollContainer === document.scrollingElement ? document.scrollingElement : scrollContainer;
      const scrollPosition = el.scrollTop || 0;
      const totalHeight = el.scrollHeight - el.clientHeight;

      let scrollPercentage = 0;
      if (totalHeight > 0) {
        scrollPercentage = Math.min(Math.round((scrollPosition / totalHeight) * 100), 100);
      }

      if (scrollPercentage > 0 || scrollPosition > 5) {
        backToTopBtn.classList.add('show');
        backToTopBtn.classList.add('show-percent');

        if (scrollPercentElement) scrollPercentElement.textContent = scrollPercentage + '%';

        const progressClasses = Array.from(backToTopBtn.classList).filter(cls => cls.startsWith('progress-'));
        progressClasses.forEach(cls => backToTopBtn.classList.remove(cls));
        backToTopBtn.classList.add(`progress-${scrollPercentage}`);

        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
           backToTopBtn.classList.remove('show-percent');
        }, SHOW_ARROW_DELAY);
      } else {
        backToTopBtn.classList.remove('show');
        backToTopBtn.classList.remove('show-percent');
      }
    }

    // 监听主内容区滚动
    scrollContainer.addEventListener('scroll', handleScroll, { passive: true });

    // 初始化时调用
    handleScroll();

    // 点击返回顶部
    backToTopBtn.addEventListener('click', () => {
      scrollContainer.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  async function checkUrlParams() {
    const urlParams = new URLSearchParams(window.location.search);
    const detailId = urlParams.get('detail');
    const editId = urlParams.get('edit');
    
    if (detailId) {
      try {
        const prompt = await PromptProDB.getPrompt(detailId);
        if (prompt) { setTimeout(() => { showPromptDetail(prompt.prompt_id); window.history.replaceState({}, '', window.location.pathname); }, 500); }
      } catch (error) { console.error('[PromptPro] 显示操作失败:', error); }
    }

    if (editId) {
      try {
        const prompt = await PromptProDB.getPrompt(editId);
        if (prompt) { setTimeout(() => { openEditModal(prompt); window.history.replaceState({}, '', window.location.pathname); }, 500); }
      } catch (error) { console.error('[PromptPro] 显示和编辑操作失败:', error); }
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

// ===== PromptPro 集成脚本（原 promptpro-utils.js） =====
/**
 * PromptPro 提示词管理系统 - 集成脚本
 * 直接打开 /promptpro/ 页面
 */

(function() {
  'use strict';

  // 打开 PromptPro 提示词管理页面
  function showPromptPro() {
    window.open('/promptpro/', '_blank');
  }

  // 绑定事件 - 侧边栏入口
  const promptproItem = document.querySelector('#promptpro-entry .promptpro-item');

  if (promptproItem) {
    promptproItem.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      showPromptPro();
    });
  }

  // 也支持直接点击链接
  const promptproLink = document.getElementById('promptpro-link');
  if (promptproLink) {
    promptproLink.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      showPromptPro();
    });
  }

  // 暴露全局函数（供其他脚本调用）
  window.showPromptPro = showPromptPro;

})();

// ===== PromptPro Export =====

/**
 * PromptPro 导出/导入功能
 * 使用与自动备份相同的文件格式和备份文件夹
 */

function showToast(message, type = 'success') {
  const existing = document.querySelector('.toast-message');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'toast-message';
  toast.style.cssText = `position:fixed;top:20px;right:20px;padding:12px 24px;border-radius:8px;color:#fff;font-size:14px;z-index:99999;transition:opacity 0.3s;${type === 'error' ? 'background:#ef4444' : 'background:#10b981'}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3000);
}

document.addEventListener('DOMContentLoaded', () => {
  // 导出按钮 — 写入自动备份文件夹
  const exportBtn = document.getElementById('exportDataBtn');
  if (exportBtn) {
    exportBtn.addEventListener('click', async () => {
      try {
        const filename = await backupManager.performBackup(true);
        showToast(`已导出：${filename}`);
      } catch (err) {
        if (err.message === 'NO_FOLDER') {
          showToast('请先在主页设置中选择备份文件夹', 'error');
        } else if (err.message === 'NO_PERMISSION') {
          showToast('没有文件夹写入权限，请重新选择', 'error');
        } else if (err.message === 'NO_CHANGE') {
          showToast('数据无变化，不需新增记录文件');
        } else {
          showToast('导出失败：' + (err.message || '请重试'), 'error');
        }
      }
    });
  }

  // 导入按钮
  const importBtn = document.getElementById('importDataBtn');
  const importInput = document.getElementById('importFileInput');
  if (importBtn && importInput) {
    importBtn.addEventListener('click', () => importInput.click());

    importInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const json = JSON.parse(event.target.result);
          if (!confirm('确定要导入数据吗？当前数据将被覆盖。')) return;

          const success = await PromptProDB.importData(json);
          if (success) {
            showToast('数据已导入，正在刷新...');
            setTimeout(() => location.reload(), 500);
          } else {
            showToast('导入失败，请重试', 'error');
          }
        } catch (err) {
          console.error('[Import] 导入失败:', err);
          showToast('导入失败，请重试', 'error');
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    });
  }
});

// ===== PromptPro Backup Setup =====

async function checkBackupSetup() {
    try {
        const folderName = await backupManager.getFolderName();
        if (folderName) return;

        const modal = document.getElementById('backupSetupModal');
        if (!modal) return;  // DOM 元素不存在时静默退出
        const selectBtn = document.getElementById('setupBackupFolderBtn');
        const skipBtn = document.getElementById('skipBackupSetupBtn');
        const confirmBtn = document.getElementById('confirmBackupSetupBtn');
        const folderNameEl = document.getElementById('setupFolderName');
        let selectedName = null;

        modal.classList.add('active');

        selectBtn.addEventListener('click', async () => {
            try {
                const name = await backupManager.selectFolder();
                if (name) {
                    selectedName = name;
                    folderNameEl.textContent = name;
                    folderNameEl.style.color = 'var(--text-primary, #1e293b)';
                    confirmBtn.disabled = false;
                }
            } catch (err) {
                console.error('选择文件夹失败:', err);
            }
        });

        skipBtn.addEventListener('click', () => {
            modal.classList.remove('active');
        });

        confirmBtn.addEventListener('click', () => {
            modal.classList.remove('active');
            if (selectedName) {
                showToast(`备份目录已设置：${selectedName}`);
            }
        });
    } catch (err) {
        console.error('检查备份目录失败:', err);
    }
}

function showToast(message) {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast toast-success';
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkBackupSetup);
} else {
    checkBackupSetup();
}

// ===== PromptPro 搜索集成（原 promptpro-search.js） =====
/**
 * PromptPro 提示词搜索集成
 * 在主项目搜索框中增加对提示词的搜索功能
 */

class PromptProSearch {
  constructor() {
    this.prompts = [];
    this.initialized = false;
  }

  // 初始化并加载提示词
  async init() {
    if (this.initialized) {
      return;
    }

    try {
      this.prompts = await this.loadPrompts();
      this.initialized = true;
    } catch (error) {
      console.error('[PromptPro Search] 初始化失败:', error);
    }
  }

  // 加载所有提示词（从服务端 API）
  async loadPrompts() {
    try {
      const prompts = await window.PromptProDB.getAll();

      // 同时加载文件夹和标签信息
      const related = await this.loadRelatedData();
      this.folders = related.folders;
      this.tags = related.tags;

      // 关联文件夹名（标签已内嵌在提示词数据中）
      this.prompts = (prompts || []).map(prompt => {
        const folder = this.folders.find(f => f.folder_id === prompt.folder_id);
        return {
          ...prompt,
          folder_name: folder ? folder.folder_name : '',
          tags: prompt.tags || []
        };
      });

      return this.prompts;
    } catch (e) {
      console.warn('[PromptPro Search] 加载提示词失败:', e);
      return [];
    }
  }

  // 加载关联数据（从服务端 API）
  async loadRelatedData() {
    try {
      const token = localStorage.getItem('favshub_token');
      const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

      const [foldersRes, tagsRes] = await Promise.all([
        fetch('/api/prompts/folders/all', { headers }).then(r => r.json()),
        fetch('/api/tags', { headers }).then(r => r.json())
      ]);

      return {
        folders: foldersRes.data || [],
        tags: tagsRes.data || []
      };
    } catch (e) {
      console.warn('[PromptPro Search] 加载关联数据失败:', e);
      return { folders: [], tags: [] };
    }
  }

  // 搜索提示词（支持多关键词模糊匹配）
  search(query) {
    if (!query || !this.initialized) {
      return [];
    }

    // 分词：按空格、中文标点、英文标点分隔
    const keywords = query
      .trim()
      .split(/[\s　 -⁯　-〿＀-￯,.!?;:，。！？；：、]+/)
      .filter(k => k.length > 0);

    if (keywords.length === 0) return [];

    const results = this.prompts
      .map(prompt => {
        const score = this.calculateScore(prompt, keywords);
        return score > 0 ? { ...prompt, _score: score } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b._score - a._score);

    return results;
  }

  // 计算匹配分数（与 promptpro-storage.js 保持一致）
  calculateScore(prompt, keywords) {
    const title = (prompt.title || '').toLowerCase();
    const desc = (prompt.description || '').toLowerCase();
    const content = (prompt.content || '').toLowerCase();
    const folder = (prompt.folder_name || '').toLowerCase();
    const tagNames = (prompt.tags || []).map(t => (t.tag_name || '').toLowerCase());

    let totalScore = 0;
    let titleMatchedCount = 0;
    let tagMatchedCount = 0;
    let descMatchedCount = 0;
    let folderMatchedCount = 0;
    let contentMatchedCount = 0;

    for (const keyword of keywords) {
      // 标题匹配（权重最高）
      if (title.includes(keyword)) {
        if (title === keyword) totalScore += 10000;
        else if (title.startsWith(keyword)) totalScore += 8000;
        else totalScore += 5000;
        titleMatchedCount++;
      }

      // 标签匹配
      if (tagNames.some(tag => tag.includes(keyword))) {
        totalScore += 2000;
        tagMatchedCount++;
      }

      // 描述匹配
      if (desc.includes(keyword)) {
        if (desc.startsWith(keyword)) totalScore += 1500;
        else totalScore += 1000;
        descMatchedCount++;
      }

      // 文件夹匹配
      if (folder.includes(keyword)) {
        totalScore += 800;
        folderMatchedCount++;
      }

      // 内容匹配（权重最低）
      if (content.includes(keyword)) {
        totalScore += 300;
        contentMatchedCount++;
      }
    }

    // 标题中包含所有关键词时，给予极高奖励（精确匹配）
    if (titleMatchedCount === keywords.length && keywords.length > 0) {
      totalScore += keywords.length * 5000;
    }

    // 标签中包含所有关键词时，给予高奖励
    if (tagMatchedCount === keywords.length && keywords.length > 0) {
      totalScore += keywords.length * 3000;
    }

    // 描述中包含所有关键词时，给予中等奖励
    if (descMatchedCount === keywords.length && keywords.length > 0) {
      totalScore += keywords.length * 1500;
    }

    // 跨字段匹配奖励（标题+标签、标题+描述等）
    const fieldsMatched = [
      titleMatchedCount > 0,
      tagMatchedCount > 0,
      descMatchedCount > 0,
      folderMatchedCount > 0
    ].filter(Boolean).length;

    if (fieldsMatched >= 2 && keywords.length > 1) {
      totalScore += fieldsMatched * 1000;
    }

    return totalScore;
  }

  // 渲染搜索结果
  renderResults(results) {
    if (!results || results.length === 0) return '';

    return results.map(prompt => {
      const tagsHtml = (prompt.tags || []).slice(0, 2).map(tag =>
        `<span class="prompt-search-tag">${this.escapeHtml(tag.tag_name)}</span>`
      ).join('');

      return `
        <div class="prompt-search-result" data-prompt-id="${prompt.prompt_id}">
          <div class="prompt-search-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
            </svg>
          </div>
          <div class="prompt-search-content">
            <div class="prompt-search-title">${this.escapeHtml(prompt.title)}</div>
            ${prompt.description ? `<div class="prompt-search-desc">${this.escapeHtml(prompt.description)}</div>` : ''}
            <div class="prompt-search-meta">
              ${prompt.folder_name ? `<span class="prompt-search-folder">${this.escapeHtml(prompt.folder_name)}</span>` : ''}
              ${tagsHtml}
            </div>
          </div>
          <div class="prompt-search-action">
            <button class="prompt-search-open-btn" title="打开编辑">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  // 转义 HTML
  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // 获取最近使用的提示词
  getRecentPrompts(limit = 10) {
    if (!this.prompts || this.prompts.length === 0) {
      return [];
    }

    // 按更新时间排序，返回最近的提示词
    return [...this.prompts]
      .sort((a, b) => {
        const timeA = a.updated_at || a.created_at || 0;
        const timeB = b.updated_at || b.created_at || 0;
        return timeB - timeA;
      })
      .slice(0, limit);
  }

  // 打开提示词编辑
  openPromptEdit(promptId) {
    const prompt = this.prompts.find(p => p.prompt_id === promptId);
    if (!prompt) return;

    window.open(`/promptpro/?edit=${promptId}`, '_blank');
  }

  // 在新标签页打开 PromptPro 并编辑提示词
  openPromptProInNewTab(promptId) {
    window.open(`/promptpro/?edit=${promptId}`, '_blank');
  }
}

// 全局实例
window.promptProSearch = new PromptProSearch();

// 初始化 - 使用多种方式确保可靠执行
function initPromptProSearch() {
  if (window.promptProSearch.initialized) return;
  window.promptProSearch.init().catch(err => {
    console.error('[PromptPro Search] 初始化失败:', err);
  });
}

// 如果 DOMContentLoaded 已经触发，立即初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPromptProSearch);
} else {
  // DOM 已经加载完成
  initPromptProSearch();
}

// 也支持在 window load 时初始化（双重保险）
if (!window.promptProSearch.initialized) {
  window.addEventListener('load', () => {
    if (!window.promptProSearch.initialized) {
      initPromptProSearch();
    }
  });
}
