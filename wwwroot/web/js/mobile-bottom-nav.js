/**
 * FavsHub Mobile Bottom Navigation
 * 4 tabs: 首页/提示词(互换) | 搜索 | 主题切换 | 管理后台
 *
 * 搜索功能：
 *   - 首页：将原搜索表单迁移到底部弹窗中（保留完整搜索引擎功能）
 *   - 提示词页：在弹窗中显示简单搜索输入框，过滤提示词
 */
(function () {
  'use strict';

  var isPromptPro = window.location.pathname.indexOf('/promptpro/') !== -1;

  /* ---- SVG Icons ---- */
  var icons = {
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
    sparkles: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
    theme: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>',
    admin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
  };

  function qs(sel, ctx) { return (ctx || document).querySelector(sel); }

  var popupOpen = false;
  var backdrop, sheet;
  var formRelocated = false;

  function setup() {
    /* ---- Build bottom nav ---- */
    var nav = document.createElement('nav');
    nav.className = 'mobile-bottom-nav';

    // 1. 首页 / 提示词 (swap based on current page)
    if (isPromptPro) {
      nav.appendChild(createTab(icons.home, '首页', '/index.html', false));
    } else {
      nav.appendChild(createTab(icons.sparkles, '提示词', '/promptpro/', false));
    }

    // 2. 搜索
    var searchTab = createTab(icons.search, '搜索', null, false);
    nav.appendChild(searchTab);

    // 3. 主题切换
    var themeTab = createTab(icons.theme, '主题', null, false);
    nav.appendChild(themeTab);

    // 4. 管理后台
    var adminTab = createTab(icons.admin, '管理', '/admin/', false);
    nav.appendChild(adminTab);

    document.body.appendChild(nav);

    /* ---- Build search bottom sheet ---- */
    backdrop = document.createElement('div');
    backdrop.className = 'mobile-search-backdrop';
    document.body.appendChild(backdrop);

    sheet = document.createElement('div');
    sheet.className = 'mobile-search-bottomsheet';

    // Header
    var header = document.createElement('div');
    header.className = 'mobile-search-sheet-header';

    var title = document.createElement('span');
    title.className = 'mobile-search-sheet-title';
    title.textContent = '搜索';

    var closeBtn = document.createElement('button');
    closeBtn.className = 'mobile-search-sheet-close';
    closeBtn.type = 'button';
    closeBtn.innerHTML = icons.close;

    header.appendChild(title);
    header.appendChild(closeBtn);

    // Body
    var body = document.createElement('div');
    body.className = 'mobile-search-sheet-body';

    sheet.appendChild(header);
    sheet.appendChild(body);
    document.body.appendChild(sheet);

    /* ---- Search tab click ---- */
    searchTab.addEventListener('click', function (e) {
      e.preventDefault();
      openSearchPopup(body);
    });

    /* ---- Close handlers ---- */
    closeBtn.addEventListener('click', closeSearchPopup);
    backdrop.addEventListener('click', closeSearchPopup);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && popupOpen) closeSearchPopup();
    });

    /* ---- Theme toggle ---- */
    themeTab.addEventListener('click', function (e) {
      e.preventDefault();
      var current = (window.FavsHubSettings && FavsHubSettings.get('theme')) || 'light';
      var newTheme = current === 'dark' ? 'light' : 'dark';
      if (window.FavsHubSettings) FavsHubSettings.set('theme', newTheme);
      document.documentElement.setAttribute('data-theme', newTheme);
      document.body.setAttribute('data-theme', newTheme);
      if (typeof updateThemeIcon === 'function') updateThemeIcon(newTheme === 'dark');
    });
  }

  /**
   * Open the search bottom sheet popup.
   * On homepage: moves the existing search form into the popup (preserves engine switching, suggestions, etc.)
   * On PromptPro: creates a simple search input that filters prompts.
   */
  function openSearchPopup(body) {
    if (!popupOpen) {
      if (isPromptPro) {
        setupPromptProSearch(body);
      } else {
        setupHomepageSearch(body);
      }
    }

    popupOpen = true;
    sheet.classList.add('active');
    backdrop.classList.add('active');

    // Auto-focus the input
    setTimeout(function () {
      var input = qs('.search-input', sheet) || qs('input', sheet);
      if (input) input.focus();
    }, 350);
  }

  function closeSearchPopup() {
    popupOpen = false;
    sheet.classList.remove('active');
    backdrop.classList.remove('active');
  }

  /**
   * Homepage: move the existing search form into the popup body.
   * The form retains all its event listeners and functionality
   * (engine switching, search suggestions, bookmark/prompt search, etc.)
   */
  function setupHomepageSearch(body) {
    if (formRelocated) return;
    var form = qs('.search-form');
    if (form) {
      body.appendChild(form);
      formRelocated = true;
    }
  }

  /**
   * PromptPro: create a simple search input in the popup.
   * Typing filters the prompt list on the page.
   */
  function setupPromptProSearch(body) {
    var wrap = document.createElement('div');
    wrap.className = 'mobile-promptpro-search';
    wrap.innerHTML = icons.search;

    var input = document.createElement('input');
    input.type = 'text';
    input.placeholder = '搜索提示词...';

    wrap.appendChild(input);
    body.appendChild(wrap);

    // Sync with the native PromptPro search input
    var nativeInput = document.getElementById('searchInput');
    input.addEventListener('input', function () {
      if (nativeInput) {
        nativeInput.value = input.value;
        nativeInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    // On Enter, also trigger native search and close popup
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (nativeInput) {
          nativeInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        closeSearchPopup();
      }
    });
  }

  function createTab(iconSvg, label, href, isActive) {
    var el;
    if (href) {
      el = document.createElement('a');
      el.href = href;
    } else {
      el = document.createElement('button');
      el.type = 'button';
    }
    el.className = 'mobile-nav-tab' + (isActive ? ' active' : '');
    el.innerHTML = '<span class="mobile-nav-icon">' + iconSvg + '</span>' +
                   '<span class="mobile-nav-label">' + label + '</span>';
    return el;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }
})();
