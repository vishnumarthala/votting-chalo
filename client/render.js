// Top-down canvas renderer: cached map chunks, people, sites, barricades, gas, ambient traffic, minimap, fx.
'use strict';
(function () {
  const { TILE, N, WORLD, K, makeRng, hashStr } = window.World;
  const T = TILE;
  const CH = 16; // tiles per cached chunk
  const COL = {
    [K.GRASS]: '#9cc46a', [K.ROAD]: '#5d5d63', [K.WALK]: '#d8d0c2', [K.BUILD]: '#c9b79c', [K.WATER]: '#4c9bd0',
    [K.BRIDGE]: '#b9b0a2', [K.WALL]: '#a3553c', [K.PARK]: '#86bd59', [K.TREE]: '#86bd59', [K.PLAZA]: '#e8dfca', [K.FIELD]: '#a5d06b',
  };

  const YSRCP_BLUE = '#1e5bd8', TDP_YELLOW = '#f2c200', TDP_HAT = '#8a6d00';
  let cv, ctx, W = 0, H = 0, DPR = 1, zoom = 1, quality = 'hi', bottomPad = 0;
  let map = null, G = null, pavedMask = null;
  const cam = { x: 0, y: 0, shake: 0 };
  const chunks = new Map();
  let chunkRes = 0, time = 0, mini = null;
  let particles = [], ambient = [];
  const bubbles = new Map();
  let bubbleSeq = 0;

  function resize(q) {
    if (q) quality = q;
    W = innerWidth; H = innerHeight;
    const ideal = Math.min(window.devicePixelRatio || 1, quality === 'hi' ? 2.5 : 1.25);
    DPR = Math.max(1, Math.min(ideal, Math.sqrt((quality === 'hi' ? 4.5e6 : 1.8e6) / (W * H))));
    cv.width = Math.ceil(W * DPR); cv.height = Math.ceil(H * DPR);
    cv.style.width = W + 'px'; cv.style.height = H + 'px';
    zoom = Math.max(0.55, Math.min(1.5, Math.min(W, H - bottomPad) / 680));
    const res = Math.min(2, zoom * DPR);
    if (Math.abs(res - chunkRes) > 0.01) { chunkRes = res; chunks.clear(); }
  }

  // ------------------------------------------------------------ setup
  function setGame(game) {
    G = game.state; map = G.map;
    chunks.clear(); particles = []; bubbles.clear(); fireLook.clear();
    cam.x = G.player.x; cam.y = G.player.y;
    buildMini();
    pavedMask = markPavements();
    ambient = makeTraffic(makeRng(map.seed ^ 0xabc));
  }
  // Autos and bikes drive back and forth along the longest mapped roads, in the lane for their direction. Only
  // roads at least 2 tiles wide: compounds and stations may clear the 1-tile lanes.
  function makeTraffic(rng) {
    const lines = map.roads.filter((r) => r.w >= 2).map((r) => {
      const cum = [0];
      for (let i = 1; i < r.pts.length; i++) cum.push(cum[i - 1] + Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]));
      return { pts: r.pts, cum, len: cum[cum.length - 1], lane: r.w * T * 0.25 };
    }).filter((l) => l.len > 6 * T).sort((a, b) => b.len - a.len).slice(0, 24);
    const out = [];
    if (!lines.length) return out;
    for (let i = 0; i < 16; i++) {
      const line = lines[rng.int(lines.length)], dir = rng() < 0.5 ? 1 : -1;
      out.push({ line, s: rng() * line.len, dir, v: 70 + rng() * 60, kind: rng() < 0.75 ? 'auto' : 'bike', hue: rng.int(3) });
    }
    return out;
  }
  // Point and heading at distance s along a traffic line, shifted into the lane for `dir`.
  function onLine(line, s, dir) {
    let i = 1;
    while (i < line.pts.length - 1 && line.cum[i] < s) i++;
    const [x0, y0] = line.pts[i - 1], [x1, y1] = line.pts[i];
    const seg = line.cum[i] - line.cum[i - 1] || 1, k = (s - line.cum[i - 1]) / seg;
    const ang = Math.atan2(y1 - y0, x1 - x0), side = dir > 0 ? 1 : -1;
    return { x: x0 + (x1 - x0) * k - Math.sin(ang) * line.lane * side, y: y0 + (y1 - y0) * k + Math.cos(ang) * line.lane * side, ang: dir > 0 ? ang : ang + Math.PI };
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
    const area = { left: cx * px, top: cy * px, size: px };
    drawGround(g, cx * CH, cy * CH);
    drawRibbons(g, area);
    drawTiles(g, cx * CH, cy * CH);
    for (const b of map.buildings) if (b.x < (cx + 1) * px && b.x + b.w > cx * px && b.y < (cy + 1) * px && b.y + b.h > cy * px) drawBuilding(g, b);
    for (const t of map.supporterProps) if (t.x > cx * px - 40 && t.x < (cx + 1) * px + 40 && t.y > cy * px - 40 && t.y < (cy + 1) * px + 40) drawProp(g, t);
    chunks.set(key, c);
    if (chunks.size > 36) chunks.delete(chunks.keys().next().value);
    return c;
  }
  // Roads are drawn as smooth ribbons from map.roads; the tile grid only decides collision and AI. A chunk is
  // layered: ground for every tile, then the ribbons (pavement, asphalt, centre-lines), then the tiles that
  // stand on top of them (water, bridges, buildings, walls, plazas, parks, trees, alleys), so compounds built on
  // cleared lanes hide the ribbon beneath. Every ribbon is stroked in full in each chunk it touches, so the
  // chunk canvases join without a seam.
  const PAVEMENT_MARGIN = 0.75; // tiles of slack when matching pavement tiles to their road
  // Walk tiles that belong to the pavement of a road at least 3 tiles wide, which the ribbon already draws.
  // The other walk tiles are alleys between plots and are drawn as tiles.
  function markPavements() {
    const mask = new Uint8Array(N * N);
    for (const r of map.roads) {
      if (r.w < 3) continue;
      const reach = ((r.w + 2) / 2 + PAVEMENT_MARGIN) * T;
      for (let i = 1; i < r.pts.length; i++) {
        const [ax, ay] = r.pts[i - 1], [bx, by] = r.pts[i];
        const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1;
        const tx0 = Math.max(0, Math.floor((Math.min(ax, bx) - reach) / T)), tx1 = Math.min(N - 1, Math.floor((Math.max(ax, bx) + reach) / T));
        const ty0 = Math.max(0, Math.floor((Math.min(ay, by) - reach) / T)), ty1 = Math.min(N - 1, Math.floor((Math.max(ay, by) + reach) / T));
        for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
          const px = (tx + 0.5) * T - ax, py = (ty + 0.5) * T - ay, k = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
          if (Math.hypot(px - dx * k, py - dy * k) <= reach) mask[ty * N + tx] = 1;
        }
      }
    }
    return mask;
  }
  function strokeRoad(g, r) {
    g.beginPath();
    r.pts.forEach(([x, y], i) => { if (i) g.lineTo(x, y); else g.moveTo(x, y); });
    g.stroke();
  }
  function drawRibbons(g, area) {
    const near = map.roads.filter((r) => {
      const m = r.w * T + 16;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of r.pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      return x1 + m >= area.left && x0 - m <= area.left + area.size && y1 + m >= area.top && y0 - m <= area.top + area.size;
    });
    g.save();
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.strokeStyle = COL[K.WALK];
    for (const r of near) { g.lineWidth = r.w >= 3 ? (r.w + 1) * T : r.w * T + 6; strokeRoad(g, r); }
    g.strokeStyle = COL[K.ROAD];
    for (const r of near) { g.lineWidth = r.w * T; strokeRoad(g, r); }
    // dashed centre line along every road at least 3 tiles wide
    g.strokeStyle = '#e8e2c8'; g.lineWidth = 4; g.setLineDash([16, 16]);
    for (const r of near) if (r.w >= 3) strokeRoad(g, r);
    g.restore();
  }
  // Ground colour under every tile, with grass flecks; roads and pavements are drawn over it by the ribbons.
  function drawGround(g, x0, y0) {
    g.fillStyle = COL[K.GRASS]; g.fillRect(x0 * T, y0 * T, CH * T, CH * T);
    for (let ty = y0; ty < y0 + CH; ty++) for (let tx = x0; tx < x0 + CH; tx++) {
      const k = map.t[ty * N + tx];
      if (k !== K.GRASS) continue;
      const x = tx * T, y = ty * T, h = th(tx, ty);
      g.fillStyle = 'rgba(60,120,40,.25)';
      g.fillRect(x + (h % 26), y + ((h >> 5) % 26), 3, 3); g.fillRect(x + ((h >> 10) % 28), y + ((h >> 15) % 28), 2, 2);
    }
  }
  function drawTiles(g, x0, y0) {
    for (let ty = y0; ty < y0 + CH; ty++) for (let tx = x0; tx < x0 + CH; tx++) {
      const k = map.t[ty * N + tx], x = tx * T, y = ty * T, h = th(tx, ty);
      if (k === K.GRASS || k === K.ROAD || (k === K.WALK && pavedMask[ty * N + tx])) continue; // ground and ribbons
      g.fillStyle = COL[k]; g.fillRect(x, y, T + 0.5, T + 0.5);
      if (k === K.PARK || k === K.TREE) {
        g.fillStyle = 'rgba(60,120,40,.25)';
        g.fillRect(x + (h % 26), y + ((h >> 5) % 26), 3, 3); g.fillRect(x + ((h >> 10) % 28), y + ((h >> 15) % 28), 2, 2);
      } else if (k === K.FIELD) {
        g.fillStyle = 'rgba(70,130,40,.35)'; for (let i = 4; i < T; i += 8) g.fillRect(x, y + i, T, 2);
      } else if (k === K.WALK) {
        g.fillStyle = 'rgba(0,0,0,.06)'; g.fillRect(x, y, T, 1); g.fillRect(x, y, 1, T);
      } else if (k === K.PLAZA) {
        g.fillStyle = 'rgba(0,0,0,.05)'; if ((tx + ty) % 2) g.fillRect(x, y, T, T);
      } else if (k === K.WATER) {
        g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(x + (h % 20), y + 8 + ((h >> 4) % 14), 10, 2);
      } else if (k === K.BRIDGE) {
        const up = map.t[(ty - 1) * N + tx], dn = map.t[(ty + 1) * N + tx];
        g.fillStyle = '#7d756a';
        if (up === K.WATER) g.fillRect(x, y, T, 3);
        if (dn === K.WATER) g.fillRect(x, y + T - 3, T, 3);
      } else if (k === K.WALL) {
        g.fillStyle = 'rgba(0,0,0,.2)'; g.fillRect(x, y + 15, T, 2); g.fillRect(x + (ty % 2 ? 8 : 24), y, 2, 15); g.fillRect(x + (ty % 2 ? 24 : 8), y + 17, 2, 15);
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
    if (b.kind === 'market') {
      for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? '#e53935' : '#fafafa'; g.fillRect(b.x + (i * b.w) / 4, b.y, b.w / 4 + 0.5, b.h); }
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
    } else if (b.kind === 'office' || b.kind === 'booth' || b.kind === 'station' || b.kind === 'party') {
      g.fillStyle = 'rgba(0,0,0,.08)'; for (let x = b.x + 10; x < b.x + b.w - 10; x += 22) g.fillRect(x, b.y + 8, 12, b.h - 16);
    }
  }

  // ------------------------------------------------------------ vehicles and supporters' houses
  const AUTO_BODY = ['#2e7d32', '#f9a825', '#1565c0', '#c62828'], CAR_BODY = ['#eceff1', '#90a4ae', '#8d1f1f', '#37474f'], BIKE_TANK = ['#c62828', '#1565c0', '#f9a825', '#2e7d32'];
  // A bike, auto or car seen from above, centred on the origin and facing +x. `hue` picks its colour.
  function drawVehicle(g, look, hue) {
    g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(-13, -7, 28, 16);
    if (look === 'auto') {
      g.fillStyle = AUTO_BODY[hue % 4]; rr(-14, -9, 26, 18, 5, g); g.fill();
      g.fillStyle = '#fdd835'; rr(-10, -8, 16, 16, 4, g); g.fill();
      g.fillStyle = '#212121'; g.fillRect(9, -2, 3, 4);
    } else if (look === 'car') {
      g.fillStyle = CAR_BODY[hue % 4]; rr(-15, -8, 30, 16, 5, g); g.fill();
      g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(-5, -6, 11, 12);
      g.fillStyle = '#263238'; g.fillRect(6, -6, 4, 12); g.fillRect(-9, -6, 3, 12);
      g.fillStyle = '#fff59d'; g.fillRect(13, -6, 2, 3); g.fillRect(13, 3, 2, 3);
    } else {
      g.fillStyle = '#212121'; g.fillRect(-10, -2, 20, 4); g.fillStyle = BIKE_TANK[hue % 4]; g.fillRect(-4, -4, 8, 8);
    }
  }
  // A supporter's house shows the YSRCP fan flag on its roof; a parked vehicle lies along its street.
  function drawProp(g, t) {
    if (t.kind === 'vehicle') {
      g.save(); g.translate(t.x, t.y); g.rotate(t.ang); drawVehicle(g, t.look, t.hue); g.restore();
      return;
    }
    const fx = t.x - 11, fy = t.y - 8;
    g.fillStyle = 'rgba(0,0,0,.2)'; g.fillRect(fx + 2, fy + 3, 22, 14);
    g.strokeStyle = '#6d4c41'; g.lineWidth = 2; g.beginPath(); g.moveTo(fx, fy - 1); g.lineTo(fx, fy + 17); g.stroke();
    drawFanFlag(g, fx + 1, fy, 22, 14, 0);
  }

  // ------------------------------------------------------------ flags
  // The YSRCP flag: a blue field with a white three-blade ceiling fan, drawn from shapes (no image file).
  // (x, y) is the flag's top-left corner; `spin` turns the blades, in radians.
  function drawFanFlag(g, x, y, w, h, spin) {
    g.save();
    g.fillStyle = YSRCP_BLUE; g.fillRect(x, y, w, h);
    const reach = Math.min(w, h) * 0.44;
    g.translate(x + w / 2, y + h / 2); g.rotate(spin || 0);
    g.fillStyle = '#fff';
    for (let i = 0; i < 3; i++) {
      g.beginPath(); g.ellipse(reach * 0.58, 0, reach * 0.46, reach * 0.2, 0, 0, Math.PI * 2); g.fill();
      g.rotate((Math.PI * 2) / 3);
    }
    g.beginPath(); g.arc(0, 0, reach * 0.24, 0, Math.PI * 2); g.fill();
    g.fillStyle = YSRCP_BLUE; g.beginPath(); g.arc(0, 0, reach * 0.1, 0, Math.PI * 2); g.fill();
    g.restore();
  }
  // A flag on a pole: the pole's foot is (x, y + 11), the cloth hangs from its top.
  function carriedFlag(x, y, spin, tdp) {
    ctx.strokeStyle = '#6d4c41'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 11); ctx.stroke();
    if (tdp) { ctx.fillStyle = TDP_YELLOW; ctx.fillRect(x + 1, y, 14, 9); } else drawFanFlag(ctx, x + 1, y, 14, 9, spin);
  }

  // ------------------------------------------------------------ people
  const SHIRTS = ['#f5f5f5', '#ffcc80', '#a5d6a7', '#ce93d8', '#90caf9', '#ffab91'];
  const SKIN = ['#8d5a3b', '#a86b45', '#7b4a2e', '#9c6644'];
  function person(x, y, e, o) {
    const r = 9, fx = e.fx || 0, fy = e.fy === undefined ? 1 : e.fy;
    const ang = Math.atan2(fy, fx);
    const moving = Math.abs(e.vx || 0) + Math.abs(e.vy || 0) > 10;
    const ph = moving ? Math.sin(time * 14 + e.id) * 4 : 0;
    ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.beginPath(); ctx.ellipse(x + 2, y + 3, r, r * 0.7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
    // feet
    ctx.fillStyle = '#3e2723'; ctx.fillRect(2 + ph, -6, 5, 4); ctx.fillRect(2 - ph, 2, 5, 4);
    // shoulders
    ctx.fillStyle = o.shirt; ctx.beginPath(); ctx.ellipse(0, 0, r * 0.75, r * 1.1, 0, 0, Math.PI * 2); ctx.fill();
    if (o.scarf) { ctx.fillStyle = o.scarf; ctx.fillRect(-3, -r * 1.05, 4, r * 2.1); }
    if (o.prop === 'papers') { ctx.fillStyle = '#fff'; ctx.fillRect(5, 3, 8, 6); ctx.fillStyle = '#90a4ae'; ctx.fillRect(7, 5, 4, 1); }
    if (o.prop === 'lathi') { ctx.strokeStyle = '#8d6e63'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(4, 7); ctx.lineTo(16, 10); ctx.stroke(); }
    if (o.prop === 'flag' || o.prop === 'tdpflag') carriedFlag(2, -15, time * 4 + e.id, o.prop === 'tdpflag');
    // head
    ctx.fillStyle = o.skin; ctx.beginPath(); ctx.arc(1, 0, r * 0.55, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = o.hat || '#1b1b1b'; ctx.beginPath(); ctx.arc(0, 0, r * 0.55, Math.PI * 0.5, Math.PI * 1.5); ctx.fill();
    if (o.hat && o.brim) { ctx.fillRect(2, -3, 5, 6); }
    ctx.restore();
  }
  function look(e) {
    switch (e.kind) {
      case 'player': return { shirt: YSRCP_BLUE, skin: '#9c6644', scarf: '#bbdefb', prop: 'papers' };
      case 'civ': return e.mode === 'follow' ? { shirt: SHIRTS[e.look % 6], skin: SKIN[e.look % 4], scarf: YSRCP_BLUE, prop: e.id % 3 === 0 ? 'flag' : null } : { shirt: SHIRTS[e.look % 6], skin: SKIN[e.look % 4] };
      case 'cop': return { shirt: e.role === 'gas' ? '#b39b5e' : '#c8b071', skin: '#8d5a3b', hat: '#6d5a2e', brim: true, prop: 'lathi' };
      case 'goon': return { shirt: TDP_YELLOW, skin: '#7b4a2e', hat: TDP_HAT, brim: true };
      case 'mob': return { shirt: TDP_YELLOW, skin: SKIN[e.id % 4], hat: TDP_HAT, brim: e.id % 2 === 0, prop: e.id % 3 === 0 ? 'tdpflag' : null };
      default: return { shirt: '#999', skin: '#8d5a3b' };
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
  function say(ev) {
    const key = ev.id !== undefined ? 'e' + ev.id : 'b' + bubbleSeq++;
    bubbles.set(key, { id: ev.id, x: ev.x, y: ev.y, text: ev.text, color: ev.color || '#fff', life: 3 });
    if (bubbles.size > 10) bubbles.delete(bubbles.keys().next().value);
  }
  function shake(a) { cam.shake = Math.max(cam.shake, a); }

  // ------------------------------------------------------------ text helpers
  function rr(x, y, w, h, r, g) {
    g = g || ctx;
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  function label(text, x, y, size, color, bg) {
    ctx.font = `800 ${size}px system-ui,sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (bg) { const w = ctx.measureText(text).width + 10; ctx.fillStyle = bg; rr(x - w / 2, y - size * 0.7, w, size * 1.4, 4); ctx.fill(); }
    ctx.fillStyle = color; ctx.fillText(text, x, y);
  }

  // ------------------------------------------------------------ fire
  const FLAME_LAYERS = [['rgba(216,67,21,.92)', 1], ['rgba(255,152,0,.95)', 0.7], ['rgba(255,235,59,.95)', 0.4]];
  const fireLook = new Map(); // supporter prop id -> where its soot, beams and flames go (drawn the same every frame)
  const footprint = (t) => ({ x: t.rect.x0 * T, y: t.rect.y0 * T, w: (t.rect.x1 - t.rect.x0 + 1) * T, h: (t.rect.y1 - t.rect.y0 + 1) * T });
  function lookOf(t) {
    let l = fireLook.get(t.id);
    if (l) return l;
    const r = makeRng(t.id * 977 + 13), b = footprint(t), vehicle = t.kind === 'vehicle';
    l = { soot: [], beams: [], flames: [] };
    if (!vehicle) {
      for (let i = 0; i < 4; i++) l.soot.push([r() * (b.w - 14), r() * (b.h - 10), 8 + r() * 14, 6 + r() * 8]);
      for (let i = 0; i < 3; i++) l.beams.push([6 + r() * (b.w - 12), (r() - 0.5) * 14]);
    }
    const n = vehicle ? 2 : Math.max(3, Math.min(7, Math.round((b.w * b.h) / (T * T))));
    for (let i = 0; i < n; i++) {
      // a flame's base, from the vehicle's centre or the house's corner
      l.flames.push(vehicle ? [(r() - 0.5) * 16, (r() - 0.5) * 16, 8 + r() * 3, r() * 6.28] : [6 + r() * (b.w - 12), 10 + r() * (b.h - 10), 9 + r() * 5, r() * 6.28]);
    }
    fireLook.set(t.id, l);
    return l;
  }
  // What a fire leaves, drawn over the house or vehicle: scorched ground and a blackened roof or wreck. `k` fades it in
  // while the fire is still burning.
  function drawCharred(t, k) {
    const b = footprint(t), l = lookOf(t);
    ctx.globalAlpha = k;
    ctx.fillStyle = 'rgba(30,24,20,.2)'; rr(b.x - 10, b.y - 10, b.w + 20, b.h + 20, 14); ctx.fill();
    if (t.kind === 'vehicle') {
      ctx.save(); ctx.translate(t.x, t.y); ctx.rotate(t.ang);
      ctx.fillStyle = '#1d1815'; rr(-14, -9, 28, 18, 5); ctx.fill();
      ctx.fillStyle = '#3a312c'; ctx.fillRect(-8, -6, 14, 12);
      ctx.fillStyle = '#0d0b0a'; ctx.fillRect(-12, -9, 4, 3); ctx.fillRect(8, 6, 4, 3);
      ctx.restore();
    } else {
      ctx.fillStyle = 'rgba(28,22,19,.94)'; ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = 'rgba(0,0,0,.35)'; for (const [x, y, w, h] of l.soot) ctx.fillRect(b.x + x, b.y + y, w, h);
      ctx.strokeStyle = '#4e342e'; ctx.lineWidth = 2.5;
      for (const [x, lean] of l.beams) { ctx.beginPath(); ctx.moveTo(b.x + x, b.y + 4); ctx.lineTo(b.x + x + lean, b.y + b.h - 4); ctx.stroke(); }
    }
    ctx.globalAlpha = 1;
  }
  // The street a fire blocks glows, and the burning house or vehicle chars as the fire ages.
  function drawBlocked(t, f) {
    const b = footprint(t);
    ctx.fillStyle = `rgba(255,110,30,${0.16 + 0.06 * Math.sin(time * 9 + t.id)})`;
    rr(b.x - T, b.y - T, b.w + 2 * T, b.h + 2 * T, 12); ctx.fill();
    drawCharred(t, (1 - f.left / f.ticks) * 0.85);
  }
  function flame(x, y, size, phase) {
    const k = 0.8 + 0.2 * Math.sin(time * 12 + phase), lean = Math.sin(time * 6 + phase * 1.7) * size * 0.18, tall = size * 1.6 * k;
    for (const [color, f] of FLAME_LAYERS) {
      ctx.fillStyle = color; ctx.beginPath();
      ctx.moveTo(x - size * f * 0.55, y);
      ctx.quadraticCurveTo(x - size * f * 0.6, y - tall * f * 0.5, x + lean * f, y - tall * f);
      ctx.quadraticCurveTo(x + size * f * 0.6, y - tall * f * 0.5, x + size * f * 0.55, y);
      ctx.closePath(); ctx.fill();
    }
  }
  // Flames die down over the last third of the fire; the fast graphics setting draws every other one.
  function drawFlames(t, f) {
    const b = footprint(t), l = lookOf(t), scale = 0.5 + 0.5 * Math.min(1, (f.left / f.ticks) * 3), step = quality === 'hi' ? 1 : 2;
    for (let i = 0; i < l.flames.length; i += step) {
      const [x, y, size, phase] = l.flames[i];
      if (t.kind === 'vehicle') flame(t.x + x, t.y + y, size * scale, phase); else flame(b.x + x, b.y + y, size * scale, phase);
    }
  }
  function drawSmoke(t, f) {
    const thin = Math.min(1, (f.left / f.ticks) * 4);
    for (let i = 0; i < 4; i++) {
      const p = (time * 0.2 + i / 4 + t.id * 0.37) % 1;
      ctx.fillStyle = `rgba(62,58,56,${(1 - p) * 0.4 * thin})`;
      ctx.beginPath(); ctx.arc(t.x + Math.sin(t.id + i * 2) * 10 + 10 + p * 34, t.y - 6 - p * 66, 12 + p * 20, 0, Math.PI * 2); ctx.fill();
    }
  }

  // ------------------------------------------------------------ frame
  function draw(alpha, dt) {
    time += dt;
    const P = G.player;
    const px = P.px + (P.x - P.px) * alpha, py = P.py + (P.y - P.py) * alpha;
    const vw = W / zoom, vh = (H - bottomPad) / zoom;
    const tx = px + (P.fx || 0) * 40, ty = py + (P.fy || 0) * 40;
    const k = Math.min(1, dt * 5);
    cam.x += (tx - cam.x) * k; cam.y += (ty - cam.y) * k;
    if (Math.abs(cam.x - px) > vw) { cam.x = px; cam.y = py; }
    cam.shake = Math.max(0, cam.shake - dt * 30);
    const sx = (Math.random() - 0.5) * cam.shake, sy = (Math.random() - 0.5) * cam.shake;
    const left = cam.x - vw / 2 + sx, top = cam.y - vh / 2 + sy;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = COL[K.FIELD]; ctx.fillRect(0, 0, cv.width, cv.height);
    const s = zoom * DPR;
    ctx.setTransform(s, 0, 0, s, -left * s, -top * s);

    // map chunks
    const px0 = Math.max(0, Math.floor(left / (CH * T))), px1 = Math.min(N / CH - 1, Math.floor((left + vw) / (CH * T)));
    const py0 = Math.max(0, Math.floor(top / (CH * T))), py1 = Math.min(N / CH - 1, Math.floor((top + vh) / (CH * T)));
    const ov = 1 / (zoom * DPR); // one device pixel of overlap hides seams between chunks
    for (let cy = py0; cy <= py1; cy++) for (let cx = px0; cx <= px1; cx++) ctx.drawImage(chunk(cx, cy), cx * CH * T, cy * CH * T, CH * T + ov, CH * T + ov);
    const inView = (x, y, m) => x > left - m && x < left + vw + m && y > top - m && y < top + vh + m;

    // ambient traffic (client-only decoration)
    for (const a of ambient) {
      a.s += a.dir * a.v * dt;
      if (a.s < 0 || a.s > a.line.len) { a.dir = -a.dir; a.s = Math.max(0, Math.min(a.line.len, a.s)); }
      const { x, y, ang } = onLine(a.line, a.s, a.dir);
      if (!inView(x, y, 40)) continue;
      ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
      drawVehicle(ctx, a.kind, a.hue);
      ctx.restore();
    }

    // Section 144 ring
    const tg = G.target;
    ctx.save();
    ctx.setLineDash([18, 12]); ctx.lineDashOffset = -time * 20;
    ctx.strokeStyle = 'rgba(198,40,40,.55)'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(tg.x, tg.y, 15.6 * T, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();

    // charred houses and vehicles, and the streets a fire blocks
    for (const t of G.supporterProps) if (t.state === 'burnt' && inView(t.x, t.y, 160)) drawCharred(t, 1);
    for (const f of G.fires) { const t = G.supporterProps[f.id]; if (inView(t.x, t.y, 160)) drawBlocked(t, f); }

    // barricades
    for (const b of G.barrs) {
      if (!inView(b.x, b.y, 200)) continue;
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

    // sites
    for (const st of map.sites) {
      if (!inView(st.x, st.y, 120)) continue;
      if (st.kind === 'doc') {
        if (st.mode === 'vote' && G.gameMode !== 'vote') continue;
        if (!G.docSites.includes(st)) continue;
        const have = P.docs.includes(st.doc);
        const bob = Math.sin(time * 3 + st.x) * 3;
        ctx.globalAlpha = have ? 0.45 : 1;
        ctx.fillStyle = have ? 'rgba(102,187,106,.35)' : 'rgba(255,213,79,.35)';
        ctx.beginPath(); ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2); ctx.fill();
        if (st.mode === 'vote') {
          ctx.fillStyle = '#ef6c00'; ctx.beginPath(); ctx.moveTo(st.x - 22, st.y + 6); ctx.lineTo(st.x, st.y - 18); ctx.lineTo(st.x + 22, st.y + 6); ctx.fill();
        }
        label(have ? '✅' : '📄', st.x, st.y - 34 + bob, 20, '#000');
        label(st.name, st.x, st.y - 54 + bob, 11, '#fff', 'rgba(40,30,20,.75)');
        label(st.doc, st.x, st.y + 24, 10, '#3e2723', 'rgba(255,248,225,.9)');
        ctx.globalAlpha = 1;
        if (P.collect && P.collect.site === st) {
          ctx.strokeStyle = '#ffd54f'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(st.x, st.y, st.r + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, P.collect.t / 1.2)); ctx.stroke();
        }
      } else if (st === tg) {
        ctx.fillStyle = 'rgba(30,91,216,.22)'; ctx.beginPath(); ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(30,91,216,.8)'; ctx.lineWidth = 3; ctx.setLineDash([8, 6]); ctx.stroke(); ctx.setLineDash([]);
        if (P.submitT > 0) { ctx.strokeStyle = '#66bb6a'; ctx.lineWidth = 7; ctx.beginPath(); ctx.arc(st.x, st.y, st.r + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, P.submitT / G.M.hold)); ctx.stroke(); }
        label(G.gameMode === 'vote' ? '🗳️' : '🏛️', st.x, st.y - 8, 26, '#000');
        label(G.gameMode === 'vote' ? 'POLLING BOOTH' : 'RETURNING OFFICER', st.x, st.y + 22, 11, '#fff', 'rgba(29,59,112,.9)');
      } else if (st.kind === 'station') {
        label('🚓 Police Station', st.x, st.y - 6, 11, '#fff', 'rgba(21,101,192,.85)');
      } else if (st.kind === 'start') {
        ctx.fillStyle = '#6d4c41'; ctx.fillRect(st.x - 1, st.y - 50, 3, 44);
        drawFanFlag(ctx, st.x + 2, st.y - 50, 32, 22, time * 1.5);
      }
    }
    // names on landmark roofs
    for (const b of map.buildings) {
      if (!b.name || b.shop || !inView(b.x + b.w / 2, b.y + b.h / 2, 150)) continue;
      if (b.kind === 'station') continue;
      label(b.name, b.x + b.w / 2, b.y + b.h / 2, b.kind === 'office' || b.kind === 'booth' ? 13 : 10, '#3e2723', 'rgba(255,255,255,.8)');
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

    // people
    for (const e of G.ents) {
      const x = e.px + (e.x - e.px) * alpha, y = e.py + (e.y - e.py) * alpha;
      if (!inView(x, y, 30)) continue;
      person(x, y, e, look(e));
      if (e.kind === 'cop' && e.mode === 'chase') label('!', x, y - 20, 14, '#d32f2f');
      else if (e.kind === 'cop' && e.mode === 'stun') label('💫', x, y - 18, 12, '#000');
      else if (e.kind === 'goon' && e.mode === 'chase') label('😠', x, y - 20, 12, '#000');
      else if (e.kind === 'mob' && e.mode === 'retreat') label('💨', x, y - 20, 12, '#000');
    }
    if (P.state === 'held') {
      ctx.fillStyle = '#eceff1'; rr(px - 26, py - 16, 52, 30, 6); ctx.fill();
      ctx.fillStyle = '#1565c0'; ctx.fillRect(px - 26, py - 4, 52, 6);
      ctx.fillStyle = Math.floor(time * 6) % 2 ? '#e53935' : '#1e88e5'; ctx.fillRect(px - 6, py - 20, 12, 5);
    } else {
      const glow = P.grab > 0 ? `rgba(229,57,53,${0.4 + 0.3 * Math.sin(time * 20)})` : 'rgba(30,91,216,.35)';
      ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(px, py, 18 + Math.sin(time * 4) * 2, 0, Math.PI * 2); ctx.fill();
      if (P.invuln > 0 && Math.floor(time * 10) % 2) ctx.globalAlpha = 0.5;
      person(px, py, P, look(P));
      ctx.globalAlpha = 1;
      if (P.stun > 0) label('💫', px, py - 24, 16, '#000');
    }

    // flames over the people, smoke over the flames
    for (const f of G.fires) { const t = G.supporterProps[f.id]; if (inView(t.x, t.y, 160)) drawFlames(t, f); }
    if (quality === 'hi') for (const f of G.fires) { const t = G.supporterProps[f.id]; if (inView(t.x, t.y, 200)) drawSmoke(t, f); }

    // stones in flight: a lobbed arc from the thrower to where the candidate stood, with its shadow on the ground
    for (const s of G.stones) {
      const x = s.px + (s.x - s.px) * alpha, y = s.py + (s.y - s.py) * alpha;
      if (!inView(x, y, 60)) continue;
      const k = Math.min(1, s.t / s.T), lift = 104 * k * (1 - k);
      ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 5]);
      ctx.beginPath(); ctx.moveTo(s.x0, s.y0); ctx.quadraticCurveTo((s.x0 + s.tx) / 2, (s.y0 + s.ty) / 2 - 52, s.tx, s.ty); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.ellipse(x, y + 2, 4, 2.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#6f6f6f'; ctx.beginPath(); ctx.arc(x, y - lift, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#b5b5b5'; ctx.beginPath(); ctx.arc(x - 1.2, y - lift - 1.2, 1.6, 0, Math.PI * 2); ctx.fill();
    }

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
      const bx = b.x - w / 2, by = b.y - 44;
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
    return { left, top, vw, vh };
  }

  // objective arrow + minimap, drawn in screen space by the HUD
  function drawMinimap(x, y, size, objective) {
    const P = G.player, sc = size / WORLD;
    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = 'rgba(20,14,8,.75)'; rr(x - 4, y - 4, size + 8, size + 8, 8); ctx.fill();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(mini, x, y, size, size);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(198,40,40,.8)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x + G.target.x * sc, y + G.target.y * sc, 15.6 * T * sc, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#ff7043'; for (const b of G.barrs) ctx.fillRect(x + b.x * sc - 1.5, y + b.y * sc - 1.5, 3, 3);
    ctx.fillStyle = '#ff6d00'; for (const f of G.fires) ctx.fillRect(x + f.x * sc - 2.5, y + f.y * sc - 2.5, 5, 5);
    for (const s of G.docSites) if (!P.docs.includes(s.doc)) { ctx.fillStyle = '#ffd54f'; ctx.fillRect(x + s.x * sc - 3, y + s.y * sc - 3, 6, 6); ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.strokeRect(x + s.x * sc - 3, y + s.y * sc - 3, 6, 6); }
    ctx.fillStyle = YSRCP_BLUE; ctx.fillRect(x + G.target.x * sc - 4, y + G.target.y * sc - 4, 8, 8);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.strokeRect(x + G.target.x * sc - 4, y + G.target.y * sc - 4, 8, 8);
    for (const e of G.ents) {
      if (e.kind === 'civ' && e.mode !== 'follow') continue;
      if (Math.abs(e.x - P.x) > 900 || Math.abs(e.y - P.y) > 900) continue;
      ctx.fillStyle = e.kind === 'cop' ? '#e53935' : e.kind === 'goon' || e.kind === 'mob' ? TDP_YELLOW : '#64b5f6';
      ctx.fillRect(x + e.x * sc - 1, y + e.y * sc - 1, 2, 2);
    }
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x + P.x * sc, y + P.y * sc, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = YSRCP_BLUE; ctx.beginPath(); ctx.arc(x + P.x * sc, y + P.y * sc, 2.2, 0, Math.PI * 2); ctx.fill();
    if (objective) { ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(x + P.x * sc, y + P.y * sc); ctx.lineTo(x + objective.x * sc, y + objective.y * sc); ctx.stroke(); ctx.setLineDash([]); }
    ctx.restore();
  }

  function worldToScreen(x, y, view) { return { x: (x - view.left) * zoom, y: (y - view.top) * zoom }; }

  window.Render = {
    init(canvas) { cv = canvas; ctx = cv.getContext('2d'); resize(); },
    resize, setGame, draw, drawMinimap, burst, popup, say, shake, worldToScreen,
    setBottomPad(px) { bottomPad = Math.max(0, px || 0); resize(); },
    get ctx() { return ctx; }, get DPR() { return DPR; }, get W() { return W; }, get H() { return H; }, get zoom() { return zoom; },
    get quality() { return quality; }, get bottomPad() { return bottomPad; },
  };
})();
