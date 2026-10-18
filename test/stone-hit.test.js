'use strict';
// CP-3 review follow-ups, through the simulation seam: a stone hit is reported by one event, and a stun never outlasts
// a detention.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../shared/sim.js');

const NONE = S.EMPTY_INPUT;

function play() {
  const g = S.createGame({ seed: 5, town: 'pulivendula', police: false, goons: false, mobs: false, civilians: 0 });
  g.step(NONE);
  for (let i = 0; i < 30 && g.state.mode === 'intro'; i++) g.step(Object.assign({}, NONE, { act: i > 20 }));
  assert.equal(g.state.mode, 'play');
  g.drainEvents();
  return g;
}

test('a stone hit is one event: it does not also report the papers as torn', () => {
  const g = play();
  const G = g.state, P = G.player;
  G.stones.push({ x: P.x + 60, y: P.y, px: P.x + 60, py: P.y, x0: P.x + 60, y0: P.y, tx: P.x, ty: P.y, t: 0, T: 0.1 });
  const events = [];
  for (let i = 0; i < 10; i++) { g.step(NONE); events.push(...g.drainEvents()); }
  const hits = events.filter((e) => e.t === 'stone' && e.hit);
  assert.equal(hits.length, 1, 'one stone hit');
  assert.equal(P.papers, 90, 'the stone cost 10 points of papers');
  assert.equal(events.filter((e) => e.t === 'torn').length, 0, 'no second hit event for the same stone');
});

test('a stunned candidate who is detained is not stunned after the release', () => {
  const g = play();
  const G = g.state, P = G.player;
  P.stun = 12;
  g._test.detain({ x: P.x + 10, y: P.y });
  assert.equal(P.state, 'held');
  assert.equal(P.stun, 0, 'the stun ends with the detention');
  for (let i = 0; i < 120 && P.state === 'held'; i++) g.step(NONE);
  assert.equal(P.state, 'free', 'released');
  assert.equal(P.stun, 0);
  const x = P.x;
  g.step(Object.assign({}, NONE, { mx: 1 }));
  assert.ok(P.x > x, 'free to walk the moment the release happens');
});
