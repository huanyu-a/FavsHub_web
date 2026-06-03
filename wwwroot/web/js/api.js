/**
 * FavsHub API 封装层 - 统一 fetch 请求（带 JWT）
 */
// API_BASE 由 chrome-shim.js 定义，此处提供回退值
if (typeof API_BASE === 'undefined') {
  var API_BASE = '/api';
}

class FavsHubAPI {
  constructor() {
    this.token = localStorage.getItem('favshub_token');
  }

  setToken(token) {
    this.token = token;
    if (token) {
      localStorage.setItem('favshub_token', token);
    } else {
      localStorage.removeItem('favshub_token');
    }
    // 同步到 chrome.storage.local（供云同步状态等使用）
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      if (token) {
        chrome.storage.local.set({ favshub_token: token });
      } else {
        chrome.storage.local.remove('favshub_token');
      }
    }
  }

  getToken() {
    return this.token;
  }

  isLoggedIn() {
    return !!this.token;
  }

  async request(path, options = {}) {
    const url = `${API_BASE}${path}`;
    const headers = { 'Content-Type': 'application/json', ...options.headers };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    let res;
    try {
      res = await fetch(url, { ...options, headers, signal: controller.signal });
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error('请求超时，请检查网络连接');
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error(`请求失败 (${res.status} ${res.statusText})`);
    }

    if (!res.ok) {
      if (res.status === 401) {
        this.setToken(null);
        const redirect = encodeURIComponent(window.location.pathname);
        window.location.href = `/login.html?redirect=${redirect}`;
      }
      throw new Error(data.error || `请求失败 (${res.status})`);
    }
    return data;
  }

  // ===== Auth =====
  async register(username, password, email) {
    const data = await this.request('/auth/register', { method: 'POST', body: JSON.stringify({ username, password, email }) });
    this.setToken(data.token);
    if (data.user) localStorage.setItem('favshub_user', JSON.stringify(data.user));
    return data;
  }

  async login(username, password) {
    const data = await this.request('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    this.setToken(data.token);
    if (data.user) localStorage.setItem('favshub_user', JSON.stringify(data.user));
    return data;
  }

  async getMe() {
    return this.request('/auth/me');
  }

  logout() {
    this.setToken(null);
    localStorage.removeItem('favshub_user');
    window.location.href = '/login.html';
  }

  // ===== Bookmarks =====
  getBookmarks(folderId) {
    const q = folderId ? `?folder_id=${folderId}` : '';
    return this.request(`/bookmarks${q}`);
  }

  searchBookmarks(query, limit = 50) {
    return this.request(`/bookmarks?search=${encodeURIComponent(query)}&limit=${limit}`);
  }

  createBookmark(data) {
    return this.request('/bookmarks', { method: 'POST', body: JSON.stringify(data) });
  }

  updateBookmark(id, data) {
    return this.request(`/bookmarks/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  }

  deleteBookmark(id) {
    return this.request(`/bookmarks/${id}`, { method: 'DELETE' });
  }

  reorderBookmarks(items) {
    return this.request('/bookmarks/reorder', { method: 'PUT', body: JSON.stringify({ items }) });
  }

  // ===== Folders =====
  getFolders() {
    return this.request('/folders');
  }

  createFolder(data) {
    return this.request('/folders', { method: 'POST', body: JSON.stringify(data) });
  }

  updateFolder(id, data) {
    return this.request(`/folders/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  }

  deleteFolder(id) {
    return this.request(`/folders/${id}`, { method: 'DELETE' });
  }

  // ===== Prompts =====
  getPrompts(params = {}) {
    const q = new URLSearchParams(params).toString();
    return this.request(`/prompts${q ? '?' + q : ''}`);
  }

  getPrompt(id) {
    return this.request(`/prompts/${id}`);
  }

  createPrompt(data) {
    return this.request('/prompts', { method: 'POST', body: JSON.stringify(data) });
  }

  updatePrompt(id, data) {
    return this.request(`/prompts/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  }

  deletePrompt(id) {
    return this.request(`/prompts/${id}`, { method: 'DELETE' });
  }

  restorePromptVersion(id, versionId) {
    return this.request(`/prompts/${id}/restore`, { method: 'POST', body: JSON.stringify({ version_id: versionId }) });
  }

  // ===== Prompt Folders =====
  getPromptFolders() {
    return this.request('/prompts/folders/all');
  }

  createPromptFolder(data) {
    const body = typeof data === 'string' ? { name: data } : data;
    return this.request('/prompts/folders', { method: 'POST', body: JSON.stringify(body) });
  }

  updatePromptFolder(id, data) {
    const body = typeof data === 'string' ? { name: data } : data;
    return this.request(`/prompts/folders/${id}`, { method: 'PUT', body: JSON.stringify(body) });
  }

  deletePromptFolder(id) {
    return this.request(`/prompts/folders/${id}`, { method: 'DELETE' });
  }

  // ===== Tags =====
  getTags() {
    return this.request('/tags');
  }

  createTag(name) {
    return this.request('/tags', { method: 'POST', body: JSON.stringify({ name }) });
  }

  deleteTag(id) {
    return this.request(`/tags/${id}`, { method: 'DELETE' });
  }

  // ===== Settings =====
  getSettings() {
    return this.request('/settings');
  }

  updateSettings(data) {
    return this.request('/settings', { method: 'PUT', body: JSON.stringify({ data }) });
  }

  // ===== Admin =====
  getAdminDefaultSettings() {
    return this.request('/admin/default-settings');
  }

  updateAdminDefaultSettings(data) {
    return this.request('/admin/default-settings', { method: 'PUT', body: JSON.stringify({ data }) });
  }

  getAdminStats() {
    return this.request('/admin/stats');
  }

  getAdminUsers() {
    return this.request('/admin/users');
  }

  deleteAdminUser(id) {
    return this.request(`/admin/users/${id}`, { method: 'DELETE' });
  }

  updateAdminUser(id, data) {
    return this.request(`/admin/users/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  }

  getAdminUserBookmarks(id) {
    return this.request(`/admin/users/${id}/bookmarks`);
  }

  getAdminUserPrompts(id) {
    return this.request(`/admin/users/${id}/prompts`);
  }

  getAdminConfig() {
    return this.request('/admin/config');
  }

  getAdminBookmarks() {
    return this.request('/admin/bookmarks');
  }

  deleteAdminBookmark(id) {
    return this.request(`/admin/bookmarks/${id}`, { method: 'DELETE' });
  }

  updateAdminBookmark(id, data) {
    return this.request(`/admin/bookmarks/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  }

  getAdminFolders() {
    return this.request('/admin/folders');
  }

  createAdminFolder(data) {
    return this.request('/admin/folders', { method: 'POST', body: JSON.stringify(data) });
  }

  updateAdminFolder(id, data) {
    return this.request(`/admin/folders/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  }

  deleteAdminFolder(id) {
    return this.request(`/admin/folders/${id}`, { method: 'DELETE' });
  }

  // ===== Search Engines =====
  getSearchEngines() {
    return this.request('/search-engines');
  }

  getAdminSearchEngines() {
    return this.request('/admin/search-engines');
  }

  createAdminSearchEngine(data) {
    return this.request('/admin/search-engines', { method: 'POST', body: JSON.stringify(data) });
  }

  updateAdminSearchEngine(id, data) {
    return this.request(`/admin/search-engines/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  }

  downloadAllFavicons() {
    return this.request('/admin/download-favicons', { method: 'POST' });
  }

  retryFailedFavicons() {
    return this.request('/admin/retry-failed-favicons', { method: 'POST' });
  }

  forceLocalizeIcons() {
    return this.request('/admin/force-localize-icons', { method: 'POST' });
  }

  downloadBookmarkFavicon(id) {
    return this.request(`/admin/download-favicon/${id}`, { method: 'POST' });
  }

  getBackupSchedule() {
    return this.request('/admin/backup-schedule');
  }

  updateBackupSchedule(data) {
    return this.request('/admin/backup-schedule', { method: 'PUT', body: JSON.stringify(data) });
  }

  getBackupFiles() {
    return this.request('/admin/backup-files');
  }

  syncPrompts(userId, data) {
    return this.request('/admin/sync-prompts', { method: 'POST', body: JSON.stringify({ userId, ...data }) });
  }

  deleteAdminSearchEngine(id) {
    return this.request(`/admin/search-engines/${id}`, { method: 'DELETE' });
  }

  getAdminBackupInfo() {
    return this.request('/admin/backup/info');
  }

  downloadBackup() {
    const url = `${API_BASE}/admin/backup`;
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    return fetch(url, { headers })
      .then(res => {
        if (!res.ok) throw new Error('备份下载失败');
        return res.blob();
      })
      .then(blob => {
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = `favshub-backup-${new Date().toISOString().slice(0, 10)}.db`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
      });
  }

  getAdminPrompts() {
    return this.request('/admin/prompts');
  }

  deleteAdminPrompt(id) {
    return this.request(`/admin/prompts/${id}`, { method: 'DELETE' });
  }

  getAdminPromptVersions(id) {
    return this.request(`/admin/prompts/${id}/versions`);
  }

  getAdminPromptFolders() {
    return this.request('/admin/prompt-folders');
  }

  deleteAdminPromptFolder(id) {
    return this.request(`/admin/prompt-folders/${id}`, { method: 'DELETE' });
  }
}

window.api = new FavsHubAPI();
