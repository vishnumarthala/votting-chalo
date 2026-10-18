// Heads-up display (screen space): status, minimap, documents, objective arrow, missions, toasts, cards.
'use strict';
(function () {
  const toasts = [];
  let tier = null, time = 0;

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function text(ctx, s, x, y, size, color, align, weight) {
    ctx.font = `${weight || 800} ${size}px system-ui,-apple-system,"Segoe UI",sans-serif`;
    ctx.textAlign = align || 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = color || '#fff'; ctx.fillText(s, x, y);
  }
  const panel = (ctx, x, y, w, h) => { ctx.fillStyle = 'rgba(20,14,8,.66)'; rr(ctx, x, y, w, h, 10); ctx.fill(); };
  function bar(ctx, x, y, w, h, v, color) {
    ctx.fillStyle = 'rgba(255,255,255,.18)'; rr(ctx, x, y, w, h, h / 2); ctx.fill();
    if (v > 0) { ctx.fillStyle = color; rr(ctx, x, y, Math.max(h, w * Math.min(1, v)), h, h / 2); ctx.fill(); }
  }
  const fmt = (s) => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  function clockStr(G) {
    const M = G.M, mins = Math.floor(M.clockStart + (M.clockEnd - M.clockStart) * (G.elapsed / M.time));
    const h = Math.floor(mins / 60), m = mins % 60;
    return ((h + 11) % 12 + 1) + ':' + String(m).padStart(2, '0') + (h >= 12 ? ' PM' : ' AM');
  }
  function wrap(ctx, s, maxW) {
    const words = String(s).split(' '), lines = [];
    let cur = '';
    for (const w of words) { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
    if (cur) lines.push(cur);
    return lines;
  }
  function objective(G) {
    const P = G.player;
    const missing = G.docSites.filter((s) => !P.docs.includes(s.doc));
    if (!missing.length) return { x: G.target.x, y: G.target.y, name: G.M.goal, icon: G.gameMode === 'vote' ? '🗳️' : '🏛️' };
    let best = null, bd = Infinity;
    for (const s of missing) { const d = Math.hypot(s.x - P.x, s.y - P.y); if (d < bd) { bd = d; best = s; } }
    return { x: best.x, y: best.y, name: best.name, icon: '📄' };
  }

  function draw(ctx, game, view, dt, opts) {
    time += dt;
    const G = game.state, P = G.player;
    const DPR = opts.DPR, W = opts.W, H = opts.H;
    const u = Math.max(0.62, Math.min(1, Math.min(W, H) / 760));
    ctx.setTransform(DPR * u, 0, 0, DPR * u, 0, 0);
    const VW = W / u, VH = H / u, narrow = VW < 760, touch = opts.isTouch;

    // ---- status (top-left)
    panel(ctx, 12, 12, 250, 112);
    const low = G.timer < 45;
    text(ctx, '🕙 ' + clockStr(G), 24, 30, 15, '#fff');
    text(ctx, '⏱ ' + fmt(G.timer), 250, 30, low ? 17 + Math.sin(time * 10) : 15, low ? '#ff5252' : '#ffe0b2', 'right', 900);
    text(ctx, '📄', 24, 54, 13); bar(ctx, 46, 48, 120, 12, P.papers / 100, P.papers > 60 ? '#66bb6a' : P.papers > 30 ? '#ffca28' : '#ef5350');
    text(ctx, '🏃', 24, 74, 13); bar(ctx, 46, 68, 120, 12, P.stamina / 100, '#4fc3f7');
    text(ctx, '👥 ' + P.followers.length + '/' + game.CAP, 250, 54, 14, '#bbdefb', 'right');
    let cases = '';
    for (let i = 0; i < game.CASES; i++) cases += i < P.cases ? '🚓' : '⚪';
    text(ctx, cases, 250, 74, 12, '#fff', 'right');
    const shield = P.followers.filter((f) => Math.hypot(f.x - P.x, f.y - P.y) < 70).length;
    text(ctx, shield >= game.SHIELD ? '🛡️ Crowd shield ON' : '🛡️ Need ' + game.SHIELD + ' supporters close', 24, 100, 12, shield >= game.SHIELD ? '#b9f6ca' : '#ffcc80', 'left', 700);
    text(ctx, G.score.toLocaleString('en-IN') + (G.combo.n > 1 ? '  x' + G.combo.n : ''), 250, 100, 14, '#ffd54f', 'right', 900);

    // ---- minimap + documents (top-right)
    const ms = narrow ? 120 : 160, mx = VW - ms - 16, my = 16;
    const obj = objective(G);
    window.Render.drawMinimap(mx, my, ms, obj);
    let dy = my + ms + 14;
    const docs = G.M.docs;
    const dh = 22 + docs.length * 17;
    panel(ctx, mx - 4, dy, ms + 8, dh);
    text(ctx, G.gameMode === 'vote' ? 'Carry' : 'Documents', mx + 6, dy + 12, 11, '#ffe0b2');
    docs.forEach((d, i) => { const got = P.docs.includes(d); text(ctx, (got ? '✅ ' : '⬜ ') + d, mx + 6, dy + 29 + i * 17, 10.5, got ? '#c5e1a5' : '#eee', 'left', 700); });

    // ---- objective arrow when the objective is off screen (kept clear of the HUD panels)
    if (G.mode === 'play' && P.state === 'free') {
      const sp = window.Render.worldToScreen(obj.x, obj.y, view);
      const sx = sp.x / u, sy = sp.y / u;
      const box = { l: 40, r: VW - ms - 50, t: 150, b: VH - (touch ? 130 : 60) };
      if (sx < box.l || sy < box.t || sx > box.r || sy > box.b) {
        const pp = window.Render.worldToScreen(P.x, P.y, view);
        const ox = pp.x / u, oy = pp.y / u;
        const ang = Math.atan2(sy - oy, sx - ox), c = Math.cos(ang), s = Math.sin(ang);
        const cx = Math.max(box.l, Math.min(box.r, ox)), cy = Math.max(box.t, Math.min(box.b, oy));
        let k = Infinity;
        if (c > 1e-6) k = Math.min(k, (box.r - cx) / c); else if (c < -1e-6) k = Math.min(k, (box.l - cx) / c);
        if (s > 1e-6) k = Math.min(k, (box.b - cy) / s); else if (s < -1e-6) k = Math.min(k, (box.t - cy) / s);
        const ax = cx + c * k, ay = cy + s * k;
        ctx.save(); ctx.translate(ax, ay); ctx.rotate(ang);
        ctx.fillStyle = 'rgba(30,91,216,.9)'; ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(-10, -13); ctx.lineTo(-4, 0); ctx.lineTo(-10, 13); ctx.closePath(); ctx.fill();
        ctx.restore();
        const dist = Math.round(Math.hypot(obj.x - P.x, obj.y - P.y) / 8);
        const lbl = obj.icon + ' ' + obj.name + ' · ' + dist + ' m';
        ctx.font = '800 12px system-ui,sans-serif';
        const lw = ctx.measureText(lbl).width + 14;
        const lx = Math.max(box.l + lw / 2 - 30, Math.min(box.r - lw / 2 + 30, ax - c * 40)), ly = ay - s * 28;
        panel(ctx, lx - lw / 2, ly - 11, lw, 22);
        text(ctx, lbl, lx, ly, 12, '#fff', 'center', 800);
      }
    }

    // ---- missions (bottom-left; on touch, under the status panel)
    if (G.mode === 'play' && !(touch && narrow)) {
      const mh = 22 + G.missions.length * 18;
      const px = 12, py = touch ? 132 : VH - mh - 12;
      panel(ctx, px, py, 262, mh);
      text(ctx, 'Aaj ka kaam', px + 12, py + 12, 11, '#ffe0b2');
      G.missions.forEach((m, i) => {
        const prog = Math.max(0, Math.min(m.n, (m.k === 'crowd' ? P.followers.length : G.stats[m.k]) - m.base));
        text(ctx, '• ' + m.txt + '  ' + prog + '/' + m.n, px + 12, py + 30 + i * 18, 11, '#fff', 'left', 600);
      });
    }

    // ---- centre: grab / detained / filing
    const cx = VW / 2;
    if (P.state === 'held') {
      panel(ctx, cx - 190, VH * 0.3 - 30, 380, 60);
      text(ctx, '🚓 Detained! Off to the police station…', cx, VH * 0.3 - 8, 17, '#ff8a80', 'center', 900);
      text(ctx, (game.CASES - P.cases) + ' more and you are jailed', cx, VH * 0.3 + 15, 12, '#ffe0b2', 'center', 700);
    } else if (P.grab > 0) {
      panel(ctx, cx - 140, VH * 0.3 - 26, 280, 52);
      text(ctx, touch ? 'GRABBED! Drag far to RUN free!' : 'GRABBED! Hold SHIFT and run!', cx, VH * 0.3 - 8, 15, '#ff8a80', 'center', 900);
      bar(ctx, cx - 120, VH * 0.3 + 8, 240, 10, P.grab, '#e53935');
    }
    if (P.submitT > 0) {
      const by = VH - (touch ? 200 : 70);
      panel(ctx, cx - 170, by - 26, 340, 52);
      text(ctx, G.gameMode === 'vote' ? 'Casting your vote… hold your ground!' : 'Filing nomination… hold the counter!', cx, by - 8, 14, '#c5e1a5', 'center', 900);
      bar(ctx, cx - 150, by + 8, 300, 10, P.submitT / G.M.hold, '#66bb6a');
    }

    // ---- toasts
    for (let i = toasts.length - 1; i >= 0; i--) { toasts[i].life -= dt; if (toasts[i].life <= 0) toasts.splice(i, 1); }
    let ty = narrow ? 150 : 76;
    for (const t of toasts.slice(-4)) {
      ctx.globalAlpha = Math.min(1, t.life / 0.4);
      ctx.font = '800 14px system-ui,sans-serif';
      const w = Math.min(VW - 40, ctx.measureText(t.text).width + 26);
      panel(ctx, cx - w / 2, ty - 14, w, 28);
      text(ctx, t.text, cx, ty, 14, t.color, 'center');
      ty += 33;
    }
    ctx.globalAlpha = 1;
    if (tier) {
      tier.life -= dt;
      if (tier.life <= 0) tier = null;
      else {
        ctx.globalAlpha = Math.min(1, tier.life / 0.4);
        const k = 1 + Math.max(0, tier.life - 1.1) * 2;
        ctx.save(); ctx.translate(cx, VH * 0.36); ctx.scale(k, k);
        ctx.font = '900 38px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round'; ctx.lineWidth = 7; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.strokeText(tier.text, 0, 0);
        ctx.fillStyle = '#ffd54f'; ctx.fillText(tier.text, 0, 0);
        ctx.restore(); ctx.globalAlpha = 1;
      }
    }

    // ---- touch joystick
    const st = window.Input.stick;
    if (st) {
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(st.ox / u, st.oy / u, 50, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(st.x / u, st.y / u, 22, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }

    if (G.mode === 'intro') introCard(ctx, game, VW, VH, touch);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function introCard(ctx, game, VW, VH, touch) {
    const G = game.state, M = G.M;
    const w = Math.min(560, VW - 40), h = 250, x = (VW - w) / 2, y = (VH - h) / 2;
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(0, 0, VW, VH);
    ctx.fillStyle = '#f6eedd'; rr(ctx, x, y, w, h, 16); ctx.fill();
    ctx.fillStyle = '#1e5bd8'; rr(ctx, x, y, w, 10, 5); ctx.fill();
    text(ctx, M.title.toUpperCase() + ' · ' + G.place.town, x + w / 2, y + 40, 20, '#0f2f6e', 'center', 900);
    ctx.font = '700 14px system-ui,sans-serif';
    wrap(ctx, game.text(M.intro), w - 50).forEach((l, i) => text(ctx, l, x + w / 2, y + 76 + i * 20, 14, '#3e2f22', 'center', 700));
    const tips = touch
      ? ['Drag on the left to walk, drag far to run', 'Walk into people to grow your crowd · SLOGAN pulls more', '3+ supporters close = police can\u2019t grab you']
      : ['WASD / arrows or hold the mouse to walk · Shift / right-click to run', 'Walk into people to grow your crowd · Space = slogan', '3+ supporters close = police can\u2019t grab you · push barricades together'];
    tips.forEach((l, i) => text(ctx, l, x + w / 2, y + 150 + i * 20, 12, '#2e4a7a', 'center', 700));
    text(ctx, touch ? 'Move to start' : 'Press a move key or Space to start', x + w / 2, y + h - 18, 12, '#9a8670', 'center', 700);
  }

  window.Hud = {
    draw, objective,
    toast(s, color, life) { toasts.push({ text: s, color: color || '#fff', life: life || 2.8 }); if (toasts.length > 8) toasts.shift(); },
    tier(name) { tier = { text: name, life: 1.6 }; },
    reset() { toasts.length = 0; tier = null; },
  };
})();
