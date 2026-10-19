'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../shared/sim.js');
const W = require('../shared/world.js');
const { makeBot } = require('./bot.js');
const { TILE, N } = W;

const NONE = S.EMPTY_INPUT;
const inp = (o) => Object.assign({}, NONE, o);
function play(opts) {
  const g = S.createGame(Object.assign({ seed: 5, place: { town: 'Testpur', mandal: 'Testmandal', district: 'Testdist', pin: '522001' } }, opts));
  g.step(NONE);
  for (let i = 0; i < 30 && g.state.mode === 'intro'; i++) g.step(inp({ act: i > 20 }));
  assert.equal(g.state.mode, 'play');
  g.drainEvents();
  return g;
}
const steps = (g, n, input) => { for (let i = 0; i < n; i++) g.step(input || NONE); return g.drainEvents(); };
const place = (e, x, y) => { e.x = x; e.y = y; e.px = x; e.py = y; };
const loneMen = (g) => g.state.ents.filter((e) => e.kind === 'civ' && e.type === 'man' && e.mode === 'wander');

test('intro waits briefly, then any move starts play', () => {
  const g = S.createGame({ seed: 1 });
  steps(g, 5, inp({ mx: 1 }));
  assert.equal(g.state.mode, 'intro');
  steps(g, 20, inp({ mx: 1 }));
  assert.equal(g.state.mode, 'play');
});

test('same seed and inputs give the same game', () => {
  const run = () => {
    const g = play({ seed: 9 });
    const bot = makeBot(g);
    for (let i = 0; i < 1500; i++) g.step(bot());
    const s = g.state;
    return JSON.stringify([s.player.x, s.player.y, s.player.followers.length, s.player.cases, s.demo, s.ents.length, s.barrs.length]);
  };
  assert.equal(run(), run());
});

test('walking into townspeople recruits them; the crowd is capped', () => {
  const g = play({ police: false, goons: false, civilians: 40 });
  const P = g.state.player;
  const civ = loneMen(g)[0];
  place(civ, P.x + 8, P.y);
  const ev = steps(g, 1);
  assert.equal(P.followers.length, 1);
  assert.ok(ev.some((e) => e.t === 'join'));
  for (const c of g.state.ents) if (c.kind === 'civ' && c.mode !== 'follow') place(c, P.x, P.y);
  steps(g, 1);
  assert.equal(P.followers.length, S.CAP);
});

test('a slogan pulls in people nearby', () => {
  const g = play({ police: false, goons: false, civilians: 20 });
  const P = g.state.player;
  const civs = loneMen(g).slice(0, 4);
  const far = g.state.posts[0];
  for (const c of g.state.ents) if (c.kind === 'civ' && !civs.includes(c)) place(c, far.x, far.y);
  civs.forEach((c, i) => place(c, P.x + 60 + i * 10, P.y + 40));
  steps(g, 1, inp({ act: true }));
  assert.equal(P.followers.length, 4);
  assert.equal(g.state.stats.slogan, 1);
  steps(g, 1, inp({ act: true }));
  assert.equal(g.state.stats.slogan, 1, 'cooldown');
});

// a street crossing with a long straight run of open street in one direction
function openRun(g, px) {
  const map = g.state.map;
  for (const p of g.state.posts) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    let ok = true;
    for (let d = 0; d <= px && ok; d += 8) if (W.solidPx(map, p.x + dx * d, p.y + dy * d)) ok = false;
    if (ok) return { x: p.x, y: p.y, dx, dy };
  }
  return null;
}
function copNextToPlayer(g, from) {
  const P = g.state.player, f = from || { dx: -1, dy: 0 };
  const cop = g.state.ents.find((e) => e.kind === 'cop' && e.role === 'patrol');
  for (const e of g.state.ents) if (e !== cop && e.kind !== 'civ') place(e, 200, 200);
  place(cop, P.x - f.dx * 12, P.y - f.dy * 12);
  cop.mode = 'chase'; cop.los = true;
  return cop;
}

test('a cop must hold on to arrest you; running breaks free', () => {
  const g = play({ goons: false, civilians: 0 });
  const P = g.state.player;
  // start at a crossing with a long open street ahead and run down it
  const run = openRun(g, 300);
  assert.ok(run, 'found an open street');
  place(P, run.x, run.y);
  const cop = copNextToPlayer(g, run);
  steps(g, 10);
  assert.ok(P.grab > 0 && P.state === 'free', 'grabbed but not yet detained');
  steps(g, 60, inp({ mx: run.dx, my: run.dy, run: true }));
  assert.equal(P.state, 'free');
  assert.equal(P.cases, 0);
  assert.ok(W.dist(P.x, P.y, cop.x, cop.y) > 40, 'got away');
});

test('standing still in a cop\u2019s grip gets you detained; three cases and you are jailed', () => {
  const g = play({ goons: false, civilians: 0 });
  const P = g.state.player;
  for (let k = 1; k <= 3; k++) {
    copNextToPlayer(g);
    P.invuln = 0;
    let ev = [];
    for (let i = 0; i < 60 && P.state === 'free'; i++) ev = ev.concat(steps(g, 1));
    assert.ok(ev.some((e) => e.t === 'detained'), 'detained ' + k);
    assert.equal(P.cases, k);
    if (k < 3) { steps(g, 90); assert.equal(P.state, 'free'); }
  }
  assert.equal(g.state.mode, 'over');
  assert.equal(g.state.result.reason, 'jailed');
});

test('three supporters close by lift the cop away, at the cost of one supporter', () => {
  const g = play({ goons: false, civilians: 20 });
  const P = g.state.player;
  const civs = loneMen(g).slice(0, 4);
  for (const c of civs) { g._test.join(c); place(c, P.x - 10, P.y + 10); }
  const cop = copNextToPlayer(g);
  const ev = steps(g, 1);
  assert.ok(ev.some((e) => e.t === 'lift'));
  assert.equal(cop.mode, 'stun');
  assert.equal(P.followers.length, 3);
  assert.equal(P.cases, 0);
});

test('a goon attack shoves the candidate and costs democracy 8%', () => {
  const g = play({ police: false, civilians: 0 });
  const G = g.state, P = G.player;
  const goon = G.ents.find((e) => e.kind === 'goon' && e.mode === 'patrol');
  place(goon, P.x + 12, P.y); goon.mode = 'chase'; goon.los = true;
  const ev = steps(g, 1);
  assert.ok(ev.some((e) => e.t === 'attacked'));
  assert.equal(G.demo, 92);
  assert.ok(P.kx < 0, 'knocked away from the goon');
  assert.equal(goon.mode, 'flee');
});

function barricadeSide(g) {
  const map = g.state.map;
  for (const b of g.state.barrs) for (const j of b.tiles) {
    const tx = j % N, ty = Math.floor(j / N);
    for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = tx + ox, ny = ty + oy;
      if (!W.solidAt(map, nx, ny) && !W.solidAt(map, nx + ox, ny + oy)) return { b, x: (nx + 0.5) * TILE, y: (ny + 0.5) * TILE, dx: -ox, dy: -oy };
    }
  }
  return null;
}
function pushTime(withCrowd) {
  const g = play({ police: false, goons: false, civilians: 20 });
  const P = g.state.player, s = barricadeSide(g);
  assert.ok(s, 'found a barricade side');
  place(P, s.x, s.y);
  if (withCrowd) for (const c of g.state.ents.filter((e) => e.kind === 'civ').slice(0, 12)) { g._test.join(c); place(c, P.x, P.y); }
  let n = 0;
  while (g.state.barrs.includes(s.b) && n < 30 * 40) { g.step(inp({ mx: s.dx, my: s.dy })); n++; }
  assert.ok(!g.state.barrs.includes(s.b), 'broken');
  const j = s.b.tiles[0];
  assert.equal(g.state.map.dyn[j], 0, 'tiles cleared');
  return n;
}
test('barricades fall to pushing, much faster with a crowd', () => {
  const alone = pushTime(false), crowd = pushTime(true);
  assert.ok(crowd * 2 < alone, `crowd ${crowd} vs alone ${alone}`);
});

test('holding the counter files the nomination, and it is rejected anyway: democracy flatlines', () => {
  const g = play({ police: false, goons: false, civilians: 0, gate: false });
  const G = g.state, P = G.player;
  place(P, G.target.x, G.target.y);
  let ev = steps(g, 30 * 3);
  assert.equal(G.mode, 'play');
  assert.ok(P.submitT > 0);
  ev = ev.concat(steps(g, Math.ceil(30 * G.M.hold)));
  assert.equal(G.mode, 'over');
  assert.equal(G.result.reason, 'rejected');
  assert.ok(G.result.why && /Rejected/.test(G.result.why));
  assert.ok(G.result.demo > 0, 'the result keeps the meter as it was on arrival');
  assert.equal(G.demo, 0);
  assert.ok(ev.some((e) => e.t === 'rejected'));
});

test('when democracy hits 0% the run ends', () => {
  const g = play({ police: false, goons: false, civilians: 0 });
  const G = g.state;
  g._test.demo(-99);
  assert.equal(G.mode, 'play');
  g._test.demo(-5);
  assert.equal(G.demo, 0);
  assert.equal(G.mode, 'over');
  assert.equal(G.result.reason, 'killed');
  assert.ok(g.drainEvents().some((e) => e.t === 'over' && e.reason === 'killed'));
});

test('there is no clock: standing around does not end the run', () => {
  const g = play({ police: false, goons: false, civilians: 0 });
  steps(g, 30 * 600);
  assert.equal(g.state.mode, 'play');
});

// ---------------------------------------------------------------- stones, the Democracy meter and bystanders
const landAll = (g) => { let ev = []; for (let i = 0; i < 90 && g.state.projs.length; i++) ev = ev.concat(steps(g, 1)); return ev; };
function throwAt(g, x, y, aimRef) {
  g._test.launch({ x: x + 150, y, aimRef: aimRef || null });
  const pj = g.state.projs[g.state.projs.length - 1];
  pj.x1 = x; pj.y1 = y;
  return pj;
}

test('a stone on the candidate knocks back, dazes, drains stamina, scatters supporters and hurts democracy', () => {
  const g = play({ police: false, goons: false, civilians: 20 });
  const G = g.state, P = G.player;
  for (const c of loneMen(g).slice(0, 2)) { g._test.join(c); place(c, P.x + 20, P.y); }
  throwAt(g, P.x, P.y);
  const ev = landAll(g);
  assert.ok(ev.some((e) => e.t === 'throw') || G.stats.thrown === 1);
  assert.ok(ev.some((e) => e.t === 'hit'));
  assert.ok(P.daze > 0 && P.stamina <= 81);
  assert.equal(P.followers.length, 0, 'nearby supporters scattered');
  assert.equal(G.demo, 94);
  assert.equal(G.stats.hits, 1);
});

test('zig-zagging dodges more throws than standing still', () => {
  const run = (zig) => {
    const g = play({ police: false, goons: false, civilians: 0 });
    const G = g.state, P = G.player;
    place(P, G.posts[5].x, G.posts[5].y);
    let hits = 0;
    for (let k = 0; k < 12; k++) {
      P.invuln = 0; P.daze = 0;
      const before = G.stats.hits;
      g._test.launch({ x: P.x, y: P.y - 200, aimRef: null });
      for (let i = 0; G.projs.length && i < 90; i++) steps(g, 1, zig ? inp({ mx: Math.floor(i / 9) % 2 ? 1 : -1 }) : NONE);
      hits += G.stats.hits - before;
    }
    return hits;
  };
  const still = run(false), zig = run(true);
  assert.ok(zig < still, `zig ${zig} vs still ${still}`);
});

test('with three supporters close, one may take the stone for the candidate', () => {
  const g = play({ police: false, goons: false, civilians: 30 });
  const G = g.state, P = G.player;
  const men = loneMen(g).slice(0, 5);
  let shielded = null;
  for (let k = 0; k < 8 && !shielded; k++) {
    for (const c of men) if (c.mode !== 'follow' && c.mode !== 'hurt' && c.mode !== 'home') { g._test.join(c); }
    for (const c of P.followers) place(c, P.x + 10, P.y + 10);
    P.invuln = 0;
    throwAt(g, P.x, P.y);
    const ev = landAll(g);
    const sh = ev.find((e) => e.t === 'shield');
    if (sh) shielded = sh;
  }
  assert.ok(shielded, 'a supporter shielded the candidate');
  assert.ok(G.ents.some((e) => e.kind === 'civ' && e.type === 'man' && (e.mode === 'hurt' || e.mode === 'home')));
  assert.equal(G.stats.civHurt, 0, 'adult supporters are not counted as women or children');
});

test('Democracy stages fire once on the way down, and broken barricades lift it', () => {
  const g = play({ police: false, goons: false, civilians: 0 });
  const G = g.state;
  let ev = (g._test.demo(-95), g.drainEvents());
  assert.equal(G.demo, 5);
  assert.deepEqual(ev.filter((e) => e.t === 'demostage').map((e) => e.stage), [1, 2, 3, 4]);
  ev = (g._test.demo(-1), g.drainEvents());
  assert.equal(ev.filter((e) => e.t === 'demostage').length, 0);
  g._test.breakBarricade(G.barrs[0]);
  assert.equal(G.demo, 7);
});

function lonelyChild(g, x, y) {
  const k = g.state.ents.find((e) => e.kind === 'civ' && e.type === 'child' && e.mode === 'wander');
  if (k.guardRef) { k.guardRef.kidRef = null; k.guardRef = null; }
  place(k, x, y);
  k.t = 99; k.dx = 0; k.dy = 0; // standing still
  return k;
}

test('stones hit women and children too: they are hurt, led home, and police look away', () => {
  const g = play({ goons: false, civilians: 60 });
  const G = g.state, P = G.player;
  const kid = lonelyChild(g, P.x + 400, P.y);
  const cop = G.ents.find((e) => e.kind === 'cop' && e.role === 'patrol');
  place(cop, kid.x + 60, kid.y); cop.mode = 'patrol';
  throwAt(g, kid.x, kid.y, kid);
  const ev = landAll(g);
  assert.ok(ev.some((e) => e.t === 'civhit' && e.type === 'child'));
  assert.equal(kid.mode, 'hurt');
  assert.equal(G.stats.civHurt, 1);
  assert.equal(G.demo, 94);
  assert.ok(cop.ignoreT > 0, 'the cop turns away');
  steps(g, 30 * 4);
  assert.equal(kid.mode, 'home');
  assert.ok(kid.bandage);
  steps(g, 30 * 7);
  assert.ok(!G.ents.includes(kid), 'gone home');
});

test('the candidate stepping in front of a child takes the stone instead', () => {
  const g = play({ police: false, goons: false, civilians: 60 });
  const G = g.state, P = G.player;
  const kid = lonelyChild(g, P.x + 8, P.y);
  G.demo = 50;
  throwAt(g, kid.x, kid.y, kid);
  const ev = landAll(g);
  assert.ok(ev.some((e) => e.t === 'protect' && !e.crowd));
  assert.notEqual(kid.mode, 'hurt');
  assert.equal(G.stats.civHurt, 0);
  assert.equal(G.stats.protected, 1);
  assert.equal(G.demo, 52);
});

test('a slogan makes the crowd close ranks around women and children', () => {
  const g = play({ police: false, goons: false, civilians: 60 });
  const G = g.state, P = G.player;
  steps(g, 1, inp({ act: true }));
  assert.ok(P.guardT > 0);
  const kid = lonelyChild(g, P.x + 70, P.y);
  throwAt(g, kid.x, kid.y, kid);
  const ev = landAll(g);
  assert.ok(ev.some((e) => e.t === 'protect' && e.crowd));
  assert.notEqual(kid.mode, 'hurt');
  assert.equal(G.stats.civHurt, 0);
});

test('nothing the player does can hurt a civilian', () => {
  for (const seed of [3, 404]) {
    const g = S.createGame({ seed, goons: false });
    const bot = makeBot(g);
    for (let n = 0; n < 30 * 120 && (g.state.mode === 'intro' || g.state.mode === 'play'); n++) { g.step(bot()); g.drainEvents(); }
    assert.equal(g.state.stats.civHurt, 0);
    assert.ok(!g.state.ents.some((e) => e.kind === 'civ' && e.mode === 'hurt'));
  }
});

test('the result carries what the end screen needs', () => {
  const g = play({ police: false, goons: false, civilians: 0 });
  g._test.demo(-100);
  const r = g.state.result;
  for (const k of ['reason', 'demo', 'crowd', 'thrown', 'hits', 'civHurt', 'protected', 'arrests', 'barricades', 'closest', 'goal', 'time', 'gateStops', 'stalls', 'frisks']) assert.ok(k in r, k);
  assert.ok(r.closest > 0);
});

// ---------------------------------------------------------------- the gate showdown
const out = (g, d) => { const T = g.state.target; return { x: T.gate.x + T.out.x * d, y: T.gate.y + T.out.y * d }; };
const only = (g, keep) => { g.state.ents = g.state.ents.filter((e) => e.kind === 'civ' || e.kind === 'official' || keep(e)); };
function shutGate(g) {
  const P = g.state.player, G = g.state;
  const a = out(g, 180); place(P, a.x, a.y); steps(g, 1);
  if (G.gate.line) { g._test.breakBarricade(G.gate.line); steps(g, 1); }
  const b = out(g, 90); place(P, b.x, b.y); steps(g, 1);
  assert.equal(G.gate.phase, 'shut');
}

test('a police line forms at the gate; a crowd pushes through far faster than one person, under lathis', () => {
  const push = (crowd) => {
    const g = play({ goons: false, civilians: 60 });
    const G = g.state, P = G.player, T = G.target;
    only(g, () => false);
    const a = out(g, 72); place(P, a.x, a.y);
    if (crowd) for (const c of loneMen(g).slice(0, 10)) { g._test.join(c); place(c, P.x + T.out.x * 10, P.y + T.out.y * 10); }
    let ev = steps(g, 1);
    assert.equal(G.gate.phase, 'line');
    const line = G.gate.line;
    assert.equal(line.kind, 'police');
    assert.equal(G.map.dyn[line.tiles[0]], 3);
    let n = 0;
    while (G.barrs.includes(line) && n < 30 * 20) { ev = ev.concat(steps(g, 1, inp({ mx: -T.out.x, my: -T.out.y }))); n++; }
    return { broken: !G.barrs.includes(line), n, lathi: ev.some((e) => e.t === 'lathi') };
  };
  const alone = push(false), crowd = push(true);
  assert.ok(!alone.broken, 'one person cannot break the line in 20 s');
  assert.ok(crowd.broken && crowd.n < 30 * 8, `crowd broke it in ${crowd.n} ticks`);
  assert.ok(crowd.lathi, 'the line lathis supporters');
});

test('the gate shuts in your face; 4 slogans with 8+ supporters open it, a small crowd cannot', () => {
  const g = play({ police: false, goons: false, civilians: 60 });
  const G = g.state, P = G.player;
  shutGate(g);
  for (const j of G.gate.tiles) assert.equal(G.map.dyn[j], 2);
  assert.equal(G.map.dyn[G.gate.wicket.tile], 0, 'the side wicket is left open');
  const men = loneMen(g);
  for (const c of men.slice(0, 3)) { g._test.join(c); place(c, P.x, P.y); }
  let ev = steps(g, 1, inp({ act: true }));
  assert.equal(G.gate.pressure, 0);
  assert.ok(ev.some((e) => e.t === 'needcrowd' && e.need === 8));
  for (const c of men.slice(3, 12)) { g._test.join(c); place(c, P.x, P.y); }
  steps(g, 80); // slogan cooldown
  ev = [];
  for (let k = 0; k < 4; k++) { ev = ev.concat(steps(g, 1, inp({ act: true }))); ev = ev.concat(steps(g, 80)); }
  assert.equal(G.gate.phase, 'open');
  assert.ok(ev.some((e) => e.t === 'gateopen'));
  for (const j of G.gate.tiles) assert.equal(G.map.dyn[j], 0);
});

test('with the gate shut, the side wicket still leads to the counter', () => {
  const g = play({ police: false, goons: false, civilians: 0 });
  const G = g.state, T = G.target;
  const before = W.field(G.map, [[Math.floor(T.x / TILE), Math.floor(T.y / TILE)]]);
  const w = T.wicket;
  shutGate(g);
  const f = W.field(G.map, [[Math.floor(T.x / TILE), Math.floor(T.y / TILE)]]);
  const o = out(g, 96), oi = Math.floor(o.y / TILE) * N + Math.floor(o.x / TILE);
  assert.ok(f[oi] > 0, 'reachable from outside the gate');
  assert.ok(f[oi] > before[oi], 'but the way round is longer');
  assert.ok(f[w.tile] > 0, 'through the wicket');
});

test('the gate and the police line part for the ruling front\u2019s guests, the police salute, and you can slip in behind', () => {
  const g = play({ civilians: 0 });
  const G = g.state, P = G.player, T = G.target;
  only(g, (e) => e.role === 'vip' || e.role === 'guard' && !e.wicketCop);
  shutGate(g);
  const vip = G.ents.find((e) => e.role === 'vip');
  const v = out(g, 50); place(vip, v.x, v.y); vip.wp = 1; vip.dir = 1; vip.wait = 0;
  const ev = steps(g, 1);
  assert.ok(G.gate.openT > 0);
  assert.ok(ev.some((e) => e.t === 'vipgate'));
  assert.ok(G.ents.some((e) => e.kind === 'cop' && e.salute > 0), 'a cop salutes');
  for (const j of G.gate.tiles) assert.equal(G.map.dyn[j], 0);
  const a = out(g, 36); place(P, a.x, a.y);
  for (let i = 0; i < 40 && !G.gate.inside; i++) steps(g, 1, inp({ mx: -T.out.x, my: -T.out.y }));
  assert.ok(G.gate.inside, 'slipped in');
});

test('only the candidate and four supporters go in; the rest wait at the gate and rejoin outside', () => {
  const g = play({ police: false, goons: false, civilians: 60 });
  const G = g.state, P = G.player, T = G.target;
  for (const c of loneMen(g).slice(0, 9)) g._test.join(c);
  const inPt = { x: T.gate.x - T.out.x * 50, y: T.gate.y - T.out.y * 50 };
  place(P, inPt.x, inPt.y);
  for (const f of P.followers) place(f, P.x, P.y);
  const ev = steps(g, 1);
  assert.ok(G.gate.inside);
  assert.equal(P.followers.filter((f) => f.inner !== false).length, 4);
  assert.ok(ev.some((e) => e.t === 'four' && e.waiting === 5));
  steps(g, 30 * 6);
  const insideNow = P.followers.filter((f) => g._test.inCompound(f.x, f.y)).length;
  assert.ok(insideNow <= 4, `${insideNow} supporters inside`);
  assert.equal(P.followers.length, 9, 'the others are still your supporters');
  const o = out(g, 150); place(P, o.x, o.y);
  steps(g, 1);
  assert.ok(!G.gate.inside);
  assert.ok(P.followers.every((f) => f.inner !== false));
});

test('papers are checked once per entry; the side wicket check is harsher', () => {
  const enter = (via) => {
    const g = play({ goons: false, civilians: 0 });
    const G = g.state, P = G.player, T = G.target;
    only(g, () => false);
    if (via === 'wicket') shutGate(g);
    const w = T.wicket, at = via === 'wicket' ? { x: w.x - w.out.x * 40, y: w.y - w.out.y * 40 } : { x: T.gate.x - T.out.x * 40, y: T.gate.y - T.out.y * 40 };
    place(P, at.x, at.y);
    const ev = steps(g, 1);
    return { g, G, P, ev };
  };
  const a = enter('gate');
  assert.equal(a.P.state, 'frisk');
  assert.ok(a.ev.some((e) => e.t === 'frisk' && !e.wicket));
  steps(a.g, 30 * 3);
  assert.equal(a.P.state, 'free');
  assert.equal(a.G.gate.frisks, 1, 'once per entry');
  const b = enter('wicket');
  assert.equal(b.P.state, 'frisk');
  assert.ok(b.P.friskT > 2.5);
});

test('the clerk stalls the filing twice; four proposers inside halve each stall', () => {
  const file = (proposers) => {
    const g = play({ police: false, goons: false, civilians: 60 });
    const G = g.state, P = G.player;
    if (proposers) for (const c of loneMen(g).slice(0, 4)) g._test.join(c);
    place(P, G.target.x, G.target.y);
    for (const f of P.followers) place(f, P.x + 10, P.y + 10);
    let n = 0, ev = [];
    while (G.mode === 'play' && n < 30 * 30) { ev = ev.concat(steps(g, 1)); n++; }
    assert.equal(G.result.reason, 'rejected');
    assert.equal(G.gate.stalls, 2);
    assert.ok(ev.some((e) => e.t === 'stall'));
    return n;
  };
  const alone = file(false), withProps = file(true), base = Math.ceil(30 * 6);
  assert.ok(alone > base + 30 * 4, `alone ${alone}`);
  assert.ok(withProps < alone - 30, `with proposers ${withProps} vs ${alone}`);
});

test('gate guards who chased you outside find their way back in, even with the gate shut', () => {
  const g = play({ goons: false, civilians: 0 });
  const G = g.state, P = G.player, T = G.target;
  place(P, 60, 60);
  G.gate.phase = 'shut'; G.gate.shut = true; G.gate.wicketOpen = true;
  const guards = G.ents.filter((e) => e.role === 'guard');
  const o = out(g, 150);
  for (const e of guards) { place(e, o.x, o.y); e.mode = 'return'; }
  steps(g, 30 * 40);
  for (const e of guards) assert.ok(W.dist(e.x, e.y, e.home.x, e.home.y) < 10, 'guard got home');
});

test('a route-following bot walks the maze to the office on several towns when police and goons are off', () => {
  for (const seed of [3, 17, 404, 2024]) {
    const g = S.createGame({ seed, police: false, goons: false });
    const bot = makeBot(g);
    let n = 0;
    while ((g.state.mode === 'intro' || g.state.mode === 'play') && n < 30 * 300) { g.step(bot()); g.drainEvents(); n++; }
    assert.equal(g.state.mode, 'over', `seed ${seed}: still playing`);
    assert.equal(g.state.result.reason, 'rejected', `seed ${seed}: ${g.state.result.reason}`);
  }
});

test('easy mode (touch devices) makes every democracy loss 25% smaller', () => {
  const hard = play({ police: false, goons: false, civilians: 0 });
  const easy = play({ police: false, goons: false, civilians: 0, easy: true });
  hard._test.demo(-8); easy._test.demo(-8);
  assert.equal(hard.state.demo, 92);
  assert.equal(easy.state.demo, 94);
  easy._test.demo(3);
  assert.equal(easy.state.demo, 97, 'gains are unchanged');
});
