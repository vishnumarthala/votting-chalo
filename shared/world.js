// Shared world: seeded town generator, tile collision, BFS flow fields and line of sight.
// UMD: loaded by the browser (window.World) and by Node (require). No DOM, no Math.random.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.World = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TILE = 32;
  const N = 128; // map is N x N tiles
  const WORLD = N * TILE;
  const DT = 1 / 30;

  // tile kinds
  const K = { LOT: 255, GRASS: 0, ROAD: 1, WALK: 2, BUILD: 3, WATER: 4, BRIDGE: 5, WALL: 6, PARK: 7, TREE: 8, PLAZA: 9, FIELD: 10 };
  const SOLID = new Uint8Array(256);
  for (const k of [K.BUILD, K.WATER, K.WALL, K.TREE, K.FIELD]) SOLID[k] = 1;

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const hypot = (x, y) => Math.sqrt(x * x + y * y);
  const dist = (ax, ay, bx, by) => hypot(ax - bx, ay - by);
  const norm = (x, y) => { const m = hypot(x, y); return m > 1e-6 ? { x: x / m, y: y / m } : { x: 0, y: 0 }; };

  function makeRng(seed) {
    let s = seed >>> 0 || 0x9e3779b9;
    const next = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
    next.int = (n) => Math.floor(next() * n);
    next.range = (a, b) => a + next() * (b - a);
    next.pick = (arr) => arr[Math.floor(next() * arr.length)];
    return next;
  }
  function hashStr(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h >>> 0;
  }

  const NEIGHBOURHOODS = ['Gandhi Nagar', 'Rythu Peta', 'Bazaar Street', 'Station Road', 'Temple Street', 'Kummari Veedhi', 'Mill Colony', 'Teachers Colony', 'Main Road', 'Old Town', 'Brindavan Colony', 'Sai Nagar', 'Canal Road', 'Weavers Colony', 'Market Yard', 'Housing Board'];
  const ROOF = ['#e8c39e', '#f2d7a6', '#cfe0e8', '#f3c1b4', '#e7e2a7', '#d8c9ef', '#c8e6c0', '#f0b98d', '#ddd2c2', '#bfd8f0'];
  const DOC_SHOPS = [
    { doc: 'Form-A Nomination', name: 'Laxmi Xerox & Notary' },
    { doc: 'Affidavit', name: 'Notary Office' },
    { doc: 'Caste Certificate', name: 'MRO Office' },
    { doc: 'Deposit Receipt', name: 'Co-op Bank' },
    { doc: 'Proposer Signatures', name: 'Ward Elder\u2019s House' },
  ];

  // ------------------------------------------------------------------ generation
  // opts: { names: [neighbourhood names from the pincode lookup] }
  function generateTown(seed, opts) {
    const rng = makeRng(seed);
    const t = new Uint8Array(N * N).fill(K.LOT);
    const idx = (x, y) => y * N + x;
    const inb = (x, y) => x >= 0 && y >= 0 && x < N && y < N;
    const get = (x, y) => (inb(x, y) ? t[idx(x, y)] : K.FIELD);
    const set = (x, y, v) => { if (inb(x, y)) t[idx(x, y)] = v; };
    const setIf = (x, y, v, only) => { if (inb(x, y) && t[idx(x, y)] === only) t[idx(x, y)] = v; };
    const B = 3;

    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (x < B || y < B || x >= N - B || y >= N - B) set(x, y, K.FIELD);

    // arterials: sidewalk, 3 road tiles, sidewalk
    function lineV(a, w, y0, y1) {
      for (let y = y0; y <= y1; y++) {
        for (let d = 0; d < w; d++) set(a + d, y, K.ROAD);
        setIf(a - 1, y, K.WALK, K.LOT); setIf(a + w, y, K.WALK, K.LOT);
      }
    }
    function lineH(a, w, x0, x1) {
      for (let x = x0; x <= x1; x++) {
        for (let d = 0; d < w; d++) set(x, a + d, K.ROAD);
        setIf(x, a - 1, K.WALK, K.LOT); setIf(x, a + w, K.WALK, K.LOT);
      }
    }
    const span = N - 2 * B;
    const art = (n) => { const out = []; for (let k = 1; k <= n; k++) out.push(Math.round(B + (k * span) / (n + 1) + rng.range(-4, 4) - 1)); return out; };
    const ax = art(4), ay = art(4);
    for (const a of ax) lineV(a, 3, B, N - B - 1);
    for (const a of ay) lineH(a, 3, B, N - B - 1);
    // sidewalks along crossings must not cut roads: restore road tiles of crossing arterials
    for (const a of ax) for (let y = B; y < N - B; y++) for (let d = 0; d < 3; d++) set(a + d, y, K.ROAD);
    for (const a of ay) for (let x = B; x < N - B; x++) for (let d = 0; d < 3; d++) set(x, a + d, K.ROAD);

    // canal across the town; roads become bridges
    const canal = [];
    const cy0 = Math.round(N * rng.range(0.33, 0.42)), amp = rng.range(2, 5), ph = rng.range(0, 6);
    for (let x = B; x < N - B; x++) {
      const cy = Math.round(cy0 + Math.sin(x * 0.06 + ph) * amp);
      canal.push(cy);
      for (let d = 0; d < 3; d++) {
        const y = cy + d, k = get(x, y);
        if (k === K.ROAD || k === K.WALK) set(x, y, K.BRIDGE);
        else if (k !== K.FIELD) set(x, y, K.WATER);
      }
      // embankment walk on both banks
      setIf(x, cy - 1, K.WALK, K.LOT); setIf(x, cy + 3, K.WALK, K.LOT);
    }

    // super blocks between arterials, split by lanes into leaf blocks
    const bounds = (lines) => {
      const lo = [B], hi = [];
      for (const a of lines) { hi.push(a - 2); lo.push(a + 4); }
      hi.push(N - B - 1);
      return lo.map((l, i) => [l, hi[i]]);
    };
    const XB = bounds(ax), YB = bounds(ay);
    const supers = [];
    for (const [y0, y1] of YB) for (const [x0, x1] of XB) supers.push({ x0, y0, x1, y1 });

    const leaves = [];
    function laneV(c, y0, y1) {
      for (let y = y0; y <= y1; y++) {
        for (const d of [1, 2]) { const k = get(c + d, y); if (k === K.WATER) continue; set(c + d, y, k === K.BRIDGE ? K.BRIDGE : K.ROAD); }
        setIf(c, y, K.WALK, K.LOT); setIf(c + 3, y, K.WALK, K.LOT);
      }
    }
    function laneH(c, x0, x1) {
      for (let x = x0; x <= x1; x++) {
        for (const d of [1, 2]) { const k = get(x, c + d); if (k === K.WATER) continue; set(x, c + d, k === K.BRIDGE ? K.BRIDGE : K.ROAD); }
        setIf(x, c, K.WALK, K.LOT); setIf(x, c + 3, K.WALK, K.LOT);
      }
    }
    function split(r, depth) {
      const w = r.x1 - r.x0 + 1, h = r.y1 - r.y0 + 1;
      const canV = w >= 17, canH = h >= 17;
      if ((!canV && !canH) || (depth > 1 && w < 22 && h < 22 && rng() < 0.35)) { leaves.push(r); return; }
      if (canV && (!canH || w >= h)) {
        const c = r.x0 + 6 + rng.int(w - 15);
        laneV(c, r.y0, r.y1);
        split({ x0: r.x0, y0: r.y0, x1: c - 1, y1: r.y1 }, depth + 1);
        split({ x0: c + 4, y0: r.y0, x1: r.x1, y1: r.y1 }, depth + 1);
      } else {
        const c = r.y0 + 6 + rng.int(h - 15);
        laneH(c, r.x0, r.x1);
        split({ x0: r.x0, y0: r.y0, x1: r.x1, y1: c - 1 }, depth + 1);
        split({ x0: r.x0, y0: c + 4, x1: r.x1, y1: r.y1 }, depth + 1);
      }
    }
    for (const s of supers) split(s, 0);
    // lanes leave sidewalk tiles on block edges; shrink leaves to their LOT interior
    const lotLeaves = [];
    for (const r of leaves) {
      let { x0, y0, x1, y1 } = r;
      const rowLot = (y) => { for (let x = x0; x <= x1; x++) if (get(x, y) === K.LOT) return true; return false; };
      const colLot = (x) => { for (let y = y0; y <= y1; y++) if (get(x, y) === K.LOT) return true; return false; };
      while (y0 <= y1 && !rowLot(y0)) y0++;
      while (y1 >= y0 && !rowLot(y1)) y1--;
      while (x0 <= x1 && !colLot(x0)) x0++;
      while (x1 >= x0 && !colLot(x1)) x1--;
      if (x1 - x0 >= 2 && y1 - y0 >= 2) lotLeaves.push({ x0, y0, x1, y1 });
    }
    // blocks cut by the canal: keep runs of fully buildable rows as blocks, green the strips beside the water
    for (let i = lotLeaves.length - 1; i >= 0; i--) {
      const r = lotLeaves[i];
      const full = (y) => { for (let x = r.x0; x <= r.x1; x++) if (get(x, y) !== K.LOT) return false; return true; };
      let mixed = false;
      for (let y = r.y0; y <= r.y1 && !mixed; y++) if (!full(y)) mixed = true;
      if (!mixed) continue;
      lotLeaves.splice(i, 1);
      let run = null;
      for (let y = r.y0; y <= r.y1 + 1; y++) {
        if (y <= r.y1 && full(y)) { if (!run) run = { x0: r.x0, x1: r.x1, y0: y, y1: y }; else run.y1 = y; continue; }
        if (run && run.y1 - run.y0 >= 2) lotLeaves.push(run);
        else if (run) for (let yy = run.y0; yy <= run.y1; yy++) for (let x = r.x0; x <= r.x1; x++) set(x, yy, K.PARK);
        run = null;
        if (y <= r.y1) for (let x = r.x0; x <= r.x1; x++) setIf(x, y, K.PARK, K.LOT);
      }
    }
    const pureLot = (r) => { for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) if (get(x, y) !== K.LOT) return false; return true; };
    const cx = (r) => ((r.x0 + r.x1 + 1) / 2) * TILE, cyy = (r) => ((r.y0 + r.y1 + 1) / 2) * TILE;

    // ---- special sites
    const big = lotLeaves.filter((r) => r.x1 - r.x0 >= 9 && r.y1 - r.y0 >= 9 && pureLot(r));
    const used = new Set();
    const take = (cands, score) => {
      let best = null, bs = -Infinity;
      for (const r of cands) { if (used.has(r)) continue; const s = score(r); if (s > bs) { bs = s; best = r; } }
      if (best) used.add(best);
      return best;
    };
    const flip = rng() < 0.5;
    const cornerA = { x: flip ? WORLD : 0, y: WORLD }, cornerB = { x: flip ? 0 : WORLD, y: 0 };
    const officeR = take(big, (r) => -dist(cx(r), cyy(r), cornerB.x, cornerB.y));
    const startR = take(lotLeaves.filter(pureLot), (r) => -dist(cx(r), cyy(r), cornerA.x, cornerA.y));
    const boothR = take(big, (r) => -Math.abs(dist(cx(r), cyy(r), cornerA.x, cornerA.y) - WORLD * 0.95) - dist(cx(r), cyy(r), officeR ? cx(officeR) : 0, officeR ? cyy(officeR) : 0) * -0.3);
    const stationRs = [];
    const stationTargets = [[0.5, 0.5], [officeR ? cx(officeR) / WORLD : 0.8, officeR ? cyy(officeR) / WORLD + 0.15 : 0.3], [0.25, 0.75], [0.75, 0.75]];
    for (const [fx, fy] of stationTargets) {
      const r = take(lotLeaves.filter((r) => pureLot(r) && r.x1 - r.x0 >= 5 && r.y1 - r.y0 >= 5), (r) => -dist(cx(r), cyy(r), fx * WORLD, fy * WORLD));
      if (r) stationRs.push(r);
    }

    const buildings = [];
    const sites = [];
    const labels = [];

    // find a walkable tile just outside a rect side, preferring roads; returns {side, x, y} of door tile
    function doorFor(r) {
      const opts = [];
      const walk = (k) => k === K.WALK || k === K.ROAD || k === K.BRIDGE;
      for (let x = r.x0 + 1; x < r.x1; x++) { if (walk(get(x, r.y0 - 1))) opts.push({ side: 'n', x, y: r.y0 - 1 }); if (walk(get(x, r.y1 + 1))) opts.push({ side: 's', x, y: r.y1 + 1 }); }
      for (let y = r.y0 + 1; y < r.y1; y++) { if (walk(get(r.x0 - 1, y))) opts.push({ side: 'w', x: r.x0 - 1, y }); if (walk(get(r.x1 + 1, y))) opts.push({ side: 'e', x: r.x1 + 1, y }); }
      if (!opts.length) return null;
      // middle of the longest side
      const bySide = {};
      for (const o of opts) (bySide[o.side] = bySide[o.side] || []).push(o);
      const side = Object.keys(bySide).sort((a, b) => bySide[b].length - bySide[a].length)[0];
      const list = bySide[side];
      return list[Math.floor(list.length / 2)];
    }

    // walled compound: wall ring, gate facing the street, plaza, central building, counter zone at its door
    function compound(r, kind, name, color) {
      const gate = doorFor(r);
      for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) {
        const edge = x === r.x0 || x === r.x1 || y === r.y0 || y === r.y1;
        set(x, y, edge ? K.WALL : K.PLAZA);
      }
      // gate: 3 tiles in the wall facing the door tile
      const gx = gate.side === 'n' || gate.side === 's' ? gate.x : gate.side === 'w' ? r.x0 : r.x1;
      const gy = gate.side === 'e' || gate.side === 'w' ? gate.y : gate.side === 'n' ? r.y0 : r.y1;
      for (let d = -1; d <= 1; d++) {
        if (gate.side === 'n' || gate.side === 's') set(gx + d, gy, K.PLAZA); else set(gx, gy + d, K.PLAZA);
      }
      // building in the half away from the gate
      const iw = r.x1 - r.x0 - 1, ih = r.y1 - r.y0 - 1;
      const bw = Math.max(3, Math.floor(iw * 0.6)), bh = Math.max(3, Math.floor(ih * 0.4));
      let bx = r.x0 + 1 + Math.floor((iw - bw) / 2), by = r.y0 + 1 + Math.floor((ih - bh) / 2);
      if (gate.side === 'n') by = r.y1 - 1 - bh;
      if (gate.side === 's') by = r.y0 + 2;
      if (gate.side === 'e') bx = r.x0 + 2;
      if (gate.side === 'w') bx = r.x1 - 1 - bw;
      for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) set(x, y, K.BUILD);
      const bld = { x: bx * TILE, y: by * TILE, w: bw * TILE, h: bh * TILE, color, kind, name };
      buildings.push(bld);
      // counter zone in front of the building, on the gate side
      let zx = (bx + bw / 2) * TILE, zy = (by + bh / 2) * TILE;
      if (gate.side === 'n') zy = (by - 1) * TILE; else if (gate.side === 's') zy = (by + bh + 1) * TILE;
      else if (gate.side === 'w') zx = (bx - 1) * TILE; else zx = (bx + bw + 1) * TILE;
      return { kind, name, x: zx, y: zy, r: 52, gate: { x: (gx + 0.5) * TILE, y: (gy + 0.5) * TILE }, rect: { x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 }, bld };
    }

    const office = officeR ? compound(officeR, 'office', 'RO Office', '#f5e6c8') : null;
    const booth = boothR ? compound(boothR, 'booth', 'Govt High School (Polling Booth)', '#ffe0b2') : null;
    if (office) sites.push(office);
    if (booth) sites.push(booth);

    // police stations: building in a plaza
    const stations = [];
    for (const r of stationRs) {
      for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) set(x, y, K.PLAZA);
      const bw = Math.max(3, r.x1 - r.x0 - 3), bh = Math.max(3, Math.floor((r.y1 - r.y0) / 2));
      const bx = r.x0 + 2, by = r.y0 + 1;
      for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) set(x, y, K.BUILD);
      buildings.push({ x: bx * TILE, y: by * TILE, w: bw * TILE, h: bh * TILE, color: '#c5d3e8', kind: 'station', name: 'Police Station' });
      const s = { kind: 'station', name: 'Police Station', x: (bx + bw / 2) * TILE, y: (by + bh + 1) * TILE, r: 40 };
      stations.push(s); sites.push(s);
    }

    // party office (start)
    let start = null;
    if (startR) {
      const r = startR;
      for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) set(x, y, K.PLAZA);
      const bw = Math.max(2, Math.min(6, r.x1 - r.x0 - 1)), bh = Math.max(2, Math.min(4, r.y1 - r.y0 - 1));
      const bx = r.x0 + 1, by = r.y0 + 1;
      for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) set(x, y, K.BUILD);
      buildings.push({ x: bx * TILE, y: by * TILE, w: bw * TILE, h: bh * TILE, color: '#bbdefb', kind: 'party', name: 'NPP Party Office' });
      start = { kind: 'start', name: 'NPP Party Office', x: (bx + bw / 2) * TILE, y: Math.min(r.y1 + 0.5, by + bh + 1) * TILE, r: 40 };
      sites.push(start);
    }

    // ---- ordinary blocks: houses, parks, a few landmarks
    const remaining = lotLeaves.filter((r) => !used.has(r) && pureLot(r));
    const landmarkNames = [['temple', 'Sri Venkateswara Temple'], ['market', 'Rythu Bazar'], ['busstand', 'RTC Bus Stand'], ['hospital', 'Govt Hospital']];
    const docRects = [];
    const shuffled = remaining.slice().sort((a, b) => hashStr(a.x0 + ':' + a.y0 + ':' + seed) - hashStr(b.x0 + ':' + b.y0 + ':' + seed));
    let li = 0;
    for (const r of shuffled) {
      const w = r.x1 - r.x0 + 1, h = r.y1 - r.y0 + 1;
      if (li < landmarkNames.length && w >= 6 && h >= 6) {
        const [kind, name] = landmarkNames[li++];
        for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) set(x, y, kind === 'temple' ? K.PARK : K.PLAZA);
        const bw = kind === 'market' ? 2 : Math.min(5, w - 2), bh = kind === 'market' ? 2 : Math.min(4, h - 2);
        const bx = Math.floor(r.x0 + (w - bw) / 2), by = Math.floor(r.y0 + (h - bh) / 2);
        if (kind !== 'market') for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) set(x, y, K.BUILD);
        buildings.push({ x: bx * TILE, y: by * TILE, w: bw * TILE, h: bh * TILE, color: kind === 'temple' ? '#ffe082' : kind === 'hospital' ? '#ffffff' : '#ffccbc', kind, name, solid: kind !== 'market' });
        continue;
      }
      if (rng() < 0.12 || w < 3 || h < 3) {
        for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) {
          const edge = x === r.x0 || x === r.x1 || y === r.y0 || y === r.y1;
          set(x, y, !edge && rng() < 0.12 ? K.TREE : K.PARK);
        }
        if (w * h > 30) labels.push({ x: cx(r), y: cyy(r), text: 'Park', small: true });
        continue;
      }
      // houses: one or two rows of plots, occasional alley
      const rows = h >= 8 ? 2 : 1;
      const rowH = Math.floor(h / rows);
      for (let k = 0; k < rows; k++) {
        const y0 = r.y0 + k * rowH, y1 = k === rows - 1 ? r.y1 : y0 + rowH - 1;
        let x = r.x0;
        while (x <= r.x1) {
          const pw = Math.min(r.x1 - x + 1, 3 + rng.int(4));
          const alley = rng() < 0.18 && x > r.x0 && r.x1 - x > 4;
          if (alley) { for (let y = y0; y <= y1; y++) set(x, y, K.WALK); x++; continue; }
          for (let y = y0; y <= y1; y++) for (let xx = x; xx < x + pw; xx++) set(xx, y, K.BUILD);
          buildings.push({ x: x * TILE, y: y0 * TILE, w: pw * TILE, h: (y1 - y0 + 1) * TILE, color: ROOF[rng.int(ROOF.length)], kind: 'house', tank: rng() < 0.5, seed: rng.int(1e6) });
          x += pw;
        }
      }
      docRects.push(r);
    }
    for (let i = 0; i < t.length; i++) if (t[i] === K.LOT) t[i] = K.GRASS;

    // ---- document shops: one house building in each of five spread-out blocks, door on the street
    const docSites = [];
    const goal = office || booth || { x: WORLD / 2, y: WORLD / 2 };
    const anchors = [[0.2, 0.25], [0.8, 0.8], [0.15, 0.6], [0.55, 0.3], [0.45, 0.75]];
    for (let i = 0; i < DOC_SHOPS.length; i++) {
      const [fx, fy] = anchors[i];
      let best = null, bs = Infinity;
      for (const b of buildings) {
        if (b.kind !== 'house' || b.shop) continue;
        const d = dist(b.x + b.w / 2, b.y + b.h / 2, fx * WORLD, fy * WORLD);
        if (d < bs && dist(b.x, b.y, goal.x, goal.y) > 20 * TILE) {
          const r = { x0: b.x / TILE, y0: b.y / TILE, x1: (b.x + b.w) / TILE - 1, y1: (b.y + b.h) / TILE - 1 };
          if (doorFor(r)) { bs = d; best = b; }
        }
      }
      if (!best) continue;
      const r = { x0: best.x / TILE, y0: best.y / TILE, x1: (best.x + best.w) / TILE - 1, y1: (best.y + best.h) / TILE - 1 };
      const door = doorFor(r);
      best.shop = true; best.name = DOC_SHOPS[i].name; best.color = '#fff3c4';
      const s = { kind: 'doc', doc: DOC_SHOPS[i].doc, name: DOC_SHOPS[i].name, x: (door.x + 0.5) * TILE, y: (door.y + 0.5) * TILE, r: 30 };
      docSites.push(s); sites.push(s);
    }
    // BLO tent for the voter slip (polling day): a walkable spot in a park or plaza near the town centre
    let blo = null;
    {
      let bd = Infinity;
      for (let y = B; y < N - B; y++) for (let x = B; x < N - B; x++) {
        if (t[idx(x, y)] !== K.PARK) continue;
        const d = dist((x + 0.5) * TILE, (y + 0.5) * TILE, WORLD * 0.45, WORLD * 0.55);
        if (d < bd) { bd = d; blo = { kind: 'doc', doc: 'Voter Slip', name: 'BLO Help Tent', x: (x + 0.5) * TILE, y: (y + 0.5) * TILE, r: 30, mode: 'vote' }; }
      }
      if (blo) sites.push(blo);
    }

    // neighbourhood labels on super blocks
    const names = (opts && opts.names && opts.names.length ? opts.names.slice() : []).concat(NEIGHBOURHOODS);
    const seen = new Set();
    let ni = 0;
    for (const s of supers) {
      while (ni < names.length && seen.has(names[ni])) ni++;
      const name = names[ni++] || '';
      seen.add(name);
      labels.push({ x: cx(s), y: cyy(s), text: name });
    }

    // posts: arterial intersections (patrol waypoints)
    const posts = [];
    for (const a of ax) for (const b of ay) posts.push({ x: (a + 1.5) * TILE, y: (b + 1.5) * TILE });

    return { seed, n: N, tile: TILE, world: WORLD, t, buildings, sites, docSites, blo, office, booth, stations, start, labels, posts, canal, arterials: { x: ax, y: ay }, dyn: new Uint8Array(N * N) };
  }

  // ------------------------------------------------------------------ queries
  const kindAt = (m, tx, ty) => (tx < 0 || ty < 0 || tx >= N || ty >= N ? K.FIELD : m.t[ty * N + tx]);
  const solidAt = (m, tx, ty) => tx < 0 || ty < 0 || tx >= N || ty >= N || SOLID[m.t[ty * N + tx]] === 1 || m.dyn[ty * N + tx] !== 0;
  const solidPx = (m, x, y) => solidAt(m, Math.floor(x / TILE), Math.floor(y / TILE));
  const walkable = (k) => SOLID[k] === 0;

  const EPS = 0.001;
  // Box body {x, y, r}: r is the half size. Axis-separated, so bodies slide along walls.
  function moveBody(b, dx, dy, m) {
    let hitX = false, hitY = false;
    if (dx) {
      b.x += dx;
      const t0 = Math.floor((b.y - b.r) / TILE), t1 = Math.floor((b.y + b.r - EPS) / TILE);
      const tx = dx > 0 ? Math.floor((b.x + b.r - EPS) / TILE) : Math.floor((b.x - b.r) / TILE);
      for (let ty = t0; ty <= t1; ty++) if (solidAt(m, tx, ty)) { b.x = dx > 0 ? tx * TILE - b.r : (tx + 1) * TILE + b.r; hitX = true; break; }
    }
    if (dy) {
      b.y += dy;
      const t0 = Math.floor((b.x - b.r) / TILE), t1 = Math.floor((b.x + b.r - EPS) / TILE);
      const ty = dy > 0 ? Math.floor((b.y + b.r - EPS) / TILE) : Math.floor((b.y - b.r) / TILE);
      for (let tx = t0; tx <= t1; tx++) if (solidAt(m, tx, ty)) { b.y = dy > 0 ? ty * TILE - b.r : (ty + 1) * TILE + b.r; hitY = true; break; }
    }
    return { hitX, hitY };
  }

  // Breadth-first distance field (in tiles) from target tiles over walkable tiles. -1 = unreachable.
  function field(m, targets, maxDist) {
    const d = new Int32Array(N * N).fill(-1);
    const q = new Int32Array(N * N);
    let qh = 0, qt = 0;
    for (const [tx, ty] of targets) {
      if (tx < 0 || ty < 0 || tx >= N || ty >= N) continue;
      const i = ty * N + tx;
      if (d[i] === -1) { d[i] = 0; q[qt++] = i; }
    }
    const lim = maxDist || 1e9;
    while (qh < qt) {
      const i = q[qh++], x = i % N, y = (i / N) | 0, nd = d[i] + 1;
      if (nd > lim) continue;
      if (x > 0) { const j = i - 1; if (d[j] === -1 && !solidAt(m, x - 1, y)) { d[j] = nd; q[qt++] = j; } }
      if (x < N - 1) { const j = i + 1; if (d[j] === -1 && !solidAt(m, x + 1, y)) { d[j] = nd; q[qt++] = j; } }
      if (y > 0) { const j = i - N; if (d[j] === -1 && !solidAt(m, x, y - 1)) { d[j] = nd; q[qt++] = j; } }
      if (y < N - 1) { const j = i + N; if (d[j] === -1 && !solidAt(m, x, y + 1)) { d[j] = nd; q[qt++] = j; } }
    }
    return d;
  }
  // Direction (unit vector) down the field from a pixel position, or null at the target/unreachable.
  function flowDir(m, f, x, y) {
    const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    if (tx < 0 || ty < 0 || tx >= N || ty >= N) return null;
    const here = f[ty * N + tx];
    let best = here < 0 ? 1e9 : here, bx = 0, by = 0;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      if (!ox && !oy) continue;
      const nx = tx + ox, ny = ty + oy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const v = f[ny * N + nx];
      if (v < 0) continue;
      if (ox && oy && (solidAt(m, tx + ox, ty) || solidAt(m, tx, ty + oy))) continue;
      const c = v + (ox && oy ? 0.4 : 0);
      if (c < best) { best = c; bx = ox; by = oy; }
    }
    if (!bx && !by) return null;
    return norm((tx + bx + 0.5) * TILE - x, (ty + by + 0.5) * TILE - y);
  }

  function lineOfSight(m, ax, ay, bx, by) {
    const d = dist(ax, ay, bx, by), steps = Math.ceil(d / 12);
    for (let i = 1; i < steps; i++) {
      const k = i / steps;
      if (solidPx(m, ax + (bx - ax) * k, ay + (by - ay) * k)) return false;
    }
    return true;
  }

  // Section 144 ring: walkable street tiles crossing a circle around the target, grouped into barricades.
  function barricadeRing(m, cx, cy, radiusTiles) {
    const inRing = new Uint8Array(N * N);
    const ctx = cx / TILE, cty = cy / TILE;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const k = m.t[y * N + x];
      if (k !== K.ROAD && k !== K.WALK && k !== K.BRIDGE) continue;
      const d = hypot(x + 0.5 - ctx, y + 0.5 - cty);
      if (d >= radiusTiles && d < radiusTiles + 1.2) inRing[y * N + x] = 1;
    }
    const groups = [];
    const seen = new Uint8Array(N * N);
    for (let i = 0; i < N * N; i++) {
      if (!inRing[i] || seen[i]) continue;
      const tiles = [], st = [i];
      seen[i] = 1;
      while (st.length) {
        const j = st.pop(); tiles.push(j);
        const x = j % N, y = (j / N) | 0;
        for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
          const nx = x + ox, ny = y + oy;
          if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
          const k = ny * N + nx;
          if (inRing[k] && !seen[k]) { seen[k] = 1; st.push(k); }
        }
      }
      let sx = 0, sy = 0;
      for (const j of tiles) { sx += (j % N) + 0.5; sy += ((j / N) | 0) + 0.5; }
      groups.push({ tiles, x: (sx / tiles.length) * TILE, y: (sy / tiles.length) * TILE });
    }
    return groups;
  }

  return { TILE, N, WORLD, DT, K, SOLID, clamp, hypot, dist, norm, makeRng, hashStr, generateTown, kindAt, solidAt, solidPx, walkable, moveBody, field, flowDir, lineOfSight, barricadeRing, DOC_SHOPS };
});
