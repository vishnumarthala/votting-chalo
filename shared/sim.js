// Deterministic top-down game simulation (30 Hz). No DOM and no Math.random: the same seed and inputs
// always give the same game, so this module can later run on a Node server for online rooms or replays.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./world.js'), require('./content.js'), (id) => require('../data/towns/' + id + '.json'));
  else root.Sim = factory(root.World, root.Content, () => null);
})(typeof self !== 'undefined' ? self : this, function (Wd, Ct, loadTown) {
  'use strict';
  const { TILE, N, WORLD, DT, K, clamp, hypot, dist, norm, makeRng, buildTown, kindAt, solidAt, moveBody, field, flowDir, lineOfSight, barricadeRing } = Wd;

  const CAP = 30; // max crowd
  const SPEED = { walk: 135, run: 215, follow: 1.18, civ: 34, flee: 120, cop: 70, copChase: 112, goon: 85, goonChase: 125, held: 0.75 };
  const CASES = 3; // detentions before you are jailed
  const SHIELD = 3; // supporters needed near you to block an arrest
  const GRAB_TIME = 1.1; // seconds a cop must hold on to arrest you
  const EMPTY_INPUT = { mx: 0, my: 0, run: false, act: false };

  // opts: { seed, town: 'pulivendula', townData, mode: 'nomination' | 'vote', police, goons, mobs, civilians }.
  // townData is the town's map file; Node loads data/towns/<town>.json itself, the browser passes the fetched file.
  function createGame(opts) {
    opts = opts || {};
    const townId = opts.town || Ct.DEFAULT_TOWN, info = Object.prototype.hasOwnProperty.call(Ct.TOWNS, townId) ? Ct.TOWNS[townId] : null;
    if (!info) throw new Error('unknown town: ' + townId);
    const townData = opts.townData || loadTown(townId);
    if (!townData) throw new Error('no map data for ' + townId + ': pass opts.townData');
    const rng = makeRng((opts.seed >>> 0) || 1);
    const modeKey = opts.mode === 'vote' ? 'vote' : 'nomination';
    const M = Ct.MODES[modeKey];
    const place = { town: info.town, mandal: info.mandal, district: info.district };
    const text = (s, extra) => Ct.fill(s, Object.assign({}, place, extra || {}));
    const map = buildTown(townData);
    const target = modeKey === 'vote' ? map.booth : map.office;
    const docSites = modeKey === 'vote' ? [map.blo] : map.docSites.filter((s) => M.docs.includes(s.doc));

    const G = {
      tick: 0, mode: 'intro', modeT: 0, gameMode: modeKey, M, map, place, target, docSites,
      timer: M.time, elapsed: 0, score: 0, combo: { n: 0, t: 0 }, events: [],
      player: null, ents: [], barrs: [], clouds: [], posts: map.posts,
      stats: { rec: 0, crowd: 0, brk: 0, lift: 0, doc: 0, slogan: 0, goon: 0 }, missions: [], missionsDone: 0,
      result: null, alertT: 50,
    };
    let nextId = 1;
    const emit = (e) => G.events.push(e);
    const say = (who, line, extra, color) => emit({ t: 'say', id: who.id, x: who.x, y: who.y, text: text(line, extra), color });
    const toast = (s, color, extra) => emit({ t: 'toast', text: text(s, extra), color });

    // ------------------------------------------------------------ setup
    const P = {
      id: 0, kind: 'player', x: map.start.x, y: map.start.y, r: 9, vx: 0, vy: 0, fx: 0, fy: 1, kx: 0, ky: 0,
      papers: 100, stamina: 100, cases: 0, followers: [], docs: (M.given || []).slice(), sloganCd: 0, grab: 0, grabTick: -1,
      collect: null, submitT: 0, state: 'free', heldT: 0, invuln: 0, pushing: 0, running: false, sayCd: 0, inGas: false,
    };
    P.px = P.x; P.py = P.y;
    G.player = P;

    const isOpen = (k) => k === K.WALK || k === K.PARK || k === K.PLAZA || k === K.ROAD || k === K.BRIDGE;
    function randomSpot(minFromPlayer, kinds) {
      for (let tries = 0; tries < 400; tries++) {
        const tx = 3 + rng.int(N - 6), ty = 3 + rng.int(N - 6);
        const k = kindAt(map, tx, ty);
        if (!(kinds ? kinds.includes(k) : isOpen(k)) || solidAt(map, tx, ty)) continue;
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
    const nearestPost = (x, y) => { let bi = 0, bd = Infinity; G.posts.forEach((p, i) => { const d = dist(x, y, p.x, p.y); if (d < bd) { bd = d; bi = i; } }); return bi; };

    // Section 144 ring around the destination: most street crossings barricaded, a few manned checkposts
    const ring = barricadeRing(map, target.x, target.y, 15);
    const checkposts = [];
    ring.forEach((g, i) => {
      if (rng() < 0.7 || i === 0) {
        for (const j of g.tiles) map.dyn[j] = 1;
        G.barrs.push({ id: nextId++, tiles: g.tiles, x: g.x, y: g.y, hp: 100, max: 100, pushT: 0 });
      } else checkposts.push(g);
    });

    const postFields = map.posts.map((p) => field(map, [[Math.floor(p.x / TILE), Math.floor(p.y / TILE)]]));
    const civCount = opts.civilians !== undefined ? opts.civilians : 150;
    for (let i = 0; i < civCount; i++) {
      const s = randomSpot(0);
      spawn('civ', s.x, s.y, { look: rng.int(6), t: rng() * 3 });
    }
    if (opts.police !== false) {
      for (let i = 0; i < 12; i++) {
        const pi = rng.int(map.posts.length), p = map.posts[pi];
        spawn('cop', p.x + rng.range(-20, 20), p.y + rng.range(-20, 20), { mode: 'patrol', role: i < 3 ? 'gas' : 'patrol', postIdx: rng.int(map.posts.length), lathiCd: 0, gasCd: 4, seeT: 0, stunT: 0 });
      }
      for (const g of checkposts) for (let k = 0; k < 2; k++) spawn('cop', g.x + (k ? 14 : -14), g.y, { mode: 'post', role: 'post', home: { x: g.x, y: g.y }, lathiCd: 0, seeT: 0, stunT: 0 });
      for (let k = 0; k < 3; k++) spawn('cop', target.gate.x + (k - 1) * 18, target.gate.y, { mode: 'post', role: 'guard', home: { x: target.gate.x + (k - 1) * 18, y: target.gate.y }, lathiCd: 0, seeT: 0, stunT: 0 });
    }
    if (opts.goons !== false) {
      const n = modeKey === 'vote' ? 8 : 10;
      for (let i = 0; i < n; i++) {
        const pi = rng.int(map.posts.length), p = map.posts[pi];
        spawn('goon', p.x, p.y, { mode: 'patrol', postIdx: rng.int(map.posts.length), seeT: 0, stunT: 0 });
      }
      // a gang hangs around the destination ("booth capturing" on polling day)
      const m = modeKey === 'vote' ? 6 : 3;
      for (let i = 0; i < m; i++) {
        const a = (i / m) * Math.PI * 2;
        let x = target.gate.x + Math.cos(a) * 60, y = target.gate.y + Math.sin(a) * 60;
        if (solidAt(map, Math.floor(x / TILE), Math.floor(y / TILE))) { x = target.gate.x; y = target.gate.y; }
        spawn('goon', x, y, { mode: 'post', home: { x, y }, seeT: 0, stunT: 0 });
      }
    }

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

    // ------------------------------------------------------------ scoring & missions
    function gain(base, combo) {
      let mult = 1;
      if (combo) {
        const prev = G.combo.n;
        G.combo.n = G.combo.t > 0 ? Math.min(4, G.combo.n + 1) : 1;
        G.combo.t = 2.5; mult = G.combo.n;
        if (G.combo.n > prev && G.combo.n >= 2) emit({ t: 'tier', n: G.combo.n, name: Ct.TIERS[G.combo.n - 1] });
      }
      const pts = Math.round(base * mult);
      G.score += pts;
      return pts;
    }
    const statOf = (k) => (k === 'crowd' ? P.followers.length : G.stats[k]);
    function newMission() {
      const pool = Ct.MISSIONS.filter((m) => !G.missions.some((x) => x.k === m.k) && !(m.k === 'doc' && G.docSites.length < 2));
      const m = rng.pick(pool), n = rng.pick(m.n);
      return { k: m.k, n, base: m.k === 'crowd' ? 0 : G.stats[m.k], rew: m.rew + (n - m.n[0]) * 10, txt: Ct.fill(m.txt, { n, s: n === 1 ? '' : 's' }) };
    }
    function updateMissions() {
      while (G.missions.length < 3) G.missions.push(newMission());
      for (let i = 0; i < G.missions.length; i++) {
        const m = G.missions[i];
        if (statOf(m.k) - m.base >= m.n) {
          G.score += m.rew; G.missionsDone++;
          emit({ t: 'mission', text: m.txt, rew: m.rew });
          G.missions.splice(i, 1, newMission());
        }
      }
    }

    // ------------------------------------------------------------ crowd
    function join(c) {
      if (P.followers.length >= CAP || c.mode === 'follow') return false;
      c.mode = 'follow'; c.slot = P.followers.length;
      P.followers.push(c);
      G.stats.rec++;
      G.stats.crowd = Math.max(G.stats.crowd, P.followers.length);
      return true;
    }
    function leave(c, from, flee) {
      const i = P.followers.indexOf(c);
      if (i >= 0) { P.followers.splice(i, 1); P.followers.forEach((f, k) => { f.slot = k; }); }
      if (flee) { c.mode = 'flee'; c.t = 2 + rng() * 1.5; c.cool = 6; const d = norm(c.x - from.x, c.y - from.y); c.dx = d.x || 1; c.dy = d.y; }
      else c.mode = 'wander';
    }
    const shieldCount = () => { let n = 0; for (const f of P.followers) if (dist(f.x, f.y, P.x, P.y) < 70) n++; return n; };

    // ------------------------------------------------------------ player events
    function detain(cop) {
      P.state = 'held'; P.heldT = 2.6; P.cases++; P.submitT = 0; P.collect = null;
      G.timer = Math.max(0, G.timer - 10);
      const scatter = P.followers.slice(Math.ceil(P.followers.length / 2));
      for (const f of scatter) leave(f, cop, true);
      emit({ t: 'detained', cases: P.cases, x: P.x, y: P.y });
      say(P, rng.pick(Ct.LINES.detained));
      for (const e of G.ents) if (e.kind === 'cop' && e.mode === 'chase') e.mode = e.role === 'post' || e.role === 'guard' ? 'return' : 'patrol';
      if (P.cases >= CASES) end(false, 'jailed');
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
    function tearPapers(by, amount) {
      P.papers = Math.max(0, P.papers - amount);
      const k = norm(P.x - by.x, P.y - by.y);
      P.kx = k.x * 260; P.ky = k.y * 260;
      emit({ t: 'torn', amount, papers: P.papers, x: P.x, y: P.y });
      if (P.papers > 0) return;
      const doc = modeKey === 'vote' ? 'Voter Slip' : 'Form-A Nomination';
      const i = P.docs.indexOf(doc);
      P.papers = 100;
      if (i >= 0) {
        P.docs.splice(i, 1);
        const shop = G.docSites.find((s) => s.doc === doc);
        say(P, rng.pick(Ct.LINES.torn));
        toast('Your ' + doc + ' was torn! Get a fresh one at ' + (shop ? shop.name : 'the shop') + '.', '#ff8a80');
        emit({ t: 'lostdoc', doc });
      }
    }
    function end(won, reason) {
      if (G.mode === 'over' || G.mode === 'won') return;
      G.mode = won ? 'won' : 'over'; G.modeT = 0;
      if (won) {
        const timeBonus = Math.floor(G.timer) * 5, crowdBonus = P.followers.length * 20, paperBonus = Math.floor(P.papers) * 2;
        G.score += timeBonus + crowdBonus + paperBonus;
        G.bonus = { timeBonus, crowdBonus, paperBonus };
      }
      G.result = { won, reason, score: G.score, crowd: G.stats.crowd, docs: P.docs.length, missions: G.missionsDone, mode: modeKey, place: G.place, town: townId };
      emit({ t: won ? 'won' : 'over', reason });
    }

    // ------------------------------------------------------------ update: player
    function updatePlayer(inp) {
      P.invuln = Math.max(0, P.invuln - DT);
      P.sloganCd = Math.max(0, P.sloganCd - DT);
      P.sayCd -= DT;
      if (P.state === 'held') {
        P.heldT -= DT; P.vx = P.vy = 0;
        if (P.heldT <= 0 && G.mode === 'play') release();
        return;
      }
      let mx = inp.mx || 0, my = inp.my || 0;
      const mag = hypot(mx, my);
      if (mag > 1) { mx /= mag; my /= mag; }
      P.running = !!inp.run && mag > 0.2 && P.stamina > 3;
      P.stamina = clamp(P.stamina + (P.running ? -20 : 13) * DT, 0, 100);
      P.inGas = G.clouds.some((c) => dist(c.x, c.y, P.x, P.y) < c.r);
      const grabbed = P.grabTick === G.tick - 1;
      if (!grabbed) P.grab = Math.max(0, P.grab - DT * 1.5);
      const speed = (P.running ? SPEED.run : SPEED.walk) * (P.inGas ? 0.6 : 1) * (grabbed ? SPEED.held : 1);
      const ix = mx * speed + P.kx, iy = my * speed + P.ky;
      P.kx *= 0.85; P.ky *= 0.85;
      if (Math.abs(P.kx) < 1) P.kx = 0;
      if (Math.abs(P.ky) < 1) P.ky = 0;
      const ox = P.x, oy = P.y;
      P.vx = ix; P.vy = iy;
      if (mx || my) { P.fx = mx; P.fy = my; }
      moveBody(P, ix * DT, iy * DT, map);
      if (Math.floor(ox / TILE) !== Math.floor(P.x / TILE) || Math.floor(oy / TILE) !== Math.floor(P.y / TILE)) pFieldDirty = pFieldDirty || G.tick - pFieldTick > 3;

      // barricade pushing: walking into a barricade wears it down; the crowd pushes with you
      P.pushing = 0;
      const moved = dist(ox, oy, P.x, P.y), want = mag * speed * DT;
      if (mag > 0.3 && moved < want * 0.5) {
        const reach = P.r + 8, sx = Math.sign(mx), sy = Math.sign(my);
        const b = (sx && barricadeAt(P.x + sx * reach, P.y)) || (sy && barricadeAt(P.x, P.y + sy * reach)) || barricadeAt(P.x + mx * reach, P.y + my * reach);
        if (b) {
          let near = 0;
          for (const f of P.followers) if (dist(f.x, f.y, P.x, P.y) < 90) near++;
          b.hp -= (5 + 2.2 * near) * DT;
          b.pushT = 0.2; P.pushing = b.id;
          if (P.sayCd <= 0 && near >= 3) { say(P, rng.pick(Ct.LINES.barricade)); P.sayCd = 5; }
          if (b.hp <= 0) breakBarricade(b);
        }
      }

      // slogan: recruit nearby townspeople and calm scattered supporters; makes goons think twice
      if (inp.act && P.sloganCd <= 0) {
        P.sloganCd = 2.5;
        G.stats.slogan++;
        say(P, rng.pick(modeKey === 'vote' ? Ct.LINES.sloganVote : Ct.LINES.slogan), null, '#bbdefb');
        let n = 0;
        query(P.x, P.y, 150, (e) => {
          if (e.kind === 'civ' && e.mode !== 'follow' && n < 6 && P.followers.length < CAP) { if (join(e)) n++; }
          else if (e.kind === 'goon' && P.followers.length >= 4 && e.mode !== 'flee') scareGoon(e);
        });
        emit({ t: 'slogan', x: P.x, y: P.y, n });
        if (n) emit({ t: 'join', n, crowd: P.followers.length, pts: gain(10 * n, true), x: P.x, y: P.y });
      }

      // walk into people to grow your crowd; the bigger it gets, the wider the pull
      if (P.followers.length < CAP) {
        const R = P.r + 12 + Math.min(26, P.followers.length * 1.1);
        let n = 0;
        query(P.x, P.y, R, (e) => { if (e.kind === 'civ' && e.mode === 'wander' && !(e.cool > 0) && join(e)) { n++; if (n === 1 && rng() < 0.5) say(e, rng.pick(Ct.LINES.join), null, '#e3f2fd'); } });
        if (n) emit({ t: 'join', n, crowd: P.followers.length, pts: gain(10 * n, true), x: P.x, y: P.y });
      }

      // documents: stand at the shop counter for a moment
      let at = null;
      for (const s of G.docSites) if (!P.docs.includes(s.doc) && dist(P.x, P.y, s.x, s.y) < s.r + P.r) at = s;
      if (at) {
        if (!P.collect || P.collect.site !== at) P.collect = { site: at, t: 0 };
        P.collect.t += DT;
        if (P.collect.t >= 1.2) {
          P.docs.push(at.doc); P.collect = null; G.stats.doc++;
          if (at.doc === 'Form-A Nomination' || at.doc === 'Voter Slip') P.papers = 100;
          emit({ t: 'doc', doc: at.doc, x: at.x, y: at.y, pts: gain(200, false), have: G.M.docs.filter((d) => P.docs.includes(d)).length, need: G.M.docs.length });
          emit({ t: 'say', x: at.x, y: at.y - 20, text: text(rng.pick(Ct.LINES.shop)), color: '#fff9c4' });
        }
      } else P.collect = null;

      // destination: hold the counter zone with every document
      if (dist(P.x, P.y, target.x, target.y) < target.r) {
        const missing = G.M.docs.filter((d) => !P.docs.includes(d));
        if (missing.length) {
          if (P.sayCd <= 0) {
            emit({ t: 'say', x: target.x, y: target.y - 30, text: text(rng.pick(modeKey === 'vote' ? Ct.LINES.boothMissing : Ct.LINES.roMissing), { doc: missing[0] }), color: '#fff9c4' });
            toast('Missing: ' + missing.join(', '), '#ffab91');
            P.sayCd = 4;
          }
        } else {
          if (P.submitT === 0) { emit({ t: 'filing' }); say(P, rng.pick(Ct.LINES.filing)); }
          P.submitT += DT;
          if (P.submitT >= G.M.hold) end(true, 'filed');
        }
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
      emit({ t: 'break', x: b.x, y: b.y, pts: gain(250, true) });
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
      const d = dist(e.x, e.y, P.x, P.y);
      const look = e.role === 'guard' ? 190 : 220;
      if (e.mode !== 'chase' && sees(e, look)) {
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
            emit({ t: 'lift', x: e.x, y: e.y, pts: gain(150, true) });
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
          if (hit) { e.lathiCd = 1.8; emit({ t: 'lathi', x: e.x, y: e.y, n: hit }); if (rng() < 0.4) say(e, rng.pick(Ct.LINES.lathi), null, '#fff59d'); }
        }
        return;
      }
      if (e.mode === 'post') { move(e, 0, 0, 0); return; }
      if (e.mode === 'return') {
        const h = e.home;
        if (!h || dist(e.x, e.y, h.x, h.y) < 8) { e.mode = h ? 'post' : 'patrol'; move(e, 0, 0, 0); return; }
        const dir = norm(h.x - e.x, h.y - e.y);
        const r = move(e, dir.x, dir.y, SPEED.cop);
        if (r.hitX && r.hitY) { e.x = h.x; e.y = h.y; }
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
      emit({ t: 'scare', x: e.x, y: e.y, pts: gain(120, true) });
      say(e, rng.pick(Ct.LINES.goonScared), null, '#ffcdd2');
    }

    function updateGoon(e) {
      e.sayCd -= DT;
      if (e.cool > 0) e.cool -= DT;
      if (e.mode === 'flee') {
        e.t -= DT;
        const r = move(e, e.dx, e.dy, SPEED.goonChase);
        if (r.hitX) e.dx = -e.dx;
        if (r.hitY) e.dy = -e.dy;
        if (e.t <= 0) backToWork(e);
        return;
      }
      const big = P.followers.length >= 8;
      if (e.mode !== 'chase' && !(e.cool > 0) && !big && sees(e, 230)) {
        e.mode = 'chase'; e.seeT = 0;
        if (e.sayCd <= 0) { say(e, rng.pick(Ct.LINES.goon), null, '#ffcdd2'); e.sayCd = 6; }
      }
      if (e.mode === 'chase') {
        if (sees(e, 600)) e.seeT = 0; else e.seeT += DT;
        if (big && dist(e.x, e.y, P.x, P.y) < 200) { scareGoon(e); return; }
        if (P.state !== 'free' || e.seeT > 5) { backToWork(e); return; }
        const dir = steerTo(e, P.x, P.y, true);
        move(e, dir.x, dir.y, SPEED.goonChase);
        if (dist(e.x, e.y, P.x, P.y) < e.r + P.r + 3 && P.invuln <= 0) {
          if (shieldCount() >= SHIELD) scareGoon(e);
          else {
            tearPapers(e, 25);
            say(e, rng.pick(Ct.LINES.goon), null, '#ffcdd2');
            e.mode = 'flee'; e.t = 3; e.cool = 6;
            const d = norm(e.x - P.x, e.y - P.y); e.dx = d.x || 1; e.dy = d.y;
          }
        }
        return;
      }
      if (e.mode === 'post' || e.mode === 'return') {
        const h = e.home;
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
      if (G.combo.t > 0) { G.combo.t -= DT; if (G.combo.t <= 0) G.combo.n = 0; }
      for (const b of G.barrs) b.pushT = Math.max(0, b.pushT - DT);
      if (G.ents.some((e) => e.dead)) G.ents = G.ents.filter((e) => !e.dead);
      // keep the streets busy
      if (G.tick % 60 === 0) {
        let civs = 0;
        for (const e of G.ents) if (e.kind === 'civ' && e.mode !== 'follow') civs++;
        for (let k = 0; civs + k < civCount * 0.7 && k < 6; k++) { const s = randomSpot(450); spawn('civ', s.x, s.y, { look: rng.int(6), t: rng() * 3 }); }
      }
      // police backup grows with time and with your crowd
      if (opts.police !== false) {
        G.alertT -= DT * (P.followers.length >= 20 ? 1.6 : 1);
        if (G.alertT <= 0) {
          G.alertT = 45;
          const cops = G.ents.filter((e) => e.kind === 'cop').length;
          if (cops < 42) {
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
          say(P, rng.pick(modeKey === 'vote' ? Ct.LINES.startVote : Ct.LINES.start));
        }
        return;
      }
      if (G.mode !== 'play') return;
      G.timer -= DT; G.elapsed += DT;
      if (G.timer <= 0) { G.timer = 0; end(false, 'time'); return; }
      rebuildGrid();
      updatePlayer(inp);
      if (G.mode !== 'play') return;
      for (const e of G.ents) {
        if (e.dead) continue;
        if (e.kind === 'civ') updateCiv(e);
        else if (e.kind === 'cop') updateCop(e);
        else updateGoon(e);
        if (G.mode !== 'play') return;
      }
      upkeep();
      if (G.tick % 15 === 0) updateMissions();
    }

    function drainEvents() { const ev = G.events; G.events = []; return ev; }

    updateMissions();
    return { state: G, step, drainEvents, text, rng, CASES, CAP, SHIELD, _test: { join, leave, detain, breakBarricade, barricadeAt, tearPapers } };
  }

  return { createGame, EMPTY_INPUT, SPEED, CAP, CASES, SHIELD };
});
