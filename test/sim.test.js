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
  const g = S.createGame(Object.assign({ seed: 5, town: 'pulivendula' }, opts));
  g.step(NONE);
  for (let i = 0; i < 30 && g.state.mode === 'intro'; i++) g.step(inp({ act: i > 20 }));
  assert.equal(g.state.mode, 'play');
  g.drainEvents();
  return g;
}
const steps = (g, n, input) => { for (let i = 0; i < n; i++) g.step(input || NONE); return g.drainEvents(); };
const place = (e, x, y) => { e.x = x; e.y = y; e.px = x; e.py = y; };

test('intro waits briefly, then any move starts play', () => {
  const g = S.createGame({ seed: 1, town: 'pulivendula' });
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
  const civ = g.state.ents.find((e) => e.kind === 'civ');
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
  const civs = g.state.ents.filter((e) => e.kind === 'civ').slice(0, 4);
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

// a patrol post with a clear run of road to its west, so the player can run away from a cop standing east of it
function postWithRoadWest(map) {
  return map.posts.find((p) => {
    const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
    for (let dx = -14; dx <= 1; dx++) if (W.solidAt(map, tx + dx, ty)) return false;
    return true;
  });
}

test('a cop must hold on to arrest you; running breaks free', () => {
  const g = play({ goons: false, civilians: 0 });
  const P = g.state.player;
  const post = postWithRoadWest(g.state.map);
  assert.ok(post, 'a post with a clear road to its west');
  place(P, post.x, post.y);
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
  const g = play({ goons: false, civilians: 10 });
  const P = g.state.player;
  const civs = g.state.ents.filter((e) => e.kind === 'civ').slice(0, 4);
  for (const c of civs) { g._test.join(c); place(c, P.x - 10, P.y + 10); }
  const cop = copNextToPlayer(g);
  const ev = steps(g, 1);
  assert.ok(ev.some((e) => e.t === 'lift'));
  assert.equal(cop.mode, 'stun');
  assert.equal(P.followers.length, 3);
  assert.equal(P.cases, 0);
});

test('goons tear papers; at zero the Form-A must be fetched again', () => {
  const g = play({ police: false, civilians: 0 });
  const P = g.state.player;
  const goon = g.state.ents.find((e) => e.kind === 'goon');
  P.docs.push('Form-A Nomination', 'Affidavit');
  place(goon, P.x + 12, P.y); goon.mode = 'chase'; goon.los = true;
  steps(g, 1);
  assert.equal(P.papers, 75);
  g._test.tearPapers(goon, 100);
  assert.equal(P.papers, 100);
  assert.deepEqual(P.docs, ['Affidavit']);
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

for (const mode of ['nomination', 'vote']) {
  test(`T-4 a route-following bot completes ${mode} in Pulivendula when police, goons and mobs are off`, () => {
    for (const seed of [1, 3, 17, 404, 2024]) {
      const g = S.createGame({ seed, town: 'pulivendula', mode, police: false, goons: false, mobs: false });
      assert.equal(g.state.place.town, 'Pulivendula');
      const bot = makeBot(g);
      let n = 0;
      while ((g.state.mode === 'intro' || g.state.mode === 'play') && n < 30 * 600) { g.step(bot()); g.drainEvents(); n++; }
      assert.equal(g.state.mode, 'won', `seed ${seed}: ${g.state.result && g.state.result.reason}`);
      assert.equal(g.state.result.won, true);
    }
  });
}
