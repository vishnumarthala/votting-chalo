// Shared world: seeded town generator, tile collision, BFS flow fields and line of sight.
// UMD: loaded by the browser (window.World) and by Node (require). No DOM, no Math.random.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.World = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TILE = 32;
  const N = 56; // map is N x N tiles
  const WORLD = N * TILE;
  const DT = 1 / 30;

  // tile kinds
  const K = { LOT: 255, GRASS: 0, ROAD: 1, WALK: 2, BUILD: 3, WATER: 4, BRIDGE: 5, WALL: 6, PARK: 7, TREE: 8, PLAZA: 9, FIELD: 10, PALM: 11 };
  const SOLID = new Uint8Array(256);
  for (const k of [K.BUILD, K.WATER, K.WALL, K.TREE, K.FIELD, K.PALM]) SOLID[k] = 1;

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

  const NEIGHBOURHOODS = ['Gandhi Nagar', 'Rythu Peta', 'Kummari Veedhi', 'Mill Colony', 'Teachers Colony', 'Old Town', 'Brindavan Colony', 'Sai Nagar'];
  const ROOF = ['#e8c39e', '#f2d7a6', '#cfe0e8', '#f3c1b4', '#e7e2a7', '#d8c9ef', '#c8e6c0', '#f0b98d', '#ddd2c2', '#bfd8f0'];

  // ------------------------------------------------------------------ generation
  // A small Andhra town, built from the pincode seed. Local layout (party office on the left; half the towns
  // are mirrored, and every street, bridge and landmark position shifts with the seed):
  //   rows  0-2   paddy fields and palms
  //   rows  3-12  RO office compound, side galis, hospital on one side, temple park on the other
  //   rows 13-17  Collectorate Road (leaves town both ways)
  //   rows 18-25  houses, lanes down to the canal
  //   rows 26-31  canal with embankment paths and two bridges
  //   rows 32-47  Bazaar Street lined with stalls, Gandhi Circle, lanes
  //   rows 48-52  Station Road: party office (start), bus stand, police station
  //   rows 53-55  paddy fields and palms
  // opts: { names: [neighbourhood names from the pincode lookup] }
  function generateTown(seed, opts) {
    const rng = makeRng(seed);
    const t = new Uint8Array(N * N).fill(K.LOT);
    const idx = (x, y) => y * N + x;
    const inb = (x, y) => x >= 0 && y >= 0 && x < N && y < N;
    const get = (x, y) => (inb(x, y) ? t[idx(x, y)] : K.FIELD);
    const set = (x, y, v) => { if (inb(x, y)) t[idx(x, y)] = v; };
    const flip = rng() < 0.5;
    const X = (x) => (flip ? N - 1 - x : x);
    const rect = (x0, y0, x1, y1) => ({ x0: Math.min(X(x0), X(x1)), y0, x1: Math.max(X(x0), X(x1)), y1 });
    const fillR = (r, v, only) => { for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) if (inb(x, y) && (only === undefined || t[idx(x, y)] === only)) t[idx(x, y)] = v; };
    const fill = (x0, y0, x1, y1, v, only) => fillR(rect(x0, y0, x1, y1), v, only);
    const px = (u) => (flip ? N - u : u) * TILE; // local position in tiles (continuous) -> world x
    const E = 3, L = N - 1;

    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (x < E || y < E || x > L - E || y > L - E) set(x, y, K.FIELD);

    // ---- layout choices
    const ox = 17 + rng.int(9), gx = ox + 6; // compound columns ox..ox+12, gate column gx
    const bA = 5 + rng.int(gx - 12), bB = gx + 6 + rng.int(42 - gx); // bridges, 3 tiles wide
    const vs = 9 + rng.int(3); // the lane next to the party office
    const sc = vs + 10 + rng.int(29 - vs); // Gandhi Circle column
    const east = rng() < 0.6, west = rng() < 0.5;

    // ---- streets (carved as road; sidewalks are worked out afterwards)
    fill(0, 13, L, 17, K.ROAD); // Collectorate Road
    fill(0, 48, L, 52, K.ROAD); // Station Road
    fill(ox - 2, 3, ox - 1, 12, K.ROAD); fill(ox + 13, 3, ox + 14, 12, K.ROAD); // galis along the compound
    for (const c of [gx - 1, bA, bB]) fill(c, 18, c + 2, 25, K.ROAD); // lanes down to the canal
    if (west) fill(E + 1, 18, E + 3, 25, K.ROAD);
    fill(E, 37, L - E, 39, K.ROAD); // Bazaar Street; rows 36 and 40 become the stall rows
    for (const c of [bA, bB]) fill(c, 32, c + 2, 36, K.ROAD);
    fill(vs, 40, vs + 2, 47, K.ROAD);
    fill(sc - 3, 35, sc + 5, 41, K.ROAD); // Gandhi Circle
    fill(sc, 41, sc + 2, 47, K.ROAD);
    if (east) fill(44, 40, 46, 47, K.ROAD);
    // sidewalks: road tiles that touch anything but road
    const edgeK = (k) => k !== K.ROAD && k !== K.WALK && k !== K.BRIDGE;
    const walks = [];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (t[idx(x, y)] === K.ROAD && (edgeK(get(x - 1, y)) || edgeK(get(x + 1, y)) || edgeK(get(x, y - 1)) || edgeK(get(x, y + 1)))) walks.push(idx(x, y));
    }
    for (const i of walks) t[i] = K.WALK;
    // the canal: embankment paths, water, two bridges
    fill(E, 26, L - E, 27, K.WALK); fill(0, 28, L, 29, K.WATER); fill(E, 30, L - E, 31, K.WALK);
    for (const c of [bA, bB]) fill(c, 28, c + 2, 29, K.BRIDGE);
    fill(sc, 37, sc + 2, 39, K.LOT); // the statue's island

    const buildings = [], sites = [], labels = [];
    function building(r, extra) {
      fillR(r, K.BUILD);
      const b = Object.assign({ x: r.x0 * TILE, y: r.y0 * TILE, w: (r.x1 - r.x0 + 1) * TILE, h: (r.y1 - r.y0 + 1) * TILE, color: ROOF[rng.int(ROOF.length)], kind: 'house', tank: rng() < 0.5, seed: rng.int(1e6) }, extra || {});
      buildings.push(b);
      return b;
    }

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
    const office = compound(rect(ox, 3, ox + 12, 12), { side: 's', x: X(gx) }, 'office', 'RO Office', '#f5e6c8');
    sites.push(office);

    // ---- landmarks
    building(rect(sc, 37, sc + 2, 39), { kind: 'statue', name: 'Gandhi Circle', color: '#86bd59', tank: false });
    // party office (start) on Station Road
    fill(E, 41, vs - 1, 47, K.PLAZA, K.LOT);
    const party = building(rect(E + 1, 42, vs - 2, 45), { color: '#c5cae9', kind: 'party', name: 'YSRCP Party Office', tank: false });
    const start = { kind: 'start', name: 'YSRCP Party Office', x: party.x + party.w / 2, y: 49.5 * TILE, r: 40 };
    sites.push(start);
    // police station at the far end of Station Road: the station, a walled forecourt, and a gate onto the road
    fill(47, 41, L - E, 47, K.PLAZA, K.LOT);
    fill(47, 41, 47, 47, K.WALL, K.PLAZA); fill(47, 47, L - E, 47, K.WALL, K.PLAZA); fill(49, 47, 50, 47, K.PLAZA);
    const yard = rect(48, 44, L - E, 46);
    const st = building(rect(48, 41, L - E, 43), {
      color: '#e6dcc4', kind: 'station', name: 'Police Station', tank: false,
      gate: { x: px(50), y: 47.5 * TILE }, yard: { x0: yard.x0 * TILE, y0: yard.y0 * TILE, x1: (yard.x1 + 1) * TILE, y1: (yard.y1 + 1) * TILE },
    });
    const station = { kind: 'station', name: 'Police Station', x: st.x + st.w / 2, y: 49.5 * TILE, r: 40 };
    sites.push(station);
    // bus stand: an open plaza with a shelter
    fill(vs + 4, 44, vs + 8, 47, K.PLAZA, K.LOT);
    building(rect(vs + 4, 44, vs + 8, 44), { color: '#ef5350', kind: 'busstand', name: 'RTC Bus Stand', tank: false });
    // hospital beside the office, temple park on the other side
    fill(ox - 9, 3, ox - 3, 9, K.PLAZA, K.LOT);
    building(rect(ox - 8, 4, ox - 4, 7), { color: '#ffffff', kind: 'hospital', name: 'Govt Hospital', tank: false });
    fill(ox + 15, 3, Math.min(L - E, ox + 23), 12, K.PARK, K.LOT);
    building(rect(ox + 17, 5, ox + 20, 8), { color: '#ffe082', kind: 'temple', name: 'Sri Venkateswara Temple', tank: false });
    for (let y = 3; y <= 12; y++) for (let x = ox + 15; x <= Math.min(L - E, ox + 23); x++) {
      const tx = X(x);
      if (get(tx, y) !== K.PARK || y === 12 || x === ox + 15) continue;
      if ((x < ox + 16 || x > ox + 21 || y < 4 || y > 9) && rng() < 0.22) set(tx, y, K.TREE);
    }

    // ---- stalls along Bazaar Street (rows 36 and 40): stall, gap, stall...
    const AWN = 5;
    for (const y of [36, 40]) {
      let run = [];
      const flush = () => {
        let i = 0;
        while (i < run.length) {
          const left = run.length - i;
          if (left >= 2 && (i === 0 || rng() < 0.8)) {
            const a = run[i], b = run[i + 1];
            building({ x0: Math.min(a, b), y0: y, x1: Math.max(a, b), y1: y }, { kind: 'stall', awning: rng.int(AWN), tank: false, color: '#d7ccc8', face: y === 36 ? 1 : -1 });
            i += 2;
          }
          if (i < run.length) { set(run[i], y, K.WALK); i++; }
          if (i < run.length && rng() < 0.4) { set(run[i], y, K.WALK); i++; }
        }
        run = [];
      };
      for (let lx = E; lx <= L - E; lx++) { const x = X(lx); if (get(x, y) === K.LOT) run.push(x); else flush(); }
      flush();
    }

    // ---- houses on what is left: group each block into rectangles, then rows of plots
    function plots(r, pockets) {
      const horiz = r.x1 - r.x0 >= r.y1 - r.y0;
      const a0 = horiz ? r.x0 : r.y0, end = horiz ? r.x1 : r.y1;
      let a = a0;
      while (a <= end) {
        let w = Math.min(end - a + 1, 2 + rng.int(3));
        if (end - a + 1 - w === 1) w++;
        const part = (p, q) => (horiz ? { x0: p, y0: r.y0, x1: q, y1: r.y1 } : { x0: r.x0, y0: p, x1: r.x1, y1: q });
        if (pockets && a > a0 + 1 && end - a > 4 && rng() < 0.12) { fillR(part(a, a + 1), K.WALK); a += 2; continue; } // a dead-end gali
        if (rng() < 0.07) { fillR(part(a, a + w - 1), K.PARK); const p = part(a, a + w - 1); set(p.x0 + rng.int(p.x1 - p.x0 + 1), p.y0 + rng.int(p.y1 - p.y0 + 1), K.TREE); }
        else building(part(a, a + w - 1));
        a += w;
      }
    }
    function block(r) {
      const w = r.x1 - r.x0 + 1, h = r.y1 - r.y0 + 1;
      if (w < 2 || h < 2) { for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) set(x, y, rng() < 0.4 ? K.TREE : K.PARK); return; }
      if (h >= 6) { const d = Math.ceil(h / 2); plots({ x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y0 + d - 1 }, true); plots({ x0: r.x0, y0: r.y0 + d, x1: r.x1, y1: r.y1 }, true); return; }
      if (w >= 6 && h <= 5 && w < h) { const d = Math.ceil(w / 2); plots({ x0: r.x0, y0: r.y0, x1: r.x0 + d - 1, y1: r.y1 }, false); plots({ x0: r.x0 + d, y0: r.y0, x1: r.x1, y1: r.y1 }, false); return; }
      plots(r, false);
    }
    const seen = new Uint8Array(N * N);
    for (let i0 = 0; i0 < N * N; i0++) {
      if (seen[i0] || t[i0] !== K.LOT) continue;
      const comp = [], st2 = [i0];
      seen[i0] = 1;
      while (st2.length) {
        const i = st2.pop(); comp.push(i);
        const x = i % N, y = (i / N) | 0;
        for (const [ox2, oy2] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + ox2, ny = y + oy2;
          if (!inb(nx, ny)) continue;
          const j = idx(nx, ny);
          if (!seen[j] && t[j] === K.LOT) { seen[j] = 1; st2.push(j); }
        }
      }
      // rows of runs, merged downwards into rectangles
      const rows = new Map();
      for (const i of comp) { const y = (i / N) | 0; if (!rows.has(y)) rows.set(y, []); rows.get(y).push(i % N); }
      const open = new Map(), rects = [];
      for (const y of [...rows.keys()].sort((a, b) => a - b)) {
        const xs = rows.get(y).sort((a, b) => a - b), runs = [];
        let s = xs[0], p = xs[0];
        for (let k = 1; k <= xs.length; k++) { if (k < xs.length && xs[k] === p + 1) { p = xs[k]; continue; } runs.push([s, p]); if (k < xs.length) { s = p = xs[k]; } }
        const next = new Map();
        for (const [a, b] of runs) { const key = a + ':' + b, r = open.get(key); if (r && r.y1 === y - 1) { r.y1 = y; next.set(key, r); open.delete(key); } else next.set(key, { x0: a, y0: y, x1: b, y1: y }); }
        for (const r of open.values()) rects.push(r);
        open.clear(); for (const [k, r] of next) open.set(k, r);
      }
      for (const r of open.values()) rects.push(r);
      for (const r of rects) block(r);
    }
    for (let i = 0; i < t.length; i++) if (t[i] === K.LOT) t[i] = K.GRASS;

    // ---- the town edge: paddy fields, with a line of palms around the town
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (t[idx(x, y)] !== K.FIELD) continue;
      const ring = x === E - 1 || y === E - 1 || x === L - E + 1 || y === L - E + 1;
      if (rng() < (ring ? 0.35 : 0.06)) t[idx(x, y)] = K.PALM;
    }

    // neighbourhood names: north of the canal, and the two halves of the bazaar side
    const names = (opts && opts.names && opts.names.length ? opts.names.slice() : []).concat(NEIGHBOURHOODS);
    const spots = [[(bA + gx) / 2 + 1, 22], [vs + 7, 33.5], [(sc + 3 + 46) / 2, 44.5]]; // the last one stays clear of the police station
    const usedN = new Set();
    let ni = 0;
    for (const [lx, ly] of spots) {
      while (ni < names.length && usedN.has(names[ni])) ni++;
      const name = names[ni++] || '';
      usedN.add(name);
      labels.push({ x: px(lx), y: ly * TILE, text: name });
    }

    // posts: street crossings and bridge ends (patrol waypoints), top to bottom; positions in tiles
    const c3 = (c) => c + 1.5; // centre of a 3-wide street starting at column c
    const P = [[gx + 0.5, 15.5], [c3(bA), 15.5], [c3(bB), 15.5], [6.5, 15.5], [N - 6.5, 15.5], [ox - 1, 15.5], [ox + 14, 15.5],
      [c3(bA), 27], [c3(bB), 27], [gx + 0.5, 22], [c3(bA), 31], [c3(bB), 31],
      [c3(bA), 38.5], [c3(bB), 38.5], [c3(vs), 38.5], [sc - 1.5, 38.5], [sc + 4.5, 38.5], [8.5, 38.5], [N - 8.5, 38.5],
      [c3(vs), 50.5], [c3(sc), 50.5], [6.5, 50.5], [N - 6.5, 50.5]];
    if (east) P.push([45.5, 50.5]);
    const posts = [];
    for (const [u, v] of P) {
      const p = { x: px(u), y: v * TILE };
      if (SOLID[t[idx(Math.floor(p.x / TILE), Math.floor(p.y / TILE))]]) continue;
      if (!posts.some((q) => q.x === p.x && q.y === p.y)) posts.push(p);
    }
    posts.sort((a, b) => a.y - b.y || a.x - b.x);

    const r = rect(E, 37, L - E, 39);
    return {
      seed, n: N, tile: TILE, world: WORLD, t, buildings, sites, office, stations: [station], start, labels, posts,
      arterials: { x: [], y: [14, 49] }, market: { x0: r.x0, y0: r.y0, x1: r.x1, y1: r.y1 }, canal: { y0: 28, y1: 29 }, dyn: new Uint8Array(N * N),
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

  return { TILE, N, WORLD, DT, K, SOLID, clamp, hypot, dist, norm, makeRng, hashStr, generateTown, kindAt, solidAt, solidPx, walkable, moveBody, field, flowDir, lineOfSight, barricadeRing };
});
