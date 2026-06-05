/**
 * FavsHub Mobile Bottom Navigation
 * 4 tabs: 首页/提示词(互换) | 搜索 | 主题切换 | 管理后台
 *
 * 搜索：将首页原有搜索表单原封不动迁移到底部面板中，
 *       保留全部原始样式和逻辑（引擎切换、书签/提示词搜索等）。
 */
(function () {
  'use strict';

  var isPromptPro = window.location.pathname.indexOf('/promptpro/') !== -1;

  var icons = {
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
    sparkles: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
    theme: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>',
    admin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
  };

  var backdrop, sheet, sheetBody;
  var isOpen = false;
  var formMoved = false;

  function setup() {
    // ---- Bottom nav bar ----
    var nav = document.createElement('nav');
    nav.className = 'mobile-bottom-nav';

    if (isPromptPro) {
      nav.appendChild(makeTab(icons.home, '首页', '/index.html'));
    } else {
      nav.appendChild(makeTab(icons.sparkles, '提示词', '/promptpro/'));
    }

    var searchTab = makeTab(icons.search, '搜索', null);
    nav.appendChild(searchTab);

    var themeTab = makeTab(icons.theme, '主题', null);
    nav.appendChild(themeTab);

    nav.appendChild(makeTab(icons.admin, '管理', '/admin/'));

    document.body.appendChild(nav);

    // ---- Bottom sheet (search panel) ----
    backdrop = document.createElement('div');
    backdrop.className = 'mobile-search-backdrop';
    document.body.appendChild(backdrop);

    sheet = document.createElement('div');
    sheet.className = 'mobile-search-bottomsheet';

    var closeBtn = document.createElement('button');
    closeBtn.className = 'mobile-search-sheet-close';
    closeBtn.type = 'button';
    closeBtn.innerHTML = icons.close;
    closeBtn.addEventListener('click', closeSheet);

    sheetBody = document.createElement('div');
    sheetBody.className = 'mobile-search-sheet-body';

    sheet.appendChild(closeBtn);
    sheet.appendChild(sheetBody);
    document.body.appendChild(sheet);

    // ---- Events ----
    searchTab.addEventListener('click', function (e) {
      e.preventDefault();
      openSheet();
    });

    backdrop.addEventListener('click', closeSheet);

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen) closeSheet();
    });

    themeTab.addEventListener('click', function (e) {
      e.preventDefault();
      var cur = (window.FavsHubSettings && FavsHubSettings.get('theme')) || 'light';
      var next = cur === 'dark' ? 'light' : 'dark';
      if (window.FavsHubSettings) FavsHubSettings.set('theme', next);
      document.documentElement.setAttribute('data-theme', next);
      document.body.setAttribute('data-theme', next);
      if (typeof updateThemeIcon === 'function') updateThemeIcon(next === 'dark');
    });
  }

  function openSheet() {
    // Move search component into sheet on first open
    if (!formMoved) {
      if (isPromptPro) {
        // PromptPro page: move the .search-box into the sheet
        var searchBox = document.querySelector('.search-box');
        if (searchBox) sheetBody.appendChild(searchBox);
      } else {
        // Homepage: move the .search-form into the sheet
        var form = document.querySelector('.search-form');
        if (form) sheetBody.appendChild(form);
      }
      formMoved = true;
    }

    isOpen = true;
    sheet.classList.add('active');
    backdrop.classList.add('active');

    // Auto-focus the search input after animation
    setTimeout(function () {
      var input = sheetBody.querySelector('.search-input') || sheetBody.querySelector('input');
      if (input) input.focus();
    }, 350);
  }

  function closeSheet() {
    if (!isOpen) return;
    isOpen = false;

    // Blur any focused input FIRST to dismiss mobile keyboard
    var active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
      active.blur();
    }

    sheet.classList.remove('active');
    backdrop.classList.remove('active');
  }

  function makeTab(iconSvg, label, href) {
    var el = href ? document.createElement('a') : document.createElement('button');
    if (href) el.href = href;
    else el.type = 'button';
    el.className = 'mobile-nav-tab';
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
