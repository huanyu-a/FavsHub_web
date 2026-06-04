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

    /* ---- Create hamburger button ---- */
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
    document.body.appendChild(hamburger);

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

  /* ---- Force two-column bookmark layout on mobile via inline styles ---- */
  function setupBookmarkColumns() {
    var bc = document.querySelector('.bookmarks-container');
    if (!bc) return;

    var mql = window.matchMedia('(max-width: ' + MOBILE_BP + 'px)');

    function applyTwoCol() {
      bc.style.setProperty('display', 'flex', 'important');
      bc.style.setProperty('flex-direction', 'row', 'important');
      bc.style.setProperty('flex-wrap', 'wrap', 'important');

      var children = bc.children;
      for (var i = 0; i < children.length; i++) {
        var el = children[i];
        if (el.classList.contains('bookmark-placeholder')) {
          el.style.display = 'none';
          continue;
        }
        el.style.setProperty('flex', '0 0 calc(50% - 0.25rem)', 'important');
        el.style.setProperty('max-width', 'calc(50% - 0.25rem)', 'important');
        el.style.setProperty('width', 'calc(50% - 0.25rem)', 'important');
      }
    }

    function removeTwoCol() {
      bc.style.removeProperty('display');
      bc.style.removeProperty('flex-direction');
      bc.style.removeProperty('flex-wrap');

      var children = bc.children;
      for (var i = 0; i < children.length; i++) {
        var el = children[i];
        el.style.removeProperty('flex');
        el.style.removeProperty('max-width');
        el.style.removeProperty('width');
        if (el.classList.contains('bookmark-placeholder')) {
          el.style.removeProperty('display');
        }
      }
    }

    function handleBP(e) {
      if (e.matches) {
        applyTwoCol();
      } else {
        removeTwoCol();
      }
    }

    // Initial check
    handleBP(mql);

    // Listen for viewport changes
    if (mql.addEventListener) {
      mql.addEventListener('change', handleBP);
    } else if (mql.addListener) {
      mql.addListener(handleBP);
    }

    // Re-apply when new bookmarks are added dynamically
    var observer = new MutationObserver(function () {
      if (mql.matches) applyTwoCol();
    });
    observer.observe(bc, { childList: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupBookmarkColumns);
  } else {
    setupBookmarkColumns();
  }
})();
