/**
 * FavsHub Mobile Drawer
 * Adds hamburger menu + sidebar drawer interaction for mobile viewports.
 * Works on both index.html (aside.custom-width) and promptpro (aside.sidebar).
 */
(function () {
  'use strict';

  var MOBILE_BP = 768;

  function qs(sel, ctx) { return (ctx || document).querySelector(sel); }

  function setup() {
    var container  = qs('#sidebar-container');
    var sidebar    = container ? (qs('aside.custom-width', container) || qs('aside.sidebar', container)) : null;
    if (!container || !sidebar) return;

    /* ---- Create overlay ---- */
    var overlay = document.createElement('div');
    overlay.className = 'mobile-sidebar-overlay';
    document.body.appendChild(overlay);

    /* ---- Create mobile header bar ---- */
    var header = document.createElement('div');
    header.className = 'mobile-header-bar';

    // Left: clone the existing sidebar brand card
    var origBrand = sidebar.querySelector('.sidebar-brand-card');
    if (origBrand) {
      var brandClone = origBrand.cloneNode(true);
      brandClone.className = 'sidebar-brand-card mobile-header-brand';
      header.appendChild(brandClone);
    }

    // Right: action buttons (PromptPro only) + hamburger
    var actionsWrap = document.createElement('div');
    actionsWrap.className = 'mobile-header-actions';

    // On PromptPro page, move favorite & create buttons to header
    if (window.location.pathname.indexOf('/promptpro/') !== -1) {
      var favBtn = document.querySelector('.btn-favorite');
      var createBtn = document.querySelector('.main-toolbar .btn-primary');
      if (favBtn) {
        favBtn.classList.add('mobile-header-action');
        actionsWrap.appendChild(favBtn);
      }
      if (createBtn) {
        createBtn.classList.add('mobile-header-action');
        actionsWrap.appendChild(createBtn);
      }
    }

    var hamburger = document.createElement('button');
    hamburger.className = 'mobile-hamburger-btn';
    hamburger.setAttribute('aria-label', 'Toggle menu');
    hamburger.setAttribute('type', 'button');
    hamburger.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none"' +
      ' stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<line x1="3" y1="6" x2="21" y2="6"/>' +
      '<line x1="3" y1="12" x2="21" y2="12"/>' +
      '<line x1="3" y1="18" x2="21" y2="18"/></svg>';
    actionsWrap.appendChild(hamburger);
    header.appendChild(actionsWrap);

    document.body.appendChild(header);

    /* ---- Helpers ---- */
    function isOpen() {
      return sidebar.classList.contains('mobile-drawer-open');
    }

    function openDrawer() {
      sidebar.classList.add('mobile-drawer-open');
      container.classList.add('mobile-drawer-open');
      overlay.classList.add('active');
      document.body.style.overflow = 'hidden';
    }

    function closeDrawer() {
      sidebar.classList.remove('mobile-drawer-open');
      container.classList.remove('mobile-drawer-open');
      overlay.classList.remove('active');
      document.body.style.overflow = '';
    }

    function toggleDrawer() {
      if (isOpen()) closeDrawer(); else openDrawer();
    }

    /* ---- Events ---- */
    hamburger.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleDrawer();
    });

    overlay.addEventListener('click', closeDrawer);

    // Close drawer on sidebar link clicks
    var links = sidebar.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      links[i].addEventListener('click', function () {
        if (window.innerWidth <= MOBILE_BP) closeDrawer();
      });
    }

    // Close on Escape
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isOpen()) closeDrawer();
    });

    // Close on swipe-left (touch gesture on the drawer)
    var touchStartX = 0;
    sidebar.addEventListener('touchstart', function (e) {
      touchStartX = e.touches[0].clientX;
    }, { passive: true });

    sidebar.addEventListener('touchmove', function (e) {
      var dx = e.touches[0].clientX - touchStartX;
      if (dx < -40 && isOpen()) {
        closeDrawer();
      }
    }, { passive: true });

    // Auto-close on resize above breakpoint; clean up body overflow
    var mql = window.matchMedia('(min-width: ' + (MOBILE_BP + 1) + 'px)');
    function onBreakpoint(e) {
      if (e.matches) {
        sidebar.classList.remove('mobile-drawer-open');
        container.classList.remove('mobile-drawer-open');
        overlay.classList.remove('active');
        document.body.style.overflow = '';
      }
    }
    if (mql.addEventListener) {
      mql.addEventListener('change', onBreakpoint);
    } else if (mql.addListener) {
      mql.addListener(onBreakpoint);   // Safari < 14
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup);
  } else {
    setup();
  }
})();
