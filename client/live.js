// Live player count: pings /api/presence every 60 s while the tab is visible and someone is actually there
// (any key, tap or mouse move in the last 10 minutes), and keeps `Live.count` up to date. If the endpoint is
// missing, not configured or over its free quota, the count is simply not shown.
'use strict';
(function () {
  const el = document.getElementById('live');
  // a fresh random id per page load, so a reload's "leave" can never remove the new page
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  const id = Array.from(b, (x) => x.toString(36).padStart(2, '0')).join('').slice(0, 20);
  const PING_MS = 60000, IDLE_MS = 10 * 60000;
  let count = null, stopped = false, timer = 0, lastActive = Date.now(), sleeping = false;

  function show(n) {
    count = n;
    if (!el) return;
    el.textContent = n === 1 ? '1 playing now' : n.toLocaleString('en-IN') + ' playing now';
    el.classList.toggle('on', n != null);
  }
  function hide() { count = null; if (el) el.classList.remove('on'); }

  async function beat() {
    if (stopped || document.hidden) return;
    if (Date.now() - lastActive > IDLE_MS) { if (!sleeping) { sleeping = true; leave(); hide(); } return; } // idle tab: stop counting it
    try {
      const r = await fetch('/api/presence', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) });
      if (r.status === 404 || r.status === 405 || r.status === 503) { stopped = true; clearInterval(timer); hide(); return; } // no backend here
      if (!r.ok) { hide(); return; }
      const j = await r.json();
      if (typeof j.online === 'number') show(Math.max(1, j.online));
    } catch (e) { hide(); }
  }
  function leave() {
    if (stopped || !navigator.sendBeacon) return;
    navigator.sendBeacon('/api/presence', new Blob([JSON.stringify({ id, leave: true })], { type: 'application/json' }));
  }

  document.addEventListener('visibilitychange', () => { if (document.hidden) leave(); else beat(); });
  addEventListener('pagehide', leave);
  const wake = () => { lastActive = Date.now(); if (sleeping) { sleeping = false; beat(); } };
  for (const ev of ['keydown', 'pointerdown', 'pointermove', 'touchstart']) addEventListener(ev, wake, { passive: true });
  timer = setInterval(beat, PING_MS);
  beat();

  window.Live = { get count() { return count; } };
})();
