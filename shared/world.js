// Shared world: town builder, tile collision, BFS flow fields and line of sight.
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

  const ROOF = ['#e8c39e', '#f2d7a6', '#cfe0e8', '#f3c1b4', '#e7e2a7', '#d8c9ef', '#c8e6c0', '#f0b98d', '#ddd2c2', '#bfd8f0'];
  const DOC_SHOPS = [
    { doc: 'Form-A Nomination', name: 'Laxmi Xerox & Notary' },
    { doc: 'Affidavit', name: 'Notary Office' },
    { doc: 'Caste Certificate', name: 'MRO Office' },
    { doc: 'Deposit Receipt', name: 'Co-op Bank' },
    { doc: 'Proposer Signatures', name: 'Ward Elder\u2019s House' },
  ];

  // ------------------------------------------------------------------ building a town from map data
  const ROAD_W = { trunk: 3, primary: 3, secondary: 3, tertiary: 2 }; // tiles; every other road class is a 1-tile lane
  const MAJOR_ROADS = new Set(['trunk', 'primary', 'secondary', 'tertiary']);
  const WATER_W = { river: 3, canal: 2, stream: 1 };
  const LANDMARK_BUILDING = { place_of_worship: ['temple', '#ffe082'], hospital: ['hospital', '#ffffff'], school: ['school', '#ffe0b2'], government: ['govt', '#f5e6c8'], townhall: ['govt', '#f5e6c8'] };
  const COMPOUND_SIZES = [[11, 9], [9, 9], [9, 7], [7, 7]];
  const BUS_STAND_SIZES = [[6, 6], [5, 5], [4, 4]];
  const REAL_REACH = 3; // tiles: a mapped police or bus station is built this close to its real point where the map allows
  const NEAR_REACH = 8; // tiles: how far from the real point a station may be built when it does not fit closer
  const SAME_STATION = 6; // tiles: two mapped points of one kind this close are one station mapped twice
  const YARD = 6; // a police station's yard is YARD x YARD tiles: a 3x3 building at the top, its site in the bottom row
  const YARD_SITE = { x: 3.5, y: 5 }; // the site's offset from the yard's top-left corner, in tiles
  const DOC_ANCHORS = [[0.2, 0.25], [0.8, 0.8], [0.15, 0.6], [0.55, 0.3], [0.45, 0.75]]; // where the five shops want to be, as shares of the map
  const NEIGH4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const isStreet = (k) => k === K.ROAD || k === K.WALK || k === K.BRIDGE;
  const idx = (x, y) => y * N + x;
  const inb = (x, y) => x >= 0 && y >= 0 && x < N && y < N;

  // Visits the tiles of a w-wide band along a polyline in tile units. The band is 4-connected, so a flow field
  // can follow it, and exactly w tiles wide across axis-aligned roads.
  function stampPolyline(pts, w, visit) {
    let px = null, py = null;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      const horizontal = Math.abs(x1 - x0) >= Math.abs(y1 - y0);
      const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 4));
      for (let s = 0; s <= n; s++) {
        const x = x0 + ((x1 - x0) * s) / n, y = y0 + ((y1 - y0) * s) / n;
        const along = Math.floor(horizontal ? x : y), first = Math.round((horizontal ? y : x) - w / 2);
        const cx = horizontal ? along : first, cy = horizontal ? first : along;
        if (w === 1 && px !== null && cx !== px && cy !== py) visit(cx, py); // keep single-tile lanes 4-connected on diagonals
        for (let o = 0; o < w; o++) { if (horizontal) visit(along, first + o); else visit(first + o, along); }
        px = cx; py = cy;
      }
    }
  }
  function pointInPolygon(ring, x, y) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  // Calls visit(tx, ty, covered) for every tile the ring touches; covered is the share of a 4x4 sample grid inside it.
  function ringTiles(ring, visit) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of ring) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    for (let ty = Math.floor(y0); ty <= Math.floor(y1); ty++) for (let tx = Math.floor(x0); tx <= Math.floor(x1); tx++) {
      let hit = 0;
      for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) if (pointInPolygon(ring, tx + (i + 0.5) / 4, ty + (j + 0.5) / 4)) hit++;
      if (hit) visit(tx, ty, hit / 16);
    }
  }

  // The tile grid being built, with the extra layers the placement steps need.
  function newGrid(data) {
    const g = {
      scale: N / data.size, // tiles per metre
      t: new Uint8Array(N * N).fill(K.LOT),
      owner: new Int32Array(N * N).fill(-1), // BUILD tile -> index of the mapped building that covers it
      wide: new Uint8Array(N * N), // road tile of a road wider than one tile: never cleared for a site
      main: new Uint8Array(N * N), // tiles of the walkable network that sites must connect to
      mapped: [], // { tiles, kind, name, color, seed } per mapped building
      roads: [], // { class, w, pts } with pts in tile units
      buildings: [], sites: [], stations: [],
    };
    g.get = (x, y) => (inb(x, y) ? g.t[idx(x, y)] : K.FIELD);
    g.set = (x, y, v) => { if (inb(x, y)) g.t[idx(x, y)] = v; };
    g.setIf = (x, y, v, only) => { if (inb(x, y) && g.t[idx(x, y)] === only) g.t[idx(x, y)] = v; };
    g.fill = (x0, y0, w, h, kind) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) g.set(x, y, kind); };
    g.release = (r) => { for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) g.owner[idx(x, y)] = -1; };
    return g;
  }

  // Roads, water and mapped buildings drawn onto the grid, and mapped landmarks tagged onto their buildings.
  function drawMap(g, data) {
    const tiles = (pts) => pts.map(([x, y]) => [x * g.scale, y * g.scale]);
    g.roads = data.roads.map((r) => ({ class: r.class, w: ROAD_W[r.class] || 1, pts: tiles(r.pts) }));
    for (const r of g.roads) if (r.w >= 3) stampPolyline(r.pts, r.w + 2, (x, y) => g.setIf(x, y, K.WALK, K.LOT));
    for (const r of g.roads) stampPolyline(r.pts, r.w, (x, y) => { g.set(x, y, K.ROAD); if (r.w > 1 && inb(x, y)) g.wide[idx(x, y)] = 1; });

    const wet = (x, y) => { if (inb(x, y)) g.t[idx(x, y)] = isStreet(g.t[idx(x, y)]) ? K.BRIDGE : K.WATER; };
    for (const w of data.water || []) {
      if (w.kind === 'area') ringTiles(tiles(w.pts), (x, y, covered) => { if (covered >= 0.5) wet(x, y); });
      else stampPolyline(tiles(w.pts), WATER_W[w.kind] || 1, wet);
    }

    (data.buildings || []).forEach((b, bi) => {
      let best = -1, bestCover = 0;
      const mine = [];
      ringTiles(tiles(b.pts), (x, y, covered) => {
        if (!inb(x, y) || g.t[idx(x, y)] !== K.LOT) return;
        if (covered >= 0.25) mine.push(idx(x, y));
        if (covered > bestCover) { bestCover = covered; best = idx(x, y); }
      });
      if (!mine.length && best >= 0) mine.push(best); // every building keeps the tile it covers most
      if (!mine.length) return;
      for (const i of mine) { g.t[i] = K.BUILD; g.owner[i] = g.mapped.length; }
      g.mapped.push({ tiles: mine, kind: 'house', name: null, color: null, seed: hashStr('b' + bi) });
    });
    for (const l of data.landmarks || []) {
      const spec = LANDMARK_BUILDING[l.kind], tx = Math.floor(l.x * g.scale), ty = Math.floor(l.y * g.scale);
      const m = inb(tx, ty) && g.owner[idx(tx, ty)] >= 0 ? g.mapped[g.owner[idx(tx, ty)]] : null;
      if (spec && m) { m.kind = spec[0]; m.color = spec[1]; m.name = l.name || null; }
    }
  }

  // The open component with the most road tiles is the network every site must connect to.
  function markMainNetwork(g) {
    const { t } = g, label = new Int32Array(N * N).fill(-1), roadCount = [];
    const open = (i) => t[i] === K.LOT || isStreet(t[i]);
    for (let s = 0; s < N * N; s++) {
      if (label[s] >= 0 || !open(s)) continue;
      const id = roadCount.length, stack = [s];
      let count = 0;
      label[s] = id;
      while (stack.length) {
        const i = stack.pop();
        if (t[i] === K.ROAD) count++;
        const x = i % N, y = (i / N) | 0;
        for (const [ox, oy] of NEIGH4) {
          if (!inb(x + ox, y + oy)) continue;
          const j = idx(x + ox, y + oy);
          if (label[j] < 0 && open(j)) { label[j] = id; stack.push(j); }
        }
      }
      roadCount.push(count);
    }
    const top = roadCount.indexOf(Math.max(...roadCount, 0));
    for (let i = 0; i < N * N; i++) if (label[i] === top) g.main[i] = 1;
  }

  // A site may take open lots, mapped buildings and one-tile lanes: the old town is too tightly built to leave room otherwise.
  const clearable = (g, i) => (g.t[i] === K.LOT || (g.t[i] === K.BUILD && g.owner[i] >= 0) || (g.t[i] === K.ROAD && !g.wide[i])) && g.main[i] === 1;
  const clearingCost = (g, i) => (g.t[i] === K.ROAD ? 1 : g.t[i] === K.BUILD ? (g.mapped[g.owner[i]].kind === 'house' ? 1.5 : 8) : 0);
  function touchesStreet(g, x0, y0, x1, y1) {
    let n = 0;
    const count = (x, y) => { if (inb(x, y) && g.main[idx(x, y)] && isStreet(g.t[idx(x, y)])) n++; };
    for (let x = x0 - 1; x <= x1 + 1; x++) { count(x, y0 - 1); count(x, y1 + 1); }
    for (let y = y0; y <= y1; y++) { count(x0 - 1, y); count(x1 + 1, y); }
    return n >= 3;
  }
  // The w x h rectangle of clearable tiles that touches a street and is cheapest: its distance from `near`
  // (tile units, within near.r) plus the cost of clearing it and of `extra(x0, y0)`.
  function findRect(g, w, h, near, extra) {
    let best = null, bestCost = Infinity;
    const lo = (v) => Math.max(2, Math.floor(v)), hi = (v, size) => Math.min(N - 2 - size, Math.ceil(v));
    for (let y0 = lo(near.y - h / 2 - near.r); y0 <= hi(near.y - h / 2 + near.r, h); y0++) {
      for (let x0 = lo(near.x - w / 2 - near.r); x0 <= hi(near.x - w / 2 + near.r, w); x0++) {
        const d = hypot(x0 + w / 2 - near.x, y0 + h / 2 - near.y);
        if (d > near.r || d >= bestCost) continue;
        let cost = d + (extra ? extra(x0, y0) : 0), ok = true;
        for (let y = y0; y < y0 + h && ok; y++) for (let x = x0; x < x0 + w; x++) {
          const i = idx(x, y);
          if (!clearable(g, i)) { ok = false; break; }
          cost += clearingCost(g, i);
        }
        if (ok && cost < bestCost && touchesStreet(g, x0, y0, x0 + w - 1, y0 + h - 1)) { bestCost = cost; best = { x0, y0, x1: x0 + w - 1, y1: y0 + h - 1 }; }
      }
    }
    return best;
  }
  // The best rectangle near a tile over several sizes: area is traded against distance and the cost of clearing.
  function bestRect(g, sizes, near) {
    const [bigW, bigH] = sizes[0];
    let best = null, bestScore = Infinity;
    for (const [w, h] of sizes) {
      const r = findRect(g, w, h, near);
      if (!r) continue;
      let score = ((bigW * bigH - w * h) * 11 * 9) / (bigW * bigH) / 6 + hypot((r.x0 + r.x1 + 1) / 2 - near.x, (r.y0 + r.y1 + 1) / 2 - near.y);
      for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) score += clearingCost(g, idx(x, y));
      if (score < bestScore) { bestScore = score; best = r; }
    }
    return best;
  }

  // A tile just outside rect r where a door or gate can open, preferring real streets; margin keeps a 3-tile
  // gate clear of the corners. Returns {side, x, y} or null.
  function doorFor(g, r, margin) {
    const open = (x, y) => (isStreet(g.get(x, y)) ? 2 : SOLID[g.get(x, y)] === 0 ? 1 : 0);
    const sides = { n: [], s: [], w: [], e: [] };
    for (let x = r.x0 + margin; x <= r.x1 - margin; x++) { sides.n.push({ side: 'n', x, y: r.y0 - 1 }); sides.s.push({ side: 's', x, y: r.y1 + 1 }); }
    for (let y = r.y0 + margin; y <= r.y1 - margin; y++) { sides.w.push({ side: 'w', x: r.x0 - 1, y }); sides.e.push({ side: 'e', x: r.x1 + 1, y }); }
    let best = null, bs = 0;
    for (const side of Object.keys(sides)) {
      const list = sides[side].filter((o) => open(o.x, o.y) > 0);
      const score = list.reduce((a, o) => a + open(o.x, o.y), 0);
      if (score > bs) { bs = score; best = list; }
    }
    return best ? best[Math.floor(best.length / 2)] : null;
  }

  // Walled compound: wall ring, gate facing the street, plaza, central building, counter zone at its door.
  function buildCompound(g, r, kind, name, color) {
    const gate = doorFor(g, r, 2) || doorFor(g, r, 1) || { side: 's', x: Math.floor((r.x0 + r.x1) / 2), y: r.y1 + 1 };
    g.release(r);
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) {
      const edge = x === r.x0 || x === r.x1 || y === r.y0 || y === r.y1;
      g.set(x, y, edge ? K.WALL : K.PLAZA);
    }
    const gx = gate.side === 'n' || gate.side === 's' ? gate.x : gate.side === 'w' ? r.x0 : r.x1;
    const gy = gate.side === 'e' || gate.side === 'w' ? gate.y : gate.side === 'n' ? r.y0 : r.y1;
    for (let d = -1; d <= 1; d++) {
      if (gate.side === 'n' || gate.side === 's') g.set(gx + d, gy, K.PLAZA); else g.set(gx, gy + d, K.PLAZA);
    }
    const iw = r.x1 - r.x0 - 1, ih = r.y1 - r.y0 - 1;
    const bw = Math.max(3, Math.floor(iw * 0.6)), bh = Math.max(3, Math.floor(ih * 0.4));
    let bx = r.x0 + 1 + Math.floor((iw - bw) / 2), by = r.y0 + 1 + Math.floor((ih - bh) / 2);
    if (gate.side === 'n') by = r.y1 - 1 - bh;
    if (gate.side === 's') by = r.y0 + 2;
    if (gate.side === 'e') bx = r.x0 + 2;
    if (gate.side === 'w') bx = r.x1 - 1 - bw;
    g.fill(bx, by, bw, bh, K.BUILD);
    const bld = { x: bx * TILE, y: by * TILE, w: bw * TILE, h: bh * TILE, color, kind, name };
    g.buildings.push(bld);
    let zx = (bx + bw / 2) * TILE, zy = (by + bh / 2) * TILE;
    if (gate.side === 'n') zy = (by - 1) * TILE; else if (gate.side === 's') zy = (by + bh + 1) * TILE;
    else if (gate.side === 'w') zx = (bx - 1) * TILE; else zx = (bx + bw + 1) * TILE;
    return { kind, name, x: zx, y: zy, r: 52, gate: { x: (gx + 0.5) * TILE, y: (gy + 0.5) * TILE }, rect: { x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 }, bld };
  }
  const yardSite = (r) => ({ x: r.x0 + YARD_SITE.x, y: r.y0 + YARD_SITE.y });
  function addStation(g, x0, y0, site) {
    g.fill(x0, y0, 3, 3, K.BUILD);
    g.buildings.push({ x: x0 * TILE, y: y0 * TILE, w: 3 * TILE, h: 3 * TILE, color: '#c5d3e8', kind: 'station', name: 'Police Station' });
    const s = { kind: 'station', name: 'Police Station', x: site.x * TILE, y: site.y * TILE, r: 40 };
    g.stations.push(s); g.sites.push(s);
  }
  function buildStation(g, r) {
    g.release(r);
    g.fill(r.x0, r.y0, YARD, YARD, K.PLAZA);
    addStation(g, r.x0 + 2, r.y0 + 1, yardSite(r));
  }
  // A 3x3 building beside a street near a real point, for where no yard fits amid wide roads: the best spot (nearest the
  // point, cheapest to clear) as {x0, y0, site}, or null. `site` is the street tile the building faces. A police station
  // is kept within REAL_REACH of the point by that street tile; a bus stand, which has no site, by its nearest edge (a
  // station mapped on a junction has pavement all round it, so the building cannot reach the point itself).
  function findRoadsideSpot(g, at, byEdge) {
    let best = null, bestCost = Infinity;
    const reach = REAL_REACH + (byEdge ? 2 : 0);
    for (let sy = Math.floor(at.y - reach); sy <= Math.ceil(at.y + reach); sy++) {
      for (let sx = Math.floor(at.x - reach); sx <= Math.ceil(at.x + reach); sx++) {
        if (!inb(sx, sy) || !g.main[idx(sx, sy)] || !isStreet(g.t[idx(sx, sy)])) continue;
        for (let k = -2; k <= 0; k++) {
          for (const [x0, y0] of [[sx + 1, sy + k], [sx - 3, sy + k], [sx + k, sy + 1], [sx + k, sy - 3]]) { // the building on each side of the street tile
            const away = byEdge ? hypot(Math.max(x0 - at.x, 0, at.x - (x0 + 3)), Math.max(y0 - at.y, 0, at.y - (y0 + 3))) : hypot(sx + 0.5 - at.x, sy + 0.5 - at.y);
            let cost = away, ok = away <= REAL_REACH && x0 >= 2 && y0 >= 2 && x0 + 3 <= N - 2 && y0 + 3 <= N - 2;
            for (let y = y0; y < y0 + 3 && ok; y++) for (let x = x0; x < x0 + 3; x++) {
              if (!clearable(g, idx(x, y))) { ok = false; break; }
              cost += clearingCost(g, idx(x, y));
            }
            if (ok && cost < bestCost) { bestCost = cost; best = { x0, y0, site: { x: sx + 0.5, y: sy + 0.5 } }; }
          }
        }
      }
    }
    return best;
  }
  function buildRoadsideStation(g, at) {
    const spot = findRoadsideSpot(g, at, false);
    if (!spot) return false;
    g.release({ x0: spot.x0, y0: spot.y0, x1: spot.x0 + 2, y1: spot.y0 + 2 });
    addStation(g, spot.x0, spot.y0, spot.site);
    return true;
  }
  function addBusStandBuilding(g, x0, y0, w, h, name) {
    g.fill(x0, y0, w, h, K.BUILD);
    g.buildings.push({ x: x0 * TILE, y: y0 * TILE, w: w * TILE, h: h * TILE, color: '#ffccbc', kind: 'busstand', name });
  }
  function buildRoadsideBusStand(g, at, name) {
    const spot = findRoadsideSpot(g, at, true);
    if (!spot) return false;
    g.release({ x0: spot.x0, y0: spot.y0, x1: spot.x0 + 2, y1: spot.y0 + 2 });
    addBusStandBuilding(g, spot.x0, spot.y0, 3, 3, name);
    return true;
  }
  function buildBusStand(g, r, name) {
    g.release(r);
    const w = r.x1 - r.x0 + 1, h = r.y1 - r.y0 + 1;
    g.fill(r.x0, r.y0, w, h, K.PLAZA);
    const bw = Math.min(5, w - 2), bh = Math.min(4, h - 2);
    const bx = Math.floor(r.x0 + (w - bw) / 2), by = Math.floor(r.y0 + (h - bh) / 2);
    addBusStandBuilding(g, bx, by, bw, bh, name);
  }
  // The party office, where you start: a small plaza with a building, in the corner of town farthest from the RO office.
  function buildPartyOffice(g, officeTile) {
    const corners = [[14, 14], [N - 14, 14], [14, N - 14], [N - 14, N - 14]];
    const far = corners.reduce((a, b) => (hypot(a[0] - officeTile.x, a[1] - officeTile.y) > hypot(b[0] - officeTile.x, b[1] - officeTile.y) ? a : b));
    const waterNear = (x0, y0) => {
      for (let y = y0 - 3; y < y0 + 9; y++) for (let x = x0 - 3; x < x0 + 10; x++) if (g.get(x, y) === K.WATER) return 40;
      return 0;
    };
    const unsuitable = (x0, y0) => (hypot(x0 + 3.5 - officeTile.x, y0 + 3 - officeTile.y) * TILE > WORLD * 0.55 ? 0 : 1e6) + waterNear(x0, y0);
    const r = findRect(g, 7, 6, { x: far[0], y: far[1], r: N }, unsuitable);
    if (!r) throw new Error('buildTown: no room for the party office');
    g.release(r);
    g.fill(r.x0, r.y0, 7, 6, K.PLAZA);
    const bw = 5, bh = 4, bx = r.x0 + 1, by = r.y0 + 1;
    g.fill(bx, by, bw, bh, K.BUILD);
    g.buildings.push({ x: bx * TILE, y: by * TILE, w: bw * TILE, h: bh * TILE, color: '#bbdefb', kind: 'party', name: 'NPP Party Office' });
    const start = { kind: 'start', name: 'NPP Party Office', x: (bx + bw / 2) * TILE, y: Math.min(r.y1 + 0.5, by + bh + 1) * TILE, r: 40 };
    g.sites.push(start);
    return start;
  }

  // A mapped police station keeps its real position: a yard whose site is within REAL_REACH of the point, else a
  // building beside the street there, else a yard as near as NEAR_REACH tiles.
  function placePoliceStation(g, at) {
    const yard = findRect(g, YARD, YARD, { x: at.x - YARD_SITE.x + YARD / 2, y: at.y - YARD_SITE.y + YARD / 2, r: REAL_REACH });
    if (yard) return buildStation(g, yard);
    if (buildRoadsideStation(g, at)) return;
    const far = findRect(g, YARD, YARD, { x: at.x, y: at.y, r: NEAR_REACH });
    if (far) buildStation(g, far);
  }
  // A mapped bus station keeps its real position like a police station: a stand whose middle is within REAL_REACH of the
  // point, else a 3x3 building beside the street whose nearest edge is, else a stand as near as NEAR_REACH tiles.
  function placeBusStand(g, at, name) {
    const stand = name || 'RTC Bus Stand';
    const r = bestRect(g, BUS_STAND_SIZES, { x: at.x, y: at.y, r: REAL_REACH });
    if (r) return buildBusStand(g, r, stand);
    if (buildRoadsideBusStand(g, at, stand)) return;
    const far = bestRect(g, BUS_STAND_SIZES, { x: at.x, y: at.y, r: NEAR_REACH });
    if (far) buildBusStand(g, far, stand);
  }
  // The mapped police and bus stations as one point each, in tile units. Points of one kind within SAME_STATION tiles
  // of a group's first point are one station mapped twice (as a node and as a building) and stand for it at their mean.
  function mappedStations(landmarks, scale) {
    const groups = [];
    for (const l of landmarks) {
      if (l.kind !== 'police' && l.kind !== 'bus_station') continue;
      const p = { x: l.x * scale, y: l.y * scale };
      const same = groups.find((q) => q.kind === l.kind && hypot(q.points[0].x - p.x, q.points[0].y - p.y) <= SAME_STATION);
      if (same) { same.points.push(p); same.name = same.name || l.name; } else groups.push({ kind: l.kind, name: l.name, points: [p] });
    }
    const mean = (q, axis) => q.points.reduce((sum, p) => sum + p[axis], 0) / q.points.length;
    return groups.map((q) => ({ kind: q.kind, name: q.name, x: mean(q, 'x'), y: mean(q, 'y') }));
  }

  // Places the RO office, polling booth, police stations, bus stands and party office. Mapped police and bus
  // stations keep their real positions; the rest go to the largest clear space near their anchor.
  function placeSites(g, data) {
    const landmarks = data.landmarks || [];
    const near = (p, r) => ({ x: p.x * g.scale, y: p.y * g.scale, r });
    for (const s of mappedStations(landmarks, g.scale)) {
      if (s.kind === 'police') placePoliceStation(g, s); else placeBusStand(g, s, s.name);
    }

    const compound = (where, kind, name, color) => {
      const r = bestRect(g, COMPOUND_SIZES, where);
      if (!r) throw new Error('buildTown: no room for the ' + name);
      return buildCompound(g, r, kind, name, color);
    };
    const office = compound(near(data.anchor, N), 'office', 'RO Office', '#f5e6c8');
    // the polling booth goes to a school if one is mapped, else near the middle of the map, but away from the office
    const officeTile = { x: office.gate.x / TILE, y: office.gate.y / TILE };
    const spots = landmarks.filter((l) => l.kind === 'school').map((l) => near(l, N)).concat([{ x: N / 2, y: N / 2, r: N }, { x: N * 0.3, y: N * 0.7, r: N }, { x: N * 0.7, y: N * 0.7, r: N }]);
    const spot = spots.find((p) => hypot(p.x - officeTile.x, p.y - officeTile.y) > 20) || spots[spots.length - 1];
    const booth = compound(Object.assign({}, spot, { r: 24 }), 'booth', 'Govt High School (Polling Booth)', '#ffe0b2');
    g.sites.unshift(booth); g.sites.unshift(office);

    // at least three police stations: spread them over the town where none is mapped
    for (const [fx, fy] of [[0.5, 0.5], [0.25, 0.75], [0.75, 0.75], [0.75, 0.25], [0.25, 0.25]]) {
      if (g.stations.length >= 3) break;
      const r = findRect(g, YARD, YARD, { x: fx * N, y: fy * N, r: N });
      if (r) buildStation(g, r);
    }
    return { office, booth, start: buildPartyOffice(g, officeTile) };
  }

  // A w x h house on the grid at tile (x0, y0); `look` is its roof colour, water tank and drawing seed.
  function addHouse(g, x0, y0, w, h, look) {
    g.fill(x0, y0, w, h, K.BUILD);
    const b = Object.assign({ x: x0 * TILE, y: y0 * TILE, w: w * TILE, h: h * TILE, kind: 'house' }, look);
    g.buildings.push(b);
    return b;
  }

  // Blocks with no mapped building get generated house plots, parks or (when large) open land.
  function fillEmptyBlocks(g, rng) {
    const { t } = g, seen = new Uint8Array(N * N);
    const plot = (x0, y0, w, h) => addHouse(g, x0, y0, w, h, { color: ROOF[rng.int(ROOF.length)], tank: rng() < 0.5, seed: rng.int(1e6) });
    for (let s = 0; s < N * N; s++) {
      if (seen[s] || (t[s] !== K.LOT && t[s] !== K.BUILD)) continue;
      const lots = [], stack = [s];
      let built = false;
      seen[s] = 1;
      while (stack.length) {
        const i = stack.pop(), x = i % N, y = (i / N) | 0;
        if (t[i] === K.BUILD) built = true; else lots.push(i);
        for (const [ox, oy] of NEIGH4) {
          if (!inb(x + ox, y + oy)) continue;
          const j = idx(x + ox, y + oy);
          if (!seen[j] && (t[j] === K.LOT || t[j] === K.BUILD)) { seen[j] = 1; stack.push(j); }
        }
      }
      if (built || lots.length < 2) continue;
      lots.sort((a, b) => a - b);
      if (lots.length > 400) { // open land on the edge of town: grass with a few trees away from the streets
        for (const i of lots) {
          const x = i % N, y = (i / N) | 0;
          let nearStreet = false;
          for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) if (isStreet(g.get(x + ox, y + oy))) nearStreet = true;
          if (!nearStreet && rng() < 0.06) t[i] = K.TREE;
        }
        continue;
      }
      if (lots.length >= 12 && rng() < 0.1) { for (const i of lots) t[i] = rng() < 0.12 ? K.TREE : K.PARK; continue; }
      const lot = (x, y) => inb(x, y) && t[idx(x, y)] === K.LOT && seen[idx(x, y)] === 1;
      for (const i of lots) {
        const x = i % N, y = (i / N) | 0;
        if (t[i] !== K.LOT) continue;
        let run = 0;
        while (lot(x + run, y)) run++;
        if (run >= 6 && rng() < 0.12) { // an alley between plots
          for (let yy = y; lot(x, yy) && yy < y + 3; yy++) g.set(x, yy, K.WALK);
          continue;
        }
        let pw = Math.min(run, 3 + rng.int(4)), ph = 3;
        for (;;) {
          let ok = true;
          for (let yy = y; yy < y + ph && ok; yy++) for (let xx = x; xx < x + pw; xx++) if (!lot(xx, yy)) { ok = false; break; }
          if (ok) break;
          if (ph > 1) ph--; else pw--;
        }
        plot(x, y, pw, ph);
      }
    }
  }

  // Mapped buildings become rectangles of tiles; only the largest piece of a building carries its name.
  function mappedBuildingRects(g) {
    const out = [];
    g.mapped.forEach((m, id) => {
      const left = new Set(m.tiles.filter((i) => g.t[i] === K.BUILD && g.owner[i] === id));
      const pieces = [];
      while (left.size) {
        const first = Math.min(...left), x0 = first % N, y0 = (first / N) | 0;
        let w = 1, h = 1;
        while (left.has(idx(x0 + w, y0))) w++;
        for (let ok = true; ok;) {
          for (let x = x0; x < x0 + w && ok; x++) if (!left.has(idx(x, y0 + h))) ok = false;
          if (ok) h++;
        }
        for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) left.delete(idx(x, y));
        pieces.push({ x: x0 * TILE, y: y0 * TILE, w: w * TILE, h: h * TILE, color: m.color || ROOF[m.seed % ROOF.length], kind: m.kind, seed: m.seed % 1000000 });
      }
      pieces.sort((a, b) => b.w * b.h - a.w * a.h);
      pieces.forEach((b, k) => {
        if (m.kind === 'house') b.tank = (m.seed >> 4) % 2 === 0;
        if (m.name && k === 0) b.name = m.name;
        out.push(b);
      });
    });
    return out;
  }

  // A town with too few houses for its shops (a sparse test fixture; the real towns have enough): a new 3x3 house on
  // open grass beside a street, as near the anchor as possible, marked `newPlot`.
  function newShopPlot(g, office, anchor, reachable) {
    let best = null, bestDoor = null, bs = Infinity;
    for (let y0 = 2; y0 <= N - 5; y0++) for (let x0 = 2; x0 <= N - 5; x0++) {
      const d = dist((x0 + 1.5) * TILE, (y0 + 1.5) * TILE, anchor[0] * WORLD, anchor[1] * WORLD);
      if (d >= bs || dist(x0 * TILE, y0 * TILE, office.x, office.y) <= 20 * TILE) continue;
      let grass = true;
      for (let y = y0; y < y0 + 3 && grass; y++) for (let x = x0; x < x0 + 3; x++) if (g.t[idx(x, y)] !== K.GRASS) { grass = false; break; }
      if (!grass) continue;
      const door = doorFor(g, { x0, y0, x1: x0 + 2, y1: y0 + 2 }, 0);
      if (door && isStreet(g.get(door.x, door.y)) && reachable(door.x, door.y)) { bs = d; best = { x0, y0 }; bestDoor = door; }
    }
    if (!best) return null;
    const b = addHouse(g, best.x0, best.y0, 3, 3, { color: ROOF[(best.x0 + best.y0) % ROOF.length], tank: false, seed: best.x0 * N + best.y0, newPlot: true });
    return { b, door: bestDoor };
  }
  // One house in each of five spread-out places becomes a document shop, with its door on a street the start can reach.
  function placeDocShops(g, office, reachable) {
    const rectOf = (b) => ({ x0: b.x / TILE, y0: b.y / TILE, x1: (b.x + b.w) / TILE - 1, y1: (b.y + b.h) / TILE - 1 });
    const shops = [];
    for (let i = 0; i < DOC_SHOPS.length; i++) {
      let best = null, bestDoor = null, bs = Infinity;
      for (const b of g.buildings) {
        if (b.kind !== 'house' || b.shop) continue;
        const d = dist(b.x + b.w / 2, b.y + b.h / 2, DOC_ANCHORS[i][0] * WORLD, DOC_ANCHORS[i][1] * WORLD);
        if (d >= bs || dist(b.x, b.y, office.x, office.y) <= 20 * TILE) continue;
        const door = doorFor(g, rectOf(b), 0);
        if (door && reachable(door.x, door.y)) { bs = d; best = b; bestDoor = door; }
      }
      if (!best) {
        const plot = newShopPlot(g, office, DOC_ANCHORS[i], reachable);
        if (!plot) continue;
        best = plot.b; bestDoor = plot.door;
      }
      best.shop = true; best.name = DOC_SHOPS[i].name; best.color = '#fff3c4';
      const s = { kind: 'doc', doc: DOC_SHOPS[i].doc, name: DOC_SHOPS[i].name, x: (bestDoor.x + 0.5) * TILE, y: (bestDoor.y + 0.5) * TILE, r: 30 };
      shops.push(s); g.sites.push(s);
    }
    if (shops.length < DOC_SHOPS.length) throw new Error('buildTown: placed ' + shops.length + ' of ' + DOC_SHOPS.length + ' document shops');
    return shops;
  }

  // The BLO tent for the voter slip (polling day): open ground near the middle of town, else any street tile.
  function placeBloTent(g, reachable) {
    for (const kinds of [[K.GRASS, K.PARK], [K.WALK, K.ROAD, K.BRIDGE]]) {
      let blo = null, bd = Infinity;
      for (let y = 2; y < N - 2; y++) for (let x = 2; x < N - 2; x++) {
        if (!kinds.includes(g.t[idx(x, y)]) || !reachable(x, y)) continue;
        const d = hypot(x + 0.5 - N * 0.45, y + 0.5 - N * 0.55);
        if (d < bd) { bd = d; blo = { kind: 'doc', doc: 'Voter Slip', name: 'BLO Help Tent', x: (x + 0.5) * TILE, y: (y + 0.5) * TILE, r: 30, mode: 'vote' }; }
      }
      if (blo) { g.sites.push(blo); return blo; }
    }
    throw new Error('buildTown: no spot for the BLO tent');
  }

  // Patrol posts for police and goons: junctions of major roads, thinned out; spread over the roads if there are too few.
  function patrolPosts(g, reachable) {
    const passes = new Map(); // tile -> indices of major roads whose centre-line crosses it
    g.roads.forEach((r, ri) => {
      if (!MAJOR_ROADS.has(r.class)) return;
      for (let k = 1; k < r.pts.length; k++) {
        const [x0, y0] = r.pts[k - 1], [x1, y1] = r.pts[k];
        const n = Math.max(1, Math.ceil(hypot(x1 - x0, y1 - y0) * 2));
        for (let s = 0; s <= n; s++) {
          const x = Math.floor(x0 + ((x1 - x0) * s) / n), y = Math.floor(y0 + ((y1 - y0) * s) / n);
          if (!inb(x, y)) continue;
          if (!passes.has(idx(x, y))) passes.set(idx(x, y), new Set());
          passes.get(idx(x, y)).add(ri);
        }
      }
    });
    const posts = [], taken = [];
    const take = (x, y) => { taken.push([x, y]); posts.push({ x: (x + 0.5) * TILE, y: (y + 0.5) * TILE }); };
    for (const i of [...passes.keys()].sort((a, b) => a - b)) {
      if (taken.length >= 18) break;
      const x = i % N, y = (i / N) | 0;
      if (!reachable(x, y) || (g.t[i] !== K.ROAD && g.t[i] !== K.BRIDGE)) continue;
      const roadsHere = new Set();
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) for (const ri of passes.get(idx(x + ox, y + oy)) || []) roadsHere.add(ri);
      if (roadsHere.size >= 2 && taken.every(([px, py]) => hypot(px - x, py - y) >= 12)) take(x, y);
    }
    while (posts.length < 8) { // not enough junctions: the road tile farthest from every post so far
      let bx = -1, by = -1, bgap = -1;
      for (let i = 0; i < N * N; i++) {
        if (g.t[i] !== K.ROAD || !reachable(i % N, (i / N) | 0)) continue;
        const x = i % N, y = (i / N) | 0;
        const gap = taken.length ? Math.min(...taken.map(([px, py]) => hypot(px - x, py - y))) : -hypot(x - N / 2, y - N / 2);
        if (gap > bgap) { bgap = gap; bx = x; by = y; }
      }
      if (bx < 0 || (taken.length && bgap < 6)) break;
      take(bx, by);
    }
    return posts;
  }

  // Builds the playable map from a town file (see scripts/osm-to-town.js): road centre-lines become road tiles of
  // their class's width, water becomes water (bridges where a road crosses), mapped buildings become solid tiles,
  // and the sites the game needs are placed on the grid. A pure function of `data`: its only randomness is a
  // seed derived from the town id. Returns what the simulation and renderer read, plus `roads` for drawing traffic.
  function buildTown(data) {
    if (!data || !(data.size > 0) || !data.anchor || !Array.isArray(data.roads)) throw new Error('buildTown: not a town file (needs size, anchor and roads)');
    const seed = hashStr(data.id || 'town'), g = newGrid(data);
    drawMap(g, data);
    markMainNetwork(g);
    const { office, booth, start } = placeSites(g, data);
    fillEmptyBlocks(g, makeRng(seed));
    for (let i = 0; i < g.t.length; i++) if (g.t[i] === K.LOT) g.t[i] = K.GRASS;
    g.buildings.push(...mappedBuildingRects(g));

    // what the start can reach decides where shops, the BLO tent and patrol posts may go
    const reach = field({ t: g.t, dyn: new Uint8Array(N * N) }, [[Math.floor(start.x / TILE), Math.floor(start.y / TILE)]]);
    const reachable = (x, y) => inb(x, y) && reach[idx(x, y)] >= 0;
    const docSites = placeDocShops(g, office, reachable);
    const blo = placeBloTent(g, reachable);
    const labels = (data.places || []).map((p) => ({ x: p.x * g.scale * TILE, y: p.y * g.scale * TILE, text: p.name }));

    return {
      seed, id: data.id || null, n: N, tile: TILE, world: WORLD, t: g.t, buildings: g.buildings, sites: g.sites, docSites, blo, office, booth, stations: g.stations, start, labels,
      posts: patrolPosts(g, reachable),
      roads: g.roads.map((r) => ({ class: r.class, w: r.w, pts: r.pts.map(([x, y]) => [x * TILE, y * TILE]) })),
      dyn: new Uint8Array(N * N),
    };
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

  return { TILE, N, WORLD, DT, K, SOLID, clamp, hypot, dist, norm, makeRng, hashStr, buildTown, kindAt, solidAt, solidPx, walkable, moveBody, field, flowDir, lineOfSight, barricadeRing, DOC_SHOPS };
});
