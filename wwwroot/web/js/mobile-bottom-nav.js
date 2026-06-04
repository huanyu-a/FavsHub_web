/**
 * FavsHub Mobile Bottom Navigation
 * 4 tabs: 首页/提示词(互换) | 搜索聚合 | 主题切换 | 管理后台
 *
 * 搜索聚合：
 *   - 首页：滚动到顶部并聚焦搜索框（复用完整搜索引擎功能）
 *   - 提示词页：跳回首页并携带搜索参数，首页自动触发搜索
 */
(function () {
  'use strict';

  var MOBILE_BP = 768;
  var isPromptPro = window.location.pathname.indexOf('/promptpro/') !== -1;

  /* ---- SVG Icons ---- */
  var icons = {
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
    sparkles: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
    theme: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>',
    admin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>'
  };

  function qs(sel, ctx) { return (ctx || document).querySelector(sel); }

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

    // 2. 搜索聚合
    var searchTab = createTab(icons.search, '搜索', null, false);
    nav.appendChild(searchTab);

    // 3. 主题切换
    var themeTab = createTab(icons.theme, '主题', null, false);
    nav.appendChild(themeTab);

    // 4. 管理后台
    var adminTab = createTab(icons.admin, '管理', '/admin/', false);
    nav.appendChild(adminTab);

    document.body.appendChild(nav);

    /* ---- Search tab: reuse homepage search ---- */
    searchTab.addEventListener('click', function (e) {
      e.preventDefault();
      if (isPromptPro) {
        // On promptpro page: go to homepage with search focus
        window.location.href = '/index.html?focus_search=1';
      } else {
        // On homepage: scroll to top and focus the search input
        window.scrollTo({ top: 0, behavior: 'smooth' });
        setTimeout(function () {
          var mainInput = qs('.search-input');
          if (mainInput) {
            mainInput.focus();
            mainInput.click();
          }
        }, 300);
      }
    });

    /* ---- Homepage: auto-focus search if redirected from promptpro ---- */
    if (!isPromptPro) {
      var params = new URLSearchParams(window.location.search);
      if (params.get('focus_search') === '1') {
        // Clean up URL
        window.history.replaceState({}, '', '/index.html');
        // Wait for page to be ready, then focus search
        setTimeout(function () {
          var mainInput = qs('.search-input');
          if (mainInput) {
            mainInput.focus();
            mainInput.click();
          }
        }, 500);
      }
    }

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
