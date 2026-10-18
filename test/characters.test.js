'use strict';
// CP-5: each town has an invented YSRCP ally at the party office and an invented TDP leader at the head of the largest mob.
// Cases go through the simulation seam (createGame, step, state, drainEvents) and the Content seam (TOWNS, LINES, fill).
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../shared/sim.js');
const W = require('../shared/world.js');
const Ct = require('../shared/content.js');
const { TILE } = W;

const TOWN_IDS = ['pulivendula', 'kadapa', 'punganur'];
const ALLIES = { pulivendula: 'Ramanna', kadapa: 'Lakshmi Devi', punganur: 'Sivanna' };
const LEADERS = { pulivendula: 'Madhu Toogutla', kadapa: 'Chaitanya', punganur: 'Bhupal' };
const MODE_HOLD = { nomination: 6, vote: 4 }; // seconds at the counter, from the spec
const TPS = 30; // ticks per second

const NONE = S.EMPTY_INPUT;
const inp = (o) => Object.assign({}, NONE, o);
const place = (e, x, y) => { e.x = x; e.y = y; e.px = x; e.py = y; };

function play(opts) {
  const g = S.createGame(Object.assign({ seed: 5, town: 'punganur', mode: 'nomination', police: false, goons: false, mobs: false, civilians: 0 }, opts));
  g.step(NONE);
  for (let i = 0; i < 30 && g.state.mode === 'intro'; i++) g.step(inp({ act: i > 20 }));
  assert.equal(g.state.mode, 'play');
  g.drainEvents();
  return g;
}

const allyOf = (G) => G.ents.find((e) => e.kind === 'ally');

// Walks the candidate towards the ally until the 'ally' event, returning every event seen on the way.
function walkIntoAlly(g) {
  const G = g.state, P = G.player, ally = allyOf(G), events = [];
  assert.ok(ally, 'an ally waits in the town');
  for (let i = 0; i < 90 && !events.some((e) => e.t === 'ally'); i++) {
    const d = W.norm(ally.x - P.x, ally.y - P.y);
    g.step(inp({ mx: d.x, my: d.y }));
    events.push(...g.drainEvents());
  }
  return events;
}

// A stone that lands on the candidate within 10 ticks, and the 'stone' hit event it causes.
function stoneHit(g) {
  const G = g.state, P = G.player, events = [];
  G.stones.push({ x: P.x + 60, y: P.y, px: P.x + 60, py: P.y, x0: P.x + 60, y0: P.y, tx: P.x, ty: P.y, t: 0, T: 0.1 });
  for (let i = 0; i < 10; i++) { g.step(NONE); events.push(...g.drainEvents()); }
  return events.find((e) => e.t === 'stone' && e.hit);
}

// Ticks from the candidate stepping into the counter zone with every document to the run ending, and how it ended.
function holdTicks(g) {
  const G = g.state, P = G.player;
  P.docs = G.M.docs.slice();
  place(P, G.target.x, G.target.y);
  let ticks = 0;
  while (G.mode === 'play' && ticks < 20 * TPS) { g.step(NONE); ticks++; }
  assert.equal(G.mode, 'won', 'the run was won at the counter');
  return ticks;
}

const near = (ticks, expected, what) => assert.ok(Math.abs(ticks - expected) <= 2, `${what}: held ${ticks} ticks, expected about ${expected}`);

for (const id of TOWN_IDS) {
  test(`T-15 ${id}: the ally waits at the party office, joins with 6 supporters, halves stone damage and shortens the hold by 2 s`, () => {
    const g = play({ town: id });
    const G = g.state, P = G.player;
    const ally = allyOf(G);
    assert.ok(ally, 'an ally waits in the town');
    assert.equal(ally.name, ALLIES[id]);
    assert.ok(W.dist(ally.x, ally.y, G.map.start.x, G.map.start.y) <= 3 * TILE, 'the ally waits at the party office');
    assert.equal(P.followers.length, 0);
    assert.equal(G.hold, MODE_HOLD.nomination, 'without the ally the hold is the mode\'s hold');

    const events = walkIntoAlly(g);
    const joined = events.find((e) => e.t === 'ally');
    assert.ok(joined, 'an ally event fired when the candidate walked into the ally');
    assert.ok(joined.text.includes(ALLIES[id]), 'the toast names the ally');
    assert.equal(joined.n, 6, 'the ally brought 6 supporters');
    assert.equal(P.followers.length, 7, 'the crowd grew by the ally and 6 supporters');
    assert.ok(P.followers.includes(ally), 'the ally is in the crowd');
    assert.equal(G.hold, MODE_HOLD.nomination - 2, 'the counter hold is 2 s shorter');

    const hit = stoneHit(g);
    assert.ok(hit, 'a stone hit the candidate');
    assert.equal(hit.amount, 5, 'the hit event reports 5 points');
    assert.equal(P.papers, 95, 'a stone costs 5 points of papers while the ally is in the crowd');
  });
}

test('T-15 the counter takes 4 s with the ally in the crowd and 6 s without (nomination), 2 s and 4 s on Polling Day', () => {
  for (const [mode, withAlly, without] of [['nomination', 4, 6], ['vote', 2, 4]]) {
    const plain = play({ mode });
    near(holdTicks(plain), without * TPS, `${mode} without the ally`);

    const helped = play({ mode });
    walkIntoAlly(helped);
    assert.ok(helped.state.player.followers.includes(allyOf(helped.state)));
    near(holdTicks(helped), withAlly * TPS, `${mode} with the ally`);
  }
});

test('T-15 an ally who leaves the crowd takes the bonuses with them, and comes back alone when the candidate returns', () => {
  const g = play();
  const G = g.state, P = G.player, ally = allyOf(G);
  walkIntoAlly(g);
  assert.equal(P.followers.length, 7);

  g._test.leave(ally, { x: ally.x + 20, y: ally.y }, true); // scattered, for example by a lathi charge
  assert.ok(!P.followers.includes(ally));
  g.step(NONE);
  assert.equal(G.hold, MODE_HOLD.nomination, 'the hold is back to normal');
  const hit = stoneHit(g);
  assert.equal(hit.amount, 10, 'a stone costs the full 10 points again');
  assert.equal(P.papers, 90);

  const townspeople = G.ents.filter((e) => e.kind === 'civ').length;
  for (let i = 0; i < 20 * TPS; i++) g.step(NONE); // the scattered ally calms down
  g.drainEvents();
  place(P, ally.x, ally.y);
  const events = walkIntoAlly(g);
  const back = events.find((e) => e.t === 'ally');
  assert.ok(back, 'an ally event fired when the ally returned');
  assert.equal(back.n, 0, 'the ally does not bring the supporters a second time');
  assert.ok(P.followers.includes(ally), 'the ally is back in the crowd');
  assert.equal(G.ents.filter((e) => e.kind === 'civ').length, townspeople, 'no new supporters appeared');
  assert.equal(G.hold, MODE_HOLD.nomination - 2);
});

test('T-15 the crowd never takes the ally away when it lifts a cop', () => {
  const g = play({ police: true });
  const G = g.state, P = G.player;
  walkIntoAlly(g);
  const ally = allyOf(G), cop = G.ents.find((e) => e.kind === 'cop');
  for (const e of G.ents) if (e !== cop && e !== ally && !P.followers.includes(e)) place(e, W.WORLD - 200, W.WORLD - 200);
  const supporters = P.followers.filter((f) => f !== ally);
  assert.equal(supporters.length, 6);
  supporters.forEach((f, i) => place(f, P.x - 40, P.y + (i - 3) * 6)); // a shield of supporters, all farther from the cop than the ally
  place(ally, P.x + 10, P.y);
  place(cop, P.x + 10, P.y);
  cop.mode = 'chase';
  const events = [];
  for (let i = 0; i < 3; i++) { g.step(NONE); events.push(...g.drainEvents()); }
  assert.ok(events.some((e) => e.t === 'lift'), 'the crowd lifted the cop');
  assert.ok(G.ents.includes(ally), 'the ally is still in the town');
  assert.ok(P.followers.includes(ally), 'the ally is still in the crowd');
});

for (const id of TOWN_IDS) {
  for (const mode of ['nomination', 'vote']) {
    test(`T-16 ${id} ${mode}: the TDP leader heads the largest mob, which is within 8 tiles of the target after 20 s`, () => {
      const g = play({ town: id, mode, police: true, goons: true, mobs: true, civilians: 150 });
      for (let i = 0; i < 20 * TPS; i++) g.step(NONE);
      const G = g.state;
      const leaders = G.ents.filter((e) => e.role === 'leader');
      assert.equal(leaders.length, 1, 'one TDP leader');
      const leader = leaders[0];
      assert.equal(leader.kind, 'mob', 'the leader is a member of a mob');
      assert.equal(leader.name, LEADERS[id]);

      const size = new Map();
      for (const e of G.ents) if (e.kind === 'mob') size.set(e.mob, (size.get(e.mob) || 0) + 1);
      const own = size.get(leader.mob);
      for (const [mob, n] of size) if (mob !== leader.mob) assert.ok(own > n, `the leader's mob (${own}) is larger than mob ${mob} (${n})`);

      const members = G.ents.filter((e) => e.kind === 'mob' && e.mob === leader.mob);
      for (const m of members) assert.ok(W.dist(m.x, m.y, G.target.x, G.target.y) <= 8 * TILE, `mob member ${m.id} is ${Math.round(W.dist(m.x, m.y, G.target.x, G.target.y) / TILE)} tiles from the ${G.M.goal}`);
    });
  }
}

test('T-16 the leader\'s mob names its leader when it riots', () => {
  for (const id of TOWN_IDS) {
    const g = play({ town: id, police: false, goons: false, mobs: true, civilians: 0 });
    const G = g.state, P = G.player;
    const leader = G.ents.find((e) => e.role === 'leader');
    let spot = null;
    for (let a = 0; a < 16 && !spot; a++) {
      const x = leader.x + Math.cos(a * Math.PI / 8) * 130, y = leader.y + Math.sin(a * Math.PI / 8) * 130;
      if (!W.solidPx(G.map, x, y) && W.lineOfSight(G.map, leader.x, leader.y, x, y)) spot = { x, y };
    }
    assert.ok(spot, 'a clear spot near the leader');
    place(P, spot.x, spot.y);
    let riot = null;
    for (let i = 0; i < 5 * TPS && !riot; i++) { g.step(NONE); riot = g.drainEvents().find((e) => e.t === 'riot' && e.mob === leader.mob); }
    assert.ok(riot, `${id}: the leader's mob rioted`);
    assert.ok(riot.text.includes(LEADERS[id]), `${id}: the warning names ${LEADERS[id]}: "${riot.text}"`);
  }
});

const stringsIn = (v, out = []) => {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => stringsIn(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => stringsIn(x, out));
  return out;
};

test('T-16 the towns carry their invented ally and leader', () => {
  for (const id of TOWN_IDS) {
    assert.equal(Ct.TOWNS[id].ally, ALLIES[id]);
    assert.equal(Ct.TOWNS[id].leader, LEADERS[id]);
  }
});

test('T-16 every Content string fills its placeholders in every town', () => {
  const strings = stringsIn(Ct.LINES).concat(stringsIn(Ct.TOWNS), stringsIn(Ct.MODES), Ct.MISSIONS.map((m) => m.txt));
  assert.ok(strings.length > 100, 'lines were collected');
  for (const id of TOWN_IDS) {
    const vars = Object.assign({ n: 3, s: 's', doc: 'Affidavit' }, Ct.TOWNS[id]); // {n} {s} {doc} are filled by the game as it plays
    for (const s of strings) {
      const filled = Ct.fill(s, vars);
      assert.ok(!/[{}]/.test(filled), `${id}: "${s}" left a brace in "${filled}"`);
    }
  }
  const names = stringsIn(Ct.LINES.ally).concat(stringsIn(Ct.LINES.leader), stringsIn(Ct.LINES.riotLeader), stringsIn(Ct.LINES.allyJoined));
  assert.ok(names.some((s) => s.includes('{ally}')) && names.some((s) => s.includes('{leader}')), 'the ally and leader lines use their name placeholders');
  assert.equal(Ct.fill('{ally} and {leader}', Ct.TOWNS.kadapa), 'Lakshmi Devi and Chaitanya');
});

test('T-16 no real person is named and none of the quoted threat lines appear', () => {
  const real = /\b(jagan|ysr(?!\s+congress)|chandrababu|naidu|babu|lokesh|pawan|avinash|mithun|peddireddy|sreenivasulu|madhavi|btech ravi|koya praveen|amzad)\b/i;
  const quoted = ['champesta', 'veyakudadhu', 'ela vestaro', 'chuskundam'];
  const strings = stringsIn(Ct.LINES).concat(stringsIn(Ct.TOWNS), stringsIn(Ct.MODES), stringsIn(Ct.PARTY), stringsIn(Ct.RIVAL), Ct.MISSIONS.map((m) => m.txt));
  for (const id of TOWN_IDS) {
    for (const s of strings) {
      const filled = Ct.fill(s, Object.assign({ n: 3, s: 's', doc: 'Affidavit' }, Ct.TOWNS[id]));
      assert.ok(!real.test(filled), `a real name in "${filled}"`);
      for (const q of quoted) assert.ok(!filled.toLowerCase().includes(q), `a quoted threat line in "${filled}"`);
    }
  }
});
