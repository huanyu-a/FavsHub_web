/**
 * PromptPro 提示词管理系统 - 集成脚本
 * 直接打开 promptpro.html 页面
 */

(function() {
  'use strict';

  // 打开 PromptPro 提示词管理页面
  function showPromptPro() {
    console.log('[PromptPro] 打开提示词管理页面...');

    // 使用 Chrome 扩展 API 打开新标签页
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      const promptproUrl = chrome.runtime.getURL('src/promptpro.html');
      chrome.tabs.create({ url: promptproUrl });
    } else {
      // 降级到 window.open
      window.open('promptpro.html', '_blank');
    }
  }

  // 绑定事件 - 侧边栏入口
  const promptproItem = document.querySelector('#promptpro-entry .promptpro-item');

  if (promptproItem) {
    promptproItem.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      console.log('[PromptPro] 提示词管理被点击');
      showPromptPro();
    });
    console.log('[PromptPro] 侧边栏入口事件绑定完成');
  }

  // 也支持直接点击链接
  const promptproLink = document.getElementById('promptpro-link');
  if (promptproLink) {
    promptproLink.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      console.log('[PromptPro] 链接被点击');
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

// backupManager 已通过 backup-manager.js 全局加载

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

          if (!PromptProDB.db) await PromptProDB.init();
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

// backupManager 已通过 backup-manager.js 全局加载

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
