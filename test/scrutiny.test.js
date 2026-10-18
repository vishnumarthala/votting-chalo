'use strict';
// CP-6: filing a nomination wins the run and the scrutiny follows: the TDP mob storms the RO office, 6 of the 10 filed
// nominations are snatched and torn, 4 are accepted. Polling Day ends as before.
// Cases go through the simulation seam (createGame, step, state, drainEvents) and the Content seam (SCRUTINY, LINES, fill).
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../shared/sim.js');
const W = require('../shared/world.js');
const Ct = require('../shared/content.js');
const { makeBot } = require('./bot.js');

const TPS = 30; // ticks per second
const NONE = S.EMPTY_INPUT;
const TOWN_IDS = ['pulivendula', 'kadapa', 'punganur'];
const SPEC_RESULT = { filed: 10, torn: 6, accepted: 4 }; // the user's request: only 4 of the 10 filed nominations survive

const place = (e, x, y) => { e.x = x; e.y = y; e.px = x; e.py = y; };

// Collects the events a game drains, each with the tick it came on.
function recorder(g) {
  const seen = [];
  return { seen, collect() { for (const e of g.drainEvents()) seen.push(Object.assign({ tick: g.state.tick }, e)); } };
}

// The route-following bot plays a town without police, goons or mobs until the run is won.
function winWithBot(mode, town = 'pulivendula') {
  const g = S.createGame({ seed: 1, town, mode, police: false, goons: false, mobs: false });
  const bot = makeBot(g), rec = recorder(g);
  for (let n = 0; (g.state.mode === 'intro' || g.state.mode === 'play') && n < 30 * TPS * 20; n++) { g.step(bot()); rec.collect(); }
  assert.equal(g.state.mode, 'won', 'the bot filed the nomination');
  return { g, rec };
}

// Steps until the scrutiny has torn its nominations (result.scrutiny is set) or `limit` seconds pass.
function playScrutiny(g, rec, input = NONE, limit = 30) {
  for (let i = 0; i < limit * TPS && !g.state.result.scrutiny; i++) { g.step(input); rec.collect(); }
}

// Presses Space through the intro card and drops the intro's events.
function skipIntro(g) {
  g.step(NONE);
  for (let i = 0; i < 30 && g.state.mode === 'intro'; i++) g.step(Object.assign({}, NONE, { act: i > 20 }));
  assert.equal(g.state.mode, 'play');
  g.drainEvents();
}

const ofType = (seen, t) => seen.filter((e) => e.t === t);

test('T-17 nomination in Pulivendula: after the counter hold, 6 nominations are snatched and 1 torn event follows, ending won with 10 filed, 6 torn, 4 accepted', () => {
  const { g, rec } = winWithBot('nomination');
  const G = g.state;
  assert.equal(G.result.won, true, 'the filing itself is a win');
  assert.equal(ofType(rec.seen, 'snatch').length, 0, 'the scrutiny has not begun snatching yet at the filing');

  playScrutiny(g, rec);
  const snatches = ofType(rec.seen, 'snatch'), tears = ofType(rec.seen, 'tear');
  assert.equal(snatches.length, 6, 'exactly 6 nominations are snatched');
  assert.equal(tears.length, 1, 'exactly 1 tear event');
  assert.deepEqual(snatches.map((e) => e.n), [1, 2, 3, 4, 5, 6], 'one snatch per nomination, counted in order');
  assert.ok(snatches.every((s) => s.tick < tears[0].tick), 'every snatch comes before the tear');
  for (let k = 1; k < 6; k++) assert.ok(snatches[k].tick > snatches[k - 1].tick, 'the snatches are spaced out, not all on one tick');
  const seconds = (tears[0].tick - snatches[0].tick) / TPS;
  assert.ok(seconds >= 2 && seconds <= 10, `the snatching lasts a few seconds, not ${seconds.toFixed(1)} s`);
  for (const e of snatches.concat(tears)) {
    assert.ok(Number.isFinite(e.x) && Number.isFinite(e.y), 'the event says where it happened');
    assert.equal(typeof e.text, 'string');
    assert.ok(!/[{}]/.test(e.text), `placeholders are filled in "${e.text}"`);
  }

  assert.equal(G.mode, 'won', 'the run ends won');
  assert.equal(G.result.won, true);
  assert.deepEqual(G.result.scrutiny, SPEC_RESULT);
  assert.ok(G.result.score > 0 && G.bonus.timeBonus > 0, 'the run still scores as a win');

  for (let i = 0; i < 10 * TPS; i++) { g.step(NONE); rec.collect(); }
  assert.equal(ofType(rec.seen, 'snatch').length, 6, 'no further snatches');
  assert.equal(ofType(rec.seen, 'tear').length, 1, 'no further tears');
  assert.deepEqual(G.result.scrutiny, SPEC_RESULT);
});

test('T-17 Polling Day in Pulivendula ends as before: won, no scrutiny field, no snatch or tear events', () => {
  const { g, rec } = winWithBot('vote');
  const G = g.state;
  assert.equal(G.result.won, true);
  for (let i = 0; i < 12 * TPS; i++) { g.step(NONE); rec.collect(); }
  assert.equal(G.mode, 'won');
  assert.equal(ofType(rec.seen, 'snatch').length, 0);
  assert.equal(ofType(rec.seen, 'tear').length, 0);
  assert.ok(!('scrutiny' in G.result), 'the vote result carries no scrutiny');
});

test('T-17 the scrutiny is the same with any input: the player cannot break it', () => {
  const run = (input) => {
    const { g, rec } = winWithBot('nomination');
    playScrutiny(g, rec, input);
    return { result: g.state.result, ticks: rec.seen.filter((e) => e.t === 'snatch' || e.t === 'tear').map((e) => e.t + '@' + e.tick) };
  };
  const still = run(NONE);
  const frantic = run({ mx: 1, my: -1, run: true, act: true });
  assert.deepEqual(frantic.ticks, still.ticks, 'the scripted sequence runs on the same ticks');
  assert.deepEqual(frantic.result.scrutiny, SPEC_RESULT);
  assert.equal(frantic.result.won, true);
  assert.equal(frantic.result.score, still.result.score);
});

for (const id of TOWN_IDS) {
  test(`T-17 ${id}: the mob storms the counter, police stand aside, and nothing is thrown or burnt during the scrutiny`, () => {
    const g = S.createGame({ seed: 5, town: id, mode: 'nomination', civilians: 0 });
    const G = g.state, P = G.player;
    skipIntro(g);
    P.docs = G.M.docs.slice();
    place(P, G.target.x, G.target.y);
    P.submitT = G.hold - 0.01; // one step from the end of the hold
    const rec = recorder(g);
    g.step(NONE); rec.collect();
    assert.equal(G.mode, 'won', `${id}: the hold finished`);

    // a police officer is already at the candidate's side, in the middle of an arrest
    const cop = G.ents.find((e) => e.kind === 'cop');
    place(cop, P.x + 10, P.y);
    cop.mode = 'chase';
    const leader = G.ents.find((e) => e.role === 'leader');
    const before = W.dist(leader.x, leader.y, G.target.x, G.target.y);
    playScrutiny(g, rec);
    assert.deepEqual(G.result.scrutiny, SPEC_RESULT, `${id}: the scrutiny ran to its end`);

    for (const t of ['detained', 'grab', 'lathi', 'lift', 'gas', 'fire', 'torn']) assert.equal(ofType(rec.seen, t).length, 0, `${id}: no '${t}' event during the scrutiny`);
    assert.ok(!ofType(rec.seen, 'stone').some((e) => e.hit), `${id}: no stone hit`);
    assert.equal(P.cases, 0, `${id}: the candidate was not arrested`);
    assert.equal(P.state, 'free');
    const after = W.dist(leader.x, leader.y, G.target.x, G.target.y);
    assert.ok(after < before, `${id}: the TDP leader moved in on the counter (${Math.round(before)} px to ${Math.round(after)} px)`);
    assert.ok(after <= G.target.r, `${id}: the TDP leader stands at the counter, ${Math.round(after)} px away`);
  });
}

test('T-17 the scrutiny lines are original: filled, no real name, none of the quoted threats', () => {
  const real = /\b(jagan|ysr(?!\s+congress)|chandrababu|naidu|babu|lokesh|pawan|avinash|mithun|peddireddy|sreenivasulu|madhavi|btech ravi|koya praveen|amzad)\b/i;
  const quoted = ['champesta', 'veyakudadhu', 'ela vestaro', 'chuskundam'];
  const strings = (v, out = []) => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
    else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out));
    return out;
  };
  for (const key of ['scrutiny', 'snatch', 'snatchShout', 'tear']) {
    assert.ok(Array.isArray(Ct.LINES[key]) && Ct.LINES[key].length >= 2, `LINES.${key} has at least two lines`);
  }
  assert.ok(Ct.SCRUTINY, 'Content has the scrutiny panel copy');
  const all = strings([Ct.LINES.scrutiny, Ct.LINES.snatch, Ct.LINES.snatchShout, Ct.LINES.tear, Ct.SCRUTINY]);
  for (const id of TOWN_IDS) {
    for (const s of all) {
      const filled = Ct.fill(s, Object.assign({ n: 3, s: 's', doc: 'Affidavit' }, Ct.TOWNS[id]));
      assert.ok(!/[{}]/.test(filled), `${id}: "${s}" left a brace in "${filled}"`);
      assert.ok(!real.test(filled), `a real name in "${filled}"`);
      for (const q of quoted) assert.ok(!filled.toLowerCase().includes(q), `a quoted threat line in "${filled}"`);
    }
  }
});

test('T-17 the result panel copy gives the three tally lines from the result numbers', () => {
  assert.ok(Ct.SCRUTINY, 'Content has the scrutiny panel copy');
  const vars = Object.assign({}, Ct.TOWNS.kadapa);
  assert.equal(Ct.fill(Ct.SCRUTINY.filed, Object.assign({ n: 10 }, vars)), '10 YSRCP nominations filed');
  assert.equal(Ct.fill(Ct.SCRUTINY.torn, Object.assign({ n: 6 }, vars)), '6 snatched and torn');
  assert.equal(Ct.fill(Ct.SCRUTINY.accepted, Object.assign({ n: 4 }, vars)), '4 accepted');
  assert.ok(Ct.fill(Ct.SCRUTINY.title, vars).includes('Kadapa'), 'the heading names the town');
});

// CP-5 leftover: the ally's supporters are only counted as brought once they have actually been spawned.
test('T-15 an ally who joins a full crowd brings the 6 supporters when they next join with room to spare', () => {
  const g = S.createGame({ seed: 5, town: 'punganur', mode: 'nomination', police: false, goons: false, mobs: false, civilians: 40 });
  const G = g.state, P = G.player;
  skipIntro(g);
  const ally = G.ents.find((e) => e.kind === 'ally');
  const civs = G.ents.filter((e) => e.kind === 'civ');
  for (const c of civs) if (P.followers.length < g.CAP - 1) g._test.join(c);
  assert.equal(P.followers.length, g.CAP - 1, 'the crowd has room for exactly one more');
  g.drainEvents();

  const walkTo = (e) => { place(P, e.x, e.y); g.step(NONE); return g.drainEvents().find((ev) => ev.t === 'ally'); };
  const first = walkTo(ally);
  assert.ok(first, 'the ally joined');
  assert.equal(first.n, 0, 'there was no room for their supporters');
  assert.equal(P.followers.length, g.CAP);

  g._test.leave(ally, { x: ally.x + 20, y: ally.y }, true);
  for (const f of P.followers.slice(0, 10)) g._test.leave(f, { x: f.x + 20, y: f.y }, false);
  for (let i = 0; i < 20 * TPS; i++) g.step(NONE); // the scattered ally calms down
  g.drainEvents();
  const again = walkTo(ally);
  assert.ok(again, 'the ally joined again');
  assert.equal(again.n, 6, 'the supporters come now that there is room');
});
