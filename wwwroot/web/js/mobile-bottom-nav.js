/**
 * FavsHub Mobile Bottom Navigation
 * 5 tabs: 首页 | 提示词/首页 | 搜索聚合 | 主题切换 | 管理后台
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
    admin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>'
  };

  function qs(sel, ctx) { return (ctx || document).querySelector(sel); }

  function setup() {
    /* ---- Build bottom nav ---- */
    var nav = document.createElement('nav');
    nav.className = 'mobile-bottom-nav';

    // 1. 首页
    var homeTab = createTab(icons.home, '首页', '/index.html', !isPromptPro);
    nav.appendChild(homeTab);

    // 2. 提示词 / 首页 (swap)
    if (isPromptPro) {
      nav.appendChild(createTab(icons.home, '首页', '/index.html', false));
    } else {
      nav.appendChild(createTab(icons.sparkles, '提示词', '/promptpro/', false));
    }

    // 3. 搜索聚合
    var searchTab = createTab(icons.search, '搜索', null, false);
    searchTab.classList.add('mobile-nav-search-tab');
    nav.appendChild(searchTab);

    // 4. 主题切换
    var themeTab = createTab(icons.theme, '主题', null, false);
    nav.appendChild(themeTab);

    // 5. 管理后台
    var adminTab = createTab(icons.admin, '管理', '/admin/', false);
    nav.appendChild(adminTab);

    document.body.appendChild(nav);

    /* ---- Search panel ---- */
    var searchPanel = document.createElement('div');
    searchPanel.className = 'mobile-search-panel';
    searchPanel.innerHTML =
      '<div class="mobile-search-header">' +
        '<div class="mobile-search-input-wrap">' +
          icons.search +
          '<input type="text" id="mobileSearchInput" placeholder="搜索..." autocomplete="off">' +
        '</div>' +
        '<button class="mobile-search-close" aria-label="关闭">' + icons.close + '</button>' +
      '</div>' +
      '<div class="mobile-search-results" id="mobileSearchResults"></div>';
    document.body.appendChild(searchPanel);

    var searchOpen = false;

    function openSearch() {
      searchOpen = true;
      searchPanel.classList.add('active');
      nav.classList.add('search-active');
      var inp = qs('#mobileSearchInput');

      // On homepage, try to reuse existing search
      if (!isPromptPro) {
        var mainInput = qs('.search-input');
        if (mainInput) {
          inp.placeholder = mainInput.placeholder || '搜索...';
        }
      }
      setTimeout(function () { inp.focus(); }, 200);
    }

    function closeSearch() {
      searchOpen = false;
      searchPanel.classList.remove('active');
      nav.classList.remove('search-active');
      qs('#mobileSearchInput').value = '';
      qs('#mobileSearchResults').innerHTML = '';
    }

    // Search tab click
    searchTab.addEventListener('click', function (e) {
      e.preventDefault();
      if (searchOpen) closeSearch(); else openSearch();
    });

    // Close button
    qs('.mobile-search-close').addEventListener('click', closeSearch);

    // Search input handler
    var searchInput = qs('#mobileSearchInput');
    var debounceTimer = null;
    searchInput.addEventListener('input', function () {
      clearTimeout(debounceTimer);
      var query = searchInput.value.trim();
      if (!query) {
        qs('#mobileSearchResults').innerHTML = '';
        return;
      }
      debounceTimer = setTimeout(function () {
        performSearch(query);
      }, 300);
    });

    searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        var query = searchInput.value.trim();
        if (!query) return;
        // On homepage, submit to existing search
        if (!isPromptPro) {
          var mainInput = qs('.search-input');
          var mainForm = qs('#search-form');
          if (mainInput && mainForm) {
            mainInput.value = query;
            mainForm.dispatchEvent(new Event('submit', { bubbles: true }));
            closeSearch();
            return;
          }
        }
        // On promptpro, trigger promptpro search
        if (isPromptPro) {
          var ppInput = qs('#searchInput');
          if (ppInput) {
            ppInput.value = query;
            ppInput.dispatchEvent(new Event('input', { bubbles: true }));
            closeSearch();
          }
        }
      }
    });

    function performSearch(query) {
      var resultsEl = qs('#mobileSearchResults');
      resultsEl.innerHTML = '<div class="mobile-search-loading">搜索中...</div>';

      if (isPromptPro) {
        // Search prompts via the promptpro search
        var ppInput = qs('#searchInput');
        if (ppInput) {
          ppInput.value = query;
          ppInput.dispatchEvent(new Event('input', { bubbles: true }));
          // Collect visible prompt cards
          setTimeout(function () {
            var cards = document.querySelectorAll('#promptsGrid .prompt-card');
            if (cards.length === 0) {
              resultsEl.innerHTML = '<div class="mobile-search-empty">无匹配结果</div>';
              return;
            }
            var html = '';
            for (var i = 0; i < cards.length && i < 20; i++) {
              var title = cards[i].querySelector('.prompt-title');
              var desc = cards[i].querySelector('.prompt-desc');
              html += '<div class="mobile-search-item">' +
                '<div class="mobile-search-item-title">' + (title ? title.textContent : '') + '</div>' +
                '<div class="mobile-search-item-desc">' + (desc ? desc.textContent : '') + '</div>' +
                '</div>';
            }
            resultsEl.innerHTML = html;
          }, 200);
        }
      } else {
        // Homepage: search bookmarks via API
        var token = localStorage.getItem('favshub_token') || localStorage.getItem('fh_local_favshub_token');
        var headers = {};
        if (token) headers['Authorization'] = 'Bearer ' + token;

        fetch('/api/bookmarks/search?q=' + encodeURIComponent(query), { headers: headers })
          .then(function (r) { return r.json(); })
          .then(function (data) {
            var items = data.results || data || [];
            if (!items.length) {
              resultsEl.innerHTML = '<div class="mobile-search-empty">无匹配结果</div>';
              return;
            }
            var html = '';
            for (var i = 0; i < items.length && i < 20; i++) {
              var bm = items[i];
              html += '<a class="mobile-search-item" href="' + (bm.url || '#') + '" target="_blank">' +
                '<div class="mobile-search-item-title">' + (bm.title || bm.name || '') + '</div>' +
                '<div class="mobile-search-item-desc">' + (bm.url || '') + '</div>' +
                '</a>';
            }
            resultsEl.innerHTML = html;
          })
          .catch(function () {
            resultsEl.innerHTML = '<div class="mobile-search-empty">搜索失败</div>';
          });
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

    /* ---- Listen for breakpoint changes ---- */
    var mql = window.matchMedia('(min-width: ' + (MOBILE_BP + 1) + 'px)');
    function onBP(e) {
      if (e.matches) {
        closeSearch();
      }
    }
    if (mql.addEventListener) mql.addEventListener('change', onBP);
    else if (mql.addListener) mql.addListener(onBP);
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
