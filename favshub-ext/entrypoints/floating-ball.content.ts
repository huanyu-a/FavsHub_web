import { enableFloatingBallStorage, baseUrlStorage, tokenStorage } from '@/utils/storage';
import { isSafeUrl } from '@/utils/safe-url';
import { currentLanguage, translateWith } from '@/utils/server-errors';
import { themeCssVariables } from '@/utils/theme';
import { clampFloatingTop, getFloatingTooltipTop, shouldHandleFloatingButtonKeydown } from '@/utils/floating-ball';

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
      host.dataset.edge = 'right';
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
      floatingButton.role = 'button';
      floatingButton.tabIndex = 0;
      floatingButton.setAttribute('aria-label', `FavsHub — ${tt('ui.fb.tooltip_click_desc')}`);
      floatingButton.setAttribute('aria-expanded', 'false');
      floatingButton.setAttribute('aria-controls', 'favshub-sidebar');
      floatingButton.setAttribute('aria-keyshortcuts', 'Alt+B');

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
        <button type="button" class="tooltip-close" title="${tt('ui.fb.hide')}" aria-label="${tt('ui.fb.hide')}">
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
      sidebarContainer.tabIndex = -1;
      sidebarContainer.setAttribute('aria-label', tt('ui.fb.tooltip_click_desc'));
      sidebarContainer.setAttribute('aria-hidden', 'true');

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
          return `<li data-url="${safeUrl}" data-name="${safeName}" role="button" tabindex="0"${sel}>${iconHtml}<span>${safeLabel}</span></li>`;
        }).join('');
      }

      function renderBookmarks(html: string) {
        const list = shadow.querySelector('#favshub-bookmark-list') as HTMLElement | null;
        if (list) list.innerHTML = html || `<li class="floating-empty">${tt('ui.fb.no_bookmarks')}</li>`;
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
          renderBookmarks(`<li class="floating-empty">${tt('ui.fb.loading')}</li>`);
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
      const cssVariables = (theme: 'light' | 'dark') => Object.entries(themeCssVariables(theme))
        .map(([name, value]) => `${name}: ${value};`).join(' ');
      const styleSheet = document.createElement('style');
      styleSheet.textContent = `
        :host {
          all: initial;
          ${cssVariables('light')}
          --fh-focus: #059669;
          --fh-shadow: 0 14px 38px rgba(41, 37, 36, 0.16), 0 2px 8px rgba(41, 37, 36, 0.08);
          color-scheme: light;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
        }
        * { box-sizing: border-box; user-select: none; -webkit-user-select: none; }

        #favshub-sidebar {
          position: fixed !important;
          top: max(12px, env(safe-area-inset-top, 0px));
          right: 10px;
          width: min(320px, calc(100vw - 20px));
          height: calc(100dvh - 24px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));
          max-height: calc(100vh - 24px);
          padding: 10px;
          overflow-y: auto;
          overscroll-behavior: contain;
          border: 1px solid var(--fh-border);
          border-radius: 18px;
          background: var(--fh-bg);
          color: var(--fh-text);
          box-shadow: var(--fh-shadow);
          transform: translateX(calc(100% + 24px));
          opacity: 0;
          visibility: hidden;
          transition: transform 180ms ease, opacity 160ms ease, visibility 180ms;
          z-index: 2147483647 !important;
          scrollbar-width: thin;
          scrollbar-color: var(--fh-primary) transparent;
        }
        #favshub-sidebar.collapsed { transform: translateX(calc(100% + 24px)) !important; }
        #favshub-sidebar:not(.collapsed) {
          transform: translateX(0) !important;
          opacity: 1;
          visibility: visible;
        }
        :host([data-edge="left"]) #favshub-sidebar {
          right: auto;
          left: 10px;
          transform: translateX(calc(-100% - 24px));
        }
        :host([data-edge="left"]) #favshub-sidebar.collapsed { transform: translateX(calc(-100% - 24px)) !important; }
        :host([data-edge="left"]) #favshub-sidebar:not(.collapsed) { transform: translateX(0) !important; }
        #favshub-sidebar:focus-visible { outline: 3px solid var(--fh-focus); outline-offset: -3px; }

        #favshub-float-btn {
          position: fixed !important;
          top: var(--fh-float-top, 20vh);
          right: 0;
          display: flex;
          width: 44px;
          height: 44px;
          align-items: center;
          justify-content: center;
          border: 1px solid var(--fh-border);
          border-right: 0;
          border-radius: 14px 0 0 14px;
          background: var(--fh-surface);
          color: var(--fh-primary);
          box-shadow: -4px 5px 18px rgba(41, 37, 36, 0.14);
          cursor: grab;
          touch-action: none;
          user-select: none;
          z-index: 2147483647 !important;
          transition: width 160ms ease, background-color 160ms ease, box-shadow 160ms ease;
        }
        #favshub-float-btn::before {
          content: "";
          position: absolute;
          top: 11px;
          bottom: 11px;
          left: 0;
          width: 3px;
          border-radius: 0 3px 3px 0;
          background: var(--fh-primary);
        }
        #favshub-float-btn:hover { width: 56px; background: var(--fh-surface-soft); }
        #favshub-float-btn:active { cursor: grabbing; }
        #favshub-float-btn:focus-visible {
          outline: 3px solid var(--fh-focus);
          outline-offset: 3px;
          box-shadow: 0 0 0 6px var(--fh-surface), -4px 5px 18px rgba(41, 37, 36, 0.14);
        }
        :host([data-edge="left"]) #favshub-float-btn {
          right: auto;
          left: 0;
          border-right: 1px solid var(--fh-border);
          border-left: 0;
          border-radius: 0 14px 14px 0;
          box-shadow: 4px 5px 18px rgba(41, 37, 36, 0.14);
        }
        :host([data-edge="left"]) #favshub-float-btn::before { right: 0; left: auto; border-radius: 3px 0 0 3px; }
        .floating-button-icon {
          display: block;
          width: 26px;
          height: 26px;
          flex-shrink: 0;
          border-radius: 7px;
          pointer-events: none;
        }

        #favshub-search-switch {
          display: flex;
          width: 100%;
          height: 100%;
          flex-direction: column;
          align-items: flex-start;
          overflow: auto;
          padding: 12px 0 0;
          background: transparent;
        }
        #favshub-search-switch ul { width: 100%; margin: 0; padding: 0; list-style-type: none; }
        #favshub-search-switch ul li {
          position: relative;
          display: flex;
          align-items: center;
          margin: 4px 6px !important;
          padding: 10px 12px;
          border: 1px solid transparent;
          border-radius: 10px;
          color: var(--fh-text);
          cursor: pointer;
          font-size: 14px;
          font-weight: 600;
          line-height: 20px;
          transition: background-color 160ms ease, border-color 160ms ease, color 160ms ease;
        }
        #favshub-search-switch ul li:hover { background: var(--fh-surface-soft); color: var(--fh-primary-hover); }
        #favshub-search-switch ul li.selected {
          border-color: var(--fh-border);
          background: var(--fh-surface-soft);
          color: var(--fh-primary);
          font-weight: 700;
        }
        #favshub-search-switch ul li:focus-visible,
        .bookmark-link:focus-visible,
        .tooltip-close:focus-visible {
          outline: 2px solid var(--fh-focus);
          outline-offset: 2px;
        }
        .search-icon { width: 18px; height: 18px; margin: 0 9px 0 0; object-fit: contain; }
        .search-icon-placeholder {
          display: inline-flex;
          width: 18px;
          height: 18px;
          align-items: center;
          justify-content: center;
          flex: 0 0 auto;
          margin: 0 9px 0 0;
          border-radius: 5px;
          background: var(--fh-surface-soft);
          color: var(--fh-primary);
          font-size: 11px;
          font-weight: 700;
        }
        .bookmark-item { padding: 5px !important; }
        .bookmark-link {
          display: flex;
          width: 100%;
          align-items: center;
          border-radius: 7px;
          color: inherit;
          text-decoration: none;
        }
        .bookmark-icon { width: 18px; height: 18px; flex: 0 0 auto; margin: 0 9px 0 0 !important; object-fit: contain; }
        .bookmark-title {
          overflow: hidden;
          color: var(--fh-text) !important;
          font-size: 14px;
          font-weight: 600;
          line-height: 20px;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        #favshub-bookmark-list { margin-top: 10px !important; padding: 10px 0 24px !important; border-top: 1px solid var(--fh-border); }
        .floating-empty { cursor: default !important; color: var(--fh-text-secondary) !important; font-size: 13px !important; font-weight: 500 !important; }

        .floating-tooltip {
          position: absolute;
          top: 50%;
          right: 56px;
          width: min(280px, calc(100vw - 76px));
          max-height: calc(100vh - 16px);
          max-height: calc(100dvh - 16px);
          overflow-y: auto;
          overscroll-behavior: contain;
          scrollbar-width: thin;
          padding: 14px;
          border: 1px solid var(--fh-border);
          border-radius: 12px;
          background: var(--fh-surface);
          color: var(--fh-text);
          box-shadow: var(--fh-shadow);
          opacity: 0;
          visibility: hidden;
          transform: translateY(-50%);
          transition: opacity 160ms ease, visibility 160ms;
          z-index: 2147483647;
        }
        #favshub-float-btn:hover .floating-tooltip,
        #favshub-float-btn:focus-within .floating-tooltip { opacity: 1; visibility: visible; }
        .floating-tooltip::after {
          content: "";
          position: absolute;
          top: 50%;
          right: -6px;
          width: 12px;
          height: 12px;
          border-top: 1px solid var(--fh-border);
          border-right: 1px solid var(--fh-border);
          background: var(--fh-surface);
          transform: translateY(-50%) rotate(45deg);
        }
        :host([data-edge="left"]) .floating-tooltip { right: auto; left: 56px; }
        :host([data-edge="left"]) .floating-tooltip::after {
          right: auto;
          left: -6px;
          transform: translateY(-50%) rotate(225deg);
        }
        .tooltip-content { padding-right: 20px; color: var(--fh-text); font-size: 13px; }
        .tooltip-row { display: grid; grid-template-columns: 82px 1fr; gap: 12px; align-items: center; margin: 7px 0; }
        .tooltip-action { color: var(--fh-text); font-weight: 650; white-space: nowrap; }
        .tooltip-desc { color: var(--fh-text-secondary); line-height: 1.45; }
        .tooltip-close {
          position: absolute;
          top: 7px;
          right: 7px;
          display: flex;
          width: 26px;
          height: 26px;
          align-items: center;
          justify-content: center;
          padding: 4px;
          border: 0;
          border-radius: 7px;
          background: transparent;
          color: var(--fh-text-secondary);
          cursor: pointer;
        }
        .tooltip-close:hover { background: var(--fh-surface-soft); color: var(--fh-primary); }
        .tooltip-close svg { width: 16px; height: 16px; }

        @media (max-width: 420px) {
          #favshub-sidebar { right: 8px; width: calc(100vw - 16px); border-radius: 14px; }
          :host([data-edge="left"]) #favshub-sidebar { left: 8px; }
          .floating-tooltip { right: 52px; width: min(236px, calc(100vw - 68px)); }
          :host([data-edge="left"]) .floating-tooltip { left: 52px; }
          .tooltip-row { grid-template-columns: 1fr; gap: 2px; }
          .tooltip-action { white-space: normal; }
        }
        @media (prefers-color-scheme: dark) {
          :host {
            ${cssVariables('dark')}
            --fh-focus: #6EE7B7;
            --fh-shadow: 0 16px 42px rgba(0, 0, 0, 0.48), 0 2px 10px rgba(0, 0, 0, 0.32);
            color-scheme: dark;
          }
          #favshub-float-btn { box-shadow: -4px 5px 20px rgba(0, 0, 0, 0.42); }
          :host([data-edge="left"]) #favshub-float-btn { box-shadow: 4px 5px 20px rgba(0, 0, 0, 0.42); }
        }
        @media (prefers-reduced-motion: reduce) {
          #favshub-sidebar,
          #favshub-float-btn,
          #favshub-search-switch ul li,
          .floating-tooltip { transition: none !important; }
          #favshub-float-btn:hover { width: 44px; }
        }
      `;
      shadow.appendChild(styleSheet);

      // ---- 交互 ----
      function setPanelOpen(open: boolean, focusPanel = false) {
        sidebarContainer.classList.toggle('collapsed', !open);
        sidebarContainer.setAttribute('aria-hidden', String(!open));
        floatingButton.setAttribute('aria-expanded', String(open));
        if (open) {
          void ensureData();
          if (focusPanel) {
            requestAnimationFrame(() => {
              if (host.isConnected && !sidebarContainer.classList.contains('collapsed')) {
                sidebarContainer.focus({ preventScroll: true });
              }
            });
          }
        }
      }

      function activateFloatingButton(altKey: boolean) {
        if (altKey) {
          void browser.runtime.sendMessage({ action: 'open_side_panel' });
          return;
        }
        setPanelOpen(sidebarContainer.classList.contains('collapsed'), true);
      }

      // Vertical dragging stays within the viewport and snaps to the nearest side edge.
      let floatTop = clampFloatingTop(window.innerHeight * 0.2, window.innerHeight, floatingButton.offsetHeight);
      let dragState: { pointerId: number; startX: number; startY: number; startTop: number; dragging: boolean } | null = null;
      let suppressClick = false;
      const clampFloatTop = (value: number) => clampFloatingTop(value, window.innerHeight, floatingButton.offsetHeight);
      const syncTooltipPosition = () => {
        const buttonTop = floatingButton.getBoundingClientRect().top;
        const tooltipTop = getFloatingTooltipTop(
          buttonTop,
          floatingButton.offsetHeight,
          tooltipDiv.offsetHeight,
          window.innerHeight,
        );
        tooltipDiv.style.top = `${tooltipTop}px`;
        tooltipDiv.style.transform = 'none';
      };
      const applyFloatTop = () => {
        floatTop = clampFloatTop(floatTop);
        host.style.setProperty('--fh-float-top', `${floatTop}px`);
        syncTooltipPosition();
      };
      const handleViewportResize = () => applyFloatTop();
      applyFloatTop();
      floatingButton.addEventListener('pointerenter', syncTooltipPosition);
      floatingButton.addEventListener('focusin', syncTooltipPosition);
      window.addEventListener('resize', handleViewportResize, { passive: true });

      floatingButton.addEventListener('pointerdown', (event) => {
        if (!event.isPrimary || event.button !== 0 || (event.target as HTMLElement).closest('.floating-tooltip')) return;
        dragState = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, startTop: floatTop, dragging: false };
        try { floatingButton.setPointerCapture(event.pointerId); } catch {}
      });
      floatingButton.addEventListener('pointermove', (event) => {
        if (!dragState || dragState.pointerId !== event.pointerId) return;
        if (!dragState.dragging && Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY) < 5) return;
        dragState.dragging = true;
        setPanelOpen(false);
        floatTop = dragState.startTop + event.clientY - dragState.startY;
        applyFloatTop();
        host.dataset.edge = event.clientX < window.innerWidth / 2 ? 'left' : 'right';
        event.preventDefault();
      });
      const finishDragging = (event: PointerEvent) => {
        if (!dragState || dragState.pointerId !== event.pointerId) return;
        if (dragState.dragging) {
          suppressClick = event.type === 'pointerup';
          if (event.type === 'pointerup') {
            host.dataset.edge = event.clientX < window.innerWidth / 2 ? 'left' : 'right';
          }
          applyFloatTop();
        }
        dragState = null;
        try { floatingButton.releasePointerCapture(event.pointerId); } catch {}
      };
      floatingButton.addEventListener('pointerup', finishDragging);
      floatingButton.addEventListener('pointercancel', finishDragging);

      floatingButton.addEventListener('click', (event) => {
        if (suppressClick) {
          suppressClick = false;
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        activateFloatingButton(event.altKey);
      });
      floatingButton.addEventListener('keydown', (event) => {
        if (!shouldHandleFloatingButtonKeydown(event.key, event.target, event.currentTarget)) return;
        event.preventDefault();
        activateFloatingButton(event.altKey);
      });

      sidebarContainer.addEventListener('mouseleave', () => setPanelOpen(false));
      sidebarContainer.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          setPanelOpen(false);
          floatingButton.focus({ preventScroll: true });
        }
      });

      // 选中文字缓存（事件委托，引擎列表为懒渲染）
      searchSwitcher.addEventListener('mousedown', () => {
        cachedSelectedText = getSelectedText();
      });

      searchSwitcher.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const target = e.target as HTMLElement;
        const engineItem = target.closest('#favshub-engine-list li[role="button"]') as HTMLElement | null;
        if (!engineItem) return;
        e.preventDefault();
        cachedSelectedText = getSelectedText();
        engineItem.dispatchEvent(new MouseEvent('click', { bubbles: true }));
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
        window.removeEventListener('resize', handleViewportResize);
        host.remove();
      };
    }
  },
});
