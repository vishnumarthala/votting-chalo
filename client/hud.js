// Heads-up display (screen space): status, NEXT-objective banner, radar, documents, objective arrow, missions,
// toasts, intro card and the full town map. Phones get a compact layout with bigger text.
'use strict';
(function () {
  const toasts = [];
  let tier = null, time = 0, demoPulse = 0;
  const layout = { mini: null, pause: null };

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function text(ctx, s, x, y, size, color, align, weight, maxW) {
    ctx.font = `${weight || 800} ${size}px system-ui,-apple-system,"Segoe UI",sans-serif`;
    ctx.textAlign = align || 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = color || '#fff';
    if (maxW) ctx.fillText(s, x, y, maxW); else ctx.fillText(s, x, y);
  }
  const panel = (ctx, x, y, w, h, a) => { ctx.fillStyle = `rgba(20,14,8,${a || 0.66})`; rr(ctx, x, y, w, h, 10); ctx.fill(); };
  function bar(ctx, x, y, w, h, v, color) {
    ctx.fillStyle = 'rgba(255,255,255,.18)'; rr(ctx, x, y, w, h, h / 2); ctx.fill();
    if (v > 0) { ctx.fillStyle = color; rr(ctx, x, y, Math.max(h, w * Math.min(1, v)), h, h / 2); ctx.fill(); }
  }
  const fmt = (s) => { s = Math.max(0, Math.ceil(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const hm = (mins, full) => { const h = Math.floor(mins / 60), m = mins % 60; return ((h + 11) % 12 + 1) + (m || full ? ':' + String(m).padStart(2, '0') : '') + (h >= 12 ? ' PM' : ' AM'); };
  const clockStr = (G) => { const M = G.M; return hm(Math.floor(M.clockStart + (M.clockEnd - M.clockStart) * (G.elapsed / M.time)), true); };
  function wrap(ctx, s, maxW) {
    const words = String(s).split(' '), lines = [];
    let cur = '';
    for (const w of words) { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
    if (cur) lines.push(cur);
    return lines;
  }
  // HUD scale: phones get larger text than a plain fit-to-screen would give.
  function scaleFor(o) {
    const short = Math.min(o.W, o.H);
    return o.isTouch ? Math.max(0.74, Math.min(1, short / 470)) : Math.max(0.62, Math.min(1, short / 760));
  }
  const metres = (G, o) => Math.round(Math.hypot(o.x - G.player.x, o.y - G.player.y) / 8);
  // the gate showdown overrides the NEXT banner while it is in your way
  function gateStep(G, o) {
    const g = G.gate, P = G.player;
    if (!g || !o.goal) return null;
    const m = metres(G, o) + ' m';
    if (P.state === 'frisk') return { main: 'Papers check at the gate', sub: 'A cop is "verifying" your papers… wait' };
    if (P.stallT > 0) return { main: 'Hold the counter', sub: 'Clerk: "' + g.stallText + '"' + (P.followers.some((f) => f.inner !== false) ? ' · your proposers argue' : '') };
    if (g.phase === 'line' && g.line && !g.inside) return { main: 'Push through the police line', sub: 'Bring your crowd: they push much faster · or slip through when it parts for "guests" · ' + m };
    if (g.shut && !g.inside) return { main: 'Gate shut for "lunch"!', sub: 'Chant with 8+ supporters (' + g.pressure + '/4) · side wicket · or slip in behind "guests"' };
    return null;
  }
  function nextLine(G, o) {
    const gs = gateStep(G, o);
    if (gs) return gs.main;
    if (o.goal) return G.gameMode === 'vote' ? 'Cast your vote at the ' + G.M.goal : 'File your nomination at the ' + G.M.goal;
    return 'Get the ' + o.name;
  }

  // Democracy meter: % bar plus an ECG trace that slows and flattens as it falls.
  function ecg(ctx, x, y, w, h, v) {
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y - h / 2, w, h); ctx.clip();
    const col = v > 60 ? '#69f0ae' : v > 30 ? '#ffd740' : '#ff5252';
    ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.lineJoin = 'round';
    const amp = v <= 5 ? 0 : (h / 2 - 1) * Math.max(0.25, v / 100), period = 46 - (100 - v) * 0.15, off = (time * 40) % period;
    ctx.beginPath();
    for (let i = 0; i <= w; i += 1) {
      const p = (i + off) % period;
      let dy = 0;
      if (p > period * 0.5 && p < period * 0.56) dy = -amp * 0.3;
      else if (p >= period * 0.56 && p < period * 0.62) dy = amp;
      else if (p >= period * 0.62 && p < period * 0.68) dy = -amp * 0.9;
      else if (p >= period * 0.68 && p < period * 0.72) dy = amp * 0.2;
      if (i === 0) ctx.moveTo(x + i, y - dy); else ctx.lineTo(x + i, y - dy);
    }
    ctx.stroke();
    ctx.restore();
  }
  function demoRow(ctx, G, x, y, w, compact) {
    const v = G.demo, col = v > 60 ? '#66bb6a' : v > 30 ? '#ffca28' : '#ef5350';
    const stage = window.Content.DEMO.labels[G.demoStage] || '';
    if (demoPulse > 0) { ctx.fillStyle = `rgba(239,83,80,${demoPulse * 0.5})`; rr(ctx, x - 6, y - (compact ? 9 : 12), w + 12, compact ? 20 : 30, 6); ctx.fill(); }
    if (compact) {
      text(ctx, '🗳️', x, y + 1, 11);
      bar(ctx, x + 17, y - 4, w - 100, 9, v / 100, col);
      text(ctx, Math.round(v) + '%', x + w - 54, y + 1, 10.5, col, 'right', 900);
      ecg(ctx, x + w - 50, y, 50, 14, v);
      return;
    }
    text(ctx, '🗳️ Democracy · ' + stage, x, y - 4, 11.5, col, 'left', 800, w - 64);
    text(ctx, Math.round(v) + '%', x + w - 58, y - 4, 12, col, 'right', 900);
    ecg(ctx, x + w - 52, y + 2, 52, 18, v);
    bar(ctx, x, y + 7, w - 60, 7, v / 100, col);
  }

  // NEXT banner: what to do now, where, how far, and overall progress chips.
  function banner(ctx, G, o, x, y, w, h) {
    const P = G.player;
    ctx.fillStyle = 'rgba(20,14,8,.8)'; rr(ctx, x, y, w, h, 12); ctx.fill();
    ctx.fillStyle = o.color; rr(ctx, x, y, 6, h, 3); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.beginPath(); ctx.arc(x + 28, y + h / 2, 16, 0, Math.PI * 2); ctx.fill();
    text(ctx, o.icon, x + 28, y + h / 2 + 1, 17, '#000', 'center');
    const docs = G.docSites, chipsW = (docs.length + 1) * 13 + 10, tx = x + 52, tw = w - 52 - chipsW - 6;
    text(ctx, 'NEXT', tx, y + 13, 10, o.color, 'left', 900);
    ctx.font = '900 10px system-ui,sans-serif';
    const nw = ctx.measureText('NEXT ').width;
    text(ctx, nextLine(G, o), tx + nw + 2, y + 13, 13.5, '#fff', 'left', 900, tw - nw - 2);
    let sub;
    const gs = gateStep(G, o);
    if (gs) sub = gs.sub;
    else if (P.collect && P.collect.site === o.site) sub = 'Collecting… stay here';
    else if (o.goal && P.submitT > 0) sub = 'Hold your ground!';
    else sub = (o.goal ? o.where : 'at ' + o.where) + ' · ' + metres(G, o) + ' m · follow the arrows';
    text(ctx, sub, tx, y + h - 13, 11.5, '#ffe0b2', 'left', 700, tw);
    // progress chips: documents, then the goal
    let cx = x + w - chipsW + 6;
    for (const s of docs) {
      const got = P.docs.includes(s.doc);
      ctx.fillStyle = got ? '#66bb6a' : 'rgba(255,255,255,.18)'; rr(ctx, cx, y + h / 2 - 5, 10, 10, 3); ctx.fill();
      if (s === o.site) { ctx.strokeStyle = o.color; ctx.lineWidth = 2; rr(ctx, cx - 1.5, y + h / 2 - 6.5, 13, 13, 4); ctx.stroke(); }
      cx += 13;
    }
    ctx.fillStyle = G.mode === 'won' ? '#66bb6a' : o.goal ? '#1a2d8a' : 'rgba(255,255,255,.18)'; ctx.beginPath(); ctx.arc(cx + 5, y + h / 2, 5.5, 0, Math.PI * 2); ctx.fill();
    if (o.goal) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke(); }
  }

  function draw(ctx, game, view, dt, opts) {
    time += dt;
    const G = game.state, P = G.player;
    const DPR = opts.DPR, W = opts.W, H = opts.H, touch = opts.isTouch, sa = opts.safe || { t: 0, r: 0, b: 0, l: 0 };
    const u = scaleFor(opts);
    ctx.setTransform(DPR * u, 0, 0, DPR * u, 0, 0);
    const VW = W / u, VH = H / u, narrow = VW < 640;
    const L = 10 + sa.l / u, R = VW - 10 - sa.r / u, TOP = 10 + sa.t / u, BOT = VH - 10 - sa.b / u;
    const obj = window.Render.objective();
    const low = G.timer < 45;
    const shieldOn = P.followers.filter((f) => Math.hypot(f.x - P.x, f.y - P.y) < 70).length >= game.SHIELD;
    let cases = '';
    for (let i = 0; i < game.CASES; i++) cases += i < P.cases ? '🚓' : '⚪';
    const score = G.score.toLocaleString('en-IN') + (G.combo.n > 1 ? '  x' + G.combo.n : '');

    // ---- status (top-left)
    const SW = narrow ? 180 : 250, SH = narrow ? 94 : 136;
    demoPulse = Math.max(0, demoPulse - dt * 1.5);
    panel(ctx, L, TOP, SW, SH);
    if (narrow) {
      text(ctx, '🕙 ' + clockStr(G), L + 10, TOP + 15, 12, '#fff', 'left', 700);
      text(ctx, '⏱ ' + fmt(G.timer), L + SW - 10, TOP + 15, low ? 16 + Math.sin(time * 10) : 15, low ? '#ff5252' : '#ffe0b2', 'right', 900);
      text(ctx, '📄', L + 9, TOP + 36, 11); bar(ctx, L + 26, TOP + 31, 56, 10, P.papers / 100, P.papers > 60 ? '#66bb6a' : P.papers > 30 ? '#ffca28' : '#ef5350');
      text(ctx, '🏃', L + 92, TOP + 36, 11); bar(ctx, L + 109, TOP + 31, SW - 119, 10, P.stamina / 100, '#4fc3f7');
      text(ctx, (shieldOn ? '🛡️ ' : '👥 ') + P.followers.length + '/' + game.CAP, L + 10, TOP + 58, 13, shieldOn ? '#b9f6ca' : '#bbdefb', 'left', 800);
      text(ctx, cases, L + 104, TOP + 58, 9, '#fff', 'center');
      text(ctx, score, L + SW - 10, TOP + 58, 13, '#ffd54f', 'right', 900, 50);
      demoRow(ctx, G, L + 10, TOP + 80, SW - 20, true);
    } else {
      text(ctx, '🕙 ' + clockStr(G), L + 12, TOP + 18, 15, '#fff');
      text(ctx, '⏱ ' + fmt(G.timer), L + SW - 12, TOP + 18, low ? 17 + Math.sin(time * 10) : 15, low ? '#ff5252' : '#ffe0b2', 'right', 900);
      text(ctx, '📄', L + 12, TOP + 42, 13); bar(ctx, L + 34, TOP + 36, 120, 12, P.papers / 100, P.papers > 60 ? '#66bb6a' : P.papers > 30 ? '#ffca28' : '#ef5350');
      text(ctx, '🏃', L + 12, TOP + 62, 13); bar(ctx, L + 34, TOP + 56, 120, 12, P.stamina / 100, '#4fc3f7');
      text(ctx, '👥 ' + P.followers.length + '/' + game.CAP, L + SW - 12, TOP + 42, 14, '#bbdefb', 'right');
      text(ctx, cases, L + SW - 12, TOP + 62, 12, '#fff', 'right');
      text(ctx, shieldOn ? '🛡️ Crowd shield ON' : '🛡️ Need ' + game.SHIELD + ' supporters close', L + 12, TOP + 88, 12, shieldOn ? '#b9f6ca' : '#ffcc80', 'left', 700);
      text(ctx, score, L + SW - 12, TOP + 88, 14, '#ffd54f', 'right', 900);
      demoRow(ctx, G, L + 12, TOP + 114, SW - 24, false);
    }
    const statusBottom = TOP + SH;

    // ---- radar (top-right); tap/click opens the full town map
    const ms = narrow ? 112 : VH < 520 ? 120 : 150, mx = R - ms - 4, my = TOP + 4;
    window.Render.drawRadar(mx, my, ms, obj);
    const hint = touch ? '🗺️ Tap: town map' : '🗺️ Click / Tab: map';
    ctx.font = '800 9.5px system-ui,sans-serif';
    const hw = ctx.measureText(hint).width + 12;
    ctx.fillStyle = 'rgba(20,14,8,.8)'; rr(ctx, mx + ms / 2 - hw / 2, my + ms - 17, hw, 15, 7); ctx.fill();
    text(ctx, hint, mx + ms / 2, my + ms - 9.5, 9.5, '#fff', 'center', 800);
    layout.mini = { x: (mx - 6) * u, y: (my - 6) * u, w: (ms + 12) * u, h: (ms + 12) * u };
    layout.pause = narrow ? { x: ((L + SW + mx - 4) / 2) * u, y: (TOP + 22) * u } : { x: (mx - 34) * u, y: (TOP + 22) * u };

    // ---- NEXT banner
    let bx, by = TOP, bw, bh = 46, under = narrow;
    if (narrow) { bx = L; bw = R - L; by = Math.max(statusBottom, my + ms + 4) + 8; }
    else {
      const l = L + SW + 14, r = mx - 66;
      bw = Math.min(470, r - l); bx = l + (r - l - bw) / 2;
      if (bw < 260) { under = true; bx = L; bw = Math.min(R - L - ms - 20, 380); by = statusBottom + 8; }
    }
    if (G.mode === 'play' || G.mode === 'intro') banner(ctx, G, obj, bx, by, bw, bh);
    const bannerBottom = by + bh;
    const leftColTop = under && !narrow ? bannerBottom + 8 : statusBottom + 8;

    // ---- documents checklist under the radar (phones: the banner chips do this)
    let rightColBottom = my + ms + 4;
    if (!narrow) {
      const docs = [...(G.M.given || []), ...G.M.docs], dh = 22 + docs.length * 17;
      ctx.font = '700 10.5px system-ui,sans-serif';
      const pw = Math.max(ms + 8, ...docs.map((d) => ctx.measureText('✅ ' + d).width + 18));
      const px = R - pw, dy = my + ms + 12;
      panel(ctx, px, dy, pw, dh);
      text(ctx, G.gameMode === 'vote' ? 'Carry' : 'Documents', px + 10, dy + 12, 11, '#ffe0b2');
      docs.forEach((d, i) => { const got = P.docs.includes(d); text(ctx, (got ? '✅ ' : '⬜ ') + d, px + 10, dy + 29 + i * 17, 10.5, got ? '#c5e1a5' : '#eee', 'left', 700); });
      rightColBottom = dy + dh;
    }

    // ---- objective arrow at the screen edge when the objective is off screen
    if (G.mode === 'play' && P.state === 'free') {
      const sp = window.Render.worldToScreen(obj.x, obj.y, view);
      const sx = sp.x / u, sy = sp.y / u;
      const box = { l: L + 30, r: narrow ? R - 30 : mx - 40, t: (narrow ? bannerBottom : Math.max(bannerBottom, statusBottom)) + 30, b: BOT - (touch ? 150 : 50) };
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
        ctx.fillStyle = obj.goal ? 'rgba(26,45,138,.95)' : 'rgba(249,168,37,.95)'; ctx.strokeStyle = obj.goal ? '#ffd700' : '#fff'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(20, 0); ctx.lineTo(-10, -14); ctx.lineTo(-4, 0); ctx.lineTo(-10, 14); ctx.closePath(); ctx.stroke(); ctx.fill();
        ctx.restore();
        const lbl = obj.icon + ' ' + metres(G, obj) + ' m';
        ctx.font = '800 12px system-ui,sans-serif';
        const lw = ctx.measureText(lbl).width + 14;
        const lx = Math.max(box.l, Math.min(box.r, ax - c * 42)), ly = Math.max(box.t - 20, Math.min(box.b + 20, ay - s * 30));
        panel(ctx, lx - lw / 2, ly - 11, lw, 22, 0.8);
        text(ctx, lbl, lx, ly, 12, '#fff', 'center', 800);
      }
    }

    // ---- missions (desktop: bottom-left; touch landscape: under the status panel; phones portrait: hidden)
    if (G.mode === 'play' && !narrow) {
      const mh = 22 + G.missions.length * 18;
      const px = L, py = touch ? leftColTop : BOT - mh;
      panel(ctx, px, py, 262, mh);
      text(ctx, 'Today\u2019s tasks', px + 12, py + 12, 11, '#ffe0b2');
      G.missions.forEach((m, i) => {
        const prog = Math.max(0, Math.min(m.n, (m.k === 'crowd' ? P.followers.length : G.stats[m.k]) - m.base));
        text(ctx, '• ' + m.txt + '  ' + prog + '/' + m.n, px + 12, py + 30 + i * 18, 11, '#fff', 'left', 600, 240);
      });
    }

    // ---- centre: grab / detained / filing
    const cx = VW / 2, cw = (w) => Math.min(w, VW - 20);
    const midY = Math.max(VH * 0.3, (narrow ? bannerBottom : statusBottom) + 50);
    if (P.state === 'held') {
      panel(ctx, cx - cw(380) / 2, midY - 30, cw(380), 60);
      text(ctx, '🚓 Detained! Off to the police station…', cx, midY - 8, 17, '#ff8a80', 'center', 900, cw(380) - 20);
      text(ctx, (game.CASES - P.cases) + ' more and you are jailed', cx, midY + 15, 12, '#ffe0b2', 'center', 700);
    } else if (P.grab > 0) {
      panel(ctx, cx - cw(300) / 2, midY - 26, cw(300), 52);
      text(ctx, touch ? 'GRABBED! Drag far or hold RUN!' : 'GRABBED! Hold SHIFT and run!', cx, midY - 8, 15, '#ff8a80', 'center', 900, cw(300) - 20);
      bar(ctx, cx - 120, midY + 8, 240, 10, P.grab, '#e53935');
    }
    if (P.submitT > 0) {
      const by2 = BOT - (touch ? 190 : 60);
      panel(ctx, cx - cw(340) / 2, by2 - 26, cw(340), 52);
      const stalled = P.stallT > 0 && G.gate;
      text(ctx, stalled ? '⏸ Clerk: "' + G.gate.stallText + '"' : G.gameMode === 'vote' ? 'Casting your vote… hold your ground!' : 'Filing nomination… hold the counter!', cx, by2 - 8, 14, stalled ? '#ffcc80' : '#c5e1a5', 'center', 900, cw(340) - 20);
      bar(ctx, cx - cw(300) / 2, by2 + 8, cw(300), 10, P.submitT / G.M.hold, stalled ? '#ffb300' : '#66bb6a');
    }

    // ---- toasts
    for (let i = toasts.length - 1; i >= 0; i--) { toasts[i].life -= dt; if (toasts[i].life <= 0) toasts.splice(i, 1); }
    let ty = narrow ? bannerBottom + 26 : Math.max(TOP + 66, under ? 0 : bannerBottom + 22);
    const tmax = narrow ? VW - 24 : Math.max(240, VW - 2 * (L + SW + 10));
    for (const t of toasts.slice(narrow ? -3 : -4)) {
      ctx.globalAlpha = Math.min(1, t.life / 0.4);
      ctx.font = '800 14px system-ui,sans-serif';
      const w = Math.min(tmax, ctx.measureText(t.text).width + 26);
      panel(ctx, cx - w / 2, ty - 14, w, 28);
      text(ctx, t.text, cx, ty, 14, t.color, 'center', 800, w - 16);
      ty += 33;
    }
    ctx.globalAlpha = 1;
    if (tier) {
      tier.life -= dt;
      if (tier.life <= 0) tier = null;
      else {
        ctx.globalAlpha = Math.min(1, tier.life / 0.4);
        const k = 1 + Math.max(0, tier.life - 1.1) * 2;
        ctx.save(); ctx.translate(cx, VH * 0.4); ctx.scale(k, k);
        ctx.font = `900 ${narrow ? 30 : 38}px system-ui,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round'; ctx.lineWidth = 7; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.strokeText(tier.text, 0, 0, VW - 30);
        ctx.fillStyle = '#ffd54f'; ctx.fillText(tier.text, 0, 0, VW - 30);
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
    return layout;
  }

  function introCard(ctx, game, VW, VH, touch) {
    const G = game.state, M = G.M, vote = G.gameMode === 'vote';
    const w = Math.min(560, VW - 24), pad = 20, inner = w - pad * 2;
    ctx.font = '700 14px system-ui,sans-serif';
    const intro = wrap(ctx, game.text(M.intro), inner);
    const n = G.docSites.length;
    const steps = vote
      ? [['📄', 'Get your Voter Slip at the BLO Help Tent'], ['🗳️', 'Reach the ' + M.goal + ' before ' + hm(M.clockEnd)], ['⏳', 'Stand in the blue circle until your vote is cast']]
      : [['📄', 'Collect ' + n + ' documents from shops marked 📄'], ['🏛️', 'Reach the ' + M.goal + ' before ' + hm(M.clockEnd)], ['⏳', 'Stand in the blue circle until it is filed']];
    const tips = touch
      ? ['Drag on the left half to walk · drag far to run', 'Walk into people to grow your crowd', '3+ supporters close = police can\u2019t grab you']
      : ['WASD / arrows or hold the mouse to walk · Shift / right-click to run', 'Walk into people to grow your crowd · Space = slogan', '3+ supporters close = police can\u2019t grab you'];
    const h = 50 + intro.length * 19 + 10 + steps.length * 26 + 40 + tips.length * 17 + 36;
    const x = (VW - w) / 2;
    let y = Math.max(8, (VH - h) / 2);
    ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(0, 0, VW, VH);
    ctx.fillStyle = '#f6eedd'; rr(ctx, x, y, w, h, 16); ctx.fill();
    const band = ctx.createLinearGradient(x, 0, x + w, 0);
    band.addColorStop(0, '#0f1b61'); band.addColorStop(0.45, '#1a2d8a'); band.addColorStop(0.75, '#00a651'); band.addColorStop(1, '#ffd700');
    ctx.fillStyle = band; rr(ctx, x, y, w, 10, 5); ctx.fill();
    text(ctx, M.title.toUpperCase() + ' · ' + G.place.town, x + w / 2, y + 34, 19, '#0f1b61', 'center', 900, inner);
    let cy = y + 62;
    intro.forEach((l) => { text(ctx, l, x + w / 2, cy, 14, '#3e2f22', 'center', 700); cy += 19; });
    cy += 10;
    steps.forEach((s, i) => {
      ctx.fillStyle = '#00a651'; ctx.beginPath(); ctx.arc(x + pad + 10, cy + 2, 10, 0, Math.PI * 2); ctx.fill();
      text(ctx, String(i + 1), x + pad + 10, cy + 3, 12, '#fff', 'center', 900);
      text(ctx, s[0], x + pad + 34, cy + 2, 15, '#000', 'center');
      text(ctx, s[1], x + pad + 50, cy + 2, 13.5, '#1d1a16', 'left', 800, inner - 52);
      cy += 26;
    });
    cy += 4;
    ctx.fillStyle = 'rgba(249,168,37,.18)'; rr(ctx, x + pad, cy - 4, inner, 28, 8); ctx.fill();
    text(ctx, '➜ Follow the glowing arrows on the road and the NEXT banner', x + w / 2, cy + 10, 12.5, '#8a4b00', 'center', 800, inner - 16);
    cy += 40;
    tips.forEach((l) => { text(ctx, l, x + w / 2, cy, 12, '#2e4a7a', 'center', 700, inner); cy += 17; });
    text(ctx, touch ? 'Move to start' : 'Press a move key or Space to start', x + w / 2, y + h - 16, 12, '#9a8670', 'center', 700);
  }

  // Full-screen town map (game is paused while it is open).
  function drawMap(ctx, game, opts) {
    const G = game.state, u = scaleFor(opts), touch = opts.isTouch;
    ctx.setTransform(opts.DPR * u, 0, 0, opts.DPR * u, 0, 0);
    const VW = opts.W / u, VH = opts.H / u, narrow = VW < 640;
    const o = window.Render.objective();
    ctx.fillStyle = 'rgba(5,12,30,.86)'; ctx.fillRect(0, 0, VW, VH);
    const head = 58, foot = narrow ? 78 : 50;
    const size = Math.max(120, Math.min(VW - 24, VH - head - foot - 8));
    const x = (VW - size) / 2, y = head + Math.max(0, (VH - head - foot - size) / 2);
    text(ctx, '🗺️ ' + G.place.town + ' · town map', VW / 2, y - 38, 16, '#fff', 'center', 900, VW - 24);
    text(ctx, 'NEXT: ' + nextLine(G, o) + ' · ' + metres(G, o) + ' m', VW / 2, y - 16, 12.5, o.color, 'center', 800, VW - 24);
    window.Render.drawBigMap(x, y, size, o);
    ctx.font = '700 11.5px system-ui,sans-serif';
    const items = ['➤ You', '📄 Document', (G.gameMode === 'vote' ? '🗳️ ' : '🏛️ ') + G.M.goal, '🚓 Police station', '🚩 Party office', '⭕ Section 144 ring'];
    const legend = wrap(ctx, items.map((s) => s.replace(/ /g, '\u00a0')).join('   '), VW - 24).map((l) => l.replace(/\u00a0/g, ' '));
    let ly = y + size + 16;
    legend.forEach((l) => { text(ctx, l, VW / 2, ly, 11.5, '#e3f2fd', 'center', 700); ly += 16; });
    text(ctx, touch ? 'Tap anywhere to close' : 'Click, Tab or Esc to close', VW / 2, ly + 4, 11, '#90a4ae', 'center', 700);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  window.Hud = {
    draw, drawMap, layout,
    objective: () => window.Render.objective(),
    toast(s, color, life) { toasts.push({ text: s, color: color || '#fff', life: life || 2.8 }); if (toasts.length > 8) toasts.shift(); },
    tier(name) { tier = { text: name, life: 1.6 }; },
    demoHit() { demoPulse = 1; },
    reset() { toasts.length = 0; tier = null; },
  };
})();
