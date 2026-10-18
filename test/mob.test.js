'use strict';
// CP-3: TDP mobs throw stones, police escort them, a big crowd drives them back, and replays stay deterministic.
// All cases go through the simulation's public seam: createGame, step, state and drainEvents.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../shared/sim.js');
const W = require('../shared/world.js');
const { TILE, N, WORLD } = W;
const MOB_ESCORT = 260; // AC-6: police this close to a rioting mob escort it

const NONE = S.EMPTY_INPUT;
const inp = (o) => Object.assign({}, NONE, o);
const place = (e, x, y) => { e.x = x; e.y = y; e.px = x; e.py = y; };

function play(opts) {
  const g = S.createGame(Object.assign({ seed: 5, town: 'pulivendula' }, opts));
  g.step(NONE);
  for (let i = 0; i < 30 && g.state.mode === 'intro'; i++) g.step(inp({ act: i > 20 }));
  assert.equal(g.state.mode, 'play');
  g.drainEvents();
  return g;
}

// A spot on a straight, 3-tile-thick open band with `left` open tiles to its west and `right` to its east.
function openRow(map, left, right) {
  for (let ty = 4; ty < N - 4; ty++) {
    for (let tx = left + 2; tx < N - right - 2; tx++) {
      let clear = true;
      for (let k = -left; k <= right && clear; k++) for (let dy = -1; dy <= 1; dy++) if (W.solidAt(map, tx + k, ty + dy)) { clear = false; break; }
      if (clear) return { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
    }
  }
  throw new Error('no open row of ' + (left + right + 1) + ' tiles');
}

const membersOf = (G, mob) => G.ents.filter((e) => e.kind === 'mob' && e.mob === mob.id);

// Moves everything that is not part of the scenario to the map corner farthest from it.
function parkOthers(G, keep, at) {
  const corners = [[200, 200], [WORLD - 200, 200], [200, WORLD - 200], [WORLD - 200, WORLD - 200]];
  const far = corners.reduce((a, b) => (W.dist(a[0], a[1], at.x, at.y) > W.dist(b[0], b[1], at.x, at.y) ? a : b));
  for (const e of G.ents) if (!keep.includes(e)) place(e, far[0], far[1]);
}

// Recruits the first n townspeople and stands them on the candidate.
function recruit(g, n) {
  const P = g.state.player;
  const civs = g.state.ents.filter((e) => e.kind === 'civ').slice(0, n);
  assert.equal(civs.length, n, 'enough townspeople to recruit');
  for (const c of civs) { g._test.join(c); place(c, P.x, P.y); }
  assert.equal(P.followers.length, n);
  return civs;
}

test('T-9 a stone hit tears 10 points of papers, scatters up to 2 supporters and stuns the candidate for 15 ticks', () => {
  const g = play({ police: false, goons: false, civilians: 4 });
  const G = g.state, P = G.player;
  const row = openRow(G.map, 6, 8);
  assert.ok(G.mobs && G.mobs.length > 0, 'the game has TDP mobs');
  const thrower = membersOf(G, G.mobs[0])[0];
  assert.ok(thrower, 'a mob member');

  place(P, row.x, row.y);
  const supporters = recruit(g, 4);
  supporters.forEach((c, i) => place(c, row.x + (i - 1.5) * 14, row.y));
  place(thrower, row.x + 150, row.y);
  parkOthers(G, [P, thrower, ...supporters], row);
  assert.ok(W.lineOfSight(G.map, thrower.x, thrower.y, P.x, P.y), 'clear line of sight');
  assert.equal(P.papers, 100);

  let hit = null;
  for (let i = 0; i < 30 * 10 && !hit; i++) { g.step(NONE); hit = g.drainEvents().find((e) => e.t === 'stone' && e.hit); }
  assert.ok(hit, 'a stone hit the candidate');
  assert.equal(P.papers, 90, 'a stone costs 10 points of papers');
  const left = 4 - P.followers.length;
  assert.ok(left >= 1 && left <= 2, `${left} supporters left`);

  const at = { x: P.x, y: P.y };
  for (let i = 1; i <= 15; i++) {
    g.step(inp({ mx: -1 }));
    assert.deepEqual({ x: P.x, y: P.y }, at, `still stunned on tick ${i}`);
  }
  g.step(inp({ mx: -1 }));
  assert.ok(P.x < at.x - 1, 'free to move again on tick 16');
});

// AC-6: police within 260 px of a rioting mob escort it. The mob stands at the middle of an open row with the candidate
// 200 px east of it, among 5 supporters (too few to drive the mob back). Three cops stand as posts `back` px west of the
// mob: stationary and far beyond their own 220 px sight of the candidate, so only the escort rule can make them chase.
// The members throw nothing (stones are T-9), so the supporters stay together for the cops to meet. Runs 150 ticks.
function escortScenario(back) {
  const g = play({ goons: false, civilians: 5 });
  const G = g.state, P = G.player;
  const row = openRow(G.map, 14, 8);
  assert.ok(G.mobs && G.mobs.length > 0, 'the game has TDP mobs');
  const mob = G.mobs[0], members = membersOf(G, mob);
  assert.ok(members.length >= 5 && members.length <= 8, 'a mob has 5 to 8 members');
  const cops = G.ents.filter((e) => e.kind === 'cop').slice(0, 3);
  assert.equal(cops.length, 3);

  members.forEach((m, k) => { place(m, row.x + (k % 3) * 8, row.y + (k % 2 ? 6 : -6)); m.throwCd = 1e9; });
  cops.forEach((c, k) => { place(c, row.x - back - k * 15, row.y + (k - 1) * 24); c.mode = 'post'; c.role = 'post'; c.home = { x: c.x, y: c.y }; });
  place(P, row.x + 200, row.y);
  const supporters = recruit(g, 5);
  parkOthers(G, [P, ...members, ...cops, ...supporters], row);
  for (const c of cops) assert.ok(W.dist(c.x, c.y, P.x, P.y) > 300, 'far beyond an ordinary cop’s 220 px sight of the candidate');
  const reach = (c, pick) => pick(...members.map((m) => W.dist(m.x, m.y, c.x, c.y)));
  const out = { cops, nearest: cops.map((c) => reach(c, Math.min)), farthest: cops.map((c) => reach(c, Math.max)), minGap: Infinity, riots: 0, chaseTick: -1, lathi: [] };

  const mobIds = new Set(members.map((m) => m.id)), supporterIds = new Set(supporters.map((c) => c.id));
  for (let i = 1; i <= 150; i++) {
    g.step(NONE);
    for (const e of g.drainEvents()) {
      if (e.t === 'riot') out.riots++;
      if (e.t === 'lathi') out.lathi.push(e);
      if (e.t === 'detained') assert.ok(W.dist(e.x, e.y, P.x, P.y) < 1, 'a detention takes the candidate, nobody else');
    }
    // the police never lay a hand on the mob: its members stay as they are, in mob modes only
    const now = membersOf(G, mob);
    assert.equal(now.length, members.length, 'no mob member is taken away');
    for (const m of now) assert.ok(!m.dead && ['idle', 'riot', 'retreat'].includes(m.mode), `mob member ${m.id} was put in mode ${m.mode}`);
    for (const e of out.lathi) for (const id of e.victims) assert.ok(supporterIds.has(id) && !mobIds.has(id), `lathi victim ${id} is not one of the candidate’s supporters`);
    for (const c of cops) out.minGap = Math.min(out.minGap, reach(c, Math.min));
    if (out.chaseTick < 0 && cops.some((c) => c.mode === 'chase')) out.chaseTick = i;
  }
  return out;
}

test('T-10 police within 260 px of a rioting mob go for the candidate and the crowd; they never touch the mob', () => {
  const near = escortScenario(200);
  assert.ok(near.nearest.every((d) => d >= 190) && near.farthest.every((d) => d <= MOB_ESCORT), `cops stand within 260 px of every mob member: ${near.nearest.map(Math.round)} to ${near.farthest.map(Math.round)}`);
  assert.ok(near.riots >= 1, 'the mob rioted');
  assert.ok(near.chaseTick >= 1 && near.chaseTick <= 90, `no cop chased the candidate within 3 s (first chase: tick ${near.chaseTick})`);
  assert.ok(near.lathi.length > 0, 'the escorting cops used the lathi on the crowd');

  // negative control: the same cops 300 px or more from every member are no escort and stay at their posts
  const far = escortScenario(330);
  assert.ok(far.nearest.every((d) => d >= 300), `control cops stand at least 300 px from every mob member: ${far.nearest.map(Math.round)}`);
  assert.ok(far.riots >= 1, 'the mob rioted in the control too');
  assert.ok(far.minGap > MOB_ESCORT, `the mob came within ${Math.round(far.minGap)} px of a control cop`);
  assert.equal(far.chaseTick, -1, 'a cop beyond 260 px of the mob chased');
  assert.equal(far.lathi.length, 0, 'a cop beyond 260 px of the mob used the lathi');
  assert.ok(far.cops.every((c) => c.mode === 'post'), 'control cops stay at their posts');
});

// A mob 120 px east of the candidate, who stands among `n` supporters; runs 2 s and returns the mob's mean distance
// to the candidate at the start and after every tick.
function mobDistances(n) {
  const g = play({ police: false, goons: false, civilians: n });
  const G = g.state, P = G.player;
  const row = openRow(G.map, 6, 19);
  assert.ok(G.mobs && G.mobs.length > 0, 'the game has TDP mobs');
  const members = membersOf(G, G.mobs[0]);
  place(P, row.x, row.y);
  const supporters = recruit(g, n);
  members.forEach((m, k) => place(m, row.x + 120 + (k % 2) * 10, row.y + (k - members.length / 2) * 6));
  parkOthers(G, [P, ...members, ...supporters], row);
  const mean = () => members.reduce((s, m) => s + W.dist(m.x, m.y, P.x, P.y), 0) / members.length;
  const out = [mean()];
  for (let i = 0; i < 60; i++) { g.step(NONE); g.drainEvents(); out.push(mean()); }
  return out;
}

test('T-11 a crowd of 8 drives a mob back for 2 s; a crowd of 7 does not', () => {
  const eight = mobDistances(8), seven = mobDistances(7);
  for (let i = 1; i < eight.length; i++) assert.ok(eight[i] >= eight[i - 1], `with 8 the mob closed in on tick ${i}`);
  assert.ok(eight[60] > eight[0] + 100, `with 8 the mob only moved from ${eight[0].toFixed(0)} to ${eight[60].toFixed(0)} px`);
  assert.ok(Math.max(...seven) <= seven[0] + 0.5, 'with 7 the mob stays or closes in');
  assert.ok(seven[60] <= seven[0] + 0.5, 'with 7 the mob is no farther after 2 s');
});

// Kadapa, seed 7, everything on; the candidate starts 130 px from a mob and drifts slowly, then walks about.
function replay() {
  const g = S.createGame({ seed: 7, town: 'kadapa', mode: 'nomination', police: true, goons: true, mobs: true });
  const G = g.state, P = G.player;
  assert.ok(G.mobs && G.mobs.length > 0, 'the game has TDP mobs');
  const events = [];
  let placed = false;
  for (let i = 0; i < 900; i++) {
    if (!placed && G.mode === 'play') {
      placed = true;
      const m = membersOf(G, G.mobs[0])[0];
      let spot = null;
      for (let a = 0; a < 16 && !spot; a++) {
        const x = m.x + Math.cos(a * Math.PI / 8) * 130, y = m.y + Math.sin(a * Math.PI / 8) * 130;
        if (!W.solidPx(G.map, x, y) && W.lineOfSight(G.map, m.x, m.y, x, y)) spot = { x, y };
      }
      assert.ok(spot, 'a clear spot near the mob');
      place(P, spot.x, spot.y);
    }
    const k = i < 300 ? 0.15 : 1;
    g.step({ mx: Math.sin(i / 37) * k, my: Math.cos(i / 53) * k, run: i % 240 < 90, act: i % 45 === 0 });
    events.push(...g.drainEvents());
  }
  return {
    player: { x: P.x, y: P.y, papers: P.papers, stun: P.stun, followers: P.followers.length },
    score: G.score,
    ents: G.ents.map((e) => [e.id, e.kind, e.mode, e.x, e.y]),
    stones: G.stones,
    mobs: G.mobs,
    fires: G.fires || [],
    events,
  };
}

test('T-12 two games with the same seed, town and inputs stay identical for 900 ticks with mobs on', () => {
  const a = replay(), b = replay();
  assert.ok(a.events.some((e) => e.t === 'riot'), 'a mob rioted');
  assert.ok(a.events.some((e) => e.t === 'stone'), 'stones were thrown');
  assert.deepEqual(a.player, b.player);
  assert.equal(a.score, b.score);
  assert.deepEqual(a.ents, b.ents);
  assert.deepEqual(a.stones, b.stones);
  assert.deepEqual(a.mobs, b.mobs);
  assert.deepEqual(a.fires, b.fires);
  assert.equal(a.events.length, b.events.length);
  assert.deepEqual(a.events, b.events);
});
