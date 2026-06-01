/**
 * FavsHub 百度网盘云端备份管理器
 * 直接调用百度网盘 REST API，通过 OAuth 2.0 简化模式认证
 *
 * 流程：用户点击"连接" → OAuth 授权 → 获取 access_token → 备份/恢复
 * AppKey 内置在代码中，用户无需输入任何凭据
 */

// ── 应用凭据（通过服务端 API 获取，不硬编码） ──

let APP_KEY = null;  // 运行时从服务端获取

async function getAppKey() {
  if (APP_KEY) return APP_KEY;
  try {
    const resp = await fetch('/api/config/baidu-app-key');
    if (resp.ok) {
      const data = await resp.json();
      APP_KEY = data.appKey;
      return APP_KEY;
    }
  } catch {}
  return null;
}

const RELAY_URL = 'https://huanyu-a.github.io/FavsHub/src/oauth-callback.html';
const REMOTE_DIR = '/apps/FavsHub';

// ── 轻量 MD5 实现（用于百度 API block_list 参数） ──

function md5(string) {
  function md5cycle(x, k) {
    let a = x[0], b = x[1], c = x[2], d = x[3];
    a = ff(a, b, c, d, k[0], 7, -680876936); d = ff(d, a, b, c, k[1], 12, -389564586);
    c = ff(c, d, a, b, k[2], 17, 606105819); b = ff(b, c, d, a, k[3], 22, -1044525330);
    a = ff(a, b, c, d, k[4], 7, -176418897); d = ff(d, a, b, c, k[5], 12, 1200080426);
    c = ff(c, d, a, b, k[6], 17, -1473231341); b = ff(b, c, d, a, k[7], 22, -45705983);
    a = ff(a, b, c, d, k[8], 7, 1770035416); d = ff(d, a, b, c, k[9], 12, -1958414417);
    c = ff(c, d, a, b, k[10], 17, -42063); b = ff(b, c, d, a, k[11], 22, -1990404162);
    a = ff(a, b, c, d, k[12], 7, 1804603682); d = ff(d, a, b, c, k[13], 12, -40341101);
    c = ff(c, d, a, b, k[14], 17, -1502002290); b = ff(b, c, d, a, k[15], 22, 1236535329);
    a = gg(a, b, c, d, k[1], 5, -165796510); d = gg(d, a, b, c, k[6], 9, -1069501632);
    c = gg(c, d, a, b, k[11], 14, 643717713); b = gg(b, c, d, a, k[0], 20, -373897302);
    a = gg(a, b, c, d, k[5], 5, -701558691); d = gg(d, a, b, c, k[10], 9, 38016083);
    c = gg(c, d, a, b, k[15], 14, -660478335); b = gg(b, c, d, a, k[4], 20, -405537848);
    a = gg(a, b, c, d, k[9], 5, 568446438); d = gg(d, a, b, c, k[14], 9, -1019803690);
    c = gg(c, d, a, b, k[3], 14, -187363961); b = gg(b, c, d, a, k[8], 20, 1163531501);
    a = gg(a, b, c, d, k[13], 5, -1444681467); d = gg(d, a, b, c, k[2], 9, -51403784);
    c = gg(c, d, a, b, k[7], 14, 1735328473); b = gg(b, c, d, a, k[12], 20, -1926607734);
    a = hh(a, b, c, d, k[5], 4, -378558); d = hh(d, a, b, c, k[8], 11, -2022574463);
    c = hh(c, d, a, b, k[11], 16, 1839030562); b = hh(b, c, d, a, k[14], 23, -35309556);
    a = hh(a, b, c, d, k[1], 4, -1530992060); d = hh(d, a, b, c, k[4], 11, 1272893353);
    c = hh(c, d, a, b, k[7], 16, -155497632); b = hh(b, c, d, a, k[10], 23, -1094730640);
    a = hh(a, b, c, d, k[13], 4, 681279174); d = hh(d, a, b, c, k[0], 11, -358537222);
    c = hh(c, d, a, b, k[3], 16, -722521979); b = hh(b, c, d, a, k[6], 23, 76029189);
    a = ii(a, b, c, d, k[9], 4, -640364487); d = ii(d, a, b, c, k[12], 11, -421815835);
    c = ii(c, d, a, b, k[10], 15, -1051523); b = ii(b, c, d, a, k[1], 21, -2054922799);
    a = ii(a, b, c, d, k[8], 6, 1873313359); d = ii(d, a, b, c, k[15], 10, -30611744);
    c = ii(c, d, a, b, k[6], 15, -1560198380); b = ii(b, c, d, a, k[13], 21, 1309151649);
    a = ii(a, b, c, d, k[4], 6, -145523070); d = ii(d, a, b, c, k[11], 10, -1120210379);
    c = ii(c, d, a, b, k[2], 15, 718787259); b = ii(b, c, d, a, k[9], 21, -343485551);
    x[0] = add32(a, x[0]); x[1] = add32(b, x[1]); x[2] = add32(c, x[2]); x[3] = add32(d, x[3]);
  }
  function cmn(q, a, b, x, s, t) { a = add32(add32(a, q), add32(x, t)); return add32((a << s) | (a >>> (32 - s)), b); }
  function ff(a, b, c, d, x, s, t) { return cmn((b & c) | ((~b) & d), a, b, x, s, t); }
  function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & (~d)), a, b, x, s, t); }
  function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
  function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | (~d)), a, b, x, s, t); }
  function md5blk(s) {
    const md5blks = [];
    for (let i = 0; i < 64; i += 4) {
      md5blks[i >> 2] = s.charCodeAt(i) + (s.charCodeAt(i + 1) << 8) + (s.charCodeAt(i + 2) << 16) + (s.charCodeAt(i + 3) << 24);
    }
    return md5blks;
  }
  function add32(a, b) { return (a + b) & 0xFFFFFFFF; }
  function rhex(n) {
    const s = '0123456789abcdef';
    let j = '';
    for (let i = 0; i < 4; i++) j += s.charAt((n >> (i * 8 + 4)) & 0x0F) + s.charAt((n >> (i * 8)) & 0x0F);
    return j;
  }

  let n = string.length;
  let state = [1732584193, -271733879, -1732584194, 271733878];
  let i;
  for (i = 64; i <= n; i += 64) md5cycle(state, md5blk(string.substring(i - 64, i)));
  string = string.substring(i - 64);
  const tail = [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];
  for (i = 0; i < string.length; i++) tail[i >> 2] |= string.charCodeAt(i) << ((i % 4) << 3);
  tail[i >> 2] |= 0x80 << ((i % 4) << 3);
  if (i > 55) { md5cycle(state, tail); tail.fill(0); }
  tail[14] = n * 8;
  md5cycle(state, tail);
  return rhex(state[0]) + rhex(state[1]) + rhex(state[2]) + rhex(state[3]);
}

function md5hex(data) {
  if (typeof data === 'string') return md5(data);
  let s = '';
  for (let i = 0; i < data.length; i++) s += String.fromCharCode(data[i]);
  return md5(s);
}

// ── 主类 ──

class BaiduPanBackupManager {
  static STORAGE_KEY = 'baiduPanConfig';
  static HISTORY_KEY = 'baiduPanBackupHistory';
  static AUTO_KEY = 'baiduPanAutoBackup';

  // ── 配置读写 ──

  async getConfig() {
    return new Promise((resolve) => {
      chrome.storage.local.get([BaiduPanBackupManager.STORAGE_KEY], (r) => {
        resolve(r[BaiduPanBackupManager.STORAGE_KEY] || {});
      });
    });
  }

  async setConfig(partial) {
    const current = await this.getConfig();
    const merged = { ...current, ...partial };
    return new Promise((resolve) => {
      chrome.storage.local.set({ [BaiduPanBackupManager.STORAGE_KEY]: merged }, resolve);
    });
  }

  async clearConfig() {
    return new Promise((resolve) => {
      chrome.storage.local.remove(BaiduPanBackupManager.STORAGE_KEY, resolve);
    });
  }

  // ── 连接状态 ──

  async isConnected() {
    const cfg = await this.getConfig();
    return !!(cfg.accessToken && cfg.expiresAt);
  }

  // ── OAuth 流程（简化模式） ──

  _getRedirectUri() {
    if (chrome.identity?.getRedirectURL) {
      return chrome.identity.getRedirectURL();
    }
    return `https://${chrome.runtime.id}.chromiumapp.org/`;
  }

  async startOAuth() {
    const appKey = await getAppKey();
    if (!appKey) {
      console.error('[百度网盘] 百度网盘功能未配置，请设置 BAIDU_APP_KEY 环境变量');
      return;
    }
    // 中继页面需要知道扩展 ID 才能跳转回 chromiumapp.org
    const extId = chrome.runtime.id;
    const redirectUri = RELAY_URL + '?ext_id=' + encodeURIComponent(extId);
    const authUrl = new URL('https://openapi.baidu.com/oauth/2.0/authorize');
    authUrl.searchParams.set('response_type', 'token');
    authUrl.searchParams.set('client_id', appKey);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('scope', 'basic,netdisk');
    authUrl.searchParams.set('display', 'popup');

    let responseUrl;

    if (chrome.identity?.launchWebAuthFlow) {
      try {
        responseUrl = await chrome.identity.launchWebAuthFlow({
          url: authUrl.toString(),
          interactive: true
        });
      } catch (err) {
        throw new Error('AUTH_FAILED');
      }
    } else {
      responseUrl = await this._oauthViaPopup(authUrl.toString(), redirectUri);
    }

    // 中继页面将 token 以 query params 形式传回 chromiumapp.org
    const url = new URL(responseUrl);
    const accessToken = url.searchParams.get('access_token');
    const expiresIn = parseInt(url.searchParams.get('expires_in'), 10);

    if (!accessToken) throw new Error('AUTH_FAILED');

    await this.setConfig({
      accessToken,
      expiresAt: Date.now() + (expiresIn || 2592000) * 1000
    });
  }

  _oauthViaPopup(authUrl, redirectUri) {
    // 中继方案：popup 最终会跳转到 chromiumapp.org（非 RELAY_URL）
    const extRedirect = this._getRedirectUri();
    return new Promise((resolve, reject) => {
      const popup = window.open(authUrl, 'baidu-oauth', 'width=600,height=700');
      if (!popup) return reject(new Error('AUTH_FAILED'));

      const timer = setInterval(() => {
        try {
          if (popup.closed) {
            clearInterval(timer);
            reject(new Error('AUTH_FAILED'));
            return;
          }
          const currentUrl = popup.location.href;
          if (currentUrl.startsWith(extRedirect)) {
            clearInterval(timer);
            popup.close();
            resolve(currentUrl);
          }
        } catch {
          // 跨域时无法读取 popup.location，继续轮询
        }
      }, 500);

      setTimeout(() => {
        clearInterval(timer);
        try { popup.close(); } catch {}
        reject(new Error('AUTH_FAILED'));
      }, 300000);
    });
  }

  async getValidToken() {
    const cfg = await this.getConfig();
    if (!cfg.accessToken) throw new Error('NO_CREDENTIALS');

    if (Date.now() >= cfg.expiresAt - 300000) {
      throw new Error('TOKEN_EXPIRED');
    }

    return cfg.accessToken;
  }

  async disconnect() {
    await this.clearConfig();
  }

  // ── 百度网盘 API ──

  async precreate(remotePath, size, blockMd5) {
    const token = await this.getValidToken();
    const url = `https://pan.baidu.com/rest/2.0/xpan/file?method=precreate&access_token=${token}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        path: remotePath,
        size: String(size),
        isdir: '0',
        autoinit: '1',
        rtype: '3',
        block_list: JSON.stringify([blockMd5])
      }).toString()
    });
    const data = await resp.json();
    if (data.errno && data.errno !== 0) {
      const err = new Error('API_ERROR');
      err.errno = data.errno;
      throw err;
    }
    return data;
  }

  async uploadBlock(remotePath, uploadid, blob) {
    const token = await this.getValidToken();
    const url = `https://d.pcs.baidu.com/rest/2.0/pcs/superfile2?method=upload&access_token=${token}&path=${encodeURIComponent(remotePath)}&type=tmpfile&uploadid=${uploadid}&partseq=0`;
    const formData = new FormData();
    formData.append('file', blob, 'backup.json');
    const resp = await fetch(url, { method: 'POST', body: formData });
    const data = await resp.json();
    if (data.errno && data.errno !== 0) {
      const err = new Error('API_ERROR');
      err.errno = data.errno;
      throw err;
    }
    return data;
  }

  async createFile(remotePath, size, uploadid, blockMd5) {
    const token = await this.getValidToken();
    const url = `https://pan.baidu.com/rest/2.0/xpan/file?method=create&access_token=${token}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        path: remotePath,
        size: String(size),
        isdir: '0',
        rtype: '3',
        uploadid,
        block_list: JSON.stringify([blockMd5])
      }).toString()
    });
    const data = await resp.json();
    if (data.errno && data.errno !== 0) {
      const err = new Error('API_ERROR');
      err.errno = data.errno;
      throw err;
    }
    return data;
  }

  async listFiles(dir) {
    if (!dir) dir = REMOTE_DIR;
    const token = await this.getValidToken();
    const url = `https://pan.baidu.com/rest/2.0/xpan/file/list?dir=${encodeURIComponent(dir)}&order=time&desc=1&access_token=${token}`;
    const resp = await fetch(url);
    return await resp.json();
  }

  async downloadFile(fsId) {
    const token = await this.getValidToken();
    const url = `https://d.pcs.baidu.com/rest/2.0/pcs/superfile2?method=download&fsid=${fsId}&access_token=${token}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('NETWORK_ERROR');
    return await resp.text();
  }

  // ── 工具方法 ──

  _hashData(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
    return hash.toString(36);
  }

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

  // ── 备份操作 ──

  async performBackup(force = false) {
    if (!(await this.isConnected())) throw new Error('NO_CREDENTIALS');
    await this.getValidToken();

    if (!PromptProDB.db) await PromptProDB.init();
    const data = await PromptProDB.exportData();

    const json = JSON.stringify(data);
    const currentHash = this._hashData(json);
    if (!force) {
      const records = await this.getBackupHistory();
      const lastHash = records.length > 0 ? records[0].hash : null;
      if (lastHash && currentHash === lastHash) {
        throw new Error('NO_CHANGE');
      }
    }

    const backup = { version: '1.0', timestamp: new Date().toISOString(), type: 'promptpro', data };
    const backupStr = JSON.stringify(backup, null, 2);
    const filename = `favshub-backup-${this._getTimestampCN()}.json`;
    const remotePath = `${REMOTE_DIR}/${filename}`;

    const contentMd5 = md5hex(backupStr);
    const blob = new Blob([backupStr], { type: 'application/json' });
    const size = blob.size;

    const precreateResult = await this.precreate(remotePath, size, contentMd5);

    if (precreateResult.return_type === 2) {
      await this.addBackupRecord({
        filename, fsId: precreateResult.block_list?.[0] || 0,
        timestamp: Date.now(), size, hash: currentHash
      });
      return filename;
    }

    const uploadid = precreateResult.uploadid;
    await this.uploadBlock(remotePath, uploadid, blob);
    const createResult = await this.createFile(remotePath, size, uploadid, contentMd5);

    await this.addBackupRecord({
      filename, fsId: createResult.fs_id || 0,
      timestamp: Date.now(), size, hash: currentHash
    });

    return filename;
  }

  async checkAndAutoBackup() {
    try {
      const enabled = await this.getAutoBackupEnabled();
      if (!enabled) return null;
      if (!(await this.isConnected())) return null;

      try { await this.getValidToken(); } catch { return null; }

      const records = await this.getBackupHistory();
      const lastTime = records.length > 0 ? records[0].timestamp : null;
      const now = Date.now();
      if (lastTime && (now - lastTime) < 24 * 60 * 60 * 1000) return null;

      return await this.performBackup();
    } catch (err) {
      console.warn('[BaiduPan] 自动备份:', err.message);
      return null;
    }
  }

  // ── 备份记录管理 ──

  async getBackupHistory() {
    return new Promise((resolve) => {
      chrome.storage.local.get([BaiduPanBackupManager.HISTORY_KEY], (r) => {
        resolve(r[BaiduPanBackupManager.HISTORY_KEY] || []);
      });
    });
  }

  async addBackupRecord(record) {
    const records = await this.getBackupHistory();
    records.unshift({
      filename: record.filename,
      fsId: record.fsId,
      timestamp: record.timestamp || Date.now(),
      timeFormatted: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
      size: record.size,
      hash: record.hash
    });
    if (records.length > 20) records.length = 20;
    return new Promise((resolve) => {
      chrome.storage.local.set({ [BaiduPanBackupManager.HISTORY_KEY]: records }, () => resolve(records));
    });
  }

  async deleteBackupRecord(index) {
    const records = await this.getBackupHistory();
    if (index < 0 || index >= records.length) return records;
    records.splice(index, 1);
    return new Promise((resolve) => {
      chrome.storage.local.set({ [BaiduPanBackupManager.HISTORY_KEY]: records }, () => resolve(records));
    });
  }

  async getLastBackupTimeFormatted() {
    const records = await this.getBackupHistory();
    if (records.length === 0) return null;
    return records[0].timeFormatted;
  }

  // ── 自动备份开关 ──

  async getAutoBackupEnabled() {
    return new Promise((resolve) => {
      chrome.storage.local.get([BaiduPanBackupManager.AUTO_KEY], (r) => {
        resolve(r[BaiduPanBackupManager.AUTO_KEY] === true);
      });
    });
  }

  async setAutoBackupEnabled(enabled) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [BaiduPanBackupManager.AUTO_KEY]: enabled }, resolve);
    });
  }
}

window.baiduPanBackupManager = new BaiduPanBackupManager();
