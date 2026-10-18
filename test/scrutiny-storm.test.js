'use strict';
// CP-6: the TDP leader gets to the RO counter during the scrutiny in every town on every seed, even when the spawn point leaves
// them wedged against a wall (Punganur, seed 35, used to leave the leader 191 px away for the whole scene).
// Goes through the simulation seam (createGame, step, state, drainEvents).
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../shared/sim.js');
const W = require('../shared/world.js');

const TPS = 30; // ticks per second
const NONE = S.EMPTY_INPUT;
const TOWN_IDS = ['pulivendula', 'kadapa', 'punganur'];
const SEEDS = Array.from({ length: 40 }, (_, i) => i + 1);
const NEAR = 3 * W.TILE; // "at the counter": within three tiles of it

const place = (e, x, y) => { e.x = x; e.y = y; e.px = x; e.py = y; };

// Files the nomination at once and plays on until the scrutiny has torn its nominations; returns how far the leader is from the counter.
function leaderAtTear(town, seed) {
  const g = S.createGame({ seed, town, mode: 'nomination', civilians: 0 });
  const G = g.state, P = G.player;
  g.step(NONE);
  for (let i = 0; i < 30 && G.mode === 'intro'; i++) g.step(Object.assign({}, NONE, { act: i > 20 }));
  assert.equal(G.mode, 'play', `${town} seed ${seed}: the intro is over`);
  P.docs = G.M.docs.slice();
  place(P, G.target.x, G.target.y);
  P.submitT = G.hold - 0.01; // one step from the end of the hold
  g.step(NONE);
  assert.equal(G.mode, 'won', `${town} seed ${seed}: the hold finished`);
  for (let i = 0; i < 30 * TPS && !G.result.scrutiny; i++) g.step(NONE);
  assert.ok(G.result.scrutiny, `${town} seed ${seed}: the scrutiny reached the tear`);
  const leader = G.ents.find((e) => e.role === 'leader');
  return W.dist(leader.x, leader.y, G.target.x, G.target.y);
}

for (const id of TOWN_IDS) {
  test(`T-17 ${id}: on seeds 1 to 40 the TDP leader stands within 3 tiles of the counter by the tear`, () => {
    const far = [];
    for (const seed of SEEDS) {
      const d = leaderAtTear(id, seed);
      if (d > NEAR) far.push(`seed ${seed}: ${Math.round(d)} px`);
    }
    assert.deepEqual(far, [], `${id}: the leader is stuck away from the counter (limit ${NEAR} px)`);
  });
}
