import { enableFloatingBallStorage, baseUrlStorage, tokenStorage } from '@/utils/storage';

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

/** Validate that a URL uses http or https protocol only */
function isSafeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export default defineContentScript({
  matches: ['<all_urls>'],
  run_at: 'document_idle',
  async main(ctx) {
    const baseUrl = await baseUrlStorage.getValue();
    if (!baseUrl?.trim()) return;
    const serverUrl = baseUrl.replace(/\/+$/, '');

    // ---- Cleanup: remove stale instance if script was re-injected ----
    const existing = document.getElementById('favshub-ext');
    if (existing) existing.remove();

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
      const s = window.getSelection();
      if (!s || s.rangeCount === 0) return '';
      const r = s.getRangeAt(0);
      if (extensionContainer.contains(r.commonAncestorContainer)) return '';
      return s.toString().trim();
    }

    function getSearchQuery(): string {
      const p = new URLSearchParams(window.location.search);
      return p.get('q') || p.get('p') || p.get('text') || p.get('wd') || '';
    }

    let cachedSelectedText = '';
    function getSearchText(): string {
      return cachedSelectedText || getSearchQuery() || getSelectedText() || '';
    }

    // ---- 获取搜索引擎列表 ----
    let engines: Array<{ name: string; label: string; url: string; icon: string; category: string; is_default?: number }> = [];
    try {
      const token = await tokenStorage.getValue();
      const resp = await proxyFetch(`${serverUrl}/api/search-engines`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = JSON.parse(resp.body);
      engines = data.data?.engines || data.engines || data.data || [];
    } catch {}

    // 过滤：只显示 is_default 的引擎（与网站搜索栏一致），如果全都没标记则显示全部
    const visibleEngines = engines.some(e => e.is_default)
      ? engines.filter(e => e.is_default)
      : engines;

    // 优先用 is_default，否则回退到当前域名匹配
    const currentEngineName = getCurrentSearchEngine();
    const defaultEngineName = visibleEngines.find(e => e.is_default)?.name || currentEngineName;

    function buildEngineListHtml(): string {
      if (!visibleEngines.length) return '';
      return visibleEngines.map((eng) => {
        const sel = eng.name.toLowerCase() === defaultEngineName.toLowerCase() ? ' class="selected"' : '';
        let iconSrc = '';
        if (eng.icon) {
          if (eng.icon.startsWith('http') && isSafeUrl(eng.icon)) iconSrc = eng.icon;
          else if (eng.icon.startsWith('/')) iconSrc = serverUrl + eng.icon;
          else iconSrc = `${serverUrl}/images/${eng.icon}`;
        }
        const safeLabel = escapeHtml(eng.label || eng.name || '');
        const safeName = escapeHtml(eng.name || '');
        const safeUrl = isSafeUrl(eng.url) ? escapeHtml(eng.url) : '';
        const iconHtml = iconSrc
          ? `<img src="${escapeHtml(iconSrc)}" alt="${safeLabel}" class="search-icon">`
          : `<span class="search-icon-placeholder">${safeLabel.charAt(0) || '?'}</span>`;
        return `<li data-url="${safeUrl}" data-name="${safeName}"${sel}>${iconHtml}<span>${safeLabel}</span></li>`;
      }).join('');
    }

    // ---- 获取书签 ----
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
              ${faviconUrl ? `<img src="${escapeHtml(faviconUrl)}" alt="" class="bookmark-icon" onerror="this.style.display='none'">` : ''}
              <span class="bookmark-title">${safeTitle}</span>
            </a>
          </li>`;
        }).join('');
      } catch { return ''; }
    }

    // ---- 容器（和旧版一样直接注入 body） ----
    const extensionContainer = document.createElement('div');
    extensionContainer.id = 'favshub-ext';
    document.body.appendChild(extensionContainer);

    // ---- 悬浮按钮 ----
    const floatingButton = document.createElement('div');
    floatingButton.id = 'favshub-float-btn';
    // 获取扩展图标 — 通过 background 转换 data URL（content script 无法直接访问 chrome-extension://）
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
    if (iconDataUrl) {
      const iconImg = document.createElement('img');
      iconImg.className = 'floating-button-icon';
      iconImg.alt = 'FavsHub';
      iconImg.src = iconDataUrl;
      floatingButton.appendChild(iconImg);
    } else {
      // Fallback
      const fallback = document.createElement('span');
      fallback.className = 'floating-button-icon';
      fallback.textContent = '⭐';
      floatingButton.appendChild(fallback);
    }

    const tooltipDiv = document.createElement('div');
    tooltipDiv.className = 'floating-tooltip';
    tooltipDiv.innerHTML = `
      <div class="tooltip-content">
        <div class="tooltip-row">
          <span class="tooltip-action">点击</span>
          <span class="tooltip-desc">展开搜索面板</span>
        </div>
        <div class="tooltip-row">
          <span class="tooltip-action">Alt+点击</span>
          <span class="tooltip-desc">打开侧边栏</span>
        </div>
        <div class="tooltip-row">
          <span class="tooltip-action">Alt+B</span>
          <span class="tooltip-desc">打开/关闭侧边栏</span>
        </div>
      </div>
      <button class="tooltip-close" title="不再显示">
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
    const engineHtml = buildEngineListHtml();
    searchSwitcher.innerHTML = `
      <ul>${engineHtml}</ul>
      <ul id="favshub-bookmark-list"><li style="padding:8px 16px;color:#999;font-size:13px;">加载中...</li></ul>
    `;
    sidebarContainer.appendChild(searchSwitcher);

    extensionContainer.appendChild(floatingButton);
    extensionContainer.appendChild(sidebarContainer);

    // ---- 加载书签 ----
    loadBookmarks().then((html) => {
      const list = sidebarContainer.querySelector('#favshub-bookmark-list');
      if (list) list.innerHTML = html || '<li style="padding:8px 16px;color:#999;font-size:13px;">暂无书签</li>';
    });

    // ---- 样式（所有选择器加 #favshub-ext 前缀，防止泄漏） ----
    const styleSheet = document.createElement('style');
    styleSheet.textContent = `
      #favshub-ext #favshub-sidebar {
        position: fixed !important; top: 0; right: 0; width: 280px !important; height: 100vh;
        background-color: #ffffff; box-shadow: -2px 0 5px rgba(0,0,0,0.1);
        transition: transform 0.3s ease; transform: translateX(100%);
        z-index: 2147483647 !important; padding: 8px; overflow-y: auto;
      }
      #favshub-ext #favshub-sidebar.collapsed { transform: translateX(100%) !important; }
      #favshub-ext #favshub-sidebar:not(.collapsed) { transform: translateX(0) !important; }

      #favshub-ext #favshub-float-btn {
        position: fixed !important; width: 40px; height: 40px; top: 20%; right: 0;
        border-radius: 20px 0 0 20px;
        display: flex; align-items: center; justify-content: center;
        cursor: pointer; z-index: 2147483647 !important;
        user-select: none; box-shadow: -2px 0 5px rgba(0,0,0,0.1);
        transition: width 0.2s;
      }
      #favshub-ext #favshub-float-btn:hover { width: 60px; }
      #favshub-ext .floating-button-icon { max-width: 24px; max-height: 24px; flex-shrink: 0; pointer-events: none; display: block; }

      #favshub-ext #favshub-search-switch { height: 100%; display: flex; flex-direction: column; align-items: flex-start; width: 100%; background-color: #ffffff; overflow: auto; padding: 20px 0 0 0; }
      #favshub-ext #favshub-search-switch ul { list-style-type: none; padding: 0; width: 100%; margin: 0; }
      #favshub-ext #favshub-search-switch ul li {
        display: flex; position: relative; font-size: 14px; font-weight: 600; color: #1a202c;
        line-height: 20px; padding: 8px 16px; margin: 4px 8px !important;
        align-items: center; cursor: pointer; border-radius: 8px;
        transition: background-color 0.3s, color 0.3s;
      }
      #favshub-ext #favshub-search-switch ul li:hover { background-color: #f0f0f0; color: #4285f4; }
      #favshub-ext #favshub-search-switch ul li.selected { background-color: #e2e8f0; font-weight: bold; color: #4285f4; }

      #favshub-ext .search-icon { height: 16px; margin: 0 8px 0 0; }
      #favshub-ext .search-icon-placeholder {
        display: inline-flex; align-items: center; justify-content: center;
        width: 16px; height: 16px; margin: 0 8px 0 0;
        font-size: 11px; font-weight: 700; color: #666;
        background: #e5e7eb; border-radius: 3px;
      }

      #favshub-ext .bookmark-item { display: flex; align-items: center; margin: 4px 8px !important; padding: 8px 16px; cursor: pointer; transition: background-color 0.3s; }
      #favshub-ext .bookmark-item:hover { background-color: #f0f0f0; }
      #favshub-ext .bookmark-icon { width: 16px; height: 16px; margin: 0 8px 0 0 !important; }
      #favshub-ext .bookmark-link { display: flex; align-items: center; width: 100%; text-decoration: none; color: inherit; }
      #favshub-ext .bookmark-title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 14px; font-weight: 600; color: #1a202c !important; line-height: 20px; }
      #favshub-ext #favshub-bookmark-list { padding: 16px 0 60px 0 !important; }

      #favshub-ext .floating-tooltip {
        position: absolute; right: 50px; top: 50%; transform: translateY(-50%);
        background: white; border-radius: 8px; padding: 16px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.15); width: 280px;
        opacity: 0; visibility: hidden; transition: opacity 0.2s, visibility 0.2s;
        z-index: 2147483647;
      }
      #favshub-ext #favshub-float-btn:hover .floating-tooltip { opacity: 1; visibility: visible; }
      #favshub-ext .floating-tooltip:after {
        content: ''; position: absolute; right: -6px; top: 50%;
        transform: translateY(-50%) rotate(45deg); width: 12px; height: 12px;
        background: white; box-shadow: 3px -3px 3px rgba(0,0,0,0.05);
      }
      #favshub-ext .tooltip-content { font-size: 13px; color: #333; padding-right: 24px; }
      #favshub-ext .tooltip-row { display: grid; grid-template-columns: 100px 1fr; gap: 24px; align-items: center; margin: 8px 0; }
      #favshub-ext .tooltip-action { font-weight: 600; color: #666; white-space: nowrap; }
      #favshub-ext .tooltip-desc { color: #666; line-height: 1.4; }
      #favshub-ext .tooltip-close {
        position: absolute; top: 8px; right: 8px; width: 24px; height: 24px; padding: 4px;
        display: flex; align-items: center; justify-content: center;
        cursor: pointer; border: none; background: transparent; border-radius: 4px; color: #888;
      }
      #favshub-ext .tooltip-close:hover { background: rgba(0,0,0,0.05); color: #666; }
      #favshub-ext .tooltip-close svg { width: 16px; height: 16px; }

      #favshub-ext * { user-select: none; -webkit-user-select: none; }

      @media (prefers-color-scheme: dark) {
        #favshub-ext #favshub-sidebar, #favshub-ext #favshub-search-switch { background-color: #1e1e2e; }
        #favshub-ext #favshub-float-btn { }
        #favshub-ext #favshub-float-btn:hover { }
        #favshub-ext #favshub-search-switch ul li, #favshub-ext .bookmark-title { color: #e0e0e0 !important; }
        #favshub-ext #favshub-search-switch ul li:hover { background-color: rgba(255,255,255,0.1); color: #4285f4 !important; }
        #favshub-ext .bookmark-item:hover { background-color: rgba(255,255,255,0.1); }
        #favshub-ext .floating-tooltip { background: #1f2937; }
        #favshub-ext .floating-tooltip:after { background: #1f2937; }
        #favshub-ext .tooltip-action { color: #e5e7eb; }
        #favshub-ext .tooltip-desc { color: #9ca3af; }
      }
    `;
    extensionContainer.appendChild(styleSheet);

    // ---- 交互 ----
    floatingButton.addEventListener('click', (e) => {
      if (e.altKey) {
        browser.runtime.sendMessage({ action: 'open_side_panel' });
      } else {
        sidebarContainer.classList.toggle('collapsed');
      }
    });

    sidebarContainer.addEventListener('mouseleave', () => {
      sidebarContainer.classList.add('collapsed');
    });

    // 搜索引擎点击
    searchSwitcher.querySelectorAll('li[data-url]').forEach((item) => {
      item.addEventListener('mousedown', () => { cachedSelectedText = getSelectedText(); });
      item.addEventListener('click', () => {
        const text = getSearchText();
        const url = (item as HTMLElement).getAttribute('data-url');
        if (url && text && isSafeUrl(url)) {
          window.open(url + encodeURIComponent(text), '_blank');
          searchSwitcher.querySelectorAll('li').forEach((li) => li.classList.remove('selected'));
          item.classList.add('selected');
        }
      });
    });

    // 书签点击
    searchSwitcher.addEventListener('click', (e) => {
      const link = (e.target as HTMLElement).closest('a.bookmark-link') as HTMLAnchorElement;
      if (link && isSafeUrl(link.href)) { e.preventDefault(); window.open(link.href, '_blank'); }
    });

    // 关闭 tooltip
    const closeBtn = floatingButton.querySelector('.tooltip-close');
    closeBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      const tip = floatingButton.querySelector('.floating-tooltip') as HTMLElement;
      if (tip) tip.style.display = 'none';
    });

    // ---- 设置监听 ----
    enableFloatingBallStorage.watch((v) => {
      extensionContainer.style.display = v ? 'block' : 'none';
      if (!v) sidebarContainer.classList.add('collapsed');
    });
    const initEnabled = await enableFloatingBallStorage.getValue();
    if (!initEnabled) extensionContainer.style.display = 'none';

    browser.runtime.onMessage.addListener((msg: any) => {
      if (msg?.action === 'updateFloatingBall') {
        extensionContainer.style.display = msg.enabled ? 'block' : 'none';
      }
    });

    // ---- Cleanup on script invalidation/disconnect ----
    ctx.onInvalidated(() => {
      extensionContainer.remove();
    });
  },
});
