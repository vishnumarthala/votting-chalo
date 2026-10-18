// Input: keyboard (WASD/arrows), mouse (hold to walk toward the pointer, right button to run) and touch
// (drag anywhere on the left to steer, drag far to run; buttons for SLOGAN and RUN).
'use strict';
(function () {
  const KEYS = { KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', ShiftLeft: 'run', ShiftRight: 'run', Space: 'act', KeyE: 'act', Enter: 'act' };
  const held = { up: false, down: false, left: false, right: false, run: false };
  let actLatch = false, enabled = false;
  const mouse = { down: false, run: false, x: 0, y: 0 };
  const stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
  let runBtn = false;
  const meta = [];
  const isTouch = matchMedia('(hover:none) and (pointer:coarse)').matches || 'ontouchstart' in window;
  const inField = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

  addEventListener('keydown', (e) => {
    if (inField(e.target)) return;
    for (const h of meta) if (h(e) === true) { e.preventDefault(); return; }
    if (!enabled) return;
    const k = KEYS[e.code];
    if (!k) return;
    e.preventDefault();
    if (k === 'act') { if (!e.repeat) actLatch = true; return; }
    held[k] = true;
  });
  addEventListener('keyup', (e) => { const k = KEYS[e.code]; if (k && k !== 'act') held[k] = false; });
  const releaseAll = () => { for (const k in held) held[k] = false; mouse.down = mouse.run = false; stick.id = null; runBtn = false; };
  addEventListener('blur', releaseAll);

  function bindCanvas(cv) {
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerdown', (e) => {
      if (!enabled) return;
      if (window.SFX) window.SFX.init();
      if (e.pointerType === 'touch') {
        if (stick.id === null && e.clientX < innerWidth * 0.6) {
          stick.id = e.pointerId; stick.ox = stick.x = e.clientX; stick.oy = stick.y = e.clientY;
        } else actLatch = true; // second finger / right side tap: slogan
        cv.setPointerCapture(e.pointerId);
        return;
      }
      mouse.x = e.clientX; mouse.y = e.clientY;
      if (e.button === 2) mouse.run = true; else if (e.button === 0) mouse.down = true;
      cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointermove', (e) => {
      if (e.pointerId === stick.id) { stick.x = e.clientX; stick.y = e.clientY; return; }
      if (e.pointerType !== 'touch') { mouse.x = e.clientX; mouse.y = e.clientY; }
    });
    const up = (e) => {
      if (e.pointerId === stick.id) { stick.id = null; return; }
      if (e.pointerType !== 'touch') { if (e.button === 2) mouse.run = false; else mouse.down = false; }
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
  }
  function bindButtons() {
    const btn = (id, down, upFn) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); el.setPointerCapture(e.pointerId); el.classList.add('down'); if (window.SFX) window.SFX.init(); down(); });
      const u = () => { el.classList.remove('down'); if (upFn) upFn(); };
      el.addEventListener('pointerup', u); el.addEventListener('pointercancel', u); el.addEventListener('lostpointercapture', u);
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    };
    btn('bAct', () => { actLatch = true; });
    btn('bRun', () => { runBtn = true; }, () => { runBtn = false; });
  }

  window.Input = {
    isTouch,
    setEnabled(on) { enabled = on; if (!on) releaseAll(); },
    onMeta(fn) { meta.push(fn); },
    bind(cv) { bindCanvas(cv); bindButtons(); },
    // playerScreen: player's position on screen, for mouse steering
    frame(playerScreen) {
      let mx = (held.right ? 1 : 0) - (held.left ? 1 : 0), my = (held.down ? 1 : 0) - (held.up ? 1 : 0);
      let run = held.run || mouse.run || runBtn;
      if (!mx && !my && mouse.down && playerScreen) {
        const dx = mouse.x - playerScreen.x, dy = mouse.y - playerScreen.y, d = Math.hypot(dx, dy);
        if (d > 14) { mx = dx / d; my = dy / d; }
      }
      if (!mx && !my && stick.id !== null) {
        const dx = stick.x - stick.ox, dy = stick.y - stick.oy, d = Math.hypot(dx, dy);
        if (d > 8) { const k = Math.min(1, d / 50); mx = (dx / d) * k; my = (dy / d) * k; if (d > 85) run = true; }
      }
      const m = Math.hypot(mx, my);
      if (m > 1) { mx /= m; my /= m; }
      const f = { mx, my, run, act: actLatch };
      actLatch = false;
      return f;
    },
    get stick() { return stick.id !== null ? { ox: stick.ox, oy: stick.oy, x: stick.x, y: stick.y } : null; },
  };
})();
