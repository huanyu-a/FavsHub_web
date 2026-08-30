import { enableFloatingBallStorage, baseUrlStorage, tokenStorage } from '@/utils/storage';
import { isSafeUrl } from '@/utils/safe-url';
import { currentLanguage, translateWith } from '@/utils/server-errors';

/**
 * 悬浮球 content script（注入 <all_urls>）。
 *
 * 安全模型（宿主页面是不可信环境）：
 * - 全部 UI 渲染在 closed Shadow DOM 内，宿主页 JS 无法读取书签/引擎数据
 * - 书签与搜索引擎数据延迟到用户首次展开面板时才请求（页面加载零网络请求、零数据落地）
 * - 开关关闭或未配置服务器时不注入任何 DOM、不发任何请求
 */

/** 通过 background script 发起请求（绕过 CORS / Mixed Content 限制） */
async function proxyFetch(url: string, options?: RequestInit): Promise<{ status: number; body: string }> {
  return browser.runtime.sendMessage({ action: 'proxyFetch', url, options });
}

/** Escape HTML special characters to prevent XSS */
function escapeHtml(str: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return str.replace(/[&<>"']/g, (c) => map[c]);
}

interface SearchEngine {
  name: string;
  label?: string;
  url: string;
  icon?: string;
  category?: string;
  is_default?: number;
}

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  async main(ctx) {
    // 悬浮球文案取注入时的语言（每页静态，跟随用户语言设置）
    const lang = await currentLanguage();
    const tt = (key: string, params?: Record<string, string | number>) => translateWith(lang, key, params);
    let teardown: (() => void) | null = null;

    // 开关 / 服务器地址任一变化时重新同步：满足条件才注入，否则整体移除。
    // 串行化执行，防止两个 watch 并发触发导致双重挂载。
    let syncQueue: Promise<void> = Promise.resolve();
    function sync(): Promise<void> {
      syncQueue = syncQueue.then(doSync).catch(() => {});
      return syncQueue;
    }

    async function doSync() {
      const [baseUrl, enabled] = await Promise.all([
        baseUrlStorage.getValue(),
        enableFloatingBallStorage.getValue(),
      ]);
      const shouldShow = !!(baseUrl?.trim() && enabled);
      if (shouldShow && !teardown) {
        teardown = mount(baseUrl!.replace(/\/+$/, ''));
      } else if (!shouldShow && teardown) {
        teardown();
        teardown = null;
      }
    }

    const unwatchEnabled = enableFloatingBallStorage.watch(() => { void sync(); });
    const unwatchBaseUrl = baseUrlStorage.watch(() => { void sync(); });
    ctx.onInvalidated(() => {
      unwatchEnabled?.();
      unwatchBaseUrl?.();
      teardown?.();
    });
    await sync();

    /** 注入悬浮球，返回拆卸函数 */
    function mount(serverUrl: string): () => void {
      // ---- Cleanup: remove stale instance if script was re-injected ----
      document.getElementById('favshub-ext')?.remove();

      const host = document.createElement('div');
      host.id = 'favshub-ext';
      // closed Shadow DOM：宿主页脚本拿不到 shadowRoot 引用，内部数据不可读
      const shadow = host.attachShadow({ mode: 'closed' });
      document.body.appendChild(host);

      // ---- 搜索引擎识别 ----
      function getCurrentSearchEngine(): string {
        const h = window.location.hostname;
        if (h.includes('google.com')) return 'google';
        if (h.includes('bing.com')) return 'bing';
        if (h.includes('baidu.com')) return 'baidu';
        if (h.includes('kimi')) return 'kimi';
        if (h.includes('felo.ai')) return 'felo';
        if (h.includes('metaso.cn')) return 'metaso';
        if (h.includes('doubao.com')) return 'doubao';
        if (h.includes('chatgpt.com')) return 'chatgpt';
        if (h.includes('grok.com')) return 'grok';
        if (h.includes('deepseek.com')) return 'deepseek';
        if (h.includes('qianwen')) return 'qwen';
        return '';
      }

      function getSelectedText(): string {
        try {
          const s = window.getSelection();
          if (!s || s.rangeCount === 0) return '';
          return s.toString().trim();
        } catch {
          return '';
        }
      }

      function getSearchQuery(): string {
        const p = new URLSearchParams(window.location.search);
        return p.get('q') || p.get('p') || p.get('text') || p.get('wd') || '';
      }

      let cachedSelectedText = '';
      function getSearchText(): string {
        return cachedSelectedText || getSearchQuery() || getSelectedText() || '';
      }

      // ---- 悬浮按钮 ----
      const floatingButton = document.createElement('div');
      floatingButton.id = 'favshub-float-btn';

      // 获取扩展图标 — 通过 background 转换 data URL（content script 无法直接访问 chrome-extension://）
      (async () => {
        let iconDataUrl = '';
        try {
          const resp = await browser.runtime.sendMessage({ action: 'getIconUrl', path: '/icon/48.png' });
          if (resp?.url) iconDataUrl = resp.url;
        } catch {
          // background 不可用时回退
          try {
            const iconUrl = chrome.runtime.getURL('/icon/48.png');
            if (iconUrl && !iconUrl.includes('invalid')) {
              const fetchResp = await fetch(iconUrl);
              const blob = await fetchResp.blob();
              iconDataUrl = await new Promise<string>(resolve => {
                const r = new FileReader();
                r.onload = () => resolve(r.result as string);
                r.readAsDataURL(blob);
              });
            }
          } catch {}
        }
        const iconImg = document.createElement('img');
        iconImg.className = 'floating-button-icon';
        iconImg.alt = 'FavsHub';
        if (iconDataUrl) {
          iconImg.src = iconDataUrl;
        } else {
          iconImg.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><text y="18" font-size="18">⭐</text></svg>';
        }
        floatingButton.prepend(iconImg);
      })();

      const tooltipDiv = document.createElement('div');
      tooltipDiv.className = 'floating-tooltip';
      tooltipDiv.innerHTML = `
        <div class="tooltip-content">
          <div class="tooltip-row">
            <span class="tooltip-action">${tt('ui.fb.tooltip_click')}</span>
            <span class="tooltip-desc">${tt('ui.fb.tooltip_click_desc')}</span>
          </div>
          <div class="tooltip-row">
            <span class="tooltip-action">${tt('ui.fb.tooltip_alt')}</span>
            <span class="tooltip-desc">${tt('ui.fb.tooltip_alt_desc')}</span>
          </div>
          <div class="tooltip-row">
            <span class="tooltip-action">${tt('ui.fb.tooltip_key')}</span>
            <span class="tooltip-desc">${tt('ui.fb.tooltip_key_desc')}</span>
          </div>
        </div>
        <button class="tooltip-close" title="${tt('ui.fb.hide')}">
          <svg xmlns="http://www.w3.org/2000/svg" height="16" viewBox="0 -960 960 960" width="16" fill="currentColor">
            <path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/>
          </svg>
        </button>
      `;
      floatingButton.appendChild(tooltipDiv);

      // ---- 侧边栏面板 ----
      const sidebarContainer = document.createElement('div');
      sidebarContainer.id = 'favshub-sidebar';
      sidebarContainer.classList.add('collapsed');

      const searchSwitcher = document.createElement('aside');
      searchSwitcher.id = 'favshub-search-switch';
      searchSwitcher.innerHTML = `
        <ul id="favshub-engine-list"></ul>
        <ul id="favshub-bookmark-list"></ul>
      `;
      sidebarContainer.appendChild(searchSwitcher);

      shadow.appendChild(floatingButton);
      shadow.appendChild(sidebarContainer);

      // ---- 数据懒加载：首次展开面板才请求，页面加载阶段零网络请求 ----
      let dataLoaded = false;
      let dataLoading = false;

      function renderEngines(allEngines: SearchEngine[]) {
        // 容错：跳过缺少 name/url 的脏数据，避免初始化中断
        const valid = allEngines.filter(e => e && typeof e.name === 'string' && e.name && typeof e.url === 'string');
        const visibleEngines = valid.some(e => e.is_default) ? valid.filter(e => e.is_default) : valid;
        const defaultEngineName = visibleEngines.find(e => e.is_default)?.name || getCurrentSearchEngine();

        const engineList = shadow.querySelector('#favshub-engine-list') as HTMLElement | null;
        if (!engineList) return;
        engineList.innerHTML = visibleEngines.map((eng) => {
          const sel = defaultEngineName && eng.name.toLowerCase() === defaultEngineName.toLowerCase() ? ' class="selected"' : '';
          let iconSrc = '';
          if (eng.icon) {
            if (eng.icon.startsWith('http') && isSafeUrl(eng.icon)) iconSrc = eng.icon;
            else if (eng.icon.startsWith('/')) iconSrc = serverUrl + eng.icon;
            else iconSrc = `${serverUrl}/images/${eng.icon}`;
          }
          if (iconSrc && !isSafeUrl(iconSrc)) iconSrc = '';
          const safeLabel = escapeHtml(eng.label || eng.name || '');
          const safeName = escapeHtml(eng.name || '');
          const safeUrl = isSafeUrl(eng.url) ? escapeHtml(eng.url) : '';
          const iconHtml = iconSrc
            ? `<img src="${escapeHtml(iconSrc)}" alt="${safeLabel}" class="search-icon">`
            : `<span class="search-icon-placeholder">${safeLabel.charAt(0) || '?'}</span>`;
          return `<li data-url="${safeUrl}" data-name="${safeName}"${sel}>${iconHtml}<span>${safeLabel}</span></li>`;
        }).join('');
      }

      function renderBookmarks(html: string) {
        const list = shadow.querySelector('#favshub-bookmark-list') as HTMLElement | null;
        if (list) list.innerHTML = html || `<li style="padding:8px 16px;color:#999;font-size:13px;">${tt('ui.fb.no_bookmarks')}</li>`;
      }

      async function loadBookmarks(): Promise<string> {
        try {
          const token = await tokenStorage.getValue();
          if (!token) return '';
          const resp = await proxyFetch(`${serverUrl}/api/bookmarks`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const json = JSON.parse(resp.body);
          const bookmarks = json.bookmarks || json.data || [];
          if (!Array.isArray(bookmarks) || !bookmarks.length) return '';
          return bookmarks.slice(0, 20).map((b: any) => {
            const safeUrl = isSafeUrl(b.url) ? escapeHtml(b.url) : '';
            if (!safeUrl) return '';
            let faviconUrl = b.icon || '';
            if (faviconUrl && !faviconUrl.startsWith('http')) faviconUrl = serverUrl + faviconUrl;
            if (faviconUrl && !isSafeUrl(faviconUrl)) faviconUrl = '';
            const safeTitle = escapeHtml(b.title || b.url || '');
            return `<li class="bookmark-item" data-url="${safeUrl}">
              <a href="${safeUrl}" target="_blank" class="bookmark-link">
                ${faviconUrl ? `<img src="${escapeHtml(faviconUrl)}" alt="" class="bookmark-icon">` : ''}
                <span class="bookmark-title">${safeTitle}</span>
              </a>
            </li>`;
          }).join('');
        } catch { return ''; }
      }

      async function ensureData() {
        if (dataLoaded || dataLoading) return;
        dataLoading = true;
        try {
          renderBookmarks(`<li style="padding:8px 16px;color:#999;font-size:13px;">${tt('ui.fb.loading')}</li>`);
          const token = await tokenStorage.getValue();
          const authHeaders: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
          // 引擎与书签串行请求，失败互不影响
          try {
            const resp = await proxyFetch(`${serverUrl}/api/search-engines`, { headers: authHeaders });
            const data = JSON.parse(resp.body);
            renderEngines(data.data?.engines || data.engines || data.data || []);
          } catch {
            renderEngines([]);
          }
          try {
            renderBookmarks(await loadBookmarks());
          } catch {
            renderBookmarks('');
          }
          dataLoaded = true;
        } finally {
          dataLoading = false;
        }
      }

      // ---- 样式（Shadow DOM 内生效，选择器无需前缀；:host 隔离宿主样式继承） ----
      const styleSheet = document.createElement('style');
      styleSheet.textContent = `
        :host { all: initial; }

        #favshub-sidebar {
          position: fixed !important; top: 0; right: 0; width: 280px !important; height: 100vh;
          background-color: #ffffff; box-shadow: -2px 0 5px rgba(0,0,0,0.1);
          transition: transform 0.3s ease; transform: translateX(100%);
          z-index: 2147483647 !important; padding: 8px; overflow-y: auto;
        }
        #favshub-sidebar.collapsed { transform: translateX(100%) !important; }
        #favshub-sidebar:not(.collapsed) { transform: translateX(0) !important; }

        #favshub-float-btn {
          position: fixed !important; width: 40px; height: 40px; top: 20%; right: 0;
          border-radius: 20px 0 0 20px;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; z-index: 2147483647 !important;
          user-select: none; box-shadow: -2px 0 5px rgba(0,0,0,0.1);
          transition: width 0.2s;
        }
        #favshub-float-btn:hover { width: 60px; }
        .floating-button-icon { max-width: 24px; max-height: 24px; flex-shrink: 0; pointer-events: none; display: block; }

        #favshub-search-switch { height: 100%; display: flex; flex-direction: column; align-items: flex-start; width: 100%; background-color: #ffffff; overflow: auto; padding: 20px 0 0 0; }
        #favshub-search-switch ul { list-style-type: none; padding: 0; width: 100%; margin: 0; }
        #favshub-search-switch ul li {
          display: flex; position: relative; font-size: 14px; font-weight: 600; color: #1a202c;
          line-height: 20px; padding: 8px 16px; margin: 4px 8px !important;
          align-items: center; cursor: pointer; border-radius: 8px;
          transition: background-color 0.3s, color 0.3s;
        }
        #favshub-search-switch ul li:hover { background-color: #f0f0f0; color: #4285f4; }
        #favshub-search-switch ul li.selected { background-color: #e2e8f0; font-weight: bold; color: #4285f4; }

        .search-icon { height: 16px; margin: 0 8px 0 0; }
        .search-icon-placeholder {
          display: inline-flex; align-items: center; justify-content: center;
          width: 16px; height: 16px; margin: 0 8px 0 0;
          font-size: 11px; font-weight: 700; color: #666;
          background: #e5e7eb; border-radius: 3px;
        }

        .bookmark-item { display: flex; align-items: center; margin: 4px 8px !important; padding: 8px 16px; cursor: pointer; transition: background-color 0.3s; }
        .bookmark-item:hover { background-color: #f0f0f0; }
        .bookmark-icon { width: 16px; height: 16px; margin: 0 8px 0 0 !important; }
        .bookmark-link { display: flex; align-items: center; width: 100%; text-decoration: none; color: inherit; }
        .bookmark-title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 14px; font-weight: 600; color: #1a202c !important; line-height: 20px; }
        #favshub-bookmark-list { padding: 16px 0 60px 0 !important; }

        .floating-tooltip {
          position: absolute; right: 50px; top: 50%; transform: translateY(-50%);
          background: white; border-radius: 8px; padding: 16px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.15); width: 280px;
          opacity: 0; visibility: hidden; transition: opacity 0.2s, visibility 0.2s;
          z-index: 2147483647;
        }
        #favshub-float-btn:hover .floating-tooltip { opacity: 1; visibility: visible; }
        .floating-tooltip:after {
          content: ''; position: absolute; right: -6px; top: 50%;
          transform: translateY(-50%) rotate(45deg); width: 12px; height: 12px;
          background: white; box-shadow: 3px -3px 3px rgba(0,0,0,0.05);
        }
        .tooltip-content { font-size: 13px; color: #333; padding-right: 24px; }
        .tooltip-row { display: grid; grid-template-columns: 100px 1fr; gap: 24px; align-items: center; margin: 8px 0; }
        .tooltip-action { font-weight: 600; color: #666; white-space: nowrap; }
        .tooltip-desc { color: #666; line-height: 1.4; }
        .tooltip-close {
          position: absolute; top: 8px; right: 8px; width: 24px; height: 24px; padding: 4px;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer; border: none; background: transparent; border-radius: 4px; color: #888;
        }
        .tooltip-close:hover { background: rgba(0,0,0,0.05); color: #666; }
        .tooltip-close svg { width: 16px; height: 16px; }

        * { user-select: none; -webkit-user-select: none; }

        @media (prefers-color-scheme: dark) {
          #favshub-sidebar, #favshub-search-switch { background-color: #1e1e2e; }
          #favshub-search-switch ul li, .bookmark-title { color: #e0e0e0 !important; }
          #favshub-search-switch ul li:hover { background-color: rgba(255,255,255,0.1); color: #4285f4 !important; }
          .bookmark-item:hover { background-color: rgba(255,255,255,0.1); }
          .floating-tooltip { background: #1f2937; }
          .floating-tooltip:after { background: #1f2937; }
          .tooltip-action { color: #e5e7eb; }
          .tooltip-desc { color: #9ca3af; }
        }
      `;
      shadow.appendChild(styleSheet);

      // ---- 交互 ----
      floatingButton.addEventListener('click', (e) => {
        if (e.altKey) {
          browser.runtime.sendMessage({ action: 'open_side_panel' });
          return;
        }
        const nowCollapsed = sidebarContainer.classList.toggle('collapsed');
        if (!nowCollapsed) void ensureData();
      });

      sidebarContainer.addEventListener('mouseleave', () => {
        sidebarContainer.classList.add('collapsed');
      });

      // 选中文字缓存（事件委托，引擎列表为懒渲染）
      searchSwitcher.addEventListener('mousedown', () => {
        cachedSelectedText = getSelectedText();
      });

      searchSwitcher.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;

        // 书签点击
        const link = target.closest('a.bookmark-link') as HTMLAnchorElement | null;
        if (link) {
          if (isSafeUrl(link.href)) {
            e.preventDefault();
            window.open(link.href, '_blank');
          }
          return;
        }

        // 搜索引擎点击
        const engineItem = target.closest('#favshub-engine-list li[data-url]') as HTMLElement | null;
        if (engineItem) {
          const text = getSearchText();
          const url = engineItem.getAttribute('data-url') || '';
          if (url && text && isSafeUrl(url)) {
            window.open(url + encodeURIComponent(text), '_blank');
            shadow.querySelectorAll('#favshub-engine-list li.selected').forEach((li) => li.classList.remove('selected'));
            engineItem.classList.add('selected');
          }
        }
      });

      // 关闭 tooltip
      const closeBtn = floatingButton.querySelector('.tooltip-close');
      closeBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        const tip = floatingButton.querySelector('.floating-tooltip') as HTMLElement;
        if (tip) tip.style.display = 'none';
      });

      // ---- Cleanup on script invalidation/disconnect ----
      return () => {
        host.remove();
      };
    }
  },
});
