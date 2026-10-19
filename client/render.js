// Top-down canvas renderer: cached map chunks, people, sites, barricades, gas, ambient traffic, minimap, fx.
'use strict';
(function () {
  const { TILE, N, WORLD, K, DT, makeRng, hashStr } = window.World;
  const T = TILE;
  const CH = 16; // tiles per cached chunk
  const COL = {
    [K.GRASS]: '#9cc46a', [K.ROAD]: '#5d5d63', [K.WALK]: '#d8d0c2', [K.BUILD]: '#c9b79c', [K.WATER]: '#4c9bd0',
    [K.BRIDGE]: '#b9b0a2', [K.WALL]: '#a3553c', [K.PARK]: '#86bd59', [K.TREE]: '#86bd59', [K.PLAZA]: '#e8dfca', [K.FIELD]: '#a5d06b', [K.PALM]: '#a5d06b',
  };

  let cv, ctx, W = 0, H = 0, DPR = 1, zoom = 1, quality = 'hi', bottomPad = 0;
  let ps = 1; // people size setting: scales people, their head icons and bubbles (not the map or hit boxes)
  let map = null, G = null;
  const cam = { x: 0, y: 0, shake: 0 };
  const chunks = new Map();
  let chunkRes = 0, time = 0, mini = null;
  let particles = [], ambient = [], debris = [], hurtT = 0;
  const bubbles = new Map();
  let bubbleSeq = 0;
  let freeMap = null, fields = new Map(), routeCache = {}, guideAng = null;
  const TAU = Math.PI * 2;
  const NAVY = '#0f1b61', NAVY2 = '#1a2d8a', GREEN = '#00a651', GOLD = '#ffd700'; // YSRCP brand colours
  // shirt colours: blue = YSRCP, yellow = the opponent's goons (Content.OPPONENT), white = the public
  const BLUE = '#2156d1', BLUE_S = ['#2156d1', '#1a49b8'], YELLOW = '#fbc02d', YELLOW_S = ['#fbc02d', '#fdd835'], WHITES = ['#fafafa', '#f1f1ee', '#eceff1'];

  function resize(q) {
    if (q) quality = q;
    W = innerWidth; H = innerHeight;
    const ideal = Math.min(window.devicePixelRatio || 1, quality === 'hi' ? 2.5 : 1.25);
    DPR = Math.max(1, Math.min(ideal, Math.sqrt((quality === 'hi' ? 4.5e6 : 1.8e6) / (W * H))));
    cv.width = Math.ceil(W * DPR); cv.height = Math.ceil(H * DPR);
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    // Big screens see ~680 world px on the short side; phones zoom in (~0.8) so people stay readable.
    const short = Math.min(W, H - bottomPad);
    zoom = Math.max(0.72, Math.min(1.5, short >= 680 ? short / 680 : 0.8 + (short - 400) / 1400));
    const res = Math.min(2, zoom * DPR);
    if (Math.abs(res - chunkRes) > 0.01) { chunkRes = res; chunks.clear(); }
  }

  // ------------------------------------------------------------ setup
  function setGame(game) {
    G = game.state; map = G.map;
    chunks.clear(); particles = []; bubbles.clear(); debris = []; hurtT = 0;
    freeMap = Object.assign({}, map, { dyn: new Uint8Array(N * N) }); // plan through barricades: pushing breaks them
    fields = new Map(); routeCache = {}; radarT = -1; gateSig = ''; guideAng = null;
    cam.x = G.player.x; cam.y = G.player.y;
    buildMini();
    const rng = makeRng(map.seed ^ 0xabc);
    ambient = [];
    const A = map.arterials;
    if (A && (A.x.length || A.y.length)) for (let i = 0; i < 12; i++) {
      const vert = A.x.length > 0 && (!A.y.length || rng() < 0.5), line = rng.pick(vert ? A.x : A.y), lane = rng() < 0.5 ? 0 : 2, dir = lane === 0 ? 1 : -1;
      ambient.push({ vert, c: (line + lane + 0.5) * T, p: rng() * WORLD, dir: vert ? -dir : dir, v: 70 + rng() * 60, kind: rng() < 0.75 ? 'auto' : 'bike', hue: rng.int(3) });
    }
  }
  function buildMini() {
    mini = document.createElement('canvas');
    mini.width = N; mini.height = N;
    const m = mini.getContext('2d');
    const img = m.createImageData(N, N);
    const rgb = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
    const pal = {};
    for (const k in COL) pal[k] = rgb(COL[k]);
    pal[K.BUILD] = [190, 170, 145];
    for (let i = 0; i < N * N; i++) { const c = pal[map.t[i]] || [0, 0, 0]; img.data[i * 4] = c[0]; img.data[i * 4 + 1] = c[1]; img.data[i * 4 + 2] = c[2]; img.data[i * 4 + 3] = 255; }
    m.putImageData(img, 0, 0);
  }

  // ------------------------------------------------------------ static chunks
  const th = (x, y) => ((x * 73856093) ^ (y * 19349663)) >>> 0;
  function chunk(cx, cy) {
    const key = cx + ',' + cy;
    let c = chunks.get(key);
    if (c) { chunks.delete(key); chunks.set(key, c); return c; }
    c = document.createElement('canvas');
    const px = CH * T;
    c.width = c.height = Math.ceil(px * chunkRes);
    const g = c.getContext('2d');
    g.scale(c.width / px, c.height / px); // fill the canvas exactly so chunk edges have no transparent seam
    g.translate(-cx * px, -cy * px);
    drawTiles(g, cx * CH, cy * CH);
    for (const b of map.buildings) if (b.x < (cx + 1) * px && b.x + b.w > cx * px && b.y < (cy + 1) * px && b.y + b.h > cy * px) drawBuilding(g, b);
    chunks.set(key, c);
    if (chunks.size > 36) chunks.delete(chunks.keys().next().value);
    return c;
  }
  function drawTiles(g, x0, y0) {
    const A = map.arterials;
    for (let ty = y0; ty < Math.min(N, y0 + CH); ty++) for (let tx = x0; tx < Math.min(N, x0 + CH); tx++) {
      const k = map.t[ty * N + tx], x = tx * T, y = ty * T, h = th(tx, ty);
      g.fillStyle = COL[k]; g.fillRect(x, y, T + 0.5, T + 0.5);
      if (k === K.GRASS || k === K.PARK || k === K.TREE) {
        g.fillStyle = 'rgba(60,120,40,.25)';
        g.fillRect(x + (h % 26), y + ((h >> 5) % 26), 3, 3); g.fillRect(x + ((h >> 10) % 28), y + ((h >> 15) % 28), 2, 2);
      } else if (k === K.FIELD || k === K.PALM) {
        g.fillStyle = 'rgba(70,130,40,.35)'; for (let i = 4; i < T; i += 8) g.fillRect(x, y + i, T, 2);
      } else if (k === K.WALK) {
        g.fillStyle = 'rgba(0,0,0,.06)'; g.fillRect(x, y, T, 1); g.fillRect(x, y, 1, T);
      } else if (k === K.PLAZA) {
        g.fillStyle = 'rgba(0,0,0,.05)'; if ((tx + ty) % 2) g.fillRect(x, y, T, T);
      } else if (k === K.WATER) {
        g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(x + (h % 20), y + 8 + ((h >> 4) % 14), 10, 2);
      } else if (k === K.BRIDGE) {
        const up = map.t[(ty - 1) * N + tx], dn = map.t[(ty + 1) * N + tx];
        const lf = map.t[ty * N + tx - 1], rt = map.t[ty * N + tx + 1];
        g.fillStyle = '#7d756a';
        if (up === K.WATER) g.fillRect(x, y, T, 3);
        if (dn === K.WATER) g.fillRect(x, y + T - 3, T, 3);
        if (lf === K.WATER) { g.fillRect(x, y, 4, T); g.fillStyle = '#5d564c'; g.fillRect(x + 1, y + 4, 2, 2); g.fillRect(x + 1, y + 20, 2, 2); g.fillStyle = '#7d756a'; }
        if (rt === K.WATER) { g.fillRect(x + T - 4, y, 4, T); }
      } else if (k === K.WALL) {
        g.fillStyle = 'rgba(0,0,0,.2)'; g.fillRect(x, y + 15, T, 2); g.fillRect(x + (ty % 2 ? 8 : 24), y, 2, 15); g.fillRect(x + (ty % 2 ? 24 : 8), y + 17, 2, 15);
      } else if (k === K.ROAD) {
        // dashed centre line on arterials
        if (A.x.some((a) => tx === a + 1) && ty % 2 === 0 && !A.y.some((a) => ty >= a && ty <= a + 2)) { g.fillStyle = '#e8e2c8'; g.fillRect(x + 14, y + 4, 4, 16); }
        if (A.y.some((a) => ty === a + 1) && tx % 2 === 0 && !A.x.some((a) => tx >= a && tx <= a + 2)) { g.fillStyle = '#e8e2c8'; g.fillRect(x + 4, y + 14, 16, 4); }
        g.fillStyle = 'rgba(255,255,255,.04)'; g.fillRect(x + (h % 24), y + ((h >> 6) % 24), 6, 3);
      }
      if (k === K.PALM) { // coconut palm: shadow, then fronds radiating from the crown
        const a0 = (h % 628) / 100;
        g.fillStyle = 'rgba(0,0,0,.16)'; g.beginPath(); g.arc(x + 20, y + 20, 14, 0, Math.PI * 2); g.fill();
        g.strokeStyle = '#2e7d32'; g.lineWidth = 4; g.lineCap = 'round';
        for (let i = 0; i < 7; i++) { const a = a0 + (i * Math.PI * 2) / 7; g.beginPath(); g.moveTo(x + 16, y + 16); g.quadraticCurveTo(x + 16 + Math.cos(a + 0.3) * 10, y + 16 + Math.sin(a + 0.3) * 10, x + 16 + Math.cos(a) * 17, y + 16 + Math.sin(a) * 17); g.stroke(); }
        g.lineCap = 'butt';
        g.fillStyle = '#6d4c41'; g.beginPath(); g.arc(x + 16, y + 16, 3.5, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#8d6e63'; g.beginPath(); g.arc(x + 19, y + 15, 2, 0, Math.PI * 2); g.arc(x + 14, y + 19, 2, 0, Math.PI * 2); g.fill();
      }
      if (k === K.TREE) {
        g.fillStyle = 'rgba(0,0,0,.18)'; g.beginPath(); g.arc(x + 19, y + 19, 17, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#3f8a35'; g.beginPath(); g.arc(x + 16, y + 16, 17, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#58a948'; g.beginPath(); g.arc(x + 12, y + 12, 9, 0, Math.PI * 2); g.fill();
      }
    }
  }
  function drawBuilding(g, b) {
    // drop shadow, roof, parapet and rooftop clutter
    g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(b.x + 5, b.y + 6, b.w, b.h);
    if (b.kind === 'stall') { // striped awning toward the street, goods peeking out on the other side
      const AWN = [['#e53935', '#fafafa'], ['#1e88e5', '#fafafa'], ['#43a047', '#fff59d'], ['#fb8c00', '#fff3e0'], ['#8e24aa', '#f3e5f5']][b.awning || 0];
      const r = makeRng(b.seed || 1), up = b.face > 0, ay = up ? b.y : b.y + 8, ah = b.h - 8;
      g.fillStyle = '#8d6e63'; g.fillRect(b.x + 2, up ? b.y + b.h - 10 : b.y, b.w - 4, 10);
      for (let i = 0; i < 4; i++) { const c = ['#ffca28', '#ef5350', '#66bb6a', '#ffa726', '#fff59d'][r.int(5)]; g.fillStyle = c; g.beginPath(); g.arc(b.x + 8 + i * ((b.w - 16) / 3), up ? b.y + b.h - 5 : b.y + 5, 3, 0, Math.PI * 2); g.fill(); }
      const n = 6;
      for (let i = 0; i < n; i++) { g.fillStyle = AWN[i % 2]; g.fillRect(b.x + (i * b.w) / n, ay, b.w / n + 0.5, ah); }
      g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(b.x, up ? ay + ah - 3 : ay, b.w, 3);
      for (let i = 0; i < n; i++) { g.fillStyle = AWN[i % 2]; g.beginPath(); const sx = b.x + (i * b.w) / n, sy = up ? ay + ah : ay; g.arc(sx + b.w / n / 2, sy, b.w / n / 2, up ? 0 : Math.PI, up ? Math.PI : Math.PI * 2); g.fill(); }
      return;
    }
    if (b.kind === 'statue') { // Gandhi Circle: a round garden island with flowers and a statue on a pedestal
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2, R = b.w / 2;
      g.fillStyle = COL[K.ROAD]; g.fillRect(b.x, b.y, b.w, b.h);
      g.fillStyle = '#d7ccc8'; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#7cb342'; g.beginPath(); g.arc(cx, cy, R - 5, 0, Math.PI * 2); g.fill();
      for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; g.fillStyle = i % 2 ? '#ff7043' : '#ffee58'; g.beginPath(); g.arc(cx + Math.cos(a) * (R - 11), cy + Math.sin(a) * (R - 11), 3.2, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.arc(cx + 4, cy + 5, 17, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#eceff1'; g.beginPath(); g.arc(cx, cy, 17, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#90a4ae'; g.lineWidth = 2; g.stroke();
      g.fillStyle = '#b0bec5'; g.beginPath(); g.arc(cx, cy, 11, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#78909c'; g.beginPath(); g.ellipse(cx, cy + 1, 6, 8, 0, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(cx, cy - 5, 4, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#78909c'; g.lineWidth = 2; g.beginPath(); g.moveTo(cx + 4, cy); g.lineTo(cx + 10, cy + 9); g.stroke();
      return;
    }
    if (b.kind === 'busstand') { // a red-roofed shelter with a bench line
      g.fillStyle = '#c62828'; g.fillRect(b.x, b.y, b.w, b.h);
      g.fillStyle = '#e53935'; for (let x = b.x + 4; x < b.x + b.w - 4; x += 12) g.fillRect(x, b.y + 4, 6, b.h - 8);
      g.fillStyle = '#fff'; g.fillRect(b.x + b.w / 2 - 22, b.y + b.h / 2 - 6, 44, 12);
      g.fillStyle = '#c62828'; g.font = '900 9px system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('APSRTC', b.x + b.w / 2, b.y + b.h / 2 + 0.5);
      return;
    }
    g.fillStyle = b.color; g.fillRect(b.x, b.y, b.w, b.h);
    g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 3; g.strokeRect(b.x + 1.5, b.y + 1.5, b.w - 3, b.h - 3);
    if (b.kind === 'house') {
      const r = makeRng(b.seed || 1);
      if (b.tank) { const tx = b.x + 8 + r() * (b.w - 24), ty = b.y + 8 + r() * (b.h - 24); g.fillStyle = '#263238'; g.beginPath(); g.arc(tx + 7, ty + 7, 7, 0, Math.PI * 2); g.fill(); g.fillStyle = '#455a64'; g.beginPath(); g.arc(tx + 6, ty + 6, 3, 0, Math.PI * 2); g.fill(); }
      if (r() < 0.6) { g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(b.x + b.w - 22, b.y + b.h - 20, 14, 12); }
      if (r() < 0.3) { g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = 1; g.beginPath(); g.moveTo(b.x + 6, b.y + 10); g.lineTo(b.x + b.w - 6, b.y + 14); g.stroke(); }
    } else if (b.kind === 'temple') {
      g.fillStyle = '#ffca28'; for (let i = 0; i < 4; i++) g.fillRect(b.x + 6 + i * 5, b.y + 6 + i * 5, b.w - 12 - i * 10, b.h - 12 - i * 10);
      g.fillStyle = '#e65100'; g.beginPath(); g.arc(b.x + b.w / 2, b.y + b.h / 2, 5, 0, Math.PI * 2); g.fill();
    } else if (b.kind === 'hospital') {
      g.fillStyle = '#e53935'; g.fillRect(b.x + b.w / 2 - 4, b.y + b.h / 2 - 14, 8, 28); g.fillRect(b.x + b.w / 2 - 14, b.y + b.h / 2 - 4, 28, 8);
    } else if (b.kind === 'station') {
      // flat RCC roof with a khaki parapet, stair head and tank, the police star, and the sign on the street side
      g.fillStyle = '#e6dcc4'; g.fillRect(b.x, b.y, b.w, b.h);
      g.fillStyle = 'rgba(0,0,0,.05)';
      for (let x = b.x + 16; x < b.x + b.w - 6; x += 16) g.fillRect(x, b.y + 6, 1, b.h - 12);
      for (let y = b.y + 16; y < b.y + b.h - 6; y += 16) g.fillRect(b.x + 6, y, b.w - 12, 1);
      g.strokeStyle = '#a1885a'; g.lineWidth = 6; g.strokeRect(b.x + 3, b.y + 3, b.w - 6, b.h - 6);
      g.fillStyle = '#cbbd9e'; g.fillRect(b.x + b.w - 42, b.y + 10, 30, 22);
      g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 2; g.strokeRect(b.x + b.w - 42, b.y + 10, 30, 22);
      g.fillStyle = '#263238'; g.beginPath(); g.arc(b.x + 22, b.y + 22, 9, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#455a64'; g.beginPath(); g.arc(b.x + 21, b.y + 21, 4, 0, Math.PI * 2); g.fill();
      const ex = b.x + b.w / 2, ey = b.y + 30;
      g.fillStyle = '#fff'; g.beginPath(); g.arc(ex, ey, 16, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#0d47a1'; g.lineWidth = 3; g.stroke();
      g.fillStyle = '#0d47a1'; g.beginPath();
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 4.5 : 11; g.lineTo(ex + Math.cos(a) * r, ey + Math.sin(a) * r); }
      g.closePath(); g.fill();
      const sy = b.y + b.h - 30;
      g.fillStyle = '#c62828'; g.fillRect(b.x + 6, sy - 4, b.w - 12, 4);
      g.fillStyle = '#0d47a1'; g.fillRect(b.x + 6, sy, b.w - 12, 22);
      g.fillStyle = '#fff'; g.font = '900 13px system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('POLICE STATION', b.x + b.w / 2, sy + 11.5, b.w - 20);
    } else if (b.kind === 'office' || b.kind === 'booth' || b.kind === 'party') {
      g.fillStyle = 'rgba(0,0,0,.08)'; for (let x = b.x + 10; x < b.x + b.w - 10; x += 22) g.fillRect(x, b.y + 8, 12, b.h - 16);
    }
  }

  // ------------------------------------------------------------ people
  // Top-down people, facing +x after rotation: legs and arms swing with speed, hair covers the head,
  // and a sliver of face shows at the front so the walking direction reads at a glance.
  const SHIRTS = ['#f5f5f5', '#ffcc80', '#a5d6a7', '#ce93d8', '#90caf9', '#ffab91', '#fff59d', '#b0bec5'];
  const SKIN = ['#8d5a3b', '#a86b45', '#7b4a2e', '#9c6644', '#b07a52'];
  const SAREES = ['#d81b60', '#8e24aa', '#ef6c00', '#2e7d32', '#c62828', '#00897b', '#f9a825', '#3949ab'];
  const LUNGI = ['#eceff1', '#5d4037', '#37474f', '#1565c0', '#ffffff'];
  const OUT = 'rgba(30,20,10,.5)';
  function blob(x, y, rx, ry, color, stroke) {
    ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.fill();
    if (stroke) ctx.stroke();
  }
  function person(x, y, e, o) {
    const r = 9, fx = e.fx || 0, fy = e.fy === undefined ? 1 : e.fy, sc = (o.scale || 1) * ps;
    const ang = Math.atan2(fy, fx);
    const amp = o.hurt ? 0 : Math.min(1, Math.hypot(e.vx || 0, e.vy || 0) / 90);
    const ph = Math.sin(time * (amp > 0.9 ? 15 : 11) + e.id * 1.7) * 4.2 * amp;
    blob(x + 2.5 * sc, y + 3.5 * sc, r * 0.95 * sc, r * 0.72 * sc, 'rgba(0,0,0,.2)');
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.scale(1.12 * sc, 1.12 * sc); // drawn a touch larger than the collision box
    ctx.lineWidth = 1.1; ctx.strokeStyle = OUT; ctx.lineJoin = 'round';
    // legs: only the stride pokes out from under the body (sitting: stretched out in front)
    if (o.saree) {
      if (o.hurt) blob(3, 0, r * 0.95, r * 0.9, o.saree, true);
      else { blob(ph * 0.3 + 1, -2.6, 3, 2, o.skin); blob(-ph * 0.3 + 1, 2.6, 3, 2, o.skin); }
      blob(-0.5, 0, r * 0.78, r * 0.92, o.saree, true);
    } else if (o.hurt) {
      blob(6, -3, 5, 2.2, o.legs); blob(6, 3, 5, 2.2, o.legs);
      blob(10.5, -3, 1.6, 1.9, '#3e2723'); blob(10.5, 3, 1.6, 1.9, '#3e2723');
    } else {
      blob(ph + 1, -3.6, 4, 2.2, o.legs); blob(-ph + 1, 3.6, 4, 2.2, o.legs);
      blob(ph + 4.4, -3.6, 1.6, 1.9, o.kidLegs || '#3e2723'); blob(-ph + 4.4, 3.6, 1.6, 1.9, o.kidLegs || '#3e2723');
    }
    if (o.satchel) { ctx.fillStyle = o.satchel; ctx.fillRect(-r * 0.95, -4.5, 5, 9); ctx.strokeRect(-r * 0.95, -4.5, 5, 9); }
    // arms swing against the legs; the right hand (+y) holds props (hurt: both hands go to the head, drawn later)
    const sw = -ph * 0.8;
    if (!o.hurt) for (const s of [-1, 1]) {
      const a = s < 0 ? sw : -sw, wind = o.windup && s > 0;
      if (o.salute && s > 0) { blob(2, r * 0.7, 3.2, 2.4, o.sleeve || o.shirt); blob(4, 3.6, 2.1, 2.1, o.skin); continue; } // hand to the cap
      blob(wind ? -3 : a * 0.45, s * r * 0.86, 3.2, 2.4, o.sleeve || o.shirt);
      blob(wind ? -7 : a + 1, s * (r + (wind ? 2.5 : 0.6)), 2.1, 2.1, o.skin);
    }
    if (o.windup) { blob(-8.5, r + 3.5, 2.8, 2.6, '#9e9e9e', true); blob(-9.2, r + 2.8, 0.9, 0.9, '#e0e0e0'); }
    const hx = -sw + 1, hy = r + 0.6;
    if (o.prop === 'lathi' && !o.salute) { ctx.strokeStyle = '#6d4c41'; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(hx - 3, hy + 1); ctx.lineTo(hx + 13, hy - 3); ctx.stroke(); ctx.strokeStyle = OUT; ctx.lineWidth = 1.1; }
    if (o.prop === 'papers') { ctx.save(); ctx.translate(hx + 3, hy - 1); ctx.rotate(-0.3); ctx.fillStyle = '#fff'; ctx.fillRect(-1, -3, 8, 6); ctx.strokeRect(-1, -3, 8, 6); ctx.fillStyle = '#90a4ae'; ctx.fillRect(1, -1, 4, 1); ctx.fillRect(1, 1, 3, 1); ctx.restore(); }
    // torso
    blob(0, 0, r * 0.56, r, o.shirt, true);
    if (o.saree) { // pallu over the left shoulder with a zari border
      ctx.save(); ctx.beginPath(); ctx.ellipse(0, 0, r * 0.56, r, 0, 0, TAU); ctx.clip();
      ctx.fillStyle = o.saree; ctx.beginPath(); ctx.moveTo(-r, -r); ctx.lineTo(r * 0.2, -r); ctx.lineTo(-r * 0.2, r * 0.4); ctx.lineTo(-r, r * 0.2); ctx.fill();
      ctx.strokeStyle = '#ffca28'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(r * 0.2, -r); ctx.lineTo(-r * 0.2, r * 0.4); ctx.stroke();
      ctx.restore(); ctx.strokeStyle = OUT; ctx.lineWidth = 1.1;
    }
    if (o.towel) { ctx.fillStyle = o.towel; ctx.fillRect(-3.5, -r * 1.02, 6, 4.5); ctx.strokeRect(-3.5, -r * 1.02, 6, 4.5); }
    if (o.belt) { ctx.fillStyle = o.belt; ctx.fillRect(-1, -r * 0.95, 2.2, r * 1.9); }
    if (o.scarf) { // party kanduva around the neck (YSRCP: green with a navy edge)
      if (o.garland) { ctx.strokeStyle = NAVY; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0.5, 0, 5.4, -Math.PI * 0.75, Math.PI * 0.75); ctx.stroke(); }
      ctx.strokeStyle = o.scarf; ctx.lineWidth = o.garland ? 2.4 : 1.5; ctx.beginPath(); ctx.arc(0.5, 0, 5.4, -Math.PI * 0.6, Math.PI * 0.6); ctx.stroke();
      ctx.strokeStyle = OUT; ctx.lineWidth = 1.1;
    }
    if (o.garland) for (let i = 0; i < 9; i++) { const a = -Math.PI * 0.8 + (i * Math.PI * 1.6) / 8; blob(0.5 + Math.cos(a) * 6.3, Math.sin(a) * 6.3, 1.5, 1.5, i % 2 ? '#ffeb3b' : '#ff9800'); }
    if (o.chain) { ctx.strokeStyle = '#ffd54f'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(1, 0, 5.6, -0.9, 0.9); ctx.stroke(); ctx.strokeStyle = OUT; ctx.lineWidth = 1.1; }
    if (o.prop === 'flag') {
      ctx.strokeStyle = '#6d4c41'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx - 6, hy + 6); ctx.stroke();
      const wv = Math.sin(time * 8 + e.id) * 1.5;
      ctx.save(); ctx.beginPath(); ctx.moveTo(hx - 6, hy + 6); ctx.lineTo(hx - 15, hy + 3 + wv); ctx.lineTo(hx - 14, hy + 9 + wv); ctx.lineTo(hx - 6, hy + 11); ctx.closePath(); ctx.clip();
      ctx.fillStyle = NAVY; ctx.fillRect(hx - 16, hy + 2 + wv, 11, 3.2); ctx.fillStyle = '#fff'; ctx.fillRect(hx - 16, hy + 5.2 + wv * 0.6, 11, 2.6); ctx.fillStyle = GREEN; ctx.fillRect(hx - 16, hy + 7.8 + wv * 0.3, 11, 4);
      ctx.restore();
      ctx.strokeStyle = OUT; ctx.lineWidth = 1.1;
    }
    // head: face sliver at the front, hair or headgear on top
    const hr = r * 0.5;
    blob(0.9, 0, hr, hr, o.skin, true);
    if (o.cap) {
      blob(-0.3, 0, hr + 0.4, hr + 0.4, o.cap, true);
      ctx.fillStyle = o.brim; ctx.beginPath(); ctx.ellipse(hr * 0.75, 0, 2.3, hr * 0.85, 0, -Math.PI / 2, Math.PI / 2); ctx.fill();
      if (o.badge) blob(hr * 0.35, 0, 1.1, 1.1, o.badge);
    } else if (o.bandana) {
      blob(-0.6, 0, hr * 0.95, hr * 0.95, o.hair);
      ctx.fillStyle = o.bandana; ctx.beginPath(); ctx.ellipse(-0.6, 0, hr * 0.95, hr * 0.95, 0, Math.PI * 0.6, Math.PI * 1.4); ctx.lineTo(1.5, -hr * 0.5); ctx.lineTo(1.5, hr * 0.5); ctx.fill();
      ctx.strokeStyle = o.bandana; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(-hr, 0); ctx.lineTo(-hr - 4, -2 + ph * 0.3); ctx.moveTo(-hr, 0); ctx.lineTo(-hr - 4, 2.5 - ph * 0.3); ctx.stroke();
      ctx.strokeStyle = OUT; ctx.lineWidth = 1.1;
    } else {
      blob(-0.7, 0, hr * 0.94, hr * 0.96, o.hair);
      if (o.bun) { blob(-hr - 1.3, 0, 2.5, 2.5, o.hair, true); blob(-hr - 1.6, -1.8, 1.3, 1.3, '#fffde7'); blob(-hr - 1.6, 1.8, 1.3, 1.3, '#fffde7'); }
    }
    if (o.bandage) { ctx.strokeStyle = '#fafafa'; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(0, 0, hr * 0.9, hr * 1.02, 0, 0, TAU); ctx.stroke(); ctx.fillStyle = '#f5e6c8'; ctx.fillRect(-1.5, -hr - 1, 3, 2.2); ctx.strokeStyle = OUT; ctx.lineWidth = 1.1; }
    if (o.hurt) for (const s of [-1, 1]) { blob(-0.5, s * r * 0.75, 3, 2.3, o.sleeve || o.shirt); blob(0.5, s * 3.3, 2.1, 2.1, o.skin, true); }
    ctx.restore();
  }
  // a yellow party tag under every goon (the leader tag for the VIPs the gate opens for); text from Content.OPPONENT
  function tdpTag(x, y, leader) {
    const O = window.Content.OPPONENT, s = leader ? O.leaderTag : O.tag, size = 8.5 * ps;
    ctx.font = `900 ${size}px system-ui,sans-serif`;
    const w = ctx.measureText(s).width + 8 * ps, h = size * 1.5;
    ctx.fillStyle = '#5d1a00'; rr(x - w / 2 - 1.2, y - h / 2 - 1.2, w + 2.4, h + 2.4, 4 * ps); ctx.fill();
    ctx.fillStyle = '#ffd600'; rr(x - w / 2, y - h / 2, w, h, 3.5 * ps); ctx.fill();
    ctx.fillStyle = '#b71c1c'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(s, x, y + 0.5);
  }
  // the station forecourt: a sentry box at the gate, the national flag, and a jeep with its lights going
  function policeYard(b) {
    const Y = b.yard, mid = (Y.x0 + Y.x1) / 2, left = b.gate.x < mid;
    const nearX = left ? Y.x0 + 16 : Y.x1 - 16, farX = left ? Y.x1 - 36 : Y.x0 + 36;
    // sentry box: red-and-white roof by the gate
    const sx = nearX, sy = Y.y1 - 18;
    ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.fillRect(sx - 9, sy - 7, 22, 22);
    ctx.fillStyle = '#fafafa'; ctx.fillRect(sx - 11, sy - 11, 22, 22);
    ctx.fillStyle = '#c62828'; for (let i = 0; i < 4; i++) ctx.fillRect(sx - 11 + i * 6, sy - 11, 3, 22);
    ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1.5; ctx.strokeRect(sx - 11, sy - 11, 22, 22);
    // flag pole with the tricolour
    const fx = nearX, fy = Y.y0 + 50, wv = Math.sin(time * 5) * 1.6;
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(fx + 2, fy + 3, 6, 3, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#9e9e9e'; ctx.beginPath(); ctx.arc(fx, fy, 3.5, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#757575'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx, fy - 30); ctx.stroke();
    const dir = left ? 1 : -1;
    for (let i = 0; i < 12; i++) {
      const x = fx + dir * (1 + i * 2), w = Math.sin(time * 6 - i * 0.6) * wv;
      ctx.fillStyle = '#ff9933'; ctx.fillRect(x, fy - 30 + w, 2.2, 5);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(x, fy - 25 + w, 2.2, 5);
      ctx.fillStyle = '#138808'; ctx.fillRect(x, fy - 20 + w, 2.2, 5);
    }
    ctx.fillStyle = '#000080'; ctx.beginPath(); ctx.arc(fx + dir * 13, fy - 22.5 + Math.sin(time * 6 - 3.6) * wv, 1.6, 0, TAU); ctx.fill();
    // white jeep facing the gate, blue stripe, red/blue light bar
    const jx = farX, jy = (Y.y0 + Y.y1) / 2 - 4;
    ctx.save(); ctx.translate(jx, jy);
    ctx.fillStyle = 'rgba(0,0,0,.25)'; rr(-11, -23, 28, 52, 7); ctx.fill();
    ctx.fillStyle = '#212121'; for (const [wx, wy] of [[-15, -18], [11, -18], [-15, 10], [11, 10]]) ctx.fillRect(wx, wy, 4, 10);
    ctx.fillStyle = '#fafafa'; rr(-13, -26, 26, 52, 6); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.fillStyle = '#1565c0'; ctx.fillRect(-13, -4, 2.5, 22); ctx.fillRect(10.5, -4, 2.5, 22);
    ctx.fillStyle = '#37474f'; rr(-10, 8, 20, 8, 2); ctx.fill();
    ctx.fillStyle = '#eceff1'; rr(-10, -20, 20, 26, 3); ctx.fill();
    ctx.fillStyle = '#0d47a1'; ctx.font = '900 6px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('POLICE', 0, 21);
    const on = Math.floor(time * 4) % 2 === 0;
    ctx.fillStyle = '#263238'; rr(-10, -10, 20, 5, 2); ctx.fill();
    ctx.fillStyle = on ? '#ff1744' : '#5d1010'; ctx.fillRect(-9, -9, 8, 3);
    ctx.fillStyle = on ? '#0d1b4a' : '#2979ff'; ctx.fillRect(1, -9, 8, 3);
    ctx.globalAlpha = 0.3; ctx.fillStyle = on ? '#ff1744' : '#2979ff';
    ctx.beginPath(); ctx.arc(on ? -5 : 5, -7.5, 8, 0, TAU); ctx.fill();
    ctx.restore(); ctx.globalAlpha = 1;
  }
  function dazeStars(x, y, n) {
    for (let i = 0; i < (n || 3); i++) {
      const a = time * 5 + (i * TAU) / (n || 3);
      label('★', x + Math.cos(a) * 9, y + Math.sin(a) * 3.5, 8, '#ffd54f');
    }
  }
  function kite(x, y, e) { // a kid's kite on a string, drifting in the breeze
    const kx = x + 26 + Math.sin(time * 1.3 + e.id) * 6, ky = y - 34 + Math.cos(time * 1.7 + e.id) * 4;
    ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(x + 3, y); ctx.quadraticCurveTo(x + 18, y - 6, kx, ky + 7); ctx.stroke();
    ctx.save(); ctx.translate(kx, ky); ctx.rotate(Math.sin(time * 2 + e.id) * 0.25);
    ctx.fillStyle = ['#e53935', '#fdd835', '#43a047', '#8e24aa'][e.id % 4];
    ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(6, 0); ctx.lineTo(0, 7); ctx.lineTo(-6, 0); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 0.8; ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, -7); ctx.lineTo(0, 7); ctx.moveTo(-6, 0); ctx.lineTo(6, 0); ctx.stroke();
    ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, 7); ctx.quadraticCurveTo(-3, 12, 1, 16); ctx.stroke();
    ctx.restore();
  }
  function look(e) {
    const v = e.look || 0, id = e.id || 0;
    switch (e.kind) {
      case 'player': return { shirt: NAVY2, legs: '#eceff1', skin: '#9c6644', hair: '#1b1410', scarf: GREEN, garland: true, prop: 'papers' };
      case 'civ': {
        // white = the public; blue = YSRCP (they switch to blue when they join your crowd)
        const type = e.type || (id % 3 === 1 ? 'woman' : 'man'), ysr = e.mode === 'follow';
        let o;
        if (type === 'woman') o = ysr ? { shirt: BLUE, saree: BLUE_S[id % 2], skin: SKIN[(v + id) % 5], hair: '#1b1410', bun: true } : { shirt: WHITES[id % 3], saree: '#f3ede0', skin: SKIN[(v + id) % 5], hair: '#1b1410', bun: true };
        else if (type === 'child') o = { shirt: ysr ? BLUE : '#fafafa', legs: id % 2 ? '#1a237e' : '#5d4037', kidLegs: SKIN[(v + id) % 5], skin: SKIN[(v + id) % 5], hair: '#1b1410', satchel: id % 3 ? '#8d6e63' : '#c62828', scale: 0.74 };
        else o = { shirt: ysr ? BLUE : WHITES[id % 3], legs: LUNGI[id % 5], skin: SKIN[(v + id) % 5], hair: id % 7 === 0 ? '#9e9e9e' : '#1b1410', towel: !ysr && id % 5 === 0 ? '#eeeeee' : null };
        if (e.mode === 'follow') { o.scarf = GREEN; if (type === 'man' && id % 3 === 0) o.prop = 'flag'; }
        if (e.mode === 'hurt') o.hurt = true;
        if (e.bandage) o.bandage = true;
        return o;
      }
      case 'cop': return Object.assign(e.role === 'gas'
        ? { shirt: '#b0915a', legs: '#9c7f4c', skin: '#8d5a3b', cap: '#1c2b4a', brim: '#0d1526', badge: '#ffd54f', belt: '#4e342e', prop: 'lathi' }
        : { shirt: '#c8ab72', legs: '#b0915a', skin: '#8d5a3b', cap: '#a88a52', brim: '#4e3b1f', badge: '#ffd54f', belt: '#4e342e', prop: 'lathi' }, { salute: e.salute > 0 });
      case 'official': return { shirt: '#eceff1', legs: '#5d4037', skin: '#a86b45', hair: '#616161', towel: null };
      case 'goon': if (e.role === 'vip') return { shirt: YELLOW, legs: '#fafafa', skin: '#8d5a3b', hair: '#424242', scarf: '#f57f17', garland: true };
        return { shirt: YELLOW_S[id % 2], legs: '#212121', skin: '#7b4a2e', hair: '#1b1410', bandana: '#f57f17', chain: true, windup: e.throwT > 0 };
      default: return { shirt: '#999', legs: '#555', skin: '#8d5a3b', hair: '#1b1410' };
    }
  }

  function missile(kind, x, y, rot, onGround) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,.45)';
    if (kind === 'stone') {
      ctx.fillStyle = '#8d8d8d'; ctx.beginPath(); ctx.moveTo(-5, -1); ctx.lineTo(-2, -4.5); ctx.lineTo(3.5, -3.5); ctx.lineTo(5, 1); ctx.lineTo(1.5, 4.5); ctx.lineTo(-4, 3); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#c4c4c4'; ctx.beginPath(); ctx.arc(-1, -1.5, 1.4, 0, TAU); ctx.fill();
    } else if (kind === 'stick') {
      ctx.strokeStyle = '#5d4037'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-9, 0); ctx.lineTo(9, 0); ctx.stroke();
      ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(2, 0); ctx.lineTo(5, -3.5); ctx.stroke();
    } else { // chappal
      ctx.fillStyle = '#ef6c00'; rr(-6, -3, 12, 6, 3); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = '#fff3e0'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(1, -3); ctx.lineTo(3, 0); ctx.lineTo(1, 3); ctx.stroke();
    }
    ctx.restore();
    if (!onGround) { ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.beginPath(); ctx.arc(x - 2, y - 2, 1.2, 0, TAU); ctx.fill(); }
  }

  // ------------------------------------------------------------ the gate showdown
  function policeLine(b) { // cops with linked arms across the street; they part for the opponent's leaders
    const g = G.gate, o = g ? g.out : { x: 0, y: 1 }, sd = { x: -o.y, y: o.x };
    const parted = g && g.openT > 0, jig = b.pushT > 0 ? Math.sin(time * 50) * 1.5 : 0;
    const n = b.tiles.length * 2, span = b.tiles.length * T - 14;
    const pts = [];
    for (let i = 0; i < n; i++) {
      const k = (i / (n - 1) - 0.5) * span, push = parted ? Math.sign(k || 1) * 26 : 0;
      pts.push([b.x + sd.x * (k + push) + jig * o.x, b.y + sd.y * (k + push) + jig * o.y]);
    }
    if (!parted) {
      ctx.strokeStyle = '#c8ab72'; ctx.lineWidth = 4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (const p of pts) ctx.lineTo(p[0], p[1]); ctx.stroke();
    }
    for (const [x, y] of pts) person(x, y, { id: Math.round(x + y), fx: parted ? sd.x : o.x, fy: parted ? sd.y : o.y, vx: b.pushT > 0 ? 50 : 0, vy: 0 }, look({ kind: 'cop', role: 'patrol', salute: parted ? 1 : 0 }));
    if (b.hp < b.max) {
      ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(b.x - 30, b.y - 34, 60, 7);
      ctx.fillStyle = '#ff7043'; ctx.fillRect(b.x - 29, b.y - 33, 58 * (b.hp / b.max), 5);
    }
  }
  function gateLabels() { // drawn above people so the crowd doesn't hide them
    const g = G.gate, o = g.out;
    const b = g.line && G.barrs.includes(g.line) ? g.line : null;
    if (b) label(g.openT > 0 ? 'Make way for sir!' : 'POLICE LINE', b.x + o.x * 30, b.y + o.y * 30 - (b.hp < b.max ? 14 : 0), 11, '#fff', g.openT > 0 ? 'rgba(198,40,40,.9)' : 'rgba(21,101,192,.9)');
    if (g.shut && g.openT <= 0) {
      const gx = G.target.gate.x + o.x * 40, gy = G.target.gate.y + o.y * 40;
      label('🔒 GATE SHUT: LUNCH BREAK', gx, gy - 6, 11, '#c62828', 'rgba(255,248,225,.95)');
      if (g.pressure > 0) label('📣 ' + '●'.repeat(g.pressure) + '○'.repeat(Math.max(0, 4 - g.pressure)), gx, gy + 14, 11, '#fff', 'rgba(0,166,81,.92)');
    }
  }
  function drawGate() {
    const g = G.gate, o = g.out, sd = { x: -o.y, y: o.x };
    // iron gate: bars across the three gate tiles when shut, swung open while "guests" pass
    if (g.shut) {
      const xs = g.tiles.map((j) => ((j % N) + 0.5) * T), ys = g.tiles.map((j) => (Math.floor(j / N) + 0.5) * T);
      const cx = (xs[0] + xs[2]) / 2, cy = (ys[0] + ys[2]) / 2, half = 1.5 * T;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(Math.atan2(sd.y, sd.x));
      const swing = g.openT > 0 ? 0.25 : 1;
      ctx.fillStyle = '#263238';
      for (const side of [-1, 1]) {
        ctx.save(); ctx.translate(side * half, 0); ctx.scale(swing, 1);
        ctx.fillRect(side < 0 ? 0 : -half, -4, half, 8);
        for (let i = 3; i < half; i += 7) ctx.fillRect(side < 0 ? i : -i - 4, -13, 4, 26);
        ctx.fillStyle = '#ffca28'; ctx.fillRect(side < 0 ? half - 6 : -half, -2, 6, 4); ctx.fillStyle = '#263238';
        ctx.restore();
      }
      ctx.restore();
    }
    // the side wicket
    const w = g.wicket;
    if (w) {
      const locked = map.dyn[w.tile] === 2;
      ctx.fillStyle = locked ? '#5d4037' : 'rgba(93,64,55,.35)'; ctx.fillRect(w.x - 12, w.y - 12, 24, 24);
      if (locked) label('🔒', w.x, w.y, 12, '#000');
      else label('Side wicket', w.x + w.out.x * 24, w.y + w.out.y * 24, 10, '#fff', 'rgba(93,64,55,.9)');
    }
    // the clerk's desk
    const inv = { x: -o.x, y: -o.y };
    const clerk = G.ents.find((e) => e.kind === 'official');
    if (clerk) {
      const dx = clerk.x - inv.x * 14, dy = clerk.y - inv.y * 14;
      ctx.save(); ctx.translate(dx, dy); ctx.rotate(Math.atan2(sd.y, sd.x));
      ctx.fillStyle = '#8d6e63'; ctx.fillRect(-22, -6, 44, 12); ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 1; ctx.strokeRect(-22, -6, 44, 12);
      ctx.fillStyle = '#fff'; ctx.fillRect(-14, -4, 8, 6); ctx.fillRect(4, -3, 10, 5);
      ctx.restore();
      if (G.player.stallT > 0) label('⏸ ☕', clerk.x, clerk.y - 22, 12, '#000', 'rgba(255,248,225,.95)');
    }
  }

  // ------------------------------------------------------------ fx api
  function burst(x, y, n, colors, speed, size) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = (0.3 + Math.random()) * (speed || 160);
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.5 + Math.random() * 0.5, c: colors[i % colors.length], s: size || 4, drag: 3 });
    }
  }
  function popup(x, y, text, color) { particles.push({ x, y, vx: 0, vy: -50, life: 1.2, text, c: color || '#fff', drag: 0 }); }
  // Speech bubbles. Near the office only the candidate, the police and the clerk speak, three at a time.
  function say(ev) {
    const focus = G && window.Hud && window.Hud.inFocus(G);
    if (focus && ev.id) {
      const who = G.ents.find((e) => e.id === ev.id);
      if (who && (who.kind === 'civ' || who.kind === 'goon')) return;
    }
    const key = ev.id !== undefined ? 'e' + ev.id : 'b' + bubbleSeq++;
    bubbles.delete(key);
    bubbles.set(key, { id: ev.id, x: ev.x, y: ev.y, text: ev.text, color: ev.color || '#fff', life: 3 });
    while (bubbles.size > (focus ? 3 : 6)) bubbles.delete(bubbles.keys().next().value);
  }
  function shake(a) { cam.shake = Math.max(cam.shake, a); }
  function addDebris(x, y, kind) { debris.push({ x, y, kind, rot: Math.random() * TAU, life: 6 }); if (debris.length > 40) debris.shift(); }
  function hurtFlash(a) { hurtT = Math.max(hurtT, a || 0.6); }

  // ------------------------------------------------------------ text helpers
  function rr(x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function label(text, x, y, size, color, bg) {
    ctx.font = `800 ${size}px system-ui,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (bg) { const w = ctx.measureText(text).width + 10; ctx.fillStyle = bg; rr(x - w / 2, y - size * 0.7, w, size * 1.4, 4); ctx.fill(); }
    ctx.fillStyle = color; ctx.fillText(text, x, y);
  }

  // ------------------------------------------------------------ guidance: next objective + route along the streets
  function fieldFor(s) {
    let f = fields.get(s);
    if (!f) { f = window.World.field(freeMap, [[Math.floor(s.x / T), Math.floor(s.y / T)]]); fields.set(s, f); }
    return f;
  }
  const tileOf = (x, y) => Math.max(0, Math.min(N - 1, Math.floor(y / T))) * N + Math.max(0, Math.min(N - 1, Math.floor(x / T)));
  let gateSig = '';
  function syncGate() { // the shut gate and the locked wicket can't be pushed: plan around them
    const g = G.gate;
    const tiles = g ? g.tiles.concat(g.wicket ? [g.wicket.tile] : []) : [];
    let sig = '';
    for (const j of tiles) sig += map.dyn[j];
    if (sig === gateSig) return;
    gateSig = sig;
    freeMap.dyn = new Uint8Array(N * N);
    for (const j of tiles) if (map.dyn[j] === 2) freeMap.dyn[j] = 1;
    fields = new Map(); routeCache = {}; radarT = -1;
  }
  function objective() {
    syncGate();
    const site = G.target;
    return { site, x: site.x, y: site.y, goal: true, name: G.M.goal, where: 'Stand in the blue circle to file', icon: '🏛️', color: GOLD };
  }
  // Route from the player to the objective as world points, following the distance field (smoothed).
  function route(maxSteps) {
    const P = G.player, o = objective(), f = fieldFor(o.site);
    let i = tileOf(P.x, P.y);
    const key = i + '|' + o.site.x + ',' + o.site.y, hit = routeCache[maxSteps];
    if (hit && hit.key === key) return hit.pts;
    let pts = [[P.x, P.y]];
    if (f[i] < 0) pts.push([o.x, o.y]);
    else {
      for (let n = 0; n < maxSteps && f[i] > 0; n++) {
        const tx = i % N, ty = (i / N) | 0;
        let best = -1, bc = f[i];
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          if (!ox && !oy) continue;
          const nx = tx + ox, ny = ty + oy;
          if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
          const v = f[ny * N + nx];
          if (v < 0) continue;
          if (ox && oy && (window.World.solidAt(freeMap, tx + ox, ty) || window.World.solidAt(freeMap, tx, ty + oy))) continue;
          const c = v + (ox && oy ? 0.4 : 0);
          if (c < bc) { bc = c; best = ny * N + nx; }
        }
        if (best < 0) break;
        i = best;
        pts.push([(i % N + 0.5) * T, (((i / N) | 0) + 0.5) * T]);
      }
      if (f[i] === 0) pts.push([o.x, o.y]);
    }
    for (let k = 0; k < 2 && pts.length > 2; k++) { // Chaikin smoothing keeps corners soft
      const q = [pts[0]];
      for (let j = 0; j < pts.length - 1; j++) {
        const a = pts[j], b = pts[j + 1];
        q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
      }
      q.push(pts[pts.length - 1]);
      pts = q;
    }
    routeCache[maxSteps] = { key, pts };
    return pts;
  }
  // The way to the office: one gold arrow at the candidate's feet, pointing along the streets (like a sat-nav),
  // so it swings at a junction to show the turn. It looks ~90 px ahead along the walking route.
  function drawGuide(o, px, py) {
    if (Math.hypot(o.x - px, o.y - py) < 70) { guideAng = null; return; } // at the office: the pin takes over
    const pts = route(12);
    if (pts.length < 2) return;
    pts[0] = [px, py];
    let need = 90, tx = pts[pts.length - 1][0], ty = pts[pts.length - 1][1];
    for (let j = 0; j < pts.length - 1; j++) {
      const a = pts[j], b = pts[j + 1], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len >= need) { const k = need / len; tx = a[0] + (b[0] - a[0]) * k; ty = a[1] + (b[1] - a[1]) * k; break; }
      need -= len;
    }
    const want = Math.atan2(ty - py, tx - px);
    if (guideAng === null) guideAng = want;
    let d = want - guideAng;
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    guideAng += d * Math.min(1, 0.25); // ease into turns instead of snapping
    const r = (34 + Math.sin(time * 6) * 3) * ps, sz = 1.15 * ps;
    ctx.save(); ctx.translate(px, py); ctx.rotate(guideAng);
    ctx.lineJoin = 'round';
    for (const [off, a] of [[0, 1], [16 * ps, 0.45]]) { // a solid arrow and a fainter one ahead of it: "go this way"
      ctx.save(); ctx.translate(r + off, 0); ctx.scale(sz, sz); ctx.globalAlpha = a;
      ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-6, -10); ctx.lineTo(-2, 0); ctx.lineTo(-6, 10); ctx.closePath();
      ctx.fillStyle = GOLD; ctx.strokeStyle = 'rgba(60,40,0,.85)'; ctx.lineWidth = 2.2; ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }
  // Bouncing pin + pulsing ring over the current objective.
  function drawBeacon(o) {
    const bob = Math.sin(time * 4) * 5, pulse = (time * 0.9) % 1;
    ctx.save();
    ctx.strokeStyle = o.color; ctx.globalAlpha = 1 - pulse; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(o.x, o.y, 26 + pulse * 40, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 1;
    const y = o.y - (o.goal ? 92 : 98) + bob;
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(o.x, o.y + 2, 10 - bob * 0.5, 4, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = o.goal ? NAVY2 : '#f9a825'; ctx.strokeStyle = o.goal ? GOLD : '#fff'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(o.x, y, 17, Math.PI * 0.8, Math.PI * 0.2); ctx.lineTo(o.x, y + 30); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    label(o.icon, o.x, y, 17, '#000');
    label('NEXT', o.x, y - 27, 10, o.goal ? GOLD : '#fff', o.goal ? 'rgba(15,27,97,.95)' : 'rgba(191,120,0,.95)');
  }

  // ------------------------------------------------------------ frame
  function draw(alpha, dt) {
    time += dt;
    const P = G.player;
    const px = P.px + (P.x - P.px) * alpha, py = P.py + (P.y - P.py) * alpha;
    const vw = W / zoom, vh = (H - bottomPad) / zoom;
    // look ahead of the player, but keep the view inside the (small) town; a little slack at the top so the
    // HUD panels never sit on top of the office
    const fit = (v, span, lo, hi) => (WORLD + lo + hi > span ? Math.max(span / 2 - lo, Math.min(WORLD - span / 2 + hi, v)) : WORLD / 2);
    const tx = fit(px + (P.fx || 0) * 40, vw, vw * 0.05, vw * 0.05), ty = fit(py + (P.fy || 0) * 40, vh, vh * 0.12, vh * 0.05);
    const k = Math.min(1, dt * 5);
    cam.x += (tx - cam.x) * k; cam.y += (ty - cam.y) * k;
    if (Math.abs(cam.x - px) > vw) { cam.x = tx; cam.y = ty; }
    cam.shake = Math.max(0, cam.shake - dt * 30);
    const sx = (Math.random() - 0.5) * cam.shake, sy = (Math.random() - 0.5) * cam.shake;
    const left = cam.x - vw / 2 + sx, top = cam.y - vh / 2 + sy;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = COL[K.FIELD]; ctx.fillRect(0, 0, cv.width, cv.height);
    const s = zoom * DPR;
    ctx.setTransform(s, 0, 0, s, -left * s, -top * s);
    // paddy rows carry on past the town edge
    ctx.fillStyle = 'rgba(70,130,40,.35)';
    for (let y = Math.floor(top / 8) * 8 + 4; y < top + vh + 8; y += 8) ctx.fillRect(left - 2, y, vw + 4, 2);

    // map chunks
    const NC = Math.ceil(N / CH) - 1; // the last chunk row/column may be partial
    const px0 = Math.max(0, Math.floor(left / (CH * T))), px1 = Math.min(NC, Math.floor((left + vw) / (CH * T)));
    const py0 = Math.max(0, Math.floor(top / (CH * T))), py1 = Math.min(NC, Math.floor((top + vh) / (CH * T)));
    const ov = 1 / (zoom * DPR); // one device pixel of overlap hides seams between chunks
    for (let cy = py0; cy <= py1; cy++) for (let cx = px0; cx <= px1; cx++) ctx.drawImage(chunk(cx, cy), cx * CH * T, cy * CH * T, CH * T + ov, CH * T + ov);
    const inView = (x, y, m) => x > left - m && x < left + vw + m && y > top - m && y < top + vh + m;

    // ambient traffic (client-only decoration)
    for (const a of ambient) {
      a.p += a.dir * a.v * dt;
      if (a.p < 0) a.p += WORLD; if (a.p > WORLD) a.p -= WORLD;
      const x = a.vert ? a.c : a.p, y = a.vert ? a.p : a.c;
      if (!inView(x, y, 40)) continue;
      ctx.save(); ctx.translate(x, y); ctx.rotate(a.vert ? (a.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : (a.dir > 0 ? 0 : Math.PI));
      ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(-13, -7, 28, 16);
      if (a.kind === 'auto') {
        ctx.fillStyle = ['#2e7d32', '#f9a825', '#1565c0'][a.hue]; rr(-14, -9, 26, 18, 5); ctx.fill();
        ctx.fillStyle = '#fdd835'; rr(-10, -8, 16, 16, 4); ctx.fill();
        ctx.fillStyle = '#212121'; ctx.fillRect(9, -2, 3, 4);
      } else {
        ctx.fillStyle = '#212121'; ctx.fillRect(-10, -2, 20, 4); ctx.fillStyle = '#c62828'; ctx.fillRect(-4, -4, 8, 8);
      }
      ctx.restore();
    }

    // democracy dying: the colour drains out of the town (people, tags and the path stay in colour)
    const dv = Math.max(0, Math.min(1, G.demo / 100));
    if (dv < 0.995) {
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'saturation';
      ctx.fillStyle = `rgba(128,128,128,${Math.min(0.92, (1 - dv) * 1.05)})`;
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.restore();
    }

    // Section 144 ring
    const tg = G.target;
    ctx.save();
    ctx.setLineDash([18, 12]); ctx.lineDashOffset = -time * 20;
    ctx.strokeStyle = 'rgba(198,40,40,.55)'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(tg.x, tg.y, G.ringR * T, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();

    // barricades
    for (const b of G.barrs) {
      if (!inView(b.x, b.y, 200)) continue;
      if (b.kind === 'police') { policeLine(b); continue; }
      const jig = b.pushT > 0 ? Math.sin(time * 60) * 2 : 0;
      for (const j of b.tiles) {
        const x = (j % N) * T + jig, y = Math.floor(j / N) * T;
        ctx.fillStyle = '#37474f'; ctx.fillRect(x + 2, y + 2, T - 4, T - 4);
        ctx.save(); ctx.beginPath(); ctx.rect(x + 4, y + 4, T - 8, T - 8); ctx.clip();
        ctx.fillStyle = '#ffca28'; ctx.fillRect(x, y, T, T);
        ctx.fillStyle = '#212121';
        for (let i = -2; i < 4; i++) { ctx.beginPath(); ctx.moveTo(x + i * 12, y + T); ctx.lineTo(x + i * 12 + 6, y + T); ctx.lineTo(x + i * 12 + 6 + T, y); ctx.lineTo(x + i * 12 + T, y); ctx.fill(); }
        ctx.restore();
      }
      if (b.hp < b.max) {
        ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(b.x - 24, b.y - 30, 48, 7);
        ctx.fillStyle = '#ff7043'; ctx.fillRect(b.x - 23, b.y - 29, 46 * (b.hp / b.max), 5);
      }
    }

    if (G.gate) drawGate();

    // sites
    for (const st of map.sites) {
      if (!inView(st.x, st.y, 120)) continue;
      if (st === tg) {
        ctx.fillStyle = 'rgba(26,45,138,.22)'; ctx.beginPath(); ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(26,45,138,.85)'; ctx.lineWidth = 3; ctx.setLineDash([8, 6]); ctx.stroke(); ctx.setLineDash([]);
        if (P.submitT > 0) { ctx.strokeStyle = '#66bb6a'; ctx.lineWidth = 7; ctx.beginPath(); ctx.arc(st.x, st.y, st.r + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, P.submitT / G.M.hold)); ctx.stroke(); }
        label('🏛️', st.x, st.y - 8, 26, '#000');
        label('RETURNING OFFICER', st.x, st.y + 22, 11, '#fff', 'rgba(15,27,97,.92)');
      } else if (st.kind === 'station') {
        const b = map.buildings.find((o) => o.kind === 'station');
        if (b && b.yard) policeYard(b);
      } else if (st.kind === 'start') {
        ctx.fillStyle = '#6d4c41'; ctx.fillRect(st.x - 1, st.y - 40, 3, 34);
        ctx.fillStyle = NAVY; ctx.fillRect(st.x + 2, st.y - 40, 22, 5); ctx.fillStyle = '#fff'; ctx.fillRect(st.x + 2, st.y - 35, 22, 4); ctx.fillStyle = GREEN; ctx.fillRect(st.x + 2, st.y - 31, 22, 5);
        ctx.fillStyle = GOLD; ctx.beginPath(); ctx.arc(st.x + 13, st.y - 33, 2, 0, Math.PI * 2); ctx.fill();
      }
    }
    // names on landmark roofs
    for (const b of map.buildings) {
      if (!b.name || !inView(b.x + b.w / 2, b.y + b.h / 2, 150)) continue;
      if (b.kind === 'station' || b.kind === 'office') continue; // the counter carries its own label
      label(b.name, b.x + b.w / 2, b.y + b.h / 2, b.kind === 'office' ? 13 : 10, '#3e2723', 'rgba(255,255,255,.8)');
    }
    let guideObj = null;
    if ((G.mode === 'play' || G.mode === 'intro') && P.state !== 'held') {
      guideObj = objective();
      drawGuide(guideObj, px, py);
    }

    // gas clouds
    for (const c of G.clouds) {
      const a = Math.min(1, c.t / 1.2) * 0.55;
      for (let i = 0; i < 6; i++) {
        const ang = i * 1.05 + time * 0.6;
        const g = ctx.createRadialGradient(c.x + Math.cos(ang) * 22, c.y + Math.sin(ang) * 22, 4, c.x + Math.cos(ang) * 22, c.y + Math.sin(ang) * 22, c.r * 0.75);
        g.addColorStop(0, `rgba(235,235,225,${a})`); g.addColorStop(1, 'rgba(235,235,225,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c.x + Math.cos(ang) * 22, c.y + Math.sin(ang) * 22, c.r * 0.75, 0, Math.PI * 2); ctx.fill();
      }
    }

    // debris left on the road by stones, sticks and chappals
    for (let i = debris.length - 1; i >= 0; i--) {
      const d = debris[i];
      d.life -= dt;
      if (d.life <= 0) { debris.splice(i, 1); continue; }
      if (!inView(d.x, d.y, 20)) continue;
      ctx.globalAlpha = Math.min(1, d.life);
      missile(d.kind, d.x, d.y, d.rot, true);
    }
    ctx.globalAlpha = 1;
    // landing warnings: a shadow that grows, then a red ring for the last moment
    const pt = (pj) => Math.min(pj.dur, pj.t + alpha * DT);
    for (const pj of G.projs) {
      if (!inView(pj.x1, pj.y1, 40)) continue;
      const t = pt(pj), k = t / pj.dur, left = pj.dur - t;
      ctx.fillStyle = `rgba(0,0,0,${0.12 + 0.25 * k})`; ctx.beginPath(); ctx.ellipse(pj.x1, pj.y1, 5 + 9 * k, 3 + 5 * k, 0, 0, TAU); ctx.fill();
      if (left < 0.45) {
        const pulse = 0.55 + 0.45 * Math.sin(time * 30);
        ctx.strokeStyle = `rgba(229,57,53,${pulse})`; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(pj.x1, pj.y1, 20, 0, TAU); ctx.stroke();
      }
    }

    // people
    for (const e of G.ents) {
      const x = e.px + (e.x - e.px) * alpha, y = e.py + (e.y - e.py) * alpha;
      if (!inView(x, y, 40)) continue;
      person(x, y, e, look(e));
      if (e.kind === 'civ') {
        if (e.mode === 'hurt') dazeStars(x, y - 14 * ps, 3);
        else if (e.kite && e.type === 'child' && e.mode === 'wander') kite(x, y, e);
      } else if (e.ignoreT > 0) label('🙈', x, y - 20 * ps, 12 * ps, '#000');
      else if (e.kind === 'cop' && e.mode === 'chase') label('!', x, y - 20 * ps, 14 * ps, '#d32f2f');
      else if (e.kind === 'cop' && e.mode === 'stun') label('💫', x, y - 18 * ps, 12 * ps, '#000');
      else if (e.kind === 'goon' && e.mode === 'chase') label('😠', x, y - 20 * ps, 12 * ps, '#000');
      if (e.kind === 'goon') tdpTag(x, y + 16 * ps, e.role === 'vip');
    }
    if (P.state === 'held') {
      ctx.fillStyle = '#eceff1'; rr(px - 26, py - 16, 52, 30, 6); ctx.fill();
      ctx.fillStyle = '#1565c0'; ctx.fillRect(px - 26, py - 4, 52, 6);
      ctx.fillStyle = Math.floor(time * 6) % 2 ? '#e53935' : '#1e88e5'; ctx.fillRect(px - 6, py - 20, 12, 5);
    } else {
      const glow = P.grab > 0 ? `rgba(229,57,53,${0.4 + 0.3 * Math.sin(time * 20)})` : 'rgba(0,166,81,.38)';
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(px, py, (18 + Math.sin(time * 4) * 2) * ps, 0, Math.PI * 2); ctx.fill();
      if (P.guardT > 0) { // the crowd closes ranks
        ctx.save(); ctx.globalAlpha = Math.min(1, P.guardT); ctx.setLineDash([6, 5]); ctx.lineDashOffset = -time * 30;
        ctx.strokeStyle = 'rgba(100,181,246,.9)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(px, py, 70, 0, TAU); ctx.stroke(); ctx.restore();
      }
      if (P.invuln > 0 && Math.floor(time * 10) % 2) ctx.globalAlpha = 0.5;
      person(px, py, P, look(P));
      ctx.globalAlpha = 1;
      if (P.daze > 0) dazeStars(px, py - 15 * ps, 4);
      if (P.state === 'frisk') { // a cop "verifies" the papers
        const fx = P.fy === undefined ? 0 : -P.fy, fy = P.fx || 1, cx = px + fx * 18, cy = py + fy * 18;
        person(cx, cy, { id: -1, fx: -fx, fy: -fy, vx: Math.sin(time * 9) * 40, vy: 0 }, look({ kind: 'cop', role: 'patrol' }));
        label('🔍', cx, cy - 18, 12, '#000');
      }
    }
    // stones, sticks and chappals in flight
    for (const pj of G.projs) {
      const t = pt(pj), k = t / pj.dur;
      const gx = pj.x0 + (pj.x1 - pj.x0) * k, gy = pj.y0 + (pj.y1 - pj.y0) * k, z = 4 * pj.h * k * (1 - k);
      if (!inView(gx, gy - z, 30)) continue;
      ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.beginPath(); ctx.ellipse(gx, gy, 4, 2.5, 0, 0, TAU); ctx.fill();
      missile(pj.kind, gx, gy - z, time * 14 + pj.id, false);
    }
    if (guideObj && inView(guideObj.x, guideObj.y, 160)) drawBeacon(guideObj);
    if (G.gate) gateLabels();

    // particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 1 - p.drag * dt; p.vy *= 1 - p.drag * dt;
      ctx.globalAlpha = Math.min(1, p.life / 0.4);
      if (p.text) {
        ctx.font = '900 15px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.strokeText(p.text, p.x, p.y);
        ctx.fillStyle = p.c; ctx.fillText(p.text, p.x, p.y);
      } else { ctx.fillStyle = p.c; ctx.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s); }
    }
    ctx.globalAlpha = 1;

    // speech bubbles
    const byId = new Map(); byId.set(0, P); for (const e of G.ents) byId.set(e.id, e);
    for (const [key, b] of bubbles) {
      b.life -= dt;
      if (b.life <= 0) { bubbles.delete(key); continue; }
      const e = b.id !== undefined ? byId.get(b.id) : null;
      if (e) { b.x = e.px + (e.x - e.px) * alpha; b.y = e.py + (e.y - e.py) * alpha; }
      if (!inView(b.x, b.y, 200)) continue;
      ctx.globalAlpha = Math.min(1, b.life / 0.3);
      ctx.font = '700 12px system-ui,sans-serif';
      const w = Math.min(240, ctx.measureText(b.text).width + 14);
      const bx = b.x - w / 2, by = b.y - 44 - 12 * (ps - 1);
      ctx.fillStyle = 'rgba(20,14,8,.85)'; rr(bx, by, w, 22, 8); ctx.fill();
      ctx.beginPath(); ctx.moveTo(b.x - 5, by + 22); ctx.lineTo(b.x + 5, by + 22); ctx.lineTo(b.x, by + 29); ctx.fill();
      ctx.fillStyle = b.color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(b.text, b.x, by + 11.5, 230);
    }
    ctx.globalAlpha = 1;

    // neighbourhood names (faint, large)
    for (const l of map.labels) {
      if (!l.text || l.small || !inView(l.x, l.y, 300)) continue;
      ctx.font = '900 34px system-ui,sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(40,30,20,.16)'; ctx.fillText(l.text.toUpperCase(), l.x, l.y);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (dv < 0.75) { // the edges bleed red as democracy fails, with a heartbeat thump once it is critical
      const beat = dv < 0.3 ? Math.pow(Math.max(0, Math.sin(time * (2.2 + dv * 4))), 12) : 0;
      const a = (0.75 - dv) * 0.55 + beat * 0.18;
      const g = ctx.createRadialGradient(cv.width / 2, cv.height / 2, Math.min(cv.width, cv.height) * 0.35, cv.width / 2, cv.height / 2, Math.max(cv.width, cv.height) * 0.75);
      g.addColorStop(0, 'rgba(120,0,0,0)'); g.addColorStop(1, `rgba(120,0,0,${a})`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, cv.width, cv.height);
    }
    if (hurtT > 0) { // red edges when the candidate is hit
      hurtT = Math.max(0, hurtT - dt);
      const g = ctx.createRadialGradient(cv.width / 2, cv.height / 2, Math.min(cv.width, cv.height) * 0.3, cv.width / 2, cv.height / 2, Math.max(cv.width, cv.height) * 0.7);
      g.addColorStop(0, 'rgba(198,40,40,0)'); g.addColorStop(1, `rgba(198,40,40,${Math.min(0.55, hurtT)})`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, cv.width, cv.height);
    }
    return { left, top, vw, vh };
  }

  // ------------------------------------------------------------ maps (screen space, drawn by the HUD)
  // Shared marker layer: world (wx, wy) -> screen via (ox, oy, sc). big = full town map with names.
  function mapMarkers(ox, oy, sc, o, big, clipR) {
    const P = G.player, X = (wx) => ox + wx * sc, Y = (wy) => oy + wy * sc;
    const lim = WORLD * sc, LX = (wx, w) => Math.max(ox + w / 2 + 3, Math.min(ox + lim - w / 2 - 3, X(wx))); // keep labels inside the map
    const tag = (s, wx, wy, dy, size, bg) => { ctx.font = `800 ${size}px system-ui,sans-serif`; label(s, LX(wx, ctx.measureText(s).width + 10), Y(wy) + dy, size, '#fff', bg); };
    ctx.strokeStyle = 'rgba(198,40,40,.85)'; ctx.lineWidth = big ? 2.5 : 1.5; ctx.setLineDash(big ? [6, 4] : []);
    ctx.beginPath(); ctx.arc(X(G.target.x), Y(G.target.y), G.ringR * T * sc, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#ff7043'; for (const b of G.barrs) ctx.fillRect(X(b.x) - 2, Y(b.y) - 2, 4, 4);
    if (big) {
      ctx.font = `700 ${Math.max(8, Math.min(11, lim / 42))}px system-ui,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const l of map.labels) if (l.text && !l.small) { const w = Math.min(ctx.measureText(l.text).width, lim / 5.6); ctx.fillStyle = 'rgba(20,14,8,.4)'; ctx.fillText(l.text, LX(l.x, w), Y(l.y), w); }
      for (const s of map.stations) label('🚓', X(s.x), Y(s.y), 13, '#000');
      if (map.start) label('🚩', X(map.start.x), Y(map.start.y), 13, '#000');
    }
    // route
    const pts = route(big ? 600 : 160);
    if (pts.length > 1) {
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = big ? 6 : 4;
      ctx.beginPath(); ctx.moveTo(X(pts[0][0]), Y(pts[0][1])); for (const p of pts) ctx.lineTo(X(p[0]), Y(p[1])); ctx.stroke();
      ctx.strokeStyle = o.color; ctx.lineWidth = big ? 3 : 2; ctx.setLineDash(big ? [8, 5] : [4, 3]); ctx.lineDashOffset = -time * 20; ctx.stroke(); ctx.setLineDash([]);
    }
    // goal
    if (big) { label('🏛️', X(G.target.x), Y(G.target.y), 20, '#000'); tag(G.M.goal, G.target.x, G.target.y, 18, 11, 'rgba(15,27,97,.95)'); }
    else { ctx.fillStyle = NAVY2; ctx.strokeStyle = GOLD; ctx.lineWidth = 1.5; ctx.fillRect(X(G.target.x) - 4.5, Y(G.target.y) - 4.5, 9, 9); ctx.strokeRect(X(G.target.x) - 4.5, Y(G.target.y) - 4.5, 9, 9); }
    // people nearby
    if (!big) for (const e of G.ents) {
      if (e.kind === 'civ' && e.mode !== 'follow') continue;
      if (clipR && Math.hypot(e.x - P.x, e.y - P.y) > clipR) continue;
      ctx.fillStyle = e.kind === 'cop' ? '#e53935' : e.kind === 'goon' ? YELLOW : '#64b5f6';
      ctx.beginPath(); ctx.arc(X(e.x), Y(e.y), e.kind === 'civ' ? 1.4 : 2.2, 0, TAU); ctx.fill();
    }
    // objective ring
    const pulse = (time * 1.2) % 1;
    ctx.strokeStyle = o.color; ctx.globalAlpha = 1 - pulse; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(X(o.x), Y(o.y), (big ? 10 : 6) + pulse * (big ? 14 : 8), 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
    // player: arrow in the facing direction
    const a = Math.atan2(P.fy === undefined ? 1 : P.fy, P.fx || 0), s = big ? 1.5 : 1;
    ctx.save(); ctx.translate(X(P.x), Y(P.y)); ctx.rotate(a); ctx.scale(s, s);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = GREEN; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(-5, -5); ctx.lineTo(-2.5, 0); ctx.lineTo(-5, 5); ctx.closePath(); ctx.stroke(); ctx.fill();
    ctx.restore();
    if (big) tag('YOU', P.x, P.y, -16, 10, 'rgba(0,166,81,.95)');
  }
  function blitMini(ox, oy, sc, x, y, w, h) {
    // draw the part of the town image that falls inside the screen rect (x, y, w, h)
    const s0x = Math.max(0, (x - ox) / sc / T), s0y = Math.max(0, (y - oy) / sc / T);
    const s1x = Math.min(N, (x + w - ox) / sc / T), s1y = Math.min(N, (y + h - oy) / sc / T);
    if (s1x <= s0x || s1y <= s0y) return;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(mini, s0x, s0y, s1x - s0x, s1y - s0y, ox + s0x * T * sc, oy + s0y * T * sc, (s1x - s0x) * T * sc, (s1y - s0y) * T * sc);
    ctx.imageSmoothingEnabled = true;
  }
  // Corner radar: centred on the player, ~1500 world px across; the objective is pinned to the rim when far.
  // Painted into a cached canvas at ~15 Hz and blitted every frame.
  let radarCv = null, radarT = -1;
  function drawRadar(x, y, size, o) {
    const s = ctx.getTransform().a, pad = 4, px = Math.ceil((size + pad * 2) * s);
    if (!radarCv) radarCv = document.createElement('canvas');
    if (radarCv.width !== px) { radarCv.width = radarCv.height = px; radarT = -1; }
    if (radarT < 0 || time - radarT > 1 / 15 || time < radarT) {
      radarT = time;
      const main = ctx;
      ctx = radarCv.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, px, px);
      ctx.setTransform(s, 0, 0, s, (pad - x) * s, (pad - y) * s);
      paintRadar(x, y, size, o);
      ctx = main;
    }
    ctx.drawImage(radarCv, x - pad, y - pad, size + pad * 2, size + pad * 2);
  }
  function paintRadar(x, y, size, o) {
    const P = G.player, span = 1500, sc = size / span;
    const ox = x + size / 2 - P.x * sc, oy = y + size / 2 - P.y * sc;
    ctx.save();
    ctx.fillStyle = 'rgba(20,14,8,.78)'; rr(x - 4, y - 4, size + 8, size + 8, 12); ctx.fill();
    rr(x, y, size, size, 9); ctx.clip();
    ctx.fillStyle = COL[K.FIELD]; ctx.fillRect(x, y, size, size);
    blitMini(ox, oy, sc, x, y, size, size);
    mapMarkers(ox, oy, sc, o, false, span * 0.75);
    ctx.restore();
    // objective outside the radar: arrow on the rim
    const dx = o.x - P.x, dy = o.y - P.y;
    if (Math.abs(dx) > span / 2 - 10 || Math.abs(dy) > span / 2 - 10) {
      const k = (size / 2 - 7) / Math.max(Math.abs(dx), Math.abs(dy)) / sc, ax = x + size / 2 + dx * sc * k, ay = y + size / 2 + dy * sc * k;
      ctx.save(); ctx.translate(ax, ay); ctx.rotate(Math.atan2(dy, dx));
      ctx.fillStyle = o.color; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(7, 0); ctx.lineTo(-5, -6); ctx.lineTo(-5, 6); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  }
  // Full town map overlay.
  function drawBigMap(x, y, size, o) {
    const sc = size / WORLD;
    ctx.save();
    rr(x, y, size, size, 10); ctx.clip();
    ctx.fillStyle = COL[K.FIELD]; ctx.fillRect(x, y, size, size);
    blitMini(x, y, sc, x, y, size, size);
    mapMarkers(x, y, sc, o, true);
    ctx.restore();
  }

  function worldToScreen(x, y, view) { return { x: (x - view.left) * zoom, y: (y - view.top) * zoom }; }

  window.Render = {
    init(canvas) { cv = canvas; ctx = cv.getContext('2d'); resize(); },
    resize, setGame, draw, drawRadar, drawBigMap, objective, burst, popup, say, shake, worldToScreen, addDebris, hurtFlash,
    setBottomPad(px) { bottomPad = Math.max(0, px || 0); resize(); },
    setPeopleScale(v) { ps = v || 1; }, get peopleScale() { return ps; },
    get ctx() { return ctx; }, get DPR() { return DPR; }, get W() { return W; }, get H() { return H; }, get zoom() { return zoom; },
    get quality() { return quality; }, get bottomPad() { return bottomPad; },
  };
})();
