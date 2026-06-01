/**
 * FavsHub 百度网盘设置控制器
 * 管理设置面板中百度网盘区域的 UI 交互
 *
 * 流程：用户点击"连接" → OAuth 授权 → 完成
 * 无需输入任何凭据
 */

// baiduPanBackupManager 已通过 baidu-pan-backup-manager.js 全局加载

class BaiduPanSettingsManager {
  constructor() {
    this.manager = baiduPanBackupManager;
  }

  async init() {
    this.statusEl = document.getElementById('baidu-pan-status-text');
    this.connectBtn = document.getElementById('baidu-pan-connect-btn');
    this.connectedEl = document.getElementById('baidu-pan-connected');
    this.autoBackupCheckbox = document.getElementById('enable-baidu-auto-backup');
    this.manualBackupBtn = document.getElementById('baidu-manual-backup-btn');
    this.lastBackupTimeEl = document.getElementById('baidu-last-backup-time');
    this.historyContainer = document.getElementById('baidu-backup-history-list');
    this.disconnectBtn = document.getElementById('baidu-pan-disconnect-btn');

    if (!this.connectBtn) return;

    await this.renderConnectionStatus();
    this._bindEvents();

    const autoEnabled = await this.manager.getAutoBackupEnabled();
    if (this.autoBackupCheckbox) {
      this.autoBackupCheckbox.checked = autoEnabled;
    }
  }

  _bindEvents() {
    this.connectBtn.addEventListener('click', () => this.handleConnect());

    if (this.disconnectBtn) {
      this.disconnectBtn.addEventListener('click', () => this.handleDisconnect());
    }

    if (this.autoBackupCheckbox) {
      this.autoBackupCheckbox.addEventListener('change', async () => {
        await this.manager.setAutoBackupEnabled(this.autoBackupCheckbox.checked);
        this._showToast(this.autoBackupCheckbox.checked ? '已开启云端自动备份' : '已关闭云端自动备份');
      });
    }

    if (this.manualBackupBtn) {
      this.manualBackupBtn.addEventListener('click', () => this.handleManualBackup());
    }
  }

  // ── 状态渲染 ──

  async renderConnectionStatus() {
    const connected = await this.manager.isConnected();
    console.log('[BaiduPan] renderConnectionStatus - connected:', connected);

    if (connected) {
      try {
        await this.manager.getValidToken();
        this._showState('connected');
        this._runAutoBackup();
      } catch (err) {
        if (err.message === 'TOKEN_EXPIRED' || err.message === 'NO_CREDENTIALS') {
          this._showState('disconnected');
        } else {
          this._showState('disconnected');
        }
      }
    } else {
      this._showState('disconnected');
    }
  }

  _showState(state) {
    if (this.statusEl) {
      if (state === 'connected') {
        this.statusEl.textContent = '已连接';
        this.statusEl.style.color = 'var(--success-color, #4caf50)';
      } else {
        this.statusEl.textContent = '未连接';
        this.statusEl.style.color = 'var(--text-secondary, #888)';
      }
    }

    if (this.connectBtn) {
      this.connectBtn.style.display = state === 'disconnected' ? '' : 'none';
    }
    if (this.connectedEl) {
      this.connectedEl.style.display = state === 'connected' ? '' : 'none';
    }
  }

  async _updateLastBackupTime() {
    const time = await this.manager.getLastBackupTimeFormatted();
    if (this.lastBackupTimeEl) {
      this.lastBackupTimeEl.textContent = time ? `上次备份：${time}` : '上次备份：未备份';
    }
  }

  async _runAutoBackup() {
    try {
      const filename = await this.manager.checkAndAutoBackup();
      if (filename) {
        this._showToast(`云端自动备份完成：${filename}`);
        await this._updateLastBackupTime();
        await this.renderCloudBackupHistory();
      }
    } catch (err) {
      console.warn('[BaiduPan] 自动备份检查:', err.message);
    }
  }

  // ── 操作处理 ──

  async handleConnect() {
    this.connectBtn.disabled = true;
    this.connectBtn.textContent = '授权中...';

    try {
      await this.manager.startOAuth();
      this._showToast('百度网盘连接成功');
      await this.renderConnectionStatus();
    } catch (err) {
      console.error('[BaiduPan] 连接失败:', err);
      this._showToast('授权失败，请重试');
    } finally {
      this.connectBtn.disabled = false;
      this.connectBtn.textContent = '连接百度网盘';
    }
  }

  async handleDisconnect() {
    await this.manager.disconnect();
    this._showState('disconnected');
    this._showToast('已断开百度网盘连接');
  }

  async handleManualBackup() {
    this.manualBackupBtn.disabled = true;
    this.manualBackupBtn.textContent = '上传中...';

    try {
      const filename = await this.manager.performBackup(true);
      this._showToast(`云端备份成功：${filename}`);
      await this._updateLastBackupTime();
      await this.renderCloudBackupHistory();
    } catch (err) {
      if (err.message === 'NO_CREDENTIALS') {
        this._showToast('请先连接百度网盘');
      } else if (err.message === 'TOKEN_EXPIRED') {
        this._showToast('登录已过期，请重新连接');
        await this.renderConnectionStatus();
      } else if (err.message === 'NO_CHANGE') {
        this._showToast('数据无变化，不需上传');
      } else {
        console.error('[BaiduPan] 上传失败:', err.message, 'errno:', err.errno);
        this._showToast(`云端备份失败：errno=${err.errno || err.message}`);
      }
    } finally {
      this.manualBackupBtn.disabled = false;
      this.manualBackupBtn.textContent = '立即上传';
    }
  }

  async handleDownloadBackup(index) {
    const records = await this.manager.getBackupHistory();
    const record = records[index];
    if (!record) return;

    try {
      this._showToast('正在下载...');
      const content = await this.manager.downloadFile(record.fsId);

      const blob = new Blob([content], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = record.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      this._showToast('下载完成');
    } catch (err) {
      console.error('[BaiduPan] 下载失败:', err);
      this._showToast(`下载失败：${err.message || '请重试'}`);
    }
  }

  async renderCloudBackupHistory() {
    if (!this.historyContainer) return;

    const records = await this.manager.getBackupHistory();

    if (records.length === 0) {
      this.historyContainer.innerHTML = '<p style="color: var(--text-secondary, #888); font-size: 13px;">暂无云端备份记录</p>';
      return;
    }

    this.historyContainer.innerHTML = records.map((record, index) => {
      const sizeStr = record.size ? this._formatSize(record.size) : '';
      return `
        <div class="backup-record-item" style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--border-color, #eee); font-size: 13px;">
          <div style="flex: 1; min-width: 0;">
            <div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--text-primary, #333);" title="${record.filename}">${record.filename}</div>
            <div style="color: var(--text-secondary, #888); font-size: 12px; margin-top: 2px;">${record.timeFormatted}${sizeStr ? ' · ' + sizeStr : ''}</div>
          </div>
          <div style="display: flex; gap: 4px; flex-shrink: 0;">
            <button class="baidu-pan-download-btn" data-index="${index}" title="下载" style="background: none; border: none; cursor: pointer; color: var(--text-secondary, #999); padding: 4px 8px; font-size: 14px;">&#x2B07;</button>
            <button class="baidu-pan-delete-btn" data-index="${index}" title="删除记录" style="background: none; border: none; cursor: pointer; color: var(--text-secondary, #999); padding: 4px 8px; font-size: 16px;">&#x2716;</button>
          </div>
        </div>
      `;
    }).join('');

    this.historyContainer.querySelectorAll('.baidu-pan-download-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const index = parseInt(btn.getAttribute('data-index'), 10);
        await this.handleDownloadBackup(index);
      });
    });

    this.historyContainer.querySelectorAll('.baidu-pan-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const index = parseInt(btn.getAttribute('data-index'), 10);
        await this.manager.deleteBackupRecord(index);
        await this.renderCloudBackupHistory();
        this._showToast('已删除云端备份记录');
      });
    });
  }

  _formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  _showToast(message) {
    const toast = document.getElementById('toast');
    if (toast) {
      toast.textContent = message;
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 3000);
    }
  }
}

window.baiduPanSettingsManager = new BaiduPanSettingsManager();
