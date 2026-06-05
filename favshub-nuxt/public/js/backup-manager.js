/**
 * FavsHub Backup Manager
 * 使用 File System Access API 将 PromptPro 数据备份到本地文件夹
 * 所有配置存储在 PromptProDB 的 backup_config 表中
 */

const DIR_HANDLE_KEY = 'directoryHandle';
const DIR_NAME_KEY = 'directoryName';
const BACKUP_HISTORY_KEY = 'backupHistory';

class BackupManager {
  async _getConfig(key) {
    try {
      if (typeof PromptProDB !== 'undefined' && PromptProDB.getBackupConfig) {
        return await PromptProDB.getBackupConfig(key);
      }
      return FavsHubSettings.get('backup_' + key) || null;
    } catch (err) {
      return null;
    }
  }

  async _setConfig(key, value) {
    try {
      if (typeof PromptProDB !== 'undefined' && PromptProDB.setBackupConfig) {
        await PromptProDB.setBackupConfig(key, value);
      }
      FavsHubSettings.set('backup_' + key, value);
    } catch (err) {
    }
  }

  // ── 文件夹选择 ──

  async selectFolder() {
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      await this._setConfig(DIR_HANDLE_KEY, handle);
      await this._setConfig(DIR_NAME_KEY, handle.name);
      return handle.name;
    } catch (err) {
      if (err.name === 'AbortError') return null;
      throw err;
    }
  }

  async loadDirectoryHandle() {
    return this._getConfig(DIR_HANDLE_KEY);
  }

  async getFolderName() {
    return this._getConfig(DIR_NAME_KEY);
  }

  async clearFolder() {
    await this._setConfig(DIR_HANDLE_KEY, null);
    await this._setConfig(DIR_NAME_KEY, null);
  }

  // ── 权限验证 ──

  async verifyPermission(handle) {
    const opts = { mode: 'readwrite' };
    if ((await handle.queryPermission(opts)) === 'granted') return true;
    if ((await handle.requestPermission(opts)) === 'granted') return true;
    return false;
  }

  // ── 数据哈希 ──

  _hashData(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
    return hash.toString(36);
  }

  // ── 备份执行 ──

  _getTimestampCN() {
    const now = new Date();
    const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
    const cnMs = utcMs + 8 * 3600000;
    const cn = new Date(cnMs);
    const y = cn.getFullYear();
    const m = String(cn.getMonth() + 1).padStart(2, '0');
    const d = String(cn.getDate()).padStart(2, '0');
    const hh = String(cn.getHours()).padStart(2, '0');
    const mm = String(cn.getMinutes()).padStart(2, '0');
    const ss = String(cn.getSeconds()).padStart(2, '0');
    return `${y}-${m}-${d}-${hh}${mm}${ss}`;
  }

  async performBackup(force = false) {
    const handle = await this.loadDirectoryHandle();
    if (!handle) throw new Error('NO_FOLDER');

    const hasPerm = await this.verifyPermission(handle);
    if (!hasPerm) throw new Error('NO_PERMISSION');

    // 收集 PromptPro 数据
    if (!PromptProDB.db) await PromptProDB.init();
    const data = await PromptProDB.exportData();

    // 比对哈希（force 模式跳过）
    const json = JSON.stringify(data);
    const currentHash = this._hashData(json);
    if (!force) {
      const records = await this.getBackupHistory();
      const lastHash = records.length > 0 ? records[0].hash : null;
      if (lastHash && currentHash === lastHash) {
        throw new Error('NO_CHANGE');
      }
    }

    // 写入文件
    const backup = { version: '1.0', timestamp: new Date().toISOString(), type: 'promptpro', data };
    const filename = `promptpro-backup-${this._getTimestampCN()}.json`;
    const fileHandle = await handle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(backup, null, 2));
    await writable.close();

    // 记录
    await this.addBackupRecord(filename, currentHash);

    return filename;
  }

  // ── 自动备份 ──

  async checkAndAutoBackup() {
    try {
      const enabled = await this._getAutoBackupEnabled();
      if (!enabled) return null;

      const handle = await this.loadDirectoryHandle();
      if (!handle) return null;

      const records = await this.getBackupHistory();
      const lastTime = records.length > 0 ? records[0].timestamp : null;
      const now = Date.now();
      if (lastTime && (now - lastTime) < 24 * 60 * 60 * 1000) return null;

      return await this.performBackup();
    } catch (err) {
      return null;
    }
  }

  // ── 备份记录管理 ──

  async getBackupHistory() {
    return (await this._getConfig(BACKUP_HISTORY_KEY)) || [];
  }

  async _saveBackupHistory(records) {
    await this._setConfig(BACKUP_HISTORY_KEY, records);
  }

  async addBackupRecord(filename, hash) {
    const records = await this.getBackupHistory();
    records.unshift({
      filename,
      timestamp: Date.now(),
      timeFormatted: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
      hash
    });
    if (records.length > 10) records.length = 10;
    await this._saveBackupHistory(records);
  }

  async deleteBackupRecord(index) {
    const records = await this.getBackupHistory();
    if (index < 0 || index >= records.length) return records;
    records.splice(index, 1);
    await this._saveBackupHistory(records);
    return records;
  }

  async getLastBackupTimeFormatted() {
    const records = await this.getBackupHistory();
    if (records.length === 0) return null;
    return new Date(records[0].timestamp).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  }

  // ── 自动备份开关 ──

  async _getAutoBackupEnabled() {
    return FavsHubSettings.get('enableAutoBackup') === true;
  }

  async setAutoBackupEnabled(enabled) {
    FavsHubSettings.set('enableAutoBackup', enabled);
  }

  async getAutoBackupEnabled() {
    return this._getAutoBackupEnabled();
  }
}

window.backupManager = new BackupManager();
