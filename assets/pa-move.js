// "Paddle App is moving to paddleapp.github.io" banner, for the OLD site
// (deenersin-png.github.io/septa-scheduler) only. Loaded by assets/pa-menu.js.
// The mirror workflow (.github/workflows/mirror.yml) replaces this file with
// an empty one on paddleapp.github.io, so the new site never shows it.
(function () {
  'use strict';
  // Not on the staging copy (deenersin-png.github.io/paddle-staging).
  if (/^\/paddle-staging(\/|$)/.test(location.pathname)) return;
  function show() {
    if (document.getElementById('pa-move')) return;
    var b = document.createElement('div');
    b.id = 'pa-move';
    b.setAttribute('role', 'status');
    b.style.cssText = 'background:#fff4c2;color:#3a2e00;border-bottom:2px solid #e0b400;' +
      'padding:10px 14px;text-align:center;font:600 16px/1.35 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;';
    b.innerHTML = 'ℹ️ Paddle App is moving to ' +
      '<a href="https://paddleapp.github.io/?utm_source=dk" style="color:#0b4ea2;text-decoration:underline;font-weight:700">paddleapp.github.io</a>. ' +
      'Please update your bookmarks.';
    document.body.insertBefore(b, document.body.firstChild);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show);
  else show();
})();
