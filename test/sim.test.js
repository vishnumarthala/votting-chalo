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
    return JSON.stringify([s.player.x, s.player.y, s.player.followers.length, s.player.cases, s.score, s.ents.length, s.barrs.length]);
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
  civs.forEach((c, i) => place(c, P.x + 60 + i * 10, P.y + 40));
  steps(g, 1, inp({ act: true }));
  assert.equal(P.followers.length, 4);
  assert.equal(g.state.stats.slogan, 1);
  steps(g, 1, inp({ act: true }));
  assert.equal(g.state.stats.slogan, 1, 'cooldown');
});

function copNextToPlayer(g) {
  const P = g.state.player;
  const cop = g.state.ents.find((e) => e.kind === 'cop' && e.role === 'patrol');
  for (const e of g.state.ents) if (e !== cop && e.kind !== 'civ') place(e, 200, 200);
  place(cop, P.x + 12, P.y);
  cop.mode = 'chase'; cop.los = true;
  return cop;
}

test('a cop must hold on to arrest you; running breaks free', () => {
  const g = play({ goons: false, civilians: 0 });
  const P = g.state.player;
  // on an open arterial: start at an intersection and run west along the road
  place(P, g.state.posts[5].x, g.state.posts[5].y);
  const cop = copNextToPlayer(g);
  steps(g, 10);
  assert.ok(P.grab > 0 && P.state === 'free', 'grabbed but not yet detained');
  steps(g, 60, inp({ mx: -1, my: 0, run: true }));
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

test('goons tear papers; at zero the latest collected document must be fetched again', () => {
  const g = play({ police: false, civilians: 0 });
  const P = g.state.player;
  const goon = g.state.ents.find((e) => e.kind === 'goon');
  assert.deepEqual(P.docs, ['Form-A Nomination']);
  P.docs.push('Affidavit', 'Caste Certificate');
  place(goon, P.x + 12, P.y); goon.mode = 'chase'; goon.los = true;
  steps(g, 1);
  assert.equal(P.papers, 75);
  g._test.tearPapers(goon, 100);
  assert.equal(P.papers, 100);
  assert.deepEqual(P.docs, ['Form-A Nomination', 'Affidavit']);
  g._test.tearPapers(goon, 100);
  g._test.tearPapers(goon, 100);
  assert.deepEqual(P.docs, ['Form-A Nomination'], 'the starting Form-A is never lost');
});

test('documents are collected by standing at the shop counter', () => {
  const g = play({ police: false, goons: false, civilians: 0 });
  const P = g.state.player, site = g.state.docSites[0];
  place(P, site.x, site.y);
  steps(g, 20);
  assert.ok(!P.docs.includes(site.doc));
  const ev = steps(g, 25);
  assert.ok(P.docs.includes(site.doc));
  assert.ok(ev.some((e) => e.t === 'doc'));
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

test('the office refuses incomplete documents; with all of them you hold the counter and win', () => {
  const g = play({ police: false, goons: false, civilians: 0 });
  const G = g.state, P = G.player;
  place(P, G.target.x, G.target.y);
  const ev = steps(g, 30 * 3);
  assert.equal(G.mode, 'play');
  assert.equal(P.submitT, 0);
  assert.ok(ev.some((e) => e.t === 'toast' && /Missing/.test(e.text)));
  P.docs.push(...G.M.docs);
  steps(g, Math.ceil(30 * G.M.hold) + 2);
  assert.equal(G.mode, 'won');
  assert.ok(G.result.won && G.bonus.timeBonus > 0);
});

test('running out of time ends the run', () => {
  const g = play({ police: false, goons: false, civilians: 0 });
  g.state.timer = 0.05;
  steps(g, 3);
  assert.equal(g.state.mode, 'over');
  assert.equal(g.state.result.reason, 'time');
});

test('polling day: voter ID in hand, slip from the BLO tent, vote at the booth', () => {
  const g = play({ mode: 'vote', police: false, goons: false, civilians: 0 });
  const G = g.state;
  assert.equal(G.target, G.map.booth);
  assert.deepEqual(G.player.docs, ['Voter ID Card']);
  assert.deepEqual(G.docSites.map((s) => s.doc), ['Voter Slip']);
});

// ---------------------------------------------------------------- stones, the Democracy meter and bystanders
const landAll = (g) => { let ev = []; for (let i = 0; i < 90 && g.state.projs.length; i++) ev = ev.concat(steps(g, 1)); return ev; };
function throwAt(g, x, y, aimRef) {
  g._test.launch({ x: x + 150, y, aimRef: aimRef || null });
  const pj = g.state.projs[g.state.projs.length - 1];
  pj.x1 = x; pj.y1 = y;
  return pj;
}

test('a stone on the candidate tears papers, dazes, drains stamina, scatters supporters and hurts democracy', () => {
  const g = play({ police: false, goons: false, civilians: 20 });
  const G = g.state, P = G.player;
  for (const c of loneMen(g).slice(0, 2)) { g._test.join(c); place(c, P.x + 20, P.y); }
  throwAt(g, P.x, P.y);
  const ev = landAll(g);
  assert.ok(ev.some((e) => e.t === 'throw') || G.stats.thrown === 1);
  assert.ok(ev.some((e) => e.t === 'hit'));
  assert.equal(P.papers, 88);
  assert.ok(P.daze > 0 && P.stamina <= 81);
  assert.equal(P.followers.length, 0, 'nearby supporters scattered');
  assert.equal(G.demo, 96);
  assert.equal(G.stats.hits, 1);
});

test('zig-zagging dodges more throws than standing still', () => {
  const run = (zig) => {
    const g = play({ police: false, goons: false, civilians: 0 });
    const G = g.state, P = G.player;
    place(P, G.posts[5].x, G.posts[5].y);
    let hits = 0;
    for (let k = 0; k < 12; k++) {
      P.invuln = 0; P.daze = 0; P.papers = 100;
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

test('the Democracy meter floors at 5, stages fire once, and broken barricades lift it', () => {
  const g = play({ police: false, goons: false, civilians: 0 });
  const G = g.state;
  let ev = (g._test.demo(-200), g.drainEvents());
  assert.equal(G.demo, 5);
  assert.deepEqual(ev.filter((e) => e.t === 'demostage').map((e) => e.stage), [1, 2, 3, 4]);
  ev = (g._test.demo(-10), g.drainEvents());
  assert.equal(ev.filter((e) => e.t === 'demostage').length, 0);
  g._test.breakBarricade(G.barrs[0]);
  assert.equal(G.demo, 8);
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

test('the result carries what the front page needs', () => {
  const g = play({ police: false, goons: false, civilians: 0 });
  g.state.timer = 0.05;
  steps(g, 3);
  const r = g.state.result;
  for (const k of ['demo', 'thrown', 'hits', 'civHurt', 'protected', 'arrests', 'barricades', 'closest', 'goal']) assert.ok(k in r, k);
  assert.ok(r.closest > 0);
});

for (const mode of ['nomination', 'vote']) {
  test(`a route-following bot completes ${mode} on several towns when police and goons are off`, () => {
    for (const seed of [3, 17, 404, 2024]) {
      const g = S.createGame({ seed, mode, police: false, goons: false });
      const bot = makeBot(g);
      let n = 0;
      while ((g.state.mode === 'intro' || g.state.mode === 'play') && n < 30 * 600) { g.step(bot()); g.drainEvents(); n++; }
      assert.equal(g.state.mode, 'won', `seed ${seed}: ${g.state.result && g.state.result.reason}`);
    }
  });
}
