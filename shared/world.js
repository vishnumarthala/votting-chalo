// Shared world: seeded town generator, tile collision, BFS flow fields and line of sight.
// UMD: loaded by the browser (window.World) and by Node (require). No DOM, no Math.random.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.World = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TILE = 32;
  const N = 48; // map is N x N tiles
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

  const NEIGHBOURHOODS = ['Gandhi Nagar', 'Rythu Peta', 'Bazaar Street', 'Station Road', 'Temple Street', 'Kummari Veedhi', 'Mill Colony', 'Teachers Colony', 'Main Road', 'Old Town', 'Brindavan Colony', 'Sai Nagar'];
  const ROOF = ['#e8c39e', '#f2d7a6', '#cfe0e8', '#f3c1b4', '#e7e2a7', '#d8c9ef', '#c8e6c0', '#f0b98d', '#ddd2c2', '#bfd8f0'];

  // The town is a small maze: a CELLS x CELLS lattice of street crossings, 3-tile streets with 4-tile house
  // blocks between them. Some streets are built over (dead ends); a few extra links keep it from being a puzzle.
  const CELLS = 7, STREET = 3, BLOCK = 4, PITCH = STREET + BLOCK, OFF = 1;
  const at = (k) => OFF + k * PITCH; // first tile of street k

  // ------------------------------------------------------------------ generation
  // opts: { names: [neighbourhood names from the pincode lookup] }
  function generateTown(seed, opts) {
    const rng = makeRng(seed);
    const t = new Uint8Array(N * N).fill(K.FIELD);
    const idx = (x, y) => y * N + x;
    const inb = (x, y) => x >= 0 && y >= 0 && x < N && y < N;
    const get = (x, y) => (inb(x, y) ? t[idx(x, y)] : K.FIELD);
    const set = (x, y, v) => { if (inb(x, y)) t[idx(x, y)] = v; };
    const fill = (x0, y0, x1, y1, v) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, v); };
    const last = CELLS - 1;

    // the RO office takes the 2x2 crossings in a top corner; the party office is in the opposite bottom corner
    const flip = rng() < 0.5;
    const officeCols = flip ? [0, 1] : [last - 1, last];
    const gateCol = flip ? 1 : last - 1;
    const startCol = flip ? last : 0, startNext = flip ? last - 1 : 1;
    const inOffice = (i, j) => j <= 1 && officeCols.includes(i);
    const id = (i, j) => j * CELLS + i;
    const key = (a, b) => (a < b ? a + ':' + b : b + ':' + a);

    // maze: randomized depth-first spanning tree over the crossings, grown from the start
    const open = new Set();
    const seen = new Uint8Array(CELLS * CELLS);
    const stack = [[startCol, last]];
    seen[id(startCol, last)] = 1;
    while (stack.length) {
      const [i, j] = stack[stack.length - 1];
      const nb = [];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + dx, b = j + dy;
        if (a >= 0 && b >= 0 && a < CELLS && b < CELLS && !inOffice(a, b) && !seen[id(a, b)]) nb.push([a, b]);
      }
      if (!nb.length) { stack.pop(); continue; }
      const [a, b] = nb[rng.int(nb.length)];
      seen[id(a, b)] = 1;
      open.add(key(id(i, j), id(a, b)));
      stack.push([a, b]);
    }
    for (let j = 0; j < CELLS; j++) for (let i = 0; i < CELLS; i++) {
      if (inOffice(i, j)) continue;
      if (i < last && !inOffice(i + 1, j) && rng() < 0.12) open.add(key(id(i, j), id(i + 1, j)));
      if (j < last && !inOffice(i, j + 1) && rng() < 0.12) open.add(key(id(i, j), id(i, j + 1)));
    }
    // streets that must exist: the approach to the office gate, the party office front, the police station front
    const stationCol = flip ? 3 : 2, stationRow = 3;
    open.add(key(id(gateCol, 2), id(gateCol, 3)));
    open.add(key(id(startCol, last), id(startNext, last)));
    open.add(key(id(stationCol, stationRow + 1), id(stationCol + 1, stationRow + 1)));

    // carve the streets
    for (let j = 0; j < CELLS; j++) for (let i = 0; i < CELLS; i++) {
      if (inOffice(i, j)) continue;
      fill(at(i), at(j), at(i) + STREET - 1, at(j) + STREET - 1, K.ROAD);
      if (i < last && open.has(key(id(i, j), id(i + 1, j)))) fill(at(i) + STREET, at(j), at(i + 1) - 1, at(j) + STREET - 1, K.ROAD);
      if (j < last && open.has(key(id(i, j), id(i, j + 1)))) fill(at(i), at(j) + STREET, at(i) + STREET - 1, at(j + 1) - 1, K.ROAD);
    }

    const buildings = [], sites = [], labels = [];
    const office = (() => {
      const x0 = flip ? at(0) : at(last - 2) + STREET, x1 = flip ? at(2) - 1 : at(last) + STREET - 1;
      return compound({ x0, y0: at(0), x1, y1: at(1) + PITCH - 1 }, { side: 's', x: at(gateCol) + 1 }, 'office', 'RO Office', '#f5e6c8');
    })();
    sites.push(office);

    // walled compound: wall ring, gate on the given side, plaza, central building, counter zone at its door
    function compound(r, gate, kind, name, color) {
      for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) {
        const edge = x === r.x0 || x === r.x1 || y === r.y0 || y === r.y1;
        set(x, y, edge ? K.WALL : K.PLAZA);
      }
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
      // gate tiles, the outward direction, and a 1-tile side wicket on a neighbouring wall
      const gateTiles = [];
      for (let d = -1; d <= 1; d++) gateTiles.push(gate.side === 'n' || gate.side === 's' ? idx(gx + d, gy) : idx(gx, gy + d));
      const dirs = { n: { x: 0, y: -1 }, s: { x: 0, y: 1 }, w: { x: -1, y: 0 }, e: { x: 1, y: 0 } };
      const out = dirs[gate.side];
      const walkOut = (k) => k === K.WALK || k === K.ROAD || k === K.BRIDGE || k === K.PLAZA || k === K.PARK;
      const sides = gate.side === 'n' || gate.side === 's' ? ['w', 'e', gate.side === 'n' ? 's' : 'n'] : ['n', 's', gate.side === 'w' ? 'e' : 'w'];
      let wicket = null;
      for (const sd of sides) {
        const o = dirs[sd];
        const cands = [];
        if (sd === 'n' || sd === 's') { const wy = sd === 'n' ? r.y0 : r.y1; for (let x = r.x0 + 2; x <= r.x1 - 2; x++) cands.push([x, wy]); }
        else { const wx = sd === 'w' ? r.x0 : r.x1; for (let y = r.y0 + 2; y <= r.y1 - 2; y++) cands.push([wx, y]); }
        const mid = cands[Math.floor(cands.length / 2)] || [0, 0];
        cands.sort((p, q) => Math.abs(p[0] - mid[0]) + Math.abs(p[1] - mid[1]) - (Math.abs(q[0] - mid[0]) + Math.abs(q[1] - mid[1])));
        for (const [wx, wy] of cands) {
          if (walkOut(get(wx + o.x, wy + o.y)) && get(wx - o.x, wy - o.y) === K.PLAZA) {
            set(wx, wy, K.PLAZA);
            wicket = { x: (wx + 0.5) * TILE, y: (wy + 0.5) * TILE, tile: idx(wx, wy), out: o, side: sd };
            break;
          }
        }
        if (wicket) break;
      }
      return { kind, name, x: zx, y: zy, r: 52, gate: { x: (gx + 0.5) * TILE, y: (gy + 0.5) * TILE }, gateTiles, out, wicket, rect: { x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 }, bld };
    }

    // a building on BUILD tiles
    function building(x0, y0, x1, y1, extra) {
      fill(x0, y0, x1, y1, K.BUILD);
      const b = Object.assign({ x: x0 * TILE, y: y0 * TILE, w: (x1 - x0 + 1) * TILE, h: (y1 - y0 + 1) * TILE, color: ROOF[rng.int(ROOF.length)], kind: 'house', tank: rng() < 0.5, seed: rng.int(1e6) }, extra || {});
      buildings.push(b);
      return b;
    }
    // party office (start) and police station on their blocks, with the site on the street in front
    const blockX = (i) => at(i) + STREET, blockY = (j) => at(j) + STREET;
    const special = new Map();
    {
      const bi = Math.min(startCol, startNext), bj = last - 1;
      special.set(bi + ',' + bj, 'party');
      building(blockX(bi), blockY(bj), blockX(bi) + BLOCK - 1, blockY(bj) + BLOCK - 1, { color: '#c5cae9', kind: 'party', name: 'YSRCP Party Office', tank: false });
      sites.push({ kind: 'start', name: 'YSRCP Party Office', x: (blockX(bi) + BLOCK / 2) * TILE, y: (at(last) + STREET / 2) * TILE, r: 40 });
    }
    const stations = [];
    {
      special.set(stationCol + ',' + stationRow, 'station');
      building(blockX(stationCol), blockY(stationRow), blockX(stationCol) + BLOCK - 1, blockY(stationRow) + BLOCK - 1, { color: '#c5d3e8', kind: 'station', name: 'Police Station', tank: false });
      const s = { kind: 'station', name: 'Police Station', x: (blockX(stationCol) + BLOCK / 2) * TILE, y: (at(stationRow + 1) + STREET / 2) * TILE, r: 40 };
      stations.push(s); sites.push(s);
    }
    const start = sites.find((s) => s.kind === 'start');

    // ordinary blocks: houses, with a temple and a hospital somewhere in the middle of town
    const landmarks = [['temple', 'Sri Venkateswara Temple', '#ffe082'], ['hospital', 'Govt Hospital', '#ffffff']];
    const free = [];
    for (let j = 0; j < last; j++) for (let i = 0; i < last; i++) {
      if (special.has(i + ',' + j) || get(blockX(i), blockY(j)) !== K.FIELD) continue;
      free.push([i, j]);
    }
    for (const [kind, name, color] of landmarks) {
      const mids = free.filter(([i, j]) => i >= 1 && i <= last - 2 && j >= 2 && j <= last - 2);
      const pick = (mids.length ? mids : free)[rng.int((mids.length ? mids : free).length)];
      if (!pick) continue;
      free.splice(free.indexOf(pick), 1);
      const [i, j] = pick;
      building(blockX(i), blockY(j), blockX(i) + BLOCK - 1, blockY(j) + BLOCK - 1, { color, kind, name, tank: false });
    }
    for (const [i, j] of free) {
      const x0 = blockX(i), y0 = blockY(j), x1 = x0 + BLOCK - 1, y1 = y0 + BLOCK - 1, r = rng();
      if (r < 0.35) building(x0, y0, x1, y1);
      else if (r < 0.7) { building(x0, y0, x0 + 1, y1); building(x0 + 2, y0, x1, y1); }
      else { building(x0, y0, x1, y0 + 1); building(x0, y0 + 2, x1, y1); }
    }
    // built-over streets (the dead ends of the maze)
    for (let j = 0; j < CELLS; j++) for (let i = 0; i < CELLS; i++) {
      if (inOffice(i, j)) continue;
      if (i < last && !inOffice(i + 1, j) && get(at(i) + STREET, at(j)) === K.FIELD) building(at(i) + STREET, at(j), at(i + 1) - 1, at(j) + STREET - 1);
      if (j < last && !inOffice(i, j + 1) && get(at(i), at(j) + STREET) === K.FIELD) building(at(i), at(j) + STREET, at(i) + STREET - 1, at(j + 1) - 1);
    }
    // sidewalks along every built edge, the road down the middle
    const edge = (x, y) => { const k = get(x, y); return k === K.BUILD || k === K.WALL || k === K.FIELD; };
    const walks = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (t[idx(x, y)] === K.ROAD && (edge(x - 1, y) || edge(x + 1, y) || edge(x, y - 1) || edge(x, y + 1))) walks.push(idx(x, y));
    }
    for (const i of walks) t[i] = K.WALK;

    // neighbourhood names on the three corners away from the office
    const names = (opts && opts.names && opts.names.length ? opts.names.slice() : []).concat(NEIGHBOURHOODS);
    const spots = [[0.27, 0.78], [0.73, 0.78], [flip ? 0.73 : 0.27, 0.3]];
    const used = new Set();
    let ni = 0;
    for (const [fx, fy] of spots) {
      while (ni < names.length && used.has(names[ni])) ni++;
      const name = names[ni++] || '';
      used.add(name);
      labels.push({ x: fx * WORLD, y: fy * WORLD, text: name });
    }

    // posts: street crossings (patrol waypoints)
    const posts = [];
    for (let j = 0; j < CELLS; j++) for (let i = 0; i < CELLS; i++) if (!inOffice(i, j)) posts.push({ x: (at(i) + STREET / 2) * TILE, y: (at(j) + STREET / 2) * TILE });

    return { seed, n: N, tile: TILE, world: WORLD, t, buildings, sites, office, stations, start, labels, posts, arterials: { x: [], y: [] }, dyn: new Uint8Array(N * N) };
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

  return { TILE, N, WORLD, DT, K, SOLID, clamp, hypot, dist, norm, makeRng, hashStr, generateTown, kindAt, solidAt, solidPx, walkable, moveBody, field, flowDir, lineOfSight, barricadeRing };
});
