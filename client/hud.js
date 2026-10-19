// Heads-up display (screen space): Democracy meter, NEXT-objective banner, radar,
// toasts, intro card and the full town map. Phones get a compact layout with bigger text.
'use strict';
(function () {
  const toasts = [];
  let tier = null, time = 0, demoPulse = 0, walked = false;
  const tactics = { seen: new Set(), queue: [], cur: null };
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
  // Near the RO office the screen gets busy, so the banner becomes the one step-by-step guide and the
  // other channels (toasts, tactic cards, crowd chatter) go quiet.
  function inFocus(G) {
    const P = G.player, T = G.target;
    const g = G.gate;
    if (g && (g.inside || (g.phase !== 'idle' && Math.hypot(P.x - T.gate.x, P.y - T.gate.y) < 420))) return true;
    return P.submitT > 0 || Math.hypot(P.x - T.x, P.y - T.y) < G.ringR * 32;
  }
  const STEPS = 4;
  function gateStep(G, o) {
    const g = G.gate, P = G.player;
    if (!g || !o.goal) return null;
    if (g.inside || P.submitT > 0) {
      if (P.state === 'frisk') return { n: 3, main: 'Papers check', sub: 'A cop is "verifying" your papers… wait' };
      if (P.stallT > 0) return { n: 4, main: 'Hold the counter', sub: 'Clerk: "' + g.stallText + '"' + (P.followers.some((f) => f.inner !== false) ? ' · your proposers argue' : '') };
      if (P.submitT > 0) return { n: 4, main: 'Hold the counter', sub: 'Filing… ' + Math.min(99, Math.floor((P.submitT / G.M.hold) * 100)) + '% · stay in the blue circle' };
      const waiting = P.followers.filter((f) => f.inner === false).length;
      return { n: 4, main: 'Stand in the blue circle', sub: 'In front of the clerk · ' + metres(G, o) + ' m' + (waiting ? ' · only you + 4 allowed in' : '') };
    }
    if (g.phase === 'line' && g.line) return { n: 1, main: 'Push through the police line', sub: 'Walk into it with your crowd · or slip through when it parts for ' + window.Content.OPPONENT.short + ' leaders' };
    if (g.shut) {
      const n = P.followers.length;
      return { n: 2, main: 'Gate shut for "lunch"', sub: n >= 8 ? 'Shout slogans at the gate (' + g.pressure + '/4) · or use the side wicket' : 'Use the side wicket · or bring 8+ supporters to chant (you have ' + n + ')' };
    }
    if (g.phase === 'approach' || g.phase === 'open') return { n: 2, main: 'Walk in through the gate', sub: metres(G, o) + ' m' };
    return null;
  }
  function nextLine(G, o) {
    const gs = gateStep(G, o);
    if (gs) return gs.main;
    return 'File your nomination at the ' + G.M.goal;
  }

  // Democracy as an ICU monitor: the heartbeat slows and flattens as it falls.
  function ecg(ctx, x, y, w, h, v, lw) {
    ctx.save();
    ctx.beginPath(); ctx.rect(x, y - h / 2, w, h); ctx.clip();
    const col = monitorColor(v);
    ctx.strokeStyle = col; ctx.lineWidth = lw || 1.6; ctx.lineJoin = 'round';
    ctx.shadowColor = col; ctx.shadowBlur = 6;
    const amp = v <= 0 ? 0 : (h / 2 - 1) * Math.max(0.2, v / 100), period = 46 + (100 - v) * 0.7, off = (time * 40) % period;
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
  const monitorColor = (v) => (v > 60 ? '#69f0ae' : v > 30 ? '#ffd740' : '#ff5252');
  function demoMeter(ctx, G, x, y, w, h, compact) {
    const v = G.demo, col = monitorColor(v);
    const stage = (window.Content.DEMO.labels[G.demoStage] || '').toUpperCase();
    ctx.fillStyle = 'rgba(6,14,10,.9)'; rr(ctx, x, y, w, h, 12); ctx.fill();
    ctx.strokeStyle = demoPulse > 0 ? `rgba(255,82,82,${0.4 + demoPulse * 0.6})` : 'rgba(255,255,255,.16)';
    ctx.lineWidth = demoPulse > 0 ? 3 : 1.5; rr(ctx, x, y, w, h, 12); ctx.stroke();
    if (demoPulse > 0) { ctx.fillStyle = `rgba(255,23,68,${demoPulse * 0.28})`; rr(ctx, x, y, w, h, 12); ctx.fill(); }
    const pad = compact ? 9 : 12, ls = compact ? 10.5 : 12;
    text(ctx, '🗳️ DEMOCRACY', x + pad, y + pad + ls / 2, ls, '#e0e0e0', 'left', 900);
    text(ctx, stage, x + w - pad, y + pad + ls / 2, ls, col, 'right', 900);
    // the big number (blinks once it is critical) and the heartbeat beside it
    const ps = compact ? 26 : 36, ny = y + pad + ls + 4 + ps / 2, pct = Math.round(v) + '%';
    ctx.font = `900 ${ps}px system-ui,sans-serif`;
    const pw = ctx.measureText('100%').width;
    if (v > 25 || Math.floor(time * 3) % 2 === 0) text(ctx, pct, x + pad, ny, ps, col, 'left', 900);
    ecg(ctx, x + pad + pw + 8, ny, w - pad * 2 - pw - 8, ps * 1.15, v, compact ? 2 : 2.4);
    bar(ctx, x + pad, y + h - pad - 5, w - pad * 2, compact ? 5 : 6, v / 100, col);
  }

  // NEXT banner: what to do now, where and how far.
  function banner(ctx, G, o, x, y, w, h, compact) {
    const P = G.player;
    if (compact) { // narrow strip (phone landscape): title and distance only
      const gs = gateStep(G, o);
      ctx.fillStyle = 'rgba(20,14,8,.8)'; rr(ctx, x, y, w, h, 10); ctx.fill();
      ctx.fillStyle = o.color; rr(ctx, x, y, 5, h, 3); ctx.fill();
      text(ctx, (gs ? 'STEP ' + gs.n + '/' + STEPS + ' ' : '🏛️ ') + nextLine(G, o).replace('File your nomination at the ', ''), x + 12, y + 12, 12, '#fff', 'left', 900, w - 20);
      text(ctx, gs ? gs.sub : metres(G, o) + ' m · follow the gold arrow', x + 12, y + h - 11, 10.5, '#ffe0b2', 'left', 700, w - 20);
      return;
    }
    ctx.fillStyle = 'rgba(20,14,8,.8)'; rr(ctx, x, y, w, h, 12); ctx.fill();
    ctx.fillStyle = o.color; rr(ctx, x, y, 6, h, 3); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.beginPath(); ctx.arc(x + 28, y + h / 2, 16, 0, Math.PI * 2); ctx.fill();
    text(ctx, o.icon, x + 28, y + h / 2 + 1, 17, '#000', 'center');
    const tx = x + 52, tw = w - 52 - 12;
    const gs = gateStep(G, o), tag = gs ? 'STEP ' + gs.n + '/' + STEPS : 'NEXT';
    text(ctx, tag, tx, y + 13, 10, o.color, 'left', 900);
    ctx.font = '900 10px system-ui,sans-serif';
    const nw = ctx.measureText(tag + ' ').width;
    text(ctx, nextLine(G, o), tx + nw + 2, y + 13, 13.5, '#fff', 'left', 900, tw - nw - 2);
    let sub;
    if (gs) sub = gs.sub;
    else if (P.submitT > 0) sub = 'Hold your ground!';
    else sub = o.where + ' · ' + metres(G, o) + ' m · follow the gold arrow';
    text(ctx, sub, tx, y + h - 13, 11.5, '#ffe0b2', 'left', 700, tw);
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
    const focus = inFocus(G);
    // phones: a compact HUD and fewer overlays, so the street stays visible
    const phone = touch && (narrow || VH < 450), playing = G.mode === 'play';

    // ---- top-left: the Democracy meter, nothing else
    const ms = phone ? 88 : narrow ? 112 : VH < 520 ? 120 : 150, mx = R - ms - 4, my = TOP + 4;
    const SW = narrow ? Math.max(160, Math.min(210, mx - 4 - L - 48)) : phone ? 230 : 300, SH = phone ? 70 : narrow ? 82 : 102; // leave room for the pause button
    demoPulse = Math.max(0, demoPulse - dt * 1.2);
    demoMeter(ctx, G, L, TOP, SW, SH, narrow);
    const statusBottom = TOP + SH;

    // ---- radar (top-right); tap/click opens the full town map
    window.Render.drawRadar(mx, my, ms, obj);
    const hint = phone ? '🗺️ Map' : touch ? '🗺️ Tap: town map' : '🗺️ Click / Tab: map';
    ctx.font = '800 9.5px system-ui,sans-serif';
    const hw = ctx.measureText(hint).width + 12;
    ctx.fillStyle = 'rgba(20,14,8,.8)'; rr(ctx, mx + ms / 2 - hw / 2, my + ms - 17, hw, 15, 7); ctx.fill();
    text(ctx, hint, mx + ms / 2, my + ms - 9.5, 9.5, '#fff', 'center', 800);
    layout.mini = { x: (mx - 6) * u, y: (my - 6) * u, w: (ms + 12) * u, h: (ms + 12) * u };
    // live player count, under the radar
    const live = window.Live && window.Live.count;
    let liveH = 0;
    if (live && !(phone && playing)) { // phones: only on the intro card, not over the street
      const s = (live === 1 ? '1' : live.toLocaleString('en-IN')) + ' playing now';
      ctx.font = '800 11px system-ui,sans-serif';
      const lw = ctx.measureText(s).width + 30, lx = R - lw, ly = my + ms + 8;
      ctx.fillStyle = 'rgba(20,14,8,.78)'; rr(ctx, lx, ly, lw, 20, 10); ctx.fill();
      const pulse = (time * 0.6) % 1;
      ctx.fillStyle = `rgba(0,230,118,${0.5 * (1 - pulse)})`; ctx.beginPath(); ctx.arc(lx + 12, ly + 10, 4 + pulse * 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#00e676'; ctx.beginPath(); ctx.arc(lx + 12, ly + 10, 4, 0, Math.PI * 2); ctx.fill();
      text(ctx, s, lx + 21, ly + 10.5, 11, '#fff', 'left', 800);
      liveH = 26;
    }
    layout.pause = phone && VW > VH * 1.3 ? { x: (L + SW + 27) * u, y: (TOP + 20) * u } : narrow ? { x: ((L + SW + mx - 4) / 2) * u, y: (TOP + 22) * u } : { x: (mx - 34) * u, y: (TOP + 22) * u };

    // ---- NEXT banner
    let bx, by = TOP, bw, bh = phone ? 40 : 46, under = narrow;
    const flat = phone && VW > VH * 1.3; // phone landscape: banner in the top row between monitor and minimap
    if (flat) { bx = L + SW + 54; bw = Math.max(160, mx - 10 - bx); bh = 36; by = TOP + 2; }
    else if (narrow) { bx = L; bw = R - L; by = Math.max(statusBottom, my + ms + 4 + liveH) + 8; }
    else {
      const l = L + SW + 14, r = mx - 66;
      bw = Math.min(470, r - l); bx = l + (r - l - bw) / 2;
      if (bw < 260 && phone) { bw = Math.max(200, r - l); bx = l; bh = 36; } // phone landscape: keep it in the top row
      else if (bw < 260) { under = true; bx = L; bw = Math.min(R - L - ms - 20, 380); by = statusBottom + 8; }
    }
    if (G.mode === 'play' || G.mode === 'intro') banner(ctx, G, obj, bx, by, bw, bh, flat);
    const bannerBottom = by + bh;

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

    // ---- toasts
    for (let i = toasts.length - 1; i >= 0; i--) { toasts[i].life -= dt; if (toasts[i].life <= 0) toasts.splice(i, 1); }
    let ty = narrow ? bannerBottom + 26 : Math.max(TOP + 66, under ? 0 : bannerBottom + 22);
    const tmax = narrow ? VW - 24 : Math.max(240, VW - 2 * (L + SW + 10));
    for (const t of toasts.slice(focus || phone ? -1 : narrow ? -3 : -4)) {
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
        ctx.fillStyle = tier.color; ctx.fillText(tier.text, 0, 0, VW - 30);
        ctx.restore(); ctx.globalAlpha = 1;
      }
    }

    // ---- "How democracy is being spoiled": one card per tactic, the first time it shows up
    // (held back near the office; the end screen lists them all)
    // (phones skip them: they cover the lower half of the street)
    if (phone) tactics.queue.length = 0;
    if (!tactics.cur && tactics.queue.length && !focus) tactics.cur = { t: tactics.queue.shift(), life: 5 };
    if (tactics.cur && !focus && !phone) {
      const c = tactics.cur, T = c.t;
      c.life -= dt;
      if (c.life <= 0) tactics.cur = null;
      else {
        const all = window.Content.TACTICS, n = all.indexOf(T) + 1;
        const w = Math.min(460, VW - 24), h = 62, x = (VW - w) / 2, y = BOT - (touch ? 196 : 70) - h;
        ctx.globalAlpha = Math.min(1, c.life / 0.4, (5 - c.life) / 0.25);
        ctx.fillStyle = 'rgba(20,14,8,.9)'; rr(ctx, x, y, w, h, 12); ctx.fill();
        ctx.fillStyle = '#e53935'; rr(ctx, x, y, 6, h, 3); ctx.fill();
        text(ctx, 'HOW DEMOCRACY IS SPOILED · ' + n + '/' + all.length, x + 18, y + 14, 10, '#ff8a80', 'left', 900, w - 30);
        text(ctx, T.title, x + 18, y + 33, 15, '#fff', 'left', 900, w - 30);
        text(ctx, T.text, x + 18, y + 51, 11.5, '#ffe0b2', 'left', 700, w - 30);
        ctx.globalAlpha = 1;
      }
    }

    // ---- touch joystick (a ghost one with a hint until the first walk)
    const st = window.Input.stick;
    if (st && Math.hypot(st.x - st.ox, st.y - st.oy) > 12) walked = true;
    if (touch && !st && !walked && (G.mode === 'play' || G.mode === 'intro')) {
      const gx = 90, gy = VH - (phone ? 150 : 170), pulse = 0.55 + 0.25 * Math.sin(time * 4), nudge = Math.sin(time * 3) * 18;
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(gx, gy, 50, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(gx + nudge * 0.6, gy - Math.abs(nudge), 22, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.font = '900 13px system-ui,sans-serif';
      const tw = ctx.measureText('Drag here to walk').width + 20;
      ctx.fillStyle = 'rgba(20,14,8,.85)'; rr(ctx, gx - tw / 2, gy + 60, tw, 24, 12); ctx.fill();
      text(ctx, 'Drag here to walk', gx, gy + 72, 13, '#fff', 'center', 900);
    }
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
    const G = game.state, M = G.M;
    const w = Math.min(560, VW - 24), pad = 20, inner = w - pad * 2;
    ctx.font = '700 14px system-ui,sans-serif';
    const phone = touch && (VW < 640 || VH < 450);
    const intro = phone ? [] : wrap(ctx, game.text(M.intro), inner);
    const steps = phone
      ? [['🏛️', 'Walk to the ' + M.goal], ['⏳', 'Stand in the blue circle to file'], ['🗳️', window.Content.OPPONENT.short + ' goons and lathis kill democracy']]
      : [['🏛️', 'Find your way through the streets to the ' + M.goal], ['⏳', 'Stand in the blue circle until it is filed'], ['🗳️', window.Content.OPPONENT.short + ' goons and police lathis kill democracy. At 0% it is over']];
    const tips = phone
      ? ['Drag on the left to walk · tap = slogan', 'Walk into people to grow your crowd']
      : touch
      ? ['Drag on the left to walk · drag far to run · tap = slogan', 'Walk into people to grow your crowd', '3+ supporters close = police can\u2019t grab you']
      : ['WASD / arrows or hold the mouse to walk · Shift / right-click to run', 'Walk into people to grow your crowd · Space = slogan', '3+ supporters close = police can\u2019t grab you'];
    const h = 50 + intro.length * 19 + 10 + steps.length * 26 + 40 + tips.length * 17 + 30 + 36;
    const x = (VW - w) / 2;
    let y = Math.max(8, (VH - h) / 2);
    ctx.fillStyle = 'rgba(0,0,0,.4)'; ctx.fillRect(0, 0, VW, VH);
    ctx.fillStyle = '#f6eedd'; rr(ctx, x, y, w, h, 16); ctx.fill();
    const band = ctx.createLinearGradient(x, 0, x + w, 0);
    band.addColorStop(0, '#0f1b61'); band.addColorStop(0.45, '#1a2d8a'); band.addColorStop(0.75, '#00a651'); band.addColorStop(1, '#ffd700');
    ctx.fillStyle = band; rr(ctx, x, y, w, 10, 5); ctx.fill();
    text(ctx, M.title.toUpperCase(), x + w / 2, y + 34, 19, '#0f1b61', 'center', 900, inner);
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
    text(ctx, phone ? '➜ Follow the gold arrow at your feet' : '➜ Follow the gold arrow at your feet and the NEXT banner', x + w / 2, cy + 10, 12.5, '#8a4b00', 'center', 800, inner - 16);
    cy += 40;
    tips.forEach((l) => { text(ctx, l, x + w / 2, cy, 12, '#2e4a7a', 'center', 700, inner); cy += 17; });
    // who is who
    cy += 8;
    const leg = window.Content.LEGEND.slice(0, 3), cw = inner / leg.length;
    leg.forEach((L, i) => {
      const lx = x + pad + cw * i + 10;
      ctx.fillStyle = L.color; ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(lx, cy, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      text(ctx, L.label.replace(/ \(.*\)/, ''), lx + 12, cy + 1, 11, '#1d1a16', 'left', 800, cw - 26); // the full name is in the intro text above
    });
    cy += 22;
    text(ctx, touch ? 'Tap or drag to start' : 'Press a move key or Space to start', x + w / 2, y + h - 16, 12, '#9a8670', 'center', 700);
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
    text(ctx, '🗺️ Town map', VW / 2, y - 38, 16, '#fff', 'center', 900, VW - 24);
    text(ctx, 'NEXT: ' + nextLine(G, o) + ' · ' + metres(G, o) + ' m', VW / 2, y - 16, 12.5, o.color, 'center', 800, VW - 24);
    window.Render.drawBigMap(x, y, size, o);
    ctx.font = '700 11.5px system-ui,sans-serif';
    const items = ['➤ You', '🏛️ ' + G.M.goal, '🚓 Police station', '🚩 Party office', '⭕ Section 144 ring'];
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
    tier(name, color, life) { tier = { text: name, color: color || '#ffd54f', life: life || 1.6 }; },
    demoHit() { demoPulse = 1; },
    reset() { walked = false; toasts.length = 0; tier = null; tactics.seen.clear(); tactics.queue.length = 0; tactics.cur = null; },
    tactic(id) {
      if (tactics.seen.has(id)) return;
      const T = window.Content.TACTICS.find((t) => t.id === id);
      if (!T) return;
      tactics.seen.add(id); tactics.queue.push(T);
    },
    inFocus,
    get tacticsSeen() { return window.Content.TACTICS.filter((t) => tactics.seen.has(t.id)); },
  };
})();
