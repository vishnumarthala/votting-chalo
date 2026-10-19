// Deterministic top-down game simulation (30 Hz). No DOM and no Math.random: the same seed and inputs
// always give the same game, so this module can later run on a Node server for online rooms or replays.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./world.js'), require('./content.js'));
  else root.Sim = factory(root.World, root.Content);
})(typeof self !== 'undefined' ? self : this, function (Wd, Ct) {
  'use strict';
  const { TILE, N, WORLD, DT, K, clamp, hypot, dist, norm, makeRng, generateTown, kindAt, solidAt, moveBody, field, flowDir, lineOfSight, barricadeRing } = Wd;

  const CAP = 30; // max crowd
  const SPEED = { walk: 135, run: 215, follow: 1.18, civ: 34, flee: 120, cop: 70, copChase: 112, goon: 85, goonChase: 125, held: 0.75 };
  const CASES = 3; // detentions before you are jailed
  const SHIELD = 3; // supporters needed near you to block an arrest
  const GRAB_TIME = 1.1; // seconds a cop must hold on to arrest you
  const EMPTY_INPUT = { mx: 0, my: 0, run: false, act: false };
  const THROW = { min: 90, max: 260, air: 6, windup: 0.35 }; // goons throw stones, sticks and chappals
  const DEMO_STAGES = [75, 50, 25, 10]; // Democracy meter thresholds: unwell, hospital, ICU, ventilator
  const RING = 11; // Section 144 ring radius around the office, in tiles

  function createGame(opts) {
    opts = opts || {};
    const rng = makeRng((opts.seed >>> 0) || 1);
    const M = Ct.MODE;
    const place = Object.assign({}, Ct.DEFAULT_PLACE, opts.place || {});
    const text = (s, extra) => Ct.fill(s, Object.assign({}, place, extra || {}));
    const map = generateTown(opts.mapSeed !== undefined ? opts.mapSeed >>> 0 : (opts.seed >>> 0) || 1, { names: opts.names });
    const target = map.office;

    const G = {
      tick: 0, mode: 'intro', modeT: 0, M, map, place, target,
      elapsed: 0, events: [],
      player: null, ents: [], barrs: [], clouds: [], posts: map.posts,
      stats: { rec: 0, crowd: 0, brk: 0, lift: 0, slogan: 0, goon: 0 },
      result: null, alertT: 50,
      projs: [], demo: 100, demoStage: 0, closest: Infinity, ringIn: false, ringR: RING + 0.6, queue: [], queueT: 0, ignoreCd: 0, newsCd: 0,
    };
    Object.assign(G.stats, { thrown: 0, hits: 0, civHurt: 0, protected: 0 });
    let nextId = 1;
    const emit = (e) => G.events.push(e);
    const say = (who, line, extra, color) => emit({ t: 'say', id: who.id, x: who.x, y: who.y, text: text(line, extra), color });
    const toast = (s, color, extra) => emit({ t: 'toast', text: text(s, extra), color });

    // ------------------------------------------------------------ setup
    const P = {
      id: 0, kind: 'player', x: map.start.x, y: map.start.y, r: 9, vx: 0, vy: 0, fx: 0, fy: 1, kx: 0, ky: 0,
      stamina: 100, cases: 0, followers: [], sloganCd: 0, grab: 0, grabTick: -1,
      submitT: 0, state: 'free', heldT: 0, invuln: 0, pushing: 0, running: false, sayCd: 0, inGas: false,
      daze: 0, guardT: 0,
    };
    P.px = P.x; P.py = P.y;
    G.player = P;

    const isOpen = (k) => k === K.WALK || k === K.PARK || k === K.PLAZA || k === K.ROAD || k === K.BRIDGE;
    function randomSpot(minFromPlayer, kinds) {
      for (let tries = 0; tries < 400; tries++) {
        const tx = 3 + rng.int(N - 6), ty = 3 + rng.int(N - 6);
        const k = kindAt(map, tx, ty);
        if (!(kinds ? kinds.includes(k) : isOpen(k)) || solidAt(map, tx, ty)) continue;
        const rc = target.rect;
        if (rc && tx >= rc.x0 && tx <= rc.x1 && ty >= rc.y0 && ty <= rc.y1) continue; // nobody loiters inside the office compound
        const x = (tx + 0.5) * TILE, y = (ty + 0.5) * TILE;
        if (minFromPlayer && dist(x, y, P.x, P.y) < minFromPlayer) continue;
        return { x, y };
      }
      return { x: map.start.x, y: map.start.y };
    }
    function spawn(kind, x, y, extra) {
      const e = Object.assign({ id: nextId++, kind, x, y, r: kind === 'civ' ? 8 : 9, vx: 0, vy: 0, fx: 0, fy: 1, mode: 'wander', t: 0, sayCd: rng() * 4 }, extra || {});
      e.px = e.x; e.py = e.y;
      G.ents.push(e);
      return e;
    }
    // townspeople: men, women (some walking with a child) and children (some flying kites)
    function spawnCiv(x, y, extra) {
      const r = rng();
      const type = r < 0.38 ? 'woman' : r < 0.46 ? 'child' : 'man';
      const c = spawn('civ', x, y, Object.assign({ look: rng.int(6), t: rng() * 3, type, r: type === 'child' ? 6 : 8 }, extra || {}));
      if (type === 'child') c.kite = rng() < 0.5;
      else if (type === 'woman' && rng() < 0.4) {
        const k = spawn('civ', x, y, { look: rng.int(6), t: 0, type: 'child', r: 6, guardRef: c });
        c.kidRef = k;
      }
      return c;
    }
    const nearestPost = (x, y) => { let bi = 0, bd = Infinity; G.posts.forEach((p, i) => { const d = dist(x, y, p.x, p.y); if (d < bd) { bd = d; bi = i; } }); return bi; };

    // Section 144 ring around the destination: most street crossings barricaded, a few manned checkposts
    const ring = barricadeRing(map, target.x, target.y, RING);
    const checkposts = [];
    ring.forEach((g, i) => {
      if (rng() < 0.7 || i === 0) {
        for (const j of g.tiles) map.dyn[j] = 1;
        G.barrs.push({ id: nextId++, tiles: g.tiles, x: g.x, y: g.y, hp: 100, max: 100, pushT: 0 });
      } else checkposts.push(g);
    });

    const postFields = map.posts.map((p) => field(map, [[Math.floor(p.x / TILE), Math.floor(p.y / TILE)]]));
    const civCount = opts.civilians !== undefined ? opts.civilians : 36;
    // a third of the town is out shopping on Bazaar Street: the place to build your crowd
    const mk = map.market;
    const marketSpot = () => {
      for (let tries = 0; tries < 60; tries++) {
        const tx = mk.x0 + rng.int(mk.x1 - mk.x0 + 1), ty = mk.y0 + rng.int(mk.y1 - mk.y0 + 1);
        if (!solidAt(map, tx, ty)) return { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
      }
      return randomSpot(0);
    };
    for (let i = 0; i < civCount; i++) {
      const s = mk && i % 3 === 0 ? marketSpot() : randomSpot(0);
      spawnCiv(s.x, s.y);
    }
    // a queue of women waiting outside the office / booth gate
    if (civCount > 0) {
      const out = norm(target.gate.x - target.x, target.gate.y - target.y);
      const side = { x: -out.y, y: out.x };
      for (let k = 0; k < 5; k++) {
        let x = target.gate.x + out.x * 70 + side.x * (k - 2) * 20, y = target.gate.y + out.y * 70 + side.y * (k - 2) * 20;
        if (solidAt(map, Math.floor(x / TILE), Math.floor(y / TILE))) { x = target.gate.x + out.x * (40 + k * 18); y = target.gate.y + out.y * (40 + k * 18); }
        if (solidAt(map, Math.floor(x / TILE), Math.floor(y / TILE))) continue;
        G.queue.push({ x, y, fx: -out.x, fy: -out.y });
      }
      for (const q of G.queue) spawnQueue(q);
    }
    function spawnQueue(q) {
      const c = spawn('civ', q.x, q.y, { look: rng.int(6), t: 0, type: 'woman', mode: 'queue', home: q, fx: q.fx, fy: q.fy });
      q.ref = c;
      return c;
    }
    if (opts.police !== false) {
      for (let i = 0; i < 4; i++) {
        const pi = rng.int(map.posts.length), p = map.posts[pi];
        spawn('cop', p.x + rng.range(-20, 20), p.y + rng.range(-20, 20), { mode: 'patrol', role: i < 1 ? 'gas' : 'patrol', postIdx: rng.int(map.posts.length), lathiCd: 0, gasCd: 4, seeT: 0, stunT: 0 });
      }
      for (const g of checkposts) for (let k = 0; k < 2; k++) spawn('cop', g.x + (k ? 14 : -14), g.y, { mode: 'post', role: 'post', home: { x: g.x, y: g.y }, lathiCd: 0, seeT: 0, stunT: 0 });
      const o = target.out || { x: 0, y: 1 }, sd = { x: -o.y, y: o.x };
      for (let k = 0; k < 3; k++) {
        const h = { x: target.gate.x - o.x * 44 + sd.x * (k - 1) * 18, y: target.gate.y - o.y * 44 + sd.y * (k - 1) * 18 };
        spawn('cop', h.x, h.y, { mode: 'post', role: 'guard', home: h, lathiCd: 0, seeT: 0, stunT: 0 });
      }
      if (opts.gate !== false && target.wicket) {
        const w = target.wicket, h = { x: w.x - w.out.x * 36, y: w.y - w.out.y * 36 };
        spawn('cop', h.x, h.y, { mode: 'post', role: 'guard', home: h, lathiCd: 0, seeT: 0, stunT: 0, wicketCop: true });
      }
    }
    if (opts.goons !== false) {
      for (let i = 0; i < 4; i++) {
        const pi = rng.int(map.posts.length), p = map.posts[pi];
        spawn('goon', p.x, p.y, { mode: 'patrol', postIdx: rng.int(map.posts.length), seeT: 0, stunT: 0 });
      }
      // an opponent goon holds the near end of each canal bridge, so every route runs into one
      const cols = new Map();
      for (let i = 0; i < N * N; i++) if (map.t[i] === K.BRIDGE) { const x = i % N, y = Math.floor(i / N); const c = cols.get(x); cols.set(x, c ? { y0: Math.min(c.y0, y), y1: Math.max(c.y1, y) } : { y0: y, y1: y }); }
      const xs = [...cols.keys()].sort((p, q) => p - q);
      for (let k = 0; k < xs.length; k++) {
        if (k > 0 && xs[k - 1] === xs[k] - 1) continue; // first column of each bridge
        let w = 1; while (cols.has(xs[k] + w)) w++;
        const cx = (xs[k] + w / 2) * TILE, foot = cols.get(xs[k]).y1 + 2.5, near = map.start.y > cols.get(xs[k]).y1 * TILE;
        const y = (near ? foot : cols.get(xs[k]).y0 - 1.5) * TILE;
        if (!solidAt(map, Math.floor(cx / TILE), Math.floor(y / TILE))) spawn('goon', cx, y, { mode: 'post', home: { x: cx, y }, seeT: 0, stunT: 0 });
      }
      // a gang hangs around the office gate
      const m = 3;
      for (let i = 0; i < m; i++) {
        const a = (i / m) * Math.PI * 2;
        let x = target.gate.x + Math.cos(a) * 60, y = target.gate.y + Math.sin(a) * 60;
        if (solidAt(map, Math.floor(x / TILE), Math.floor(y / TILE))) { const o = target.out || { x: 0, y: 1 }; x = target.gate.x + o.x * (80 + i * 14); y = target.gate.y + o.y * (80 + i * 14); }
        spawn('goon', x, y, { mode: 'post', home: { x, y }, seeT: 0, stunT: 0 });
      }
    }

    // ------------------------------------------------------------ the gate showdown
    // police line -> gate shut ("lunch") -> only candidate + 4 -> papers check -> clerk stalls -> rejection;
    // meanwhile the opponent's leaders ("guests") walk in and out and the police salute them.
    const GATE_ON = opts.gate !== false && !!target.gateTiles;
    const gOut = target.out || { x: 0, y: 1 }, gSide = { x: -gOut.y, y: gOut.x };
    const gateOutSpot = { x: target.gate.x + gOut.x * 96, y: target.gate.y + gOut.y * 96 };
    const inCompound = (x, y) => {
      const r = target.rect;
      if (!r) return false;
      const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
      return tx > r.x0 && tx < r.x1 && ty > r.y0 && ty < r.y1;
    };
    if (GATE_ON) {
      const lineTiles = [];
      for (const j of target.gateTiles) {
        const tx = (j % N) + gOut.x, ty = Math.floor(j / N) + gOut.y;
        if (!solidAt(map, tx, ty)) lineTiles.push(ty * N + tx);
      }
      G.gate = { phase: 'idle', pressure: 0, openT: 0, shut: false, line: null, lineTiles, tiles: target.gateTiles, wicket: target.wicket, wicketOpen: false, out: gOut, inside: false, stops: 0, stalls: 0, frisks: 0, stallText: '', hintCd: 0, salCd: 0, ver: 0 };
      if (target.wicket) map.dyn[target.wicket.tile] = 2; // locked, until they shut the main gate and "forget" this one
      const inv = norm(target.x - target.gate.x, target.y - target.gate.y);
      spawn('official', target.x + inv.x * 34, target.y + inv.y * 34, { mode: 'desk', fx: -inv.x, fy: -inv.y });
      if (opts.goons !== false) {
        // the guests' outer stop: out in the street, but short of the Section 144 barricades
        let reach = 150;
        while (reach > 60 && solidAt(map, Math.floor((target.gate.x + gOut.x * reach) / TILE), Math.floor((target.gate.y + gOut.y * reach) / TILE))) reach -= 16;
        const way = [{ x: target.gate.x + gOut.x * reach, y: target.gate.y + gOut.y * reach }, { x: target.gate.x, y: target.gate.y }, { x: target.x + gSide.x * 30, y: target.y + gSide.y * 30 }];
        for (let k = 0; k < 2; k++) spawn('goon', way[k * 2].x, way[k * 2].y, { mode: 'vip', role: 'vip', way, wp: 1, dir: k ? -1 : 1, wait: k * 5, stuckT: 0, seeT: 0, stunT: 0 });
      }
    } else G.gate = null;
    let waitField = null, waitVer = -1;
    function waitDir(e, x, y) {
      if (waitVer !== G.gate.ver) { waitField = field(map, [[Math.floor(gateOutSpot.x / TILE), Math.floor(gateOutSpot.y / TILE)]]); waitVer = G.gate.ver; }
      return flowDir(map, waitField, e.x, e.y) || norm(x - e.x, y - e.y);
    }
    const overlaps = (b, tiles) => tiles.some((j) => {
      const tx = j % N, ty = Math.floor(j / N);
      return b.x + b.r > tx * TILE && b.x - b.r < (tx + 1) * TILE && b.y + b.r > ty * TILE && b.y - b.r < (ty + 1) * TILE;
    });

    // ------------------------------------------------------------ spatial hash
    const CELL = 64, CW = WORLD / CELL;
    const cells = Array.from({ length: CW * CW }, () => []);
    const used = [];
    function rebuildGrid() {
      for (const c of used) c.length = 0;
      used.length = 0;
      for (const e of G.ents) {
        const cx = clamp(Math.floor(e.x / CELL), 0, CW - 1), cy = clamp(Math.floor(e.y / CELL), 0, CW - 1);
        const c = cells[cy * CW + cx];
        if (!c.length) used.push(c);
        c.push(e);
      }
    }
    function query(x, y, r, fn) {
      const x0 = clamp(Math.floor((x - r) / CELL), 0, CW - 1), x1 = clamp(Math.floor((x + r) / CELL), 0, CW - 1);
      const y0 = clamp(Math.floor((y - r) / CELL), 0, CW - 1), y1 = clamp(Math.floor((y + r) / CELL), 0, CW - 1);
      const r2 = r * r;
      for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
        for (const e of cells[cy * CW + cx]) { const dx = e.x - x, dy = e.y - y; if (dx * dx + dy * dy <= r2 && fn(e) === false) return; }
      }
    }

    // ------------------------------------------------------------ player field (for chasers and lost followers)
    let pField = null, pFieldTick = -100, pFieldDirty = true;
    function playerField() {
      if (pFieldDirty || G.tick - pFieldTick >= 10) {
        pField = field(map, [[Math.floor(P.x / TILE), Math.floor(P.y / TILE)]], 70);
        pFieldTick = G.tick; pFieldDirty = false;
      }
      return pField;
    }
    function steerTo(e, tx, ty, useField) {
      if (dist(e.x, e.y, tx, ty) < 6) return { x: 0, y: 0 };
      if (useField && !e.los) {
        const d = flowDir(map, playerField(), e.x, e.y);
        if (d) return d;
      }
      return norm(tx - e.x, ty - e.y);
    }
    function move(e, dx, dy, speed) {
      e.vx = dx * speed; e.vy = dy * speed;
      if (dx || dy) { e.fx = dx; e.fy = dy; }
      return moveBody(e, e.vx * DT, e.vy * DT, map);
    }

    // ------------------------------------------------------------ crowd
    function join(c) {
      if (P.followers.length >= CAP || c.mode === 'follow') return false;
      if (c.type === 'child' && !(c.guardRef && c.guardRef.mode === 'follow')) return false; // children only come with their mother
      c.mode = 'follow'; c.slot = P.followers.length;
      if (G.gate && G.gate.inside) c.inner = P.followers.filter((f) => f.inner !== false).length < 4; // "only candidate + 4"
      P.followers.push(c);
      G.stats.rec++;
      G.stats.crowd = Math.max(G.stats.crowd, P.followers.length);
      const k = c.kidRef;
      if (k && !k.dead && (k.mode === 'wander' || k.mode === 'flee')) join(k);
      return true;
    }
    function leave(c, from, flee) {
      const i = P.followers.indexOf(c);
      if (i >= 0) { P.followers.splice(i, 1); P.followers.forEach((f, k) => { f.slot = k; }); }
      if (flee) { c.mode = 'flee'; c.t = 2 + rng() * 1.5; c.cool = 6; const d = norm(c.x - from.x, c.y - from.y); c.dx = d.x || 1; c.dy = d.y; }
      else c.mode = 'wander';
      if (c.kidRef && c.kidRef.mode === 'follow') leave(c.kidRef, from, flee);
    }

    // ------------------------------------------------------------ democracy meter
    function demo(delta) {
      const before = G.demo;
      if (G.mode === 'over') return;
      G.demo = clamp(G.demo + delta, 0, 100);
      if (G.demo !== before) emit({ t: 'demo', v: G.demo, d: G.demo - before });
      while (G.demoStage < DEMO_STAGES.length && G.demo <= DEMO_STAGES[G.demoStage]) {
        emit({ t: 'demostage', stage: ++G.demoStage });
      }
      if (G.demo <= 0) { toast(Ct.DEMO.dead, '#ff8a80'); end('killed'); }
    }

    // ------------------------------------------------------------ violence against bystanders
    const vulnerable = (c) => c.type === 'woman' || c.type === 'child';
    function copsLookAway(at) {
      query(at.x, at.y, 320, (e) => {
        if (e.kind !== 'cop' || e.mode === 'chase' || e.mode === 'stun') return;
        e.ignoreT = 2.5;
        const k = norm(e.x - at.x, e.y - at.y); e.fx = k.x || 1; e.fy = k.y;
        if (G.ignoreCd <= 0) { say(e, rng.pick(Ct.LINES.copIgnore), null, '#fff59d'); G.ignoreCd = 5; emit({ t: 'ignore', x: e.x, y: e.y }); }
      });
    }
    function hurtCiv(c, from) {
      if (c.mode === 'follow') leave(c, from, false);
      if (c.mode === 'help' && c.helpRef) c.helpRef.helperRef = null;
      c.mode = 'hurt'; c.hurtT = 3.2; c.hitFrom = { x: from.x, y: from.y }; c.cool = 30;
      move(c, 0, 0, 0);
      say(c, rng.pick(c.type === 'child' ? Ct.LINES.childHurt : c.type === 'woman' ? Ct.LINES.womanHurt : Ct.LINES.manHurt), null, '#ffcdd2');
      emit({ t: 'civhit', x: c.x, y: c.y, type: c.type });
      // the nearest woman runs over to help
      let helper = null, bd = 170;
      query(c.x, c.y, 170, (o) => {
        if (o === c || o.kind !== 'civ' || o.type !== 'woman' || o.helperRef) return;
        if (!(o.mode === 'wander' || o.mode === 'flee' || o.mode === 'queue' || o.mode === 'follow')) return;
        const d = dist(o.x, o.y, c.x, c.y);
        if (d < bd) { bd = d; helper = o; }
      });
      if (helper) {
        if (helper.mode === 'follow') leave(helper, from, false);
        if (helper.home) { helper.home.ref = null; helper.home = null; }
        helper.mode = 'help'; helper.helpRef = c; c.helperRef = helper;
      }
      if (c.home) { c.home.ref = null; c.home = null; }
      if (vulnerable(c)) {
        G.stats.civHurt++;
        demo(-6);
        if (G.newsCd <= 0) { toast(rng.pick(c.type === 'child' ? Ct.LINES.childNews : Ct.LINES.womanNews), '#ff8a80'); G.newsCd = 7; }
        copsLookAway(c);
      } else demo(-2);
    }
    function goHome(c) {
      const from = c.hitFrom || { x: c.x - c.fx, y: c.y - c.fy };
      const d = norm(c.x - from.x, c.y - from.y);
      c.mode = 'home'; c.t = 6; c.bandage = true; c.dx = d.x || 1; c.dy = d.y;
      const h = c.helperRef;
      if (h && !h.dead && h.mode === 'help') { h.mode = 'home'; h.t = 6; h.dx = c.dx; h.dy = c.dy; }
      const k = c.kidRef;
      if (k && !k.dead && k.mode !== 'follow' && k.mode !== 'hurt') { k.mode = 'home'; k.t = 6; k.dx = c.dx; k.dy = c.dy; }
    }
    const shieldCount = () => { let n = 0; for (const f of P.followers) if (dist(f.x, f.y, P.x, P.y) < 70) n++; return n; };

    // ------------------------------------------------------------ player events
    function detain(cop) {
      P.state = 'held'; P.heldT = 2.6; P.cases++; P.submitT = 0;
      const scatter = P.followers.slice(Math.ceil(P.followers.length / 2));
      for (const f of scatter) leave(f, cop, true);
      emit({ t: 'detained', cases: P.cases, x: P.x, y: P.y });
      say(P, rng.pick(Ct.LINES.detained));
      for (const e of G.ents) if (e.kind === 'cop' && e.mode === 'chase') e.mode = e.role === 'post' || e.role === 'guard' ? 'return' : 'patrol';
      if (P.cases >= CASES) end('jailed');
      else demo(-10);
    }
    function release() {
      let best = map.stations[0], bd = Infinity;
      for (const s of map.stations) { const d = dist(s.x, s.y, P.x, P.y); if (d < bd) { bd = d; best = s; } }
      P.x = best.x; P.y = best.y; P.px = P.x; P.py = P.y; P.state = 'free'; P.invuln = 5; P.grab = 0;
      for (const f of P.followers) { f.x = P.x + (f.x - P.x) * 0.1; f.y = P.y + (f.y - P.y) * 0.1; f.px = f.x; f.py = f.y; }
      pFieldDirty = true;
      emit({ t: 'released', x: P.x, y: P.y });
      toast('Released from ' + best.name + ' with a warning. ' + (CASES - P.cases) + ' case' + (CASES - P.cases === 1 ? '' : 's') + ' left before jail!', '#ffcc80');
    }
    function shove(by, power) {
      const k = norm(P.x - by.x, P.y - by.y);
      P.kx = k.x * power; P.ky = k.y * power;
    }
    // every run ends with the same title; the reason says how democracy died this time
    function end(reason, extra) {
      if (G.mode === 'over') return;
      G.mode = 'over'; G.modeT = 0;
      G.result = Object.assign({
        reason, crowd: G.stats.crowd, place: G.place, demo: Math.round(G.demo), thrown: G.stats.thrown, hits: G.stats.hits,
        civHurt: G.stats.civHurt, protected: G.stats.protected, arrests: P.cases, barricades: G.stats.brk, lifted: G.stats.lift,
        closest: Math.max(0, Math.round((G.closest - target.r) / 8)), goal: M.goal, time: Math.round(G.elapsed),
        gateStops: G.gate ? G.gate.stops : 0, stalls: G.gate ? G.gate.stalls : 0, frisks: G.gate ? G.gate.frisks : 0,
      }, extra || {});
      emit({ t: 'over', reason });
    }
    // the counter is held: the clerk rejects the nomination anyway, and democracy flatlines
    function reject() {
      const why = rng.pick(Ct.LINES.reject);
      const clerk = G.ents.find((e) => e.kind === 'official');
      if (clerk) say(clerk, why, null, '#ffcdd2');
      emit({ t: 'rejected', text: why });
      end('rejected', { why });
      const before = G.demo;
      G.demo = 0;
      emit({ t: 'demo', v: 0, d: -before });
    }

    // ------------------------------------------------------------ update: player
    function updatePlayer(inp) {
      P.invuln = Math.max(0, P.invuln - DT);
      P.daze = Math.max(0, P.daze - DT);
      P.guardT = Math.max(0, P.guardT - DT);
      P.sloganCd = Math.max(0, P.sloganCd - DT);
      P.sayCd -= DT;
      P.stallT = Math.max(0, (P.stallT || 0) - DT);
      if (P.state === 'held') {
        P.heldT -= DT; P.vx = P.vy = 0;
        if (P.heldT <= 0 && G.mode === 'play') release();
        return;
      }
      if (P.state === 'frisk') { // papers check at the gate
        P.friskT -= DT; P.vx = P.vy = 0;
        if (P.friskT <= 0) { P.state = 'free'; P.invuln = Math.max(P.invuln, 0.8); }
        return;
      }
      let mx = inp.mx || 0, my = inp.my || 0;
      const mag = hypot(mx, my);
      if (mag > 1) { mx /= mag; my /= mag; }
      P.running = !!inp.run && mag > 0.2 && P.stamina > 3 && P.daze <= 0;
      P.stamina = clamp(P.stamina + (P.running ? -20 : 13) * DT, 0, 100);
      P.inGas = G.clouds.some((c) => dist(c.x, c.y, P.x, P.y) < c.r);
      const grabbed = P.grabTick === G.tick - 1;
      if (!grabbed) P.grab = Math.max(0, P.grab - DT * 1.5);
      const speed = (P.running ? SPEED.run : SPEED.walk) * (P.inGas ? 0.6 : 1) * (grabbed ? SPEED.held : 1) * (P.daze > 0 ? 0.55 : 1);
      const ix = mx * speed + P.kx, iy = my * speed + P.ky;
      P.kx *= 0.85; P.ky *= 0.85;
      if (Math.abs(P.kx) < 1) P.kx = 0;
      if (Math.abs(P.ky) < 1) P.ky = 0;
      const ox = P.x, oy = P.y;
      P.vx = ix; P.vy = iy;
      if (mx || my) { P.fx = mx; P.fy = my; }
      moveBody(P, ix * DT, iy * DT, map);
      if (Math.floor(ox / TILE) !== Math.floor(P.x / TILE) || Math.floor(oy / TILE) !== Math.floor(P.y / TILE)) pFieldDirty = pFieldDirty || G.tick - pFieldTick > 3;
      if (G.gate) {
        const inside = inCompound(P.x, P.y);
        if (inside && !G.gate.inside) enterCompound();
        else if (!inside && G.gate.inside) { G.gate.inside = false; for (const f of P.followers) f.inner = true; }
      }
      const toTarget = dist(P.x, P.y, target.x, target.y);
      G.closest = Math.min(G.closest, toTarget);
      if (!G.ringIn && toTarget < G.ringR * TILE) { G.ringIn = true; toast(Ct.DEMO.ring, '#ffcc80'); demo(-5); emit({ t: 'ring' }); }

      // barricade pushing: walking into a barricade wears it down; the crowd pushes with you
      P.pushing = 0;
      const moved = dist(ox, oy, P.x, P.y), want = mag * speed * DT;
      if (mag > 0.3 && moved < want * 0.5) {
        const reach = P.r + 8, sx = Math.sign(mx), sy = Math.sign(my);
        const b = (sx && barricadeAt(P.x + sx * reach, P.y)) || (sy && barricadeAt(P.x, P.y + sy * reach)) || barricadeAt(P.x + mx * reach, P.y + my * reach);
        if (b) {
          let near = 0;
          for (const f of P.followers) if (dist(f.x, f.y, P.x, P.y) < 90) near++;
          b.hp -= (b.kind === 'police' ? 1 + 3 * near : 5 + 2.2 * near) * DT;
          b.pushT = 0.2; P.pushing = b.id;
          if (b.kind === 'police') { // the line shoves back with lathis
            b.lathiCd -= DT;
            if (b.lathiCd <= 0) {
              b.lathiCd = 2.5;
              let hit = 0;
              for (const f of P.followers.slice()) { if (hit >= 2) break; if (dist(f.x, f.y, b.x, b.y) < 110) { leave(f, b, true); hit++; } }
              if (hit) { emit({ t: 'lathi', x: b.x, y: b.y, n: hit }); demo(-4); }
              emit({ t: 'say', x: b.x, y: b.y - 10, text: text(rng.pick(Ct.LINES.lineCop)), color: '#fff59d' });
            }
          }
          if (P.sayCd <= 0 && near >= 3) { say(P, rng.pick(Ct.LINES.barricade)); P.sayCd = 5; }
          if (b.hp <= 0) breakBarricade(b);
        }
      }

      // slogan: recruit nearby townspeople and calm scattered supporters; makes goons think twice
      if (inp.act && P.sloganCd <= 0) {
        P.sloganCd = 2.5; P.guardT = 3; // the crowd closes ranks around women and children
        G.stats.slogan++;
        say(P, rng.pick(Ct.LINES.slogan), null, '#bbdefb');
        let n = 0;
        query(P.x, P.y, 150, (e) => {
          if (e.kind === 'civ' && (e.mode === 'wander' || e.mode === 'flee') && n < 6 && P.followers.length < CAP) { if (join(e)) n++; }
          else if (e.kind === 'goon' && e.role !== 'vip' && P.followers.length >= 4 && e.mode !== 'flee') scareGoon(e);
        });
        chantAtGate();
        emit({ t: 'slogan', x: P.x, y: P.y, n });
        if (n) emit({ t: 'join', n, crowd: P.followers.length, x: P.x, y: P.y });
      }

      // walk into people to grow your crowd; the bigger it gets, the wider the pull
      if (P.followers.length < CAP) {
        const R = P.r + 12 + Math.min(26, P.followers.length * 1.1);
        let n = 0;
        query(P.x, P.y, R, (e) => { if (e.kind === 'civ' && e.mode === 'wander' && !(e.cool > 0) && join(e)) { n++; if (n === 1 && rng() < 0.5) say(e, rng.pick(Ct.LINES.join), null, '#e3f2fd'); } });
        if (n) emit({ t: 'join', n, crowd: P.followers.length, x: P.x, y: P.y });
      }

      // destination: hold the counter zone until it is "filed"
      if (dist(P.x, P.y, target.x, target.y) < target.r) {
        if (P.submitT === 0) { emit({ t: 'filing' }); say(P, rng.pick(Ct.LINES.filing)); }
        if (P.stallT <= 0) {
          P.submitT += DT;
          if (G.gate && G.gate.stalls < 2 && P.submitT < G.M.hold && P.submitT >= (G.M.hold * (G.gate.stalls + 1)) / 3) startStall();
        }
        if (P.submitT >= G.M.hold) reject();
      } else P.submitT = Math.max(0, P.submitT - DT * 0.5);
    }

    function barricadeAt(x, y) {
      const tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
      if (tx < 0 || ty < 0 || tx >= N || ty >= N || !map.dyn[ty * N + tx]) return null;
      const j = ty * N + tx;
      return G.barrs.find((b) => b.tiles.includes(j)) || null;
    }
    function breakBarricade(b) {
      for (const j of b.tiles) map.dyn[j] = 0;
      G.barrs.splice(G.barrs.indexOf(b), 1);
      G.stats.brk++;
      pFieldDirty = true;
      emit({ t: 'break', x: b.x, y: b.y, kind: b.kind || 'barricade' });
      demo(3);
      if (b.kind === 'police') { // the cops stagger aside, then go back to work
        for (let k = 0; k < 3; k++) spawn('cop', b.x + gSide.x * (k - 1) * 22 + gOut.x * 20, b.y + gSide.y * (k - 1) * 22 + gOut.y * 20, { mode: 'stun', stunT: 3, role: 'patrol', postIdx: nearestPost(b.x, b.y), lathiCd: 2, seeT: 0 });
      }
    }

    // ------------------------------------------------------------ gate showdown
    function applyGateTiles() {
      const g = G.gate, closed = g.openT <= 0;
      let changed = false;
      const setT = (j, v) => { if (map.dyn[j] !== v) { map.dyn[j] = v; changed = true; } };
      for (const j of g.tiles) setT(j, g.shut && closed ? 2 : 0);
      if (g.wicket) setT(g.wicket.tile, g.wicketOpen ? 0 : 2);
      if (g.line && G.barrs.includes(g.line)) for (const j of g.line.tiles) setT(j, closed ? 3 : 0);
      if (changed) { pFieldDirty = true; g.ver++; }
    }
    function updateGate() {
      const g = G.gate;
      g.hintCd -= DT; g.salCd -= DT;
      const dg = dist(P.x, P.y, target.gate.x, target.gate.y), inside = inCompound(P.x, P.y);
      if (g.phase === 'idle' && dg < 260 && !inside) {
        g.stops++;
        if (opts.police !== false && g.lineTiles.length) {
          let sx = 0, sy = 0;
          for (const j of g.lineTiles) { sx += (j % N) + 0.5; sy += Math.floor(j / N) + 0.5; }
          const b = { id: nextId++, tiles: g.lineTiles.slice(), x: (sx / g.lineTiles.length) * TILE, y: (sy / g.lineTiles.length) * TILE, hp: 100, max: 100, pushT: 0, kind: 'police', lathiCd: 1.5 };
          G.barrs.push(b); g.line = b; g.phase = 'line';
          emit({ t: 'line', x: b.x, y: b.y });
          emit({ t: 'say', x: b.x, y: b.y - 10, text: text(rng.pick(Ct.LINES.lineCop)), color: '#fff59d' });
        } else g.phase = 'approach';
      }
      if (g.phase === 'line' && !G.barrs.includes(g.line)) { g.phase = 'approach'; g.line = null; }
      if (g.phase === 'approach' && dg < 110 && !inside) {
        if (overlaps(P, g.tiles)) g.phase = 'open';
        else {
          g.phase = 'shut'; g.shut = true; g.wicketOpen = true; g.stops++;
          demo(-5);
          emit({ t: 'gateshut', x: target.gate.x, y: target.gate.y });
          emit({ t: 'say', x: target.gate.x, y: target.gate.y - 14, text: text(rng.pick(Ct.LINES.gateShut)), color: '#fff59d' });
        }
      }
      // the gate (and the police line) part for the opponent's leaders
      const wasOpen = g.openT > 0;
      for (const e of G.ents) if (e.role === 'vip' && dist(e.x, e.y, target.gate.x, target.gate.y) < 64) g.openT = Math.max(g.openT, 0.5);
      if (g.openT > 0 && !wasOpen && (g.shut || g.line)) {
        emit({ t: 'vipgate', x: target.gate.x, y: target.gate.y });
        let said = false;
        query(target.gate.x, target.gate.y, 240, (e) => {
          if (e.kind !== 'cop' || e.mode === 'chase' || e.mode === 'stun') return;
          e.salute = 1.8;
          const v = G.ents.find((o) => o.role === 'vip' && dist(o.x, o.y, target.gate.x, target.gate.y) < 64);
          if (v) { const k = norm(v.x - e.x, v.y - e.y); e.fx = k.x || 1; e.fy = k.y; }
          if (!said && g.salCd <= 0) { say(e, rng.pick(Ct.LINES.vipSalute), null, '#fff59d'); said = true; g.salCd = 6; }
        });
      }
      if (g.openT > 0) {
        g.openT -= DT;
        if (g.openT <= 0 && (overlaps(P, g.tiles) || overlaps(P, g.lineTiles))) g.openT = 0.2; // never close on the candidate
      }
      applyGateTiles();
    }
    function chantAtGate() {
      const g = G.gate;
      if (!g || !g.shut || dist(P.x, P.y, target.gate.x, target.gate.y) > 160) return;
      if (P.followers.length < 8) { if (g.hintCd <= 0) { emit({ t: 'needcrowd', n: P.followers.length, need: 8 }); g.hintCd = 6; } return; }
      g.pressure++;
      const f = P.followers[g.pressure % P.followers.length];
      if (f) say(f, rng.pick(Ct.LINES.chant), null, '#e3f2fd');
      emit({ t: 'chant', n: g.pressure, need: 4, x: target.gate.x, y: target.gate.y });
      if (g.pressure >= 4) {
        g.shut = false; g.phase = 'open';
        applyGateTiles();
        demo(3);
        emit({ t: 'gateopen', x: target.gate.x, y: target.gate.y });
      }
    }
    function enterCompound() {
      const g = G.gate;
      g.inside = true;
      const viaWicket = !!g.wicket && dist(P.x, P.y, g.wicket.x, g.wicket.y) < dist(P.x, P.y, target.gate.x, target.gate.y);
      // "only candidate + 4": the nearest four come in, the rest wait at the gate
      const sorted = P.followers.slice().sort((a, b) => dist(a.x, a.y, P.x, P.y) - dist(b.x, b.y, P.x, P.y));
      sorted.forEach((f, i) => { f.inner = i < 4; });
      if (sorted.length > 4) emit({ t: 'four', waiting: sorted.length - 4 });
      if (opts.police !== false) { // papers check
        P.state = 'frisk'; P.friskT = viaWicket ? 3 : 2; P.vx = P.vy = 0; P.kx = P.ky = 0; P.submitT = 0; g.frisks++;
        emit({ t: 'frisk', x: P.x, y: P.y, wicket: viaWicket });
        emit({ t: 'say', x: P.x, y: P.y - 18, text: text(rng.pick(Ct.LINES.frisk)), color: '#fff59d' });
        demo(viaWicket ? -4 : -3);
      }
    }
    function startStall() {
      const g = G.gate;
      g.stalls++;
      let props = 0;
      for (const f of P.followers) if (inCompound(f.x, f.y) && dist(f.x, f.y, P.x, P.y) < 160) props++;
      P.stallT = props >= 4 ? 1.25 : 2.5;
      g.stallText = rng.pick(Ct.LINES.stall);
      const clerk = G.ents.find((e) => e.kind === 'official');
      if (clerk) say(clerk, g.stallText, null, '#fff9c4');
      if (props >= 4) { const f = P.followers.find((o) => inCompound(o.x, o.y)); if (f) say(f, rng.pick(Ct.LINES.proposers), null, '#e3f2fd'); }
      emit({ t: 'stall', text: g.stallText, short: props >= 4 });
      demo(-4);
    }

    // ------------------------------------------------------------ update: NPCs
    function sees(e, range) {
      if (P.state !== 'free') return false;
      const d = dist(e.x, e.y, P.x, P.y);
      if (d > range) return false;
      if ((G.tick + e.id) % 6 === 0 || e.los === undefined) e.los = lineOfSight(map, e.x, e.y, P.x, P.y);
      return e.los;
    }

    function updateCiv(e) {
      if (e.cool > 0) e.cool -= DT;
      if (e.mode === 'follow' && G.gate && G.gate.inside && e.inner === false) {
        // waiting at the gate, chanting
        const k = e.slot % 24, sx = gateOutSpot.x + gSide.x * ((k % 6) - 2.5) * 18 + gOut.x * Math.floor(k / 6) * 18, sy = gateOutSpot.y + gSide.y * ((k % 6) - 2.5) * 18 + gOut.y * Math.floor(k / 6) * 18;
        const d = dist(e.x, e.y, sx, sy);
        if (d < 5) { move(e, 0, 0, 0); e.fx = -gOut.x; e.fy = -gOut.y; return; }
        const dir = inCompound(e.x, e.y) || d > 140 ? waitDir(e, sx, sy) : norm(sx - e.x, sy - e.y);
        move(e, dir.x, dir.y, Math.min(SPEED.walk, d * 4 + 20));
        return;
      }
      if (e.mode === 'follow') {
        const i = e.slot, a = i * 2.39996, rad = 20 + 9 * Math.sqrt(i + 1);
        const tx = P.x + Math.cos(a) * rad - P.fx * 10, ty = P.y + Math.sin(a) * rad - P.fy * 10;
        const d = dist(e.x, e.y, tx, ty);
        const far = dist(e.x, e.y, P.x, P.y) > 150;
        if ((G.tick + e.id) % 8 === 0) e.los = lineOfSight(map, e.x, e.y, P.x, P.y);
        const dir = far ? steerTo(e, P.x, P.y, true) : norm(tx - e.x, ty - e.y);
        const max = (P.running ? SPEED.run : SPEED.walk) * SPEED.follow;
        const sp = Math.min(max, d * 4 + (far ? max : 0));
        if (P.state === 'held') { move(e, 0, 0, 0); return; }
        move(e, dir.x, dir.y, sp);
        if (G.clouds.some((c) => dist(c.x, c.y, e.x, e.y) < c.r) && rng() < 0.6 * DT) { leave(e, { x: e.x - e.fx, y: e.y - e.fy }, true); say(e, rng.pick(Ct.LINES.scared)); }
        return;
      }
      if (e.mode === 'flee') {
        e.t -= DT;
        const r = move(e, e.dx, e.dy, SPEED.flee);
        if (r.hitX) e.dx = -e.dx;
        if (r.hitY) e.dy = -e.dy;
        if (e.t <= 0) e.mode = 'wander';
        return;
      }
      if (e.mode === 'hurt') { e.hurtT -= DT; move(e, 0, 0, 0); if (e.hurtT <= 0) goHome(e); return; }
      if (e.mode === 'help') {
        const v = e.helpRef;
        if (!v || v.dead || v.mode !== 'hurt') { e.helpRef = null; if (e.mode === 'help') e.mode = 'wander'; return; }
        const d = dist(e.x, e.y, v.x, v.y);
        if (d > 13) { const dir = norm(v.x - e.x, v.y - e.y); move(e, dir.x, dir.y, SPEED.flee); } else { move(e, 0, 0, 0); e.fx = v.x - e.x || 1; e.fy = v.y - e.y; }
        return;
      }
      if (e.mode === 'home') { // led home after being hurt, then off the map
        e.t -= DT;
        const r = move(e, e.dx, e.dy, SPEED.civ * 1.5);
        if (r.hitX) e.dx = -e.dx;
        if (r.hitY) e.dy = -e.dy;
        if (e.t <= 0) e.dead = true;
        return;
      }
      if (e.mode === 'queue') {
        const h = e.home;
        if (!h) { e.mode = 'wander'; return; }
        const d = dist(e.x, e.y, h.x, h.y);
        if (d > 4) { const dir = norm(h.x - e.x, h.y - e.y); move(e, dir.x, dir.y, SPEED.civ); } else { move(e, 0, 0, 0); e.fx = h.fx; e.fy = h.fy; }
        return;
      }
      const g = e.guardRef;
      if (g) { // a child stays close to their mother
        if (g.dead) e.guardRef = null;
        else if (g.mode === 'home') { e.mode = 'home'; e.t = g.t; e.dx = g.dx; e.dy = g.dy; return; }
        else if (g.mode !== 'follow') {
          const d = dist(e.x, e.y, g.x, g.y);
          if (d > 15) { const dir = norm(g.x - e.x, g.y - e.y); move(e, dir.x, dir.y, Math.min(SPEED.flee, d * 3)); } else move(e, 0, 0, 0);
          return;
        }
      }
      e.t -= DT;
      if (e.t <= 0) {
        e.t = 1.5 + rng() * 3;
        if (rng() < 0.4) { e.dx = 0; e.dy = 0; } else { const a = rng() * Math.PI * 2; e.dx = Math.cos(a); e.dy = Math.sin(a); }
      }
      const r = move(e, e.dx || 0, e.dy || 0, SPEED.civ);
      if (r.hitX || r.hitY) e.t = 0;
    }

    function backToWork(e) { e.mode = e.role === 'post' || e.role === 'guard' || e.kind === 'goon' && e.home ? 'return' : 'patrol'; }

    function updateCop(e) {
      e.lathiCd = Math.max(0, (e.lathiCd || 0) - DT);
      e.gasCd = Math.max(0, (e.gasCd || 0) - DT);
      e.sayCd -= DT;
      if (e.mode === 'stun') { e.stunT -= DT; move(e, 0, 0, 0); if (e.stunT <= 0) backToWork(e); return; }
      if (e.ignoreT > 0 && e.mode !== 'chase') { e.ignoreT -= DT; move(e, 0, 0, 0); return; } // "didn't see anything"
      if (e.salute > 0 && e.mode !== 'chase') { e.salute -= DT; move(e, 0, 0, 0); return; } // saluting the opponent's leaders
      const d = dist(e.x, e.y, P.x, P.y);
      const look = e.role === 'guard' ? 190 : 220;
      // once you are checked and inside, the gate police step back: the officials take over
      const calm = e.role === 'guard' && G.gate && G.gate.inside && P.state !== 'frisk';
      if (calm && e.mode === 'chase') backToWork(e);
      if (!calm && e.mode !== 'chase' && sees(e, look)) {
        e.mode = 'chase'; e.seeT = 0;
        if (e.sayCd <= 0) { say(e, rng.pick(Ct.LINES.cop), null, '#fff59d'); e.sayCd = 6; }
      }
      if (e.mode === 'chase') {
        if (sees(e, 700)) e.seeT = 0; else e.seeT += DT;
        const leash = e.home ? dist(e.x, e.y, e.home.x, e.home.y) > 360 : false;
        if (P.state !== 'free' || e.seeT > 6 || d > 700 || leash) { backToWork(e); return; }
        const dir = steerTo(e, P.x, P.y, true);
        move(e, dir.x, dir.y, SPEED.copChase * (e.role === 'gas' ? 0.9 : 1));
        if (e.role === 'gas' && e.gasCd <= 0 && P.followers.length >= 6 && d < 320 && e.los) {
          e.gasCd = 10;
          G.clouds.push({ x: P.x + rng.range(-30, 30), y: P.y + rng.range(-30, 30), r: 75, t: 4.5, max: 4.5 });
          emit({ t: 'gas', x: P.x, y: P.y });
          demo(-4);
        }
        if (d < e.r + P.r + 3 && P.state === 'free' && P.invuln <= 0) {
          if (shieldCount() >= SHIELD) {
            // the crowd lifts the cop out of the way, but one supporter is taken away
            e.mode = 'stun'; e.stunT = 3;
            const k = norm(e.x - P.x, e.y - P.y);
            for (let s = 0; s < 6; s++) moveBody(e, k.x * 14, k.y * 14, map);
            let taken = null, bd = Infinity;
            for (const f of P.followers) { const fd = dist(f.x, f.y, e.x, e.y); if (fd < bd) { bd = fd; taken = f; } }
            if (taken) { leave(taken, e, false); taken.dead = true; }
            G.stats.lift++;
            emit({ t: 'lift', x: e.x, y: e.y });
            say(e, rng.pick(Ct.LINES.copLifted), null, '#fff59d');
          } else {
            // a grab takes a moment; running breaks free (cops are slower than a running candidate)
            if (P.grabTick !== G.tick) { P.grabTick = G.tick; if (P.grab === 0) { emit({ t: 'grab', x: P.x, y: P.y }); say(e, rng.pick(Ct.LINES.cop), null, '#fff59d'); } }
            P.grab += DT / GRAB_TIME;
            if (P.grab >= 1) { P.grab = 0; detain(e); }
          }
        }
        // lathi: scatters supporters around the cop (after the crowd had its chance to lift him)
        if (e.mode === 'chase' && e.lathiCd <= 0) {
          let hit = 0;
          for (const f of P.followers.slice()) {
            if (hit >= 3) break;
            if (dist(f.x, f.y, e.x, e.y) < 46) { leave(f, e, true); hit++; }
          }
          if (hit) { e.lathiCd = 1.8; emit({ t: 'lathi', x: e.x, y: e.y, n: hit }); if (rng() < 0.4) say(e, rng.pick(Ct.LINES.lathi), null, '#fff59d'); demo(-4); }
        }
        return;
      }
      if (e.mode === 'post') { move(e, 0, 0, 0); return; }
      if (e.mode === 'return') {
        const h = e.home;
        if (!h || dist(e.x, e.y, h.x, h.y) < 8) { e.mode = h ? 'post' : 'patrol'; e.stuckT = 0; move(e, 0, 0, 0); return; }
        let dir;
        if (e.role === 'guard') { // posts behind the compound wall: walk round by the streets, not into the wall
          const ver = G.gate ? G.gate.ver : 0;
          if (!e.homeField || e.homeVer !== ver) { e.homeField = field(map, [[Math.floor(h.x / TILE), Math.floor(h.y / TILE)]]); e.homeVer = ver; }
          dir = flowDir(map, e.homeField, e.x, e.y) || norm(h.x - e.x, h.y - e.y);
        } else dir = norm(h.x - e.x, h.y - e.y);
        const ox = e.x, oy = e.y;
        const r = move(e, dir.x, dir.y, SPEED.cop);
        e.stuckT = dist(ox, oy, e.x, e.y) < 0.5 ? (e.stuckT || 0) + DT : 0;
        if ((r.hitX && r.hitY) || e.stuckT > 4) { e.x = h.x; e.y = h.y; e.stuckT = 0; } // never jam for good
        return;
      }
      // patrol between intersections along precomputed fields
      const p = G.posts[e.postIdx];
      if (dist(e.x, e.y, p.x, p.y) < 40) { e.postIdx = rng.int(G.posts.length); return; }
      const dir = flowDir(map, postFields[e.postIdx], e.x, e.y) || norm(p.x - e.x, p.y - e.y);
      move(e, dir.x, dir.y, e.kind === 'goon' ? SPEED.goon : SPEED.cop);
    }

    function scareGoon(e) {
      e.mode = 'flee'; e.t = 4; e.cool = 8;
      const d = norm(e.x - P.x, e.y - P.y); e.dx = d.x || 1; e.dy = d.y;
      G.stats.goon++;
      emit({ t: 'scare', x: e.x, y: e.y });
      say(e, rng.pick(Ct.LINES.goonScared), null, '#ffcdd2');
    }

    // ------------------------------------------------------------ thrown stones, sticks and chappals
    function startThrow(e, civ) {
      e.throwT = THROW.windup; e.aimRef = civ || null;
      e.throwCd = civ ? rng.range(5, 8) : rng.range(2.8, 4.2);
      const tx = civ ? civ.x : P.x, ty = civ ? civ.y : P.y, k = norm(tx - e.x, ty - e.y);
      e.fx = k.x || 1; e.fy = k.y;
      if (e.sayCd <= 0) { say(e, rng.pick(Ct.LINES.throw), null, '#ffcdd2'); e.sayCd = 5; }
    }
    function launch(e) {
      const civ = e.aimRef;
      e.aimRef = null;
      if (civ && (civ.dead || civ.mode === 'hurt' || civ.mode === 'home')) return;
      let tx, ty;
      const d0 = civ ? dist(e.x, e.y, civ.x, civ.y) : dist(e.x, e.y, P.x, P.y), dur = 0.6 + d0 / 600;
      if (civ) { tx = civ.x + rng.range(-8, 8); ty = civ.y + rng.range(-8, 8); }
      else { // lead the target a little: zig-zagging dodges
        tx = P.x + P.vx * dur * 0.8 + rng.range(-22, 22); ty = P.y + P.vy * dur * 0.8 + rng.range(-22, 22);
      }
      const r = rng(), kind = r < 0.55 ? 'stone' : r < 0.8 ? 'stick' : 'chappal';
      G.projs.push({ id: nextId++, kind, x0: e.x, y0: e.y, x1: tx, y1: ty, t: 0, dur, h: 40 + d0 * 0.25, aimed: !!civ });
      G.stats.thrown++;
      emit({ t: 'throw', x: e.x, y: e.y, kind });
    }
    function canThrow(e) { return opts.throws !== false && !(e.throwCd > 0) && G.projs.length < THROW.air; }
    function hitPlayer(pj, from) {
      G.stats.hits++;
      shove(from, 340);
      P.daze = 0.7; P.stamina = Math.max(0, P.stamina - 20); P.invuln = Math.max(P.invuln, 0.6);
      for (let n = 0; n < 2; n++) { // the closest supporters scatter
        let f = null, bd = 80;
        for (const o of P.followers) { const d = dist(o.x, o.y, P.x, P.y); if (d < bd) { bd = d; f = o; } }
        if (f) leave(f, from, true);
      }
      emit({ t: 'hit', x: P.x, y: P.y, kind: pj.kind });
      if (P.sayCd <= 0) { say(P, rng.pick(Ct.LINES.hit)); P.sayCd = 3; }
      demo(-6);
    }
    function protect(x, y, byCrowd) {
      G.stats.protected++;
      demo(2);
      emit({ t: 'protect', x, y, crowd: byCrowd });
      if (!byCrowd && P.sayCd <= 0) { say(P, rng.pick(Ct.LINES.protect)); P.sayCd = 3; }
    }
    function land(pj) {
      const x = pj.x1, y = pj.y1, from = { x: pj.x0, y: pj.y0 };
      emit({ t: 'land', x, y, kind: pj.kind });
      let victim = null, vd = 18;
      query(x, y, 22, (e) => {
        if (e.kind !== 'civ' || e.dead || e.mode === 'hurt' || e.mode === 'home') return;
        const d = dist(e.x, e.y, x, y);
        if (d < vd) { vd = d; victim = e; }
      });
      const pd = dist(P.x, P.y, x, y);
      if (P.state === 'free' && pd < 22 && P.invuln <= 0) {
        if (pj.aimed) { // the candidate stepped in front of the women and children
          protect(P.x, P.y, false);
          shove(from, 150);
          return;
        }
        if (shieldCount() >= SHIELD && rng() < 0.6) { // a supporter takes it for you
          let f = null, bd = 90;
          for (const o of P.followers) { if (o.type !== 'man') continue; const d = dist(o.x, o.y, P.x, P.y); if (d < bd) { bd = d; f = o; } }
          if (f) { hurtCiv(f, from); say(f, rng.pick(Ct.LINES.shield), null, '#e3f2fd'); emit({ t: 'shield', x: f.x, y: f.y }); return; }
        }
        hitPlayer(pj, from);
      } else if (victim) {
        if (vulnerable(victim) && P.guardT > 0 && dist(victim.x, victim.y, P.x, P.y) < 160) protect(victim.x, victim.y, true);
        else hurtCiv(victim, from);
      }
      query(x, y, 70, (e) => {
        if (e.kind === 'civ' && e.mode === 'wander') { e.mode = 'flee'; e.t = 1.5 + rng(); e.cool = 4; const d = norm(e.x - x, e.y - y); e.dx = d.x || 1; e.dy = d.y; }
      });
    }
    function updateProjs() {
      for (let i = G.projs.length - 1; i >= 0; i--) {
        const pj = G.projs[i];
        pj.t += DT;
        if (pj.t < pj.dur) continue;
        G.projs.splice(i, 1);
        land(pj);
        if (G.mode !== 'play') return;
      }
    }

    function updateVip(e) { // strolls gate <-> office; the gate opens for them
      e.sayCd -= DT;
      if (e.wait > 0) { e.wait -= DT; move(e, 0, 0, 0); return; }
      const wp = e.way[e.wp], d = dist(e.x, e.y, wp.x, wp.y);
      if (d < 8) {
        if (e.wp === 2) { e.dir = -1; e.wait = 4; if (e.sayCd <= 0) { say(e, rng.pick(Ct.LINES.vip), null, '#ffcdd2'); e.sayCd = 10; } }
        else if (e.wp === 0) { e.dir = 1; e.wait = 6; }
        e.wp += e.dir; e.stuckT = 0;
        return;
      }
      const dir = norm(wp.x - e.x, wp.y - e.y), ox = e.x, oy = e.y;
      move(e, dir.x, dir.y, SPEED.goon * 0.8);
      e.stuckT = dist(ox, oy, e.x, e.y) < 0.5 ? e.stuckT + DT : 0;
      if (e.stuckT > 3) { e.x = wp.x; e.y = wp.y; e.stuckT = 0; } // never jam
    }

    function updateGoon(e) {
      if (e.role === 'vip') { updateVip(e); return; }
      e.sayCd -= DT;
      if (e.cool > 0) e.cool -= DT;
      if (e.throwCd > 0) e.throwCd -= DT;
      if (e.mode === 'flee') {
        e.t -= DT; e.throwT = 0;
        const r = move(e, e.dx, e.dy, SPEED.goonChase);
        if (r.hitX) e.dx = -e.dx;
        if (r.hitY) e.dy = -e.dy;
        if (e.t <= 0) backToWork(e);
        return;
      }
      if (e.throwT > 0) { e.throwT -= DT; move(e, 0, 0, 0); if (e.throwT <= 0) launch(e); return; }
      const big = P.followers.length >= 8;
      if (e.mode !== 'chase' && !(e.cool > 0) && sees(e, big ? 280 : 230)) {
        e.mode = 'chase'; e.seeT = 0;
        if (e.sayCd <= 0) { say(e, rng.pick(Ct.LINES.goon), null, '#ffcdd2'); e.sayCd = 6; }
      }
      if (e.mode === 'chase') {
        if (sees(e, 600)) e.seeT = 0; else e.seeT += DT;
        if (P.state !== 'free' || e.seeT > 5) { backToWork(e); return; }
        const d = dist(e.x, e.y, P.x, P.y);
        const inRange = d > THROW.min && d < THROW.max && e.los;
        if (big) { // a big crowd: they won't face you, they pelt you from a distance
          if (d < 130) { scareGoon(e); return; }
          if (inRange && canThrow(e)) { startThrow(e, null); return; }
          const k = d < 200 ? -1 : d > 250 ? 1 : 0, dir = norm(P.x - e.x, P.y - e.y);
          move(e, dir.x * k, dir.y * k, SPEED.goon);
          if (!k) { e.fx = dir.x || 1; e.fy = dir.y; }
          return;
        }
        if (inRange && canThrow(e)) { if (rng() < 0.6) { startThrow(e, null); return; } e.throwCd = 1.5; }
        const dir = steerTo(e, P.x, P.y, true);
        move(e, dir.x, dir.y, SPEED.goonChase);
        if (dist(e.x, e.y, P.x, P.y) < e.r + P.r + 3 && P.invuln <= 0) {
          if (shieldCount() >= SHIELD) scareGoon(e);
          else {
            shove(e, 260);
            say(e, rng.pick(Ct.LINES.goon), null, '#ffcdd2');
            if (P.sayCd <= 0) { say(P, rng.pick(Ct.LINES.attacked)); P.sayCd = 3; }
            emit({ t: 'attacked', x: P.x, y: P.y });
            e.mode = 'flee'; e.t = 3; e.cool = 6;
            const d = norm(e.x - P.x, e.y - P.y); e.dx = d.x || 1; e.dy = d.y;
            demo(-8);
          }
        }
        return;
      }
      if (e.mode === 'post' || e.mode === 'return') {
        const h = e.home;
        if (e.mode === 'post' && canThrow(e) && dist(P.x, P.y, target.x, target.y) < 560) {
          // the gang at the gate pelts the women queuing outside
          let victim = null;
          for (const q of G.queue) { const c = q.ref; if (c && !c.dead && c.mode === 'queue') { const d = dist(c.x, c.y, e.x, e.y); if (d > 50 && d < THROW.max) { victim = c; break; } } }
          if (victim && rng() < 0.5) { startThrow(e, victim); return; }
          e.throwCd = 2;
        }
        if (!h || dist(e.x, e.y, h.x, h.y) < 8) { e.mode = 'post'; move(e, 0, 0, 0); return; }
        const dir = norm(h.x - e.x, h.y - e.y);
        move(e, dir.x, dir.y, SPEED.goon);
        return;
      }
      updateCop(e); // shares the patrol walk
    }

    // ------------------------------------------------------------ world upkeep
    function upkeep() {
      for (let i = G.clouds.length - 1; i >= 0; i--) { G.clouds[i].t -= DT; if (G.clouds[i].t <= 0) G.clouds.splice(i, 1); }
      G.ignoreCd -= DT; G.newsCd -= DT;
      if (G.queue.some((q) => !q.ref || q.ref.dead || q.ref.home !== q)) {
        G.queueT -= DT;
        if (G.queueT <= 0) { const q = G.queue.find((o) => !o.ref || o.ref.dead || o.ref.home !== o); if (q) spawnQueue(q); G.queueT = 10; }
      } else G.queueT = 10;
      for (const b of G.barrs) b.pushT = Math.max(0, b.pushT - DT);
      if (G.ents.some((e) => e.dead)) G.ents = G.ents.filter((e) => !e.dead);
      // keep the streets busy
      if (G.tick % 60 === 0) {
        let civs = 0;
        for (const e of G.ents) if (e.kind === 'civ' && e.mode !== 'follow') civs++;
        for (let k = 0; civs + k < civCount * 0.7 && k < 6; k++) { const s = randomSpot(450); spawnCiv(s.x, s.y); }
      }
      // police backup grows with time and with your crowd
      if (opts.police !== false) {
        G.alertT -= DT * (P.followers.length >= 20 ? 1.6 : 1);
        if (G.alertT <= 0) {
          G.alertT = 45;
          const cops = G.ents.filter((e) => e.kind === 'cop').length;
          if (cops < 14) {
            let st = map.stations[0], bd = Infinity;
            for (const s of map.stations) { const d = dist(s.x, s.y, P.x, P.y); if (d < bd && d > 300) { bd = d; st = s; } }
            for (let k = 0; k < 3; k++) spawn('cop', st.x + (k - 1) * 16, st.y, { mode: 'patrol', role: k === 0 ? 'gas' : 'patrol', postIdx: nearestPost(P.x, P.y), lathiCd: 0, gasCd: 6, seeT: 0, stunT: 0 });
            emit({ t: 'backup', name: st.name });
            toast('🚨 Police backup from the ' + st.name + '!', '#90caf9');
          }
        }
      }
    }

    function snapPrev() {
      P.px = P.x; P.py = P.y;
      for (const e of G.ents) { e.px = e.x; e.py = e.y; }
    }

    function step(input) {
      const inp = input || EMPTY_INPUT;
      G.tick++; G.modeT += DT;
      snapPrev();
      if (G.mode === 'intro') {
        if ((G.modeT > 0.5 && (inp.act || Math.abs(inp.mx || 0) + Math.abs(inp.my || 0) > 0.3)) || G.modeT > 8) {
          G.mode = 'play'; G.modeT = 0;
          say(P, rng.pick(Ct.LINES.start));
        }
        return;
      }
      if (G.mode !== 'play') return;
      G.elapsed += DT;
      rebuildGrid();
      updatePlayer(inp);
      if (G.mode !== 'play') return;
      if (G.gate) updateGate();
      for (const e of G.ents) {
        if (e.dead) continue;
        if (e.kind === 'civ') updateCiv(e);
        else if (e.kind === 'cop') updateCop(e);
        else if (e.kind === 'goon') updateGoon(e);
        if (G.mode !== 'play') return;
      }
      updateProjs();
      if (G.mode !== 'play') return;
      upkeep();
    }

    function drainEvents() { const ev = G.events; G.events = []; return ev; }

    return { state: G, step, drainEvents, text, rng, CASES, CAP, SHIELD, _test: { join, leave, detain, breakBarricade, barricadeAt, shove, launch, startThrow, hurtCiv, demo, spawnCiv, inCompound, updateGate } };
  }

  return { createGame, EMPTY_INPUT, SPEED, CAP, CASES, SHIELD, THROW, DEMO_STAGES, RING };
});
